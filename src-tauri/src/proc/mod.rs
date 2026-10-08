//! Process-group spawning and guaranteed termination.
//!
//! Every child process CodeUI creates is placed in its own process group so a
//! runaway student program cannot leave orphans behind on a shared lab machine.
//!
//! Time budgets for one run (single source of truth):
//!
//! - compile step: [`COMPILE_TIMEOUT_SECS`], wall clock, supervisor.
//! - program idle: the `run_timeout_secs` setting (default
//!   [`DEFAULT_TIMEOUT_SECS`]), restarted by every line the student types,
//!   supervisor.
//! - program total: [`MAX_RUNTIME_SECS`], wall clock, never restarted,
//!   supervisor.
//! - program CPU: [`sandbox::CPU_LIMIT_SECS`], CPU time, enforced by the OS.

use std::process::Command;
use std::time::Duration;

pub mod kill;
pub mod sandbox;
pub mod toolpath;

pub use kill::{kill_tree, kill_tree_by_pid, KillOutcome};
pub use toolpath::{augmented_path, resolve_tool, set_bundled_bin};

/// Grace period between SIGTERM and SIGKILL.
pub const TERM_GRACE_MS: u64 = 500;

/// Default idle timeout for a student program: it is stopped once this long
/// has passed without the student typing input (the clock starts at launch
/// and restarts on every write to stdin). Backs the `run_timeout_secs`
/// setting.
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Smallest / largest idle timeout accepted from the setting or the
/// `timeout_secs` IPC parameter.
pub const MIN_TIMEOUT_SECS: u64 = 1;
pub const MAX_TIMEOUT_SECS: u64 = 300;

/// Hard wall-clock ceiling for one program run. Typing input does not extend
/// it, so a program that is fed input forever still ends.
pub const MAX_RUNTIME_SECS: u64 = 300;

/// Wall-clock budget for the compile step. Pathological C++ templates can run
/// for minutes, and an unbounded compile would hang the app with no way out.
pub const COMPILE_TIMEOUT_SECS: u64 = 60;

/// Resolves the idle timeout for a run: the requested value clamped to
/// [`MIN_TIMEOUT_SECS`]..=[`MAX_TIMEOUT_SECS`], or the default.
pub fn idle_timeout(requested_secs: Option<u64>) -> Duration {
    Duration::from_secs(
        requested_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS),
    )
}

/// Why the supervisor or the OS ended a run early.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// No input for the idle timeout.
    IdleTimeout,
    /// Reached [`MAX_RUNTIME_SECS`].
    MaxRuntime,
    /// Used up [`sandbox::CPU_LIMIT_SECS`] of CPU time.
    CpuLimit,
    /// Hit [`sandbox::MEMORY_LIMIT_BYTES`].
    MemoryLimit,
    /// Tried to exceed [`sandbox::PROCESS_LIMIT`].
    ProcessLimit,
}

/// Student-facing explanation for an early stop. `idle` is the idle timeout
/// that was in force for the run.
pub fn stop_hint(reason: StopReason, idle: Duration) -> String {
    const MB: u64 = 1024 * 1024;
    match reason {
        StopReason::IdleTimeout => format!(
            "Program was stopped after {} seconds without input from you (idle timeout). \
             If it needs longer, raise the run timeout in Settings.",
            idle.as_secs()
        ),
        StopReason::MaxRuntime => format!(
            "Program reached the {MAX_RUNTIME_SECS}-second maximum run time and was stopped."
        ),
        StopReason::CpuLimit => format!(
            "Program used its {}-second CPU time limit and was stopped - likely an infinite loop.",
            sandbox::CPU_LIMIT_SECS
        ),
        StopReason::MemoryLimit => format!(
            "Program hit the {} MB memory limit - likely a runaway allocation or endless recursion.",
            sandbox::MEMORY_LIMIT_BYTES / MB
        ),
        StopReason::ProcessLimit => format!(
            "Program tried to start more than {} processes and was refused.",
            sandbox::PROCESS_LIMIT
        ),
    }
}

/// Places `cmd` in a fresh process group so the whole tree can be signalled at once.
pub fn detach_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe and the closure allocates nothing.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    // Already a group leader is fine; anything else is fatal for isolation.
                    let err = std::io::Error::last_os_error();
                    if err.raw_os_error() != Some(libc::EPERM) {
                        return Err(err);
                    }
                }
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
}

