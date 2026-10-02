//! Process-group spawning and guaranteed termination.
//!
//! Every child process CodeUI creates is placed in its own process group so a
//! runaway student program cannot leave orphans behind on a shared lab machine.

use std::process::Command;

pub mod kill;
pub mod toolpath;

pub use kill::{kill_tree, kill_tree_by_pid, KillOutcome};
pub use toolpath::{augmented_path, resolve_tool};

/// Grace period between SIGTERM and SIGKILL.
pub const TERM_GRACE_MS: u64 = 500;

/// Default wall-clock budget for a student program (R4: raised to 30s for interactive use).
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;

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
/// Students see these instead of a bare number.
pub fn crash_hint(code: i32) -> Option<&'static str> {
    match code {
        139 => Some("Program crashed - likely a segmentation fault (invalid memory access)."),
        134 => Some("Program aborted - an assertion failed or abort() was called."),
        136 => Some("Arithmetic error - likely a division by zero."),
        137 => Some("Program was stopped - it ran too long or was killed."),
        143 => Some("Program was terminated before it finished."),
        124 => Some("Program timed out."),
        _ => None,
    }
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
    use super::{crash_hint, take_utf8};

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
}
