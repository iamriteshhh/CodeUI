//! Pseudo-terminal lifecycle on top of `portable-pty`.
//!
//! A real PTY (not piped stdio) is what lets `vim`, `top`, `Ctrl+C` and
//! interactive prompts behave the way they do in a native terminal.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize, SlavePty};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("terminal session with id {0} already exists")]
    AlreadyExists(String),
    #[error("no terminal session with id {0}")]
    UnknownSession(String),
    #[error("could not open a pseudo-terminal: {0}")]
    OpenFailed(String),
    #[error("could not start shell `{shell}`: {message}")]
    SpawnFailed { shell: String, message: String },
    #[error("{0}")]
    Io(String),
}

/// `{ kind, message }` with `message` the readable text (the derived form sent only the
/// path, or nothing for unit variants).
impl Serialize for PtyError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            PtyError::AlreadyExists(_) => "AlreadyExists",
            PtyError::UnknownSession(_) => "UnknownSession",
            PtyError::OpenFailed(_) => "OpenFailed",
            PtyError::SpawnFailed { .. } => "SpawnFailed",
            PtyError::Io(_) => "Io",
        };
        let mut out = serializer.serialize_struct("PtyError", 2)?;
        out.serialize_field("kind", kind)?;
        out.serialize_field("message", &self.to_string())?;
        out.end()
    }
}

/// A terminal's writer, held separately so a blocked write never pins the
/// manager's session map.
type SessionWriter = Arc<Mutex<Box<dyn Write + Send>>>;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    _slave: Option<Box<dyn SlavePty + Send>>,
    writer: SessionWriter,
    child: Box<dyn Child + Send + Sync>,
}

impl PtySession {
    fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        // Drives TIOCSWINSZ; without it full-screen programs render garbage.
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// How to open a terminal session.
///
/// The caller supplies `id` so it can wire up listeners before any output
/// exists; the shell's first prompt arrives within milliseconds of spawning.
pub struct PtySpawnOptions {
    pub id: String,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    /// Opens a PTY running the requested shell, streaming output through `on_data`.
    pub fn spawn(
        &self,
        opts: PtySpawnOptions,
        on_data: impl Fn(String) + Send + 'static,
        on_exit: impl Fn() + Send + 'static,
    ) -> Result<String, PtyError> {
        let PtySpawnOptions {
            id,
            shell,
            cwd,
            cols,
            rows,
        } = opts;

        // Duplicate session ID protection
        {
            let sessions = self.sessions.lock().expect("pty sessions");
            if sessions.contains_key(&id) {
                return Err(PtyError::AlreadyExists(id));
            }
        }

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::OpenFailed(e.to_string()))?;

        let shell = shell
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(default_shell);
        let mut builder = CommandBuilder::new(&shell);
        if shell.to_lowercase().contains("powershell") {
            builder.arg("-NoLogo");
        }
        if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
            if std::path::Path::new(&dir).is_dir() {
                builder.cwd(dir);
            }
        }
        // Tells the shell and its children that a capable terminal is attached.
        builder.env("TERM", "xterm-256color");
        // Same PATH the Run button uses, so `sf`, gcc, etc. resolve identically in the terminal.
        builder.env("PATH", crate::proc::augmented_path());
        if let Some(lang) = crate::proc::utf8_locale_override() {
            builder.env("LANG", lang);
            builder.env("LC_ALL", lang);
        }

        let mut child = pair
            .slave
            .spawn_command(builder)
            .map_err(|e| PtyError::SpawnFailed {
                shell: shell.clone(),
                message: e.to_string(),
            })?;

        // The shell is already running by this point. If wiring up its streams
        // fails, kill it here - returning early would orphan it.
        let streams = pair
            .master
            .try_clone_reader()
            .and_then(|reader| pair.master.take_writer().map(|writer| (reader, writer)));