/// Plain-language explanation for an abnormal exit status.
///
/// Students see these instead of a bare number. Unix codes follow the shell
/// convention (128 + signal); Windows crash codes are NTSTATUS values, which
/// arrive here as negative `i32`s.
pub fn crash_hint(code: i32) -> Option<&'static str> {
    match code as u32 {
        139 => Some("Program crashed - likely a segmentation fault (invalid memory access)."),
        134 => Some(
            "Program aborted - an assertion failed, abort() was called, or it ran out of memory.",
        ),
        136 => Some("Arithmetic error - likely a division by zero."),
        135 => Some("Program crashed - bus error (invalid memory access)."),
        132 => Some("Program crashed - illegal instruction (corrupt program or wrong CPU type)."),
        137 => Some("Program was stopped - it ran too long or was killed."),
        143 => Some("Program was terminated before it finished."),
        152 => {
            Some("Program used up its CPU time limit and was stopped - likely an infinite loop.")
        }
        153 => Some("Program tried to write a file larger than the allowed size and was stopped."),
        124 => Some("Program timed out."),
        126 => Some("The program could not be started (permission denied or not a valid program)."),
        127 => Some("The program could not be started because it was not found."),
        0xC000_0005 => Some("Program crashed - invalid memory access (access violation)."),
        0xC000_0094 => Some("Arithmetic error - integer division by zero."),
        0xC000_00FD => Some("Program crashed - stack overflow, likely endless recursion."),
        0xC000_0409 => {
            Some("Program aborted - abort() was called or a buffer overrun was detected.")
        }
        0xC000_013A => Some("Program was interrupted with Ctrl+C."),
        // STATUS_QUOTA_EXCEEDED: how Windows ends a job that used its CPU time.
        0xC000_0044 => {
            Some("Program used up its CPU time limit and was stopped - likely an infinite loop.")
        }
        0xC000_0135 => Some("Program could not start - a required DLL was not found."),
        _ => None,
    }
}

/// Student-facing explanation for a failure to start `program`.
///
/// Covers the cases students actually hit: a missing compiler/interpreter or
/// build output, a file without execute permission, and a binary built for a
/// different CPU or OS.
pub fn explain_spawn_error(program: &str, err: &std::io::Error) -> String {
    use std::io::ErrorKind;
    // ENOEXEC on Unix; ERROR_BAD_EXE_FORMAT / ERROR_EXE_MACHINE_TYPE_MISMATCH on Windows.
    #[cfg(unix)]
    let bad_format = err.raw_os_error() == Some(libc::ENOEXEC);
    #[cfg(windows)]
    let bad_format = matches!(err.raw_os_error(), Some(193 | 216));
    #[cfg(not(any(unix, windows)))]
    let bad_format = false;

    if bad_format {
        format!(
            "`{program}` is not a program this computer can run - it was built for a different \
             processor or operating system, or the file is incomplete."
        )
    } else if err.kind() == ErrorKind::NotFound {
        format!(
            "`{program}` was not found. If it is a compiler or interpreter, install it or add it \
             to PATH; if it is your compiled program, the build output is missing (an antivirus \
             may have removed it)."
        )
    } else if err.kind() == ErrorKind::PermissionDenied {
        format!(
            "Permission denied when starting `{program}`. The file is not executable, or a \
             security policy (antivirus, a noexec mount) blocked it."
        )
    } else {
        format!("Could not start `{program}`: {err}")
    }
}

/// Recovers the OS error from a message that embeds one as `(os error N)`.
///
/// portable_pty reports spawn failures as formatted text rather than an
/// `io::Error`; this keeps them on the same student-facing path.
pub fn os_error_in(message: &str) -> Option<std::io::Error> {
    let tail = &message[message.rfind("(os error ")? + "(os error ".len()..];
    let code: i32 = tail[..tail.find(')')?].parse().ok()?;
    Some(std::io::Error::from_raw_os_error(code))
}

/// Maps a signal description (`strsignal` text, which is how portable_pty
/// reports a signalled child) back to its number.
#[cfg(unix)]
pub fn signal_from_name(name: &str) -> Option<i32> {
    if let Some(n) = name.strip_prefix("Signal ") {
        return n.trim().parse().ok();
    }
    (1..65).find(|&sig| {
        // SAFETY: strsignal returns a valid C string (or null) for any input.
        let text = unsafe { libc::strsignal(sig) };
        !text.is_null() && unsafe { std::ffi::CStr::from_ptr(text) }.to_bytes() == name.as_bytes()
    })
}

