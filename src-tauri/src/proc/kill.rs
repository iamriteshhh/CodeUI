//! Escalating termination: SIGTERM to the whole group, then SIGKILL.

use std::process::Child;
use std::time::{Duration, Instant};

use super::TERM_GRACE_MS;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KillOutcome {
    /// Process had already exited on its own.
    AlreadyExited,
    /// Exited after the polite signal.
    Terminated,
    /// Needed SIGKILL.
    Killed,
}

/// Terminates `child` and every process in its group.
///
/// Escalates SIGTERM -> grace period -> SIGKILL so well-behaved programs get to
/// flush output while fork bombs still die.
pub fn kill_tree(child: &mut Child) -> std::io::Result<KillOutcome> {
    if let Some(_status) = child.try_wait()? {
        return Ok(KillOutcome::AlreadyExited);
    }

    let pid = child.id();
    signal_group(pid, Signal::Term);

    let deadline = Instant::now() + Duration::from_millis(TERM_GRACE_MS);
    while Instant::now() < deadline {
        if child.try_wait()?.is_some() {
            return Ok(KillOutcome::Terminated);
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    signal_group(pid, Signal::Kill);
    let _ = child.kill();
    let _ = child.wait();
    Ok(KillOutcome::Killed)
}

/// Terminates a process tree by PID (used when managing PTY children).
pub fn kill_tree_by_pid(pid: u32) {
    signal_group(pid, Signal::Term);
    std::thread::sleep(Duration::from_millis(150));
    signal_group(pid, Signal::Kill);
}

#[derive(Clone, Copy)]
enum Signal {
    Term,
    Kill,
}

#[cfg(unix)]
fn signal_group(pid: u32, sig: Signal) {
    let signo = match sig {
        Signal::Term => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
    };
    // Negative pid targets the entire process group created by setsid.
    // SAFETY: killpg on a possibly-dead pgid returns ESRCH, which we ignore.
    unsafe {
        libc::killpg(pid as libc::pid_t, signo);
    }
}

#[cfg(windows)]
fn signal_group(pid: u32, sig: Signal) {
    // Windows has no signal groups; taskkill /T walks the child tree instead.
    let mut cmd = std::process::Command::new("taskkill");
    cmd.arg("/PID").arg(pid.to_string()).arg("/T");
    if matches!(sig, Signal::Kill) {
        cmd.arg("/F");
    }
    // Release builds are GUI-subsystem; without this, taskkill flashes a console window.
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let _ = cmd.output();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn already_exited_is_reported() {
        let mut child = spawn_trivial();
        let _ = child.wait();
        assert_eq!(kill_tree(&mut child).unwrap(), KillOutcome::AlreadyExited);
    }

    #[test]
    fn runaway_process_is_killed() {
        let mut child = spawn_sleeper();
        let outcome = kill_tree(&mut child).unwrap();
        assert!(matches!(
            outcome,
            KillOutcome::Terminated | KillOutcome::Killed
        ));
        // A second wait must not hang: the process is gone.
        assert!(child.try_wait().is_ok());
    }

    fn spawn_trivial() -> std::process::Child {
        #[cfg(unix)]
        let mut cmd = Command::new("true");
        #[cfg(windows)]
        let mut cmd = Command::new("cmd");
        #[cfg(windows)]
        cmd.args(["/C", "exit"]);
        crate::proc::detach_process_group(&mut cmd);
        cmd.spawn().expect("spawn")
    }

    fn spawn_sleeper() -> std::process::Child {
        #[cfg(unix)]
        let mut cmd = {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", "ping", "-n", "30", "127.0.0.1"]);
            c
        };
        crate::proc::detach_process_group(&mut cmd);
        cmd.spawn().expect("spawn")
    }
}