        let (reader, writer) = match streams {
            Ok(pair) => pair,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(PtyError::Io(e.to_string()));
            }
        };

        // On Windows ConPTY, the slave handle must be kept alive alongside the session
        // so child process stdin (e.g. scanf, input prompts) remains connected.
        #[cfg(windows)]
        let slave_handle = Some(pair.slave);
        #[cfg(not(windows))]
        let slave_handle = {
            drop(pair.slave);
            None
        };

        let session = PtySession {
            master: pair.master,
            _slave: slave_handle,
            writer: Arc::new(Mutex::new(writer)),
            child,
        };
        {
            // Re-checked under the lock: a concurrent spawn with the same id may
            // have won since the early check. Inserting blindly would drop the
            // other session's handle and orphan its shell.
            let mut sessions = self.sessions.lock().expect("pty sessions");
            if sessions.contains_key(&id) {
                drop(sessions);
                let mut session = session;
                session.kill();
                return Err(PtyError::AlreadyExists(id));
            }
            sessions.insert(id.clone(), session);
        }

        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            let mut pending: Vec<u8> = Vec::new();
            let mut last_flush = std::time::Instant::now();
            let flush_interval = std::time::Duration::from_millis(16);

            loop {
                match std::io::Read::read(&mut reader, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                    }
                }

                // Batch output to prevent UI IPC event flood during rapid prints
                let wait = flush_interval.saturating_sub(last_flush.elapsed());
                if !wait.is_zero() && pending.len() < 8192 {
                    std::thread::sleep(wait);
                }

                // `top` and `vim` emit box-drawing characters that can
                // straddle a read boundary; hold the split tail back.
                if let Some(chunk) = crate::proc::take_utf8(&mut pending) {
                    on_data(chunk);
                }
                last_flush = std::time::Instant::now();
            }

            if !pending.is_empty() {
                on_data(String::from_utf8_lossy(&pending).into_owned());
            }
            on_exit();
        });

        Ok(id)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), PtyError> {
        // The writer is taken out first. A PTY's input buffer is only a few
        // kilobytes, so pasting into a program that has stopped reading blocks
        // here - and holding the session map through that would freeze every
        // other terminal, including the one the student wants to fix it from.
        let writer = {
            let sessions = self.sessions.lock().expect("pty sessions");
            let session = sessions
                .get(id)
                .ok_or_else(|| PtyError::UnknownSession(id.to_string()))?;
            Arc::clone(&session.writer)
        };

        let mut writer = writer.lock().expect("pty writer");
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().expect("pty sessions");
        sessions
            .get(id)
            .ok_or_else(|| PtyError::UnknownSession(id.to_string()))?
            .resize(cols, rows)
    }

    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        let mut session = self
            .sessions
            .lock()
            .expect("pty sessions")
            .remove(id)
            .ok_or_else(|| PtyError::UnknownSession(id.to_string()))?;
        // Killed after releasing the map: waiting on a dying shell must not
        // block every other terminal.
        session.kill();
        Ok(())
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .expect("pty sessions")
            .keys()
            .cloned()
            .collect()
    }

    /// Destroys every shell. Called on app exit and when the workspace changes,
    /// so no session outlives its workspace.
    pub fn shutdown_all(&self) {
        let sessions: Vec<PtySession> = self
            .sessions
            .lock()
            .expect("pty sessions")
            .drain()
            .map(|(_, s)| s)
            .collect();
        for mut session in sessions {
            session.kill();
        }
    }
}