/// Takes the complete UTF-8 prefix of `pending`, leaving a split multi-byte
/// character in the buffer.
///
/// Child output arrives in fixed-size reads that can land mid-character;
/// converting each read independently would turn box-drawing and accented
/// characters into replacement glyphs.
pub fn take_utf8(pending: &mut Vec<u8>) -> Option<String> {
    let valid = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        Err(e) => e.valid_up_to(),
    };
    if valid == 0 {
        return None;
    }
    let chunk = String::from_utf8_lossy(&pending[..valid]).into_owned();
    pending.drain(..valid);
    Some(chunk)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_the_exit_codes_students_actually_hit() {
        // 139 = 128 + SIGSEGV(11); the shell convention the engine reports.
        assert!(crash_hint(139).unwrap().contains("segmentation fault"));
        assert!(crash_hint(136).unwrap().contains("division by zero"));
        assert!(crash_hint(137).is_some());
    }

    #[test]
    fn stays_quiet_for_normal_exits() {
        assert_eq!(crash_hint(0), None);
        assert_eq!(crash_hint(1), None);
    }

    #[test]
    fn explains_windows_crash_codes() {
        assert!(crash_hint(0xC000_0005_u32 as i32)
            .unwrap()
            .contains("memory access"));
        assert!(crash_hint(0xC000_00FD_u32 as i32)
            .unwrap()
            .contains("stack overflow"));
        assert!(crash_hint(152).unwrap().contains("CPU"));
    }

    #[test]
    fn idle_timeout_is_clamped_like_the_setting() {
        assert_eq!(idle_timeout(None).as_secs(), DEFAULT_TIMEOUT_SECS);
        assert_eq!(idle_timeout(Some(0)).as_secs(), MIN_TIMEOUT_SECS);
        assert_eq!(idle_timeout(Some(99_999)).as_secs(), MAX_TIMEOUT_SECS);
        assert_eq!(idle_timeout(Some(45)).as_secs(), 45);
    }

    #[test]
    fn stop_hints_name_the_real_reason() {
        let idle = Duration::from_secs(30);
        assert!(stop_hint(StopReason::IdleTimeout, idle).contains("without input"));
        assert!(stop_hint(StopReason::MaxRuntime, idle).contains("maximum run time"));
        assert!(stop_hint(StopReason::CpuLimit, idle).contains("CPU"));
        assert!(stop_hint(StopReason::MemoryLimit, idle).contains("memory"));
        assert!(stop_hint(StopReason::ProcessLimit, idle).contains("processes"));
    }

    #[test]
    fn spawn_errors_are_explained() {
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(explain_spawn_error("gcc", &missing).contains("was not found"));
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(explain_spawn_error("a.out", &denied).contains("Permission denied"));
        #[cfg(windows)]
        let wrong_arch = std::io::Error::from_raw_os_error(193);
        #[cfg(unix)]
        let wrong_arch = std::io::Error::from_raw_os_error(libc::ENOEXEC);
        assert!(explain_spawn_error("prog", &wrong_arch).contains("different"));
    }

    #[test]
    fn os_error_is_recovered_from_text() {
        let err = std::io::Error::from_raw_os_error(2);
        let text = format!("CreateProcessW `x` failed: {err}");
        assert_eq!(os_error_in(&text).unwrap().raw_os_error(), Some(2));
        assert!(os_error_in("no code here").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn signal_names_round_trip() {
        // Copied out: macOS strsignal reuses one static buffer, so a borrowed
        // pointer would be overwritten by the lookup's own strsignal calls.
        // SAFETY: strsignal is safe to call with any signal number.
        let name = unsafe { std::ffi::CStr::from_ptr(libc::strsignal(libc::SIGSEGV)) }
            .to_string_lossy()
            .into_owned();
        assert_eq!(signal_from_name(&name), Some(libc::SIGSEGV));
        assert_eq!(signal_from_name("Signal 24"), Some(24));
    }

    #[test]
    fn utf8_split_across_reads_is_not_mangled() {
        // "é" is two bytes; simulate it landing on a read boundary.
        let mut pending = vec![b'o', b'k', 0xC3];
        assert_eq!(take_utf8(&mut pending).as_deref(), Some("ok"));
        assert_eq!(pending, vec![0xC3], "incomplete tail is held back");

        pending.push(0xA9);
        assert_eq!(take_utf8(&mut pending).as_deref(), Some("\u{e9}"));
        assert!(pending.is_empty());
    }

    #[test]
    fn utf8_yields_nothing_when_only_a_partial_char_is_buffered() {
        // Leading bytes of a box-drawing character, as `top` would emit.
        let mut pending = vec![0xE2, 0x94];
        assert_eq!(take_utf8(&mut pending), None);
        assert_eq!(pending.len(), 2, "nothing consumed");
    }

    #[test]
    fn utf8_four_byte_char_split_three_ways() {
        let bytes = "a\u{1F600}b".as_bytes();
        let mut pending = bytes[..2].to_vec();
        assert_eq!(take_utf8(&mut pending).as_deref(), Some("a"));
        pending.extend_from_slice(&bytes[2..4]);
        assert_eq!(take_utf8(&mut pending), None, "still incomplete");
        pending.extend_from_slice(&bytes[4..]);
        assert_eq!(take_utf8(&mut pending).as_deref(), Some("\u{1F600}b"));
        assert!(pending.is_empty());
    }
}
