//! Pseudo-terminal lifecycle on top of `portable-pty`.
//!
//! A real PTY (not piped stdio) is what lets `vim`, `top`, `Ctrl+C` and
//! interactive prompts behave the way they do in a native terminal.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize, SlavePty};
use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
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

        self.sessions.lock().expect("pty sessions").insert(
            id.clone(),
            PtySession {
                master: pair.master,
                _slave: slave_handle,
                writer: Arc::new(Mutex::new(writer)),
                child,
            },
        );

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
        let mut sessions = self.sessions.lock().expect("pty sessions");
        let mut session = sessions
            .remove(id)
            .ok_or_else(|| PtyError::UnknownSession(id.to_string()))?;
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

    /// Destroys every shell. Called on window close so no session outlives the app.
    pub fn shutdown_all(&self) {
        let mut sessions = self.sessions.lock().expect("pty sessions");
        for (_, mut session) in sessions.drain() {
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