/// The student's login shell, or a sane fallback.
pub fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
    #[cfg(windows)]
    {
        if which::which("powershell.exe").is_ok() {
            "powershell.exe".to_string()
        } else {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn test_pty_spawn_and_write() {
        let mgr = PtyManager::default();
        let received_output = Arc::new(Mutex::new(String::new()));
        let r_clone = Arc::clone(&received_output);

        let id = mgr.spawn(
            PtySpawnOptions {
                id: "test-session".to_string(),
                shell: None,
                cwd: None,
                cols: 80,
                rows: 24,
            },
            move |data| {
                println!("PTY DATA: {:?}", data);
                r_clone.lock().unwrap().push_str(&data);
            },
            || {
                println!("PTY EXITED");
            },
        );

        assert!(id.is_ok(), "Failed to spawn PTY: {:?}", id.err());
        let id = id.unwrap();

        let test_cmd = if cfg!(windows) {
            "echo CODEUI_PTY_OK\r\n"
        } else {
            "echo CODEUI_PTY_OK\n"
        };

        let start = std::time::Instant::now();
        let mut found = false;

        // Give shell up to 10 seconds to start and echo output (handles slow CI runners)
        while start.elapsed() < std::time::Duration::from_secs(10) {
            let _ = mgr.write(&id, test_cmd);
            std::thread::sleep(std::time::Duration::from_millis(500));
            let current = received_output.lock().unwrap().clone();
            if current.contains("CODEUI_PTY_OK") {
                found = true;
                break;
            }
        }

        let output = received_output.lock().unwrap().clone();
        println!("TOTAL PTY OUTPUT: {:?}", output);
        assert!(
            found,
            "Did not receive CODEUI_PTY_OK in PTY output within timeout: {:?}",
            output
        );
        let _ = mgr.kill(&id);
    }

    fn opts(id: &str) -> PtySpawnOptions {
        PtySpawnOptions {
            id: id.to_string(),
            shell: None,
            cwd: None,
            cols: 80,
            rows: 24,
        }
    }

    /// Writes `marker` until it shows up in the session's output.
    fn echo_round_trip(mgr: &PtyManager, id: &str, out: &Arc<Mutex<String>>, marker: &str) -> bool {
        let cmd = if cfg!(windows) {
            format!("echo {marker}\r\n")
        } else {
            format!("echo {marker}\n")
        };
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_secs(10) {
            let _ = mgr.write(id, &cmd);
            std::thread::sleep(std::time::Duration::from_millis(300));
            if out.lock().unwrap().contains(marker) {
                return true;
            }
        }
        false
    }

    fn spawn_capturing(mgr: &PtyManager, id: &str) -> (Arc<Mutex<String>>, Arc<AtomicBool>) {
        let out = Arc::new(Mutex::new(String::new()));
        let exited = Arc::new(AtomicBool::new(false));
        let (o, e) = (Arc::clone(&out), Arc::clone(&exited));
        mgr.spawn(
            opts(id),
            move |data| o.lock().unwrap().push_str(&data),
            move || e.store(true, Ordering::SeqCst),
        )
        .expect("spawn pty");
        (out, exited)
    }

    fn wait_for(flag: &AtomicBool) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_secs(10) {
            if flag.load(Ordering::SeqCst) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn resize_and_kill_lifecycle() {
        let mgr = PtyManager::default();
        let (_out, exited) = spawn_capturing(&mgr, "life");
        assert_eq!(mgr.session_ids(), vec!["life".to_string()]);

        mgr.resize("life", 120, 40).expect("resize live session");
        mgr.kill("life").expect("kill live session");

        assert!(mgr.session_ids().is_empty());
        assert!(
            wait_for(&exited),
            "reader thread must report exit after kill"
        );
        // A killed session is gone for every operation, not half-alive.
        assert!(matches!(
            mgr.write("life", "x"),
            Err(PtyError::UnknownSession(_))
        ));
        assert!(matches!(
            mgr.resize("life", 80, 24),
            Err(PtyError::UnknownSession(_))
        ));
        assert!(matches!(mgr.kill("life"), Err(PtyError::UnknownSession(_))));
    }

    #[test]
    fn unknown_session_operations_fail_cleanly() {
        let mgr = PtyManager::default();
        assert!(matches!(
            mgr.write("nope", "x"),
            Err(PtyError::UnknownSession(_))
        ));
        assert!(matches!(
            mgr.resize("nope", 80, 24),
            Err(PtyError::UnknownSession(_))
        ));
        assert!(matches!(mgr.kill("nope"), Err(PtyError::UnknownSession(_))));
    }

    #[test]
    fn sessions_are_independent() {
        let mgr = PtyManager::default();
        let (out_a, _) = spawn_capturing(&mgr, "a");
        let (out_b, _) = spawn_capturing(&mgr, "b");
        let mut ids = mgr.session_ids();
        ids.sort();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);

        mgr.kill("a").unwrap();
        // Killing one terminal leaves the other fully working.
        assert!(echo_round_trip(&mgr, "b", &out_b, "CODEUI_B_ALIVE"));
        assert!(!out_a.lock().unwrap().contains("CODEUI_B_ALIVE"));
        mgr.kill("b").unwrap();
    }

    #[test]
    fn shutdown_all_leaves_no_sessions() {
        let mgr = PtyManager::default();
        let exits: Vec<_> = (0..3)
            .map(|i| spawn_capturing(&mgr, &format!("s{i}")).1)
            .collect();
        assert_eq!(mgr.session_ids().len(), 3);

        mgr.shutdown_all();

        assert!(mgr.session_ids().is_empty());
        for exited in &exits {
            assert!(wait_for(exited), "every shell must exit on shutdown");
        }
        mgr.shutdown_all(); // idempotent
    }

    #[test]
    fn concurrent_duplicate_spawns_keep_exactly_one_session() {
        let mgr = Arc::new(PtyManager::default());
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let mgr = Arc::clone(&mgr);
                std::thread::spawn(move || mgr.spawn(opts("race"), |_| {}, || {}))
            })
            .collect();
        let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();

        let ok = results.iter().filter(|r| r.is_ok()).count();
        assert_eq!(ok, 1, "exactly one spawn wins: {results:?}");
        assert!(results
            .iter()
            .filter_map(|r| r.as_ref().err())
            .all(|e| matches!(e, PtyError::AlreadyExists(_))));
        assert_eq!(mgr.session_ids(), vec!["race".to_string()]);
        mgr.shutdown_all();
    }

    #[test]
    fn test_duplicate_session_id_is_rejected() {
        let mgr = PtyManager::default();
        let res1 = mgr.spawn(
            PtySpawnOptions {
                id: "dup-session".to_string(),
                shell: None,
                cwd: None,
                cols: 80,
                rows: 24,
            },
            |_| {},
            || {},
        );
        assert!(res1.is_ok());

        let res2 = mgr.spawn(
            PtySpawnOptions {
                id: "dup-session".to_string(),
                shell: None,
                cwd: None,
                cols: 80,
                rows: 24,
            },
            |_| {},
            || {},
        );
        assert!(matches!(res2, Err(PtyError::AlreadyExists(_))));
        let _ = mgr.kill("dup-session");
    }
}
