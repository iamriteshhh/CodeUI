//! Pseudo-terminal lifecycle on top of `portable-pty`.
//!
//! A real PTY (not piped stdio) is what lets `vim`, `top`, `Ctrl+C` and
//! interactive prompts behave the way they do in a native terminal.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum PtyError {
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

        // The slave handle must drop here, otherwise the reader never sees EOF
        // when the shell exits.
        drop(pair.slave);

        self.sessions.lock().expect("pty sessions").insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                child,
            },
        );

        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            let mut pending: Vec<u8> = Vec::new();

            loop {
                match std::io::Read::read(&mut reader, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        // `top` and `vim` emit box-drawing characters that can
                        // straddle a read boundary; hold the split tail back.
                        if let Some(chunk) = crate::proc::take_utf8(&mut pending) {
                            on_data(chunk);
                        }
                    }
                }
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
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn test_pty_spawn_and_write() {
        let mgr = PtyManager::default();
        let received = Arc::new(AtomicBool::new(false));
        let r_clone = Arc::clone(&received);

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
                r_clone.store(true, Ordering::SeqCst);
            },
            || {
                println!("PTY EXITED");
            },
        );

        assert!(id.is_ok(), "Failed to spawn PTY: {:?}", id.err());
        let id = id.unwrap();

        let write_res = mgr.write(&id, "Write-Host 'hello_pty'\r\n");
        assert!(write_res.is_ok(), "Failed to write: {:?}", write_res.err());

        // Wait a bit for output
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_millis(1500) {
            if received.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        assert!(
            received.load(Ordering::SeqCst),
            "Did not receive PTY output!"
        );
        let _ = mgr.kill(&id);
    }
}
