//! OS-level restrictions for the exec phase (the student's program).
//!
//! The supervisor in `commands::process` still owns the process lifecycle
//! (idle timeout, max runtime, kill tree, output cap). This module adds what
//! the kernel can enforce on top of it, and reports truthfully what that is on
//! this machine through [`status`]:
//!
//! - Linux: the exec phase is spawned as `codeui --codeui-sandbox-exec <policy>
//!   -- <program> <args>`. That launcher applies rlimits, a user + network
//!   namespace, `no_new_privs`, Landlock and a seccomp filter to itself, then
//!   execs the program, which inherits all of it. (portable_pty offers no
//!   pre_exec hook, hence the re-exec.)
//! - macOS: the same launcher applies rlimits and execs the program under
//!   `sandbox-exec` (no network, writes only to project, scratch and temp).
//!   Compile-checked only; untested.
//! - Windows: the supervisor places the program in a Job Object (CPU time,
//!   per-process memory, process count, whole tree killed when the run ends).
//!   No network or filesystem isolation.
//!
//! Every feature degrades on its own: what the kernel does not support is
//! skipped, and `status()` says so. The compile phase is not sandboxed.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::StopReason;

/// Private argv[1] that turns the CodeUI binary into the sandbox launcher.
pub const LAUNCHER_FLAG: &str = "--codeui-sandbox-exec";

/// CPU-time limit for the program and everything it starts. Equal to the
/// wall-clock ceiling, so it only bites for multi-threaded spinners and never
/// contradicts the idle-timeout setting.
pub const CPU_LIMIT_SECS: u64 = super::MAX_RUNTIME_SECS;

/// Memory limit. Linux: RLIMIT_DATA (private writable memory, so the JVM's
/// large unused address-space reservations do not count). Windows: committed
/// memory per process. Not enforced on macOS.
pub const MEMORY_LIMIT_BYTES: u64 = 1024 * 1024 * 1024;

/// Largest file the program may write (RLIMIT_FSIZE, Unix only).
pub const FILE_SIZE_LIMIT_BYTES: u64 = 256 * 1024 * 1024;

/// Open file descriptors (RLIMIT_NOFILE, Unix only).
pub const OPEN_FILES_LIMIT: u64 = 512;

/// Processes the program may run at once. Windows: active processes in the
/// job. Linux: RLIMIT_NPROC, which counts threads too, so it leaves room for
/// a JVM's worker threads.
pub const PROCESS_LIMIT: u64 = 128;

const NETWORK_BLOCKED: &str = "Blocked";
const NETWORK_ALLOWED: &str = "Allowed";
const FS_UNRESTRICTED: &str = "User privileges";

/// Limits applied to one program run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub cpu_secs: u64,
    pub memory_bytes: u64,
    pub file_size_bytes: u64,
    pub open_files: u64,
    pub processes: u64,
    /// Directories the program may write to: its working directory and the
    /// run's scratch directory. (Temp and device nodes are added per OS.)
    pub writable: Vec<PathBuf>,
}

impl Policy {
    pub fn for_run(workdir: &Path, scratch: &Path) -> Self {
        Policy {
            cpu_secs: CPU_LIMIT_SECS,
            memory_bytes: MEMORY_LIMIT_BYTES,
            file_size_bytes: FILE_SIZE_LIMIT_BYTES,
            open_files: OPEN_FILES_LIMIT,
            processes: PROCESS_LIMIT,
            writable: vec![workdir.to_path_buf(), scratch.to_path_buf()],
        }
    }

    /// Encodes the policy as launcher arguments (`key=value`).
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            format!("cpu={}", self.cpu_secs),
            format!("mem={}", self.memory_bytes),
            format!("fsize={}", self.file_size_bytes),
            format!("nofile={}", self.open_files),
            format!("nproc={}", self.processes),
        ];
        args.extend(
            self.writable
                .iter()
                .map(|p| format!("rw={}", p.to_string_lossy())),
        );
        args
    }

    /// Inverse of [`Policy::to_args`]: parses up to `--` and returns the
    /// command that follows it.
    pub fn parse_args(args: &[String]) -> Option<(Policy, &[String])> {
        let split = args.iter().position(|a| a == "--")?;
        let mut policy = Policy {
            writable: Vec::new(),
            ..Policy::for_run(Path::new(""), Path::new(""))
        };
        for arg in &args[..split] {
            let (key, value) = arg.split_once('=')?;
            if key == "rw" {
                policy.writable.push(PathBuf::from(value));
                continue;
            }
            let n: u64 = value.parse().ok()?;
            match key {
                "cpu" => policy.cpu_secs = n,
                "mem" => policy.memory_bytes = n,
                "fsize" => policy.file_size_bytes = n,
                "nofile" => policy.open_files = n,
                "nproc" => policy.processes = n,
                _ => return None,
            }
        }
        Some((policy, &args[split + 1..]))
    }
}

/// The command the supervisor should spawn for the exec phase.
///
/// `Ok(Some((exe, args)))`: the launcher re-exec. `Ok(None)`: this OS
/// restricts the program from outside (Windows, see [`Guard`]), spawn it
/// directly. `Err(reason)`: the launcher is unusable; spawn directly and tell
/// the student the run is only supervised.
pub fn launcher_command(
    policy: &Policy,
    program: &str,
    args: &[String],
) -> Result<Option<(String, Vec<String>)>, String> {
    if !cfg!(unix) {
        return Ok(None);
    }
    let exe =
        std::env::current_exe().map_err(|e| format!("cannot locate the CodeUI executable: {e}"))?;
    let mut argv = vec![LAUNCHER_FLAG.to_string()];
    argv.extend(policy.to_args());
    argv.push("--".into());
    argv.push(program.to_string());
    argv.extend(args.iter().cloned());
    Ok(Some((exe.to_string_lossy().into_owned(), argv)))
}

/// Entry point for `main`: `Some(exit code)` when this process was started as
/// the sandbox launcher, `None` for a normal app start.
pub fn launcher_main() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(LAUNCHER_FLAG)) {
        return None;
    }
    let rest: Vec<String> = args.map(|a| a.to_string_lossy().into_owned()).collect();
    Some(run_launcher(&rest))
}

#[cfg(unix)]
fn run_launcher(args: &[String]) -> i32 {
    use std::os::unix::process::CommandExt;

    let Some((policy, command)) = Policy::parse_args(args) else {
        eprintln!("[CodeUI] sandbox launcher: invalid arguments");
        return 126;
    };
    let Some((program, rest)) = command.split_first() else {
        eprintln!("[CodeUI] sandbox launcher: no program given");
        return 126;
    };

    unix::apply_rlimits(&policy);
    #[cfg(target_os = "linux")]
    for warning in linux::apply(&policy, program) {
        eprintln!("[CodeUI] sandbox: {warning}");
    }

    #[cfg(target_os = "macos")]
    let mut cmd = macos::command(&policy, program, rest);
    #[cfg(not(target_os = "macos"))]
    let mut cmd = {
        let mut cmd = std::process::Command::new(program);
        cmd.args(rest);
        cmd
    };

    // exec only returns on failure.
    let err = cmd.exec();
    eprintln!("[CodeUI] {}", super::explain_spawn_error(program, &err));
    if err.kind() == std::io::ErrorKind::NotFound {
        127
    } else {
        126
    }
}

#[cfg(not(unix))]
fn run_launcher(_args: &[String]) -> i32 {
    eprintln!("[CodeUI] the sandbox launcher is not used on this OS");
    126
}

/// What the sandbox enforces on this machine, for the diagnostics report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    /// `"Sandboxed"` only when network or filesystem isolation is in force;
    /// resource limits alone are `"Supervised"`.
    pub execution: &'static str,
    /// The mechanisms in use.
    pub sandbox: String,
    /// `"Blocked"` or `"Allowed"`.
    pub network: &'static str,
    pub filesystem: String,
    pub resource_limits: Vec<String>,
    /// Degradations and caveats on this machine.
    pub notes: Vec<String>,
}

/// Probes this machine and reports what a run would actually be subject to.
pub fn status() -> SandboxStatus {
    let mut status = platform_status();
    let isolated = status.network == NETWORK_BLOCKED || status.filesystem != FS_UNRESTRICTED;
    status.execution = if isolated { "Sandboxed" } else { "Supervised" };
    status.resource_limits.extend([
        format!(
            "Idle timeout: run timeout setting (default {} s, max {} s)",
            super::DEFAULT_TIMEOUT_SECS,
            super::MAX_TIMEOUT_SECS
        ),
        format!("Wall clock: {} s maximum", super::MAX_RUNTIME_SECS),
        format!("Compile: {} s maximum", super::COMPILE_TIMEOUT_SECS),
    ]);
    status
}

fn supervised_only(reason: String) -> SandboxStatus {
    SandboxStatus {
        execution: "Supervised",
        sandbox: "none".into(),
        network: NETWORK_ALLOWED,
        filesystem: FS_UNRESTRICTED.into(),
        resource_limits: Vec::new(),
        notes: vec![reason],
    }
}

const MB: u64 = 1024 * 1024;

#[cfg(target_os = "linux")]
fn platform_status() -> SandboxStatus {
    if let Err(e) = std::env::current_exe() {
        return supervised_only(format!("Sandbox launcher unavailable: {e}"));
    }
    let landlock = linux::landlock_abi();
    let (userns, seccomp) = linux::probe();
    // SAFETY: geteuid cannot fail.
    let root = unsafe { libc::geteuid() } == 0;

    let mut mechanisms = vec!["re-exec launcher".to_string(), "rlimits".to_string()];
    let mut notes = Vec::new();
    if userns {
        mechanisms.push("user+network namespace".into());
    } else {
        notes.push(
            "User namespaces are unavailable (e.g. Ubuntu's AppArmor restriction or a container)."
                .into(),
        );
    }
    if seccomp {
        mechanisms.push("seccomp (IPv4/IPv6 sockets denied)".into());
    } else {
        notes.push("seccomp filters are unavailable.".into());
    }
    if landlock >= 1 {
        mechanisms.push(format!("Landlock ABI {landlock}"));
    } else {
        notes.push(
            "Landlock is unavailable (kernel < 5.13 or not enabled): filesystem access is not restricted."
                .into(),
        );
    }

    let processes = if userns {
        format!("Processes/threads: {PROCESS_LIMIT} (own user namespace)")
    } else if root {
        notes.push("Running as root: the kernel does not enforce the process limit.".into());
        "Processes/threads: not enforced (root)".into()
    } else {
        format!("Processes/threads: {PROCESS_LIMIT} more than the user already runs")
    };

    SandboxStatus {
        execution: "",
        sandbox: mechanisms.join(" + "),
        network: if userns || seccomp {
            NETWORK_BLOCKED
        } else {
            NETWORK_ALLOWED
        },
        filesystem: if landlock >= 1 {
            "Writes limited to the project folder, scratch, /tmp and /dev; reads limited to system and toolchain directories".into()
        } else {
            FS_UNRESTRICTED.into()
        },
        resource_limits: vec![
            format!("CPU time: {CPU_LIMIT_SECS} s"),
            format!("Memory: {} MB (data segment)", MEMORY_LIMIT_BYTES / MB),
            format!("File size: {} MB", FILE_SIZE_LIMIT_BYTES / MB),
            format!("Open files: {OPEN_FILES_LIMIT}"),
            processes,
            "Core dumps: disabled".into(),
        ],
        notes,
    }
}

#[cfg(target_os = "macos")]
fn platform_status() -> SandboxStatus {
    if let Err(e) = std::env::current_exe() {
        return supervised_only(format!("Sandbox launcher unavailable: {e}"));
    }
    let profile = Path::new(macos::SANDBOX_EXEC).exists();
    let mut notes = vec!["macOS sandboxing is untested.".to_string()];
    if !profile {
        notes.push("sandbox-exec is missing: network and filesystem are not restricted.".into());
    }
    SandboxStatus {
        execution: "",
        sandbox: if profile {
            "re-exec launcher + rlimits + sandbox-exec profile".into()
        } else {
            "re-exec launcher + rlimits".into()
        },
        network: if profile {
            NETWORK_BLOCKED
        } else {
            NETWORK_ALLOWED
        },
        filesystem: if profile {
            "Writes limited to the project folder, scratch and temp".into()
        } else {
            FS_UNRESTRICTED.into()
        },
        resource_limits: vec![
            format!("CPU time: {CPU_LIMIT_SECS} s"),
            "Memory: not enforced on macOS".into(),
            format!("File size: {} MB", FILE_SIZE_LIMIT_BYTES / MB),
            format!("Open files: {OPEN_FILES_LIMIT}"),
            "Processes: not enforced on macOS".into(),
            "Core dumps: disabled".into(),
        ],
        notes,
    }
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn platform_status() -> SandboxStatus {
    SandboxStatus {
        execution: "",
        sandbox: "re-exec launcher + rlimits".into(),
        network: NETWORK_ALLOWED,
        filesystem: FS_UNRESTRICTED.into(),
        resource_limits: vec![
            format!("CPU time: {CPU_LIMIT_SECS} s"),
            format!("File size: {} MB", FILE_SIZE_LIMIT_BYTES / MB),
            format!("Open files: {OPEN_FILES_LIMIT}"),
            "Core dumps: disabled".into(),
        ],
        notes: vec!["Only resource limits are applied on this OS.".into()],
    }
}

#[cfg(windows)]
fn platform_status() -> SandboxStatus {
    if let Err(e) = Guard::new(&Policy::for_run(Path::new("."), Path::new("."))) {
        return supervised_only(format!("Job Objects are unavailable: {e}"));
    }
    SandboxStatus {
        execution: "",
        sandbox: "Windows Job Object".into(),
        network: NETWORK_ALLOWED,
        filesystem: FS_UNRESTRICTED.into(),
        resource_limits: vec![
            format!("CPU time: {CPU_LIMIT_SECS} s (user mode, whole process tree)"),
            format!("Memory: {} MB committed per process", MEMORY_LIMIT_BYTES / MB),
            format!("Processes: {PROCESS_LIMIT} at once"),
            "Process tree killed when the run ends".into(),
            "Crash dialogs suppressed".into(),
        ],
        notes: vec![
            "Network and filesystem are not isolated on Windows; the program runs with your user's privileges."
                .into(),
        ],
    }
}

#[cfg(not(any(unix, windows)))]
fn platform_status() -> SandboxStatus {
    supervised_only("No sandbox support on this OS.".into())
}

#[cfg(unix)]
mod unix {
    use super::Policy;

    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub type Resource = libc::__rlimit_resource_t;
    #[cfg(not(all(target_os = "linux", target_env = "gnu")))]
    pub type Resource = libc::c_int;

    /// Lowers a limit. Never raises a hard limit (an unprivileged process
    /// cannot), so it is always safe to call.
    pub fn set_limit(resource: Resource, soft: u64, hard: u64) -> bool {
        let mut current = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: `current` is a valid out-pointer.
        if unsafe { libc::getrlimit(resource, &mut current) } != 0 {
            return false;
        }
        let hard = (hard as libc::rlim_t).min(current.rlim_max);
        let new = libc::rlimit {
            rlim_cur: (soft as libc::rlim_t).min(hard),
            rlim_max: hard,
        };
        // SAFETY: `new` is a valid rlimit.
        unsafe { libc::setrlimit(resource, &new) == 0 }
    }

    pub fn apply_rlimits(policy: &Policy) {
        set_limit(libc::RLIMIT_CORE, 0, 0);
        // SIGXCPU at the soft limit; SIGKILL a second later if it is caught.
        set_limit(libc::RLIMIT_CPU, policy.cpu_secs, policy.cpu_secs + 1);
        set_limit(
            libc::RLIMIT_FSIZE,
            policy.file_size_bytes,
            policy.file_size_bytes,
        );
        set_limit(libc::RLIMIT_NOFILE, policy.open_files, policy.open_files);
        // The data segment rather than RLIMIT_AS: the JVM reserves gigabytes
        // of address space it never touches, which RLIMIT_AS would count.
        // RLIMIT_DATA (Linux >= 4.7) counts only private writable memory.
        // macOS does not enforce either.
        #[cfg(target_os = "linux")]
        set_limit(libc::RLIMIT_DATA, policy.memory_bytes, policy.memory_bytes);
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};

    use super::unix::set_limit;
    use super::Policy;

    /// Applies the namespace, Landlock and seccomp layers to the current
    /// (single-threaded) launcher. Returns warnings for layers that the
    /// kernel supports but that still failed; unsupported layers are skipped
    /// silently because `status()` already reports them.
    pub fn apply(policy: &Policy, program: &str) -> Vec<String> {
        let mut warnings = Vec::new();

        let in_userns = enter_user_and_net_namespace();
        // RLIMIT_NPROC counts every task the user owns in this user
        // namespace. A fresh namespace starts near zero; otherwise the limit
        // must sit above what the user already runs (browser, IDE, ...).
        let nproc = if in_userns {
            Some(policy.processes)
        } else {
            user_task_count().map(|n| n + policy.processes)
        };
        if let Some(n) = nproc {
            set_limit(libc::RLIMIT_NPROC, n, n);
        }

        // SAFETY: plain prctl with constant arguments.
        if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
            warnings.push(format!(
                "could not set no_new_privs ({}); filesystem and network filters skipped",
                std::io::Error::last_os_error()
            ));
            return warnings;
        }

        if landlock_abi() >= 1 {
            let mut writable = policy.writable.clone();
            writable.extend(["/tmp", "/dev"].map(PathBuf::from));
            if let Err(e) = landlock_restrict(&readable_paths(program), &writable) {
                warnings.push(format!("filesystem restriction failed: {e}"));
            }
        }

        // SAFETY: installs a filter on this process only.
        if unsafe { install_seccomp() } != 0 {
            let err = std::io::Error::last_os_error();
            // EINVAL: kernel without seccomp filters; status() reports that.
            if err.raw_os_error() != Some(libc::EINVAL) {
                warnings.push(format!("network filter failed: {err}"));
            }
        }
        warnings
    }

    fn enter_user_and_net_namespace() -> bool {
        // SAFETY: getuid/getgid cannot fail.
        let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };
        // SAFETY: the launcher is single-threaded, which CLONE_NEWUSER needs.
        if unsafe { libc::unshare(libc::CLONE_NEWUSER | libc::CLONE_NEWNET) } != 0 {
            return false;
        }
        // Keep our own ids inside the namespace; unmapped, getuid() reports
        // 65534 and programs that look up the current user misbehave.
        let _ = std::fs::write("/proc/self/setgroups", "deny");
        let _ = std::fs::write("/proc/self/uid_map", format!("{uid} {uid} 1"));
        let _ = std::fs::write("/proc/self/gid_map", format!("{gid} {gid} 1"));
        true
    }

    /// Tasks (processes and threads) the current user runs right now.
    fn user_task_count() -> Option<u64> {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: getuid cannot fail.
        let uid = unsafe { libc::getuid() };
        let count = std::fs::read_dir("/proc")
            .ok()?
            .flatten()
            .filter(|e| e.file_name().as_bytes().iter().all(u8::is_ascii_digit))
            .filter(|e| e.metadata().is_ok_and(|m| m.uid() == uid))
            .map(|e| {
                // Field 20 of /proc/<pid>/stat is num_threads; the comm field
                // before it may contain spaces, so count from the last ')'.
                std::fs::read_to_string(e.path().join("stat"))
                    .ok()
                    .and_then(|s| {
                        s.rsplit_once(')')?
                            .1
                            .split_whitespace()
                            .nth(17)?
                            .parse()
                            .ok()
                    })
                    .unwrap_or(1)
            })
            .sum();
        Some(count)
    }

    /// Forks a throwaway child to learn which layers the kernel accepts.
    /// Returns (user+net namespace, seccomp filter).
    pub fn probe() -> (bool, bool) {
        // SAFETY: the child makes only raw syscalls before _exit, which is
        // async-signal-safe even though this process is multithreaded.
        let pid = unsafe { libc::fork() };
        if pid < 0 {
            return (false, false);
        }
        if pid == 0 {
            unsafe {
                let mut code = 0;
                if libc::unshare(libc::CLONE_NEWUSER | libc::CLONE_NEWNET) == 0 {
                    code |= 1;
                }
                if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0 && install_seccomp() == 0
                {
                    code |= 2;
                }
                libc::_exit(code);
            }
        }
        let mut status = 0;
        // SAFETY: waits for the child forked above.
        unsafe { libc::waitpid(pid, &mut status, 0) };
        let code = if libc::WIFEXITED(status) {
            libc::WEXITSTATUS(status)
        } else {
            0
        };
        (code & 1 != 0, code & 2 != 0)
    }

    /// Installs a seccomp filter that makes `socket(AF_INET | AF_INET6, ..)`
    /// fail with EACCES. Unix sockets stay usable. Also denies io_uring
    /// (it can create sockets without the socket syscall) and any foreign
    /// syscall ABI (x32 / 32-bit compat), which the filter cannot inspect.
    ///
    /// Async-signal-safe: no allocation. Returns the prctl result.
    ///
    /// # Safety
    /// Restricts the calling process irrevocably.
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    unsafe fn install_seccomp() -> libc::c_int {
        #[cfg(target_arch = "x86_64")]
        const ARCH: u32 = 0xC000_003E; // AUDIT_ARCH_X86_64
        #[cfg(target_arch = "aarch64")]
        const ARCH: u32 = 0xC000_00B7; // AUDIT_ARCH_AARCH64
        const LD_W_ABS: u16 = 0x20;
        const JEQ_K: u16 = 0x15;
        const JGE_K: u16 = 0x35;
        const RET_K: u16 = 0x06;
        const ALLOW: u32 = 0x7fff_0000;
        const DENY: u32 = 0x0005_0000 | libc::EACCES as u32; // SECCOMP_RET_ERRNO
        const fn op(code: u16, jt: u8, jf: u8, k: u32) -> libc::sock_filter {
            libc::sock_filter { code, jt, jf, k }
        }
        // struct seccomp_data: nr @0, arch @4, args[0] @16 (low half on LE).
        // Jump offsets count instructions skipped; index 9 allows, 10 denies.
        let filter = [
            op(LD_W_ABS, 0, 0, 4),
            op(JEQ_K, 0, 8, ARCH),
            op(LD_W_ABS, 0, 0, 0),
            op(JGE_K, 6, 0, 0x4000_0000), // x32 syscalls
            op(JEQ_K, 5, 0, libc::SYS_io_uring_setup as u32),
            op(JEQ_K, 0, 3, libc::SYS_socket as u32),
            op(LD_W_ABS, 0, 0, 16),
            op(JEQ_K, 2, 0, libc::AF_INET as u32),
            op(JEQ_K, 1, 0, libc::AF_INET6 as u32),
            op(RET_K, 0, 0, ALLOW),
            op(RET_K, 0, 0, DENY),
        ];
        let prog = libc::sock_fprog {
            len: filter.len() as u16,
            filter: filter.as_ptr() as *mut libc::sock_filter,
        };
        libc::prctl(
            libc::PR_SET_SECCOMP,
            libc::SECCOMP_MODE_FILTER as libc::c_ulong,
            &prog as *const libc::sock_fprog,
        )
    }

    /// Other architectures: no filter (reported as unavailable).
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    unsafe fn install_seccomp() -> libc::c_int {
        *libc::__errno_location() = libc::EINVAL;
        -1
    }

    // Landlock (kernel >= 5.13), raw syscalls; see linux/landlock.h.
    const CREATE_RULESET_VERSION: libc::c_uint = 1;
    const RULE_PATH_BENEATH: libc::c_int = 1;
    const FS_EXECUTE: u64 = 1 << 0;
    const FS_WRITE_FILE: u64 = 1 << 1;
    const FS_READ_FILE: u64 = 1 << 2;
    const FS_READ_DIR: u64 = 1 << 3;
    /// Every right ABI 1 defines (execute .. make_sym).
    const FS_ABI1: u64 = (1 << 13) - 1;
    const FS_REFER: u64 = 1 << 13; // ABI 2
    const FS_TRUNCATE: u64 = 1 << 14; // ABI 3
    const FS_READ: u64 = FS_EXECUTE | FS_READ_FILE | FS_READ_DIR;
    /// Rights valid on a regular file; the others only apply to directories.
    const FS_FILE: u64 = FS_EXECUTE | FS_WRITE_FILE | FS_READ_FILE | FS_TRUNCATE;

    #[repr(C)]
    struct RulesetAttr {
        handled_access_fs: u64,
    }

    #[repr(C, packed)]
    struct PathBeneathAttr {
        allowed_access: u64,
        parent_fd: i32,
    }

    /// Landlock ABI version, or <= 0 when unavailable.
    pub fn landlock_abi() -> i64 {
        // SAFETY: the version query passes no attribute.
        unsafe {
            libc::syscall(
                libc::SYS_landlock_create_ruleset,
                std::ptr::null::<RulesetAttr>(),
                0usize,
                CREATE_RULESET_VERSION,
            )
        }
    }

    fn landlock_restrict(readable: &[PathBuf], writable: &[PathBuf]) -> std::io::Result<()> {
        let abi = landlock_abi();
        let mut handled = FS_ABI1;
        if abi >= 2 {
            handled |= FS_REFER;
        }
        if abi >= 3 {
            handled |= FS_TRUNCATE;
        }
        let attr = RulesetAttr {
            handled_access_fs: handled,
        };
        // SAFETY: attr outlives the call; size matches the struct passed.
        let ruleset = unsafe {
            libc::syscall(
                libc::SYS_landlock_create_ruleset,
                &attr as *const RulesetAttr,
                std::mem::size_of::<RulesetAttr>(),
                0 as libc::c_uint,
            )
        };
        if ruleset < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let ruleset = ruleset as libc::c_int;
        for path in readable {
            allow(ruleset, path, FS_READ);
        }
        for path in writable {
            allow(ruleset, path, handled);
        }
        // SAFETY: ruleset is a valid Landlock fd; no_new_privs is already set.
        let rc =
            unsafe { libc::syscall(libc::SYS_landlock_restrict_self, ruleset, 0 as libc::c_uint) };
        let err = std::io::Error::last_os_error();
        // SAFETY: closing the fd we own.
        unsafe { libc::close(ruleset) };
        if rc != 0 {
            Err(err)
        } else {
            Ok(())
        }
    }

    /// Grants `access` beneath `path`. Paths that do not exist are skipped.
    fn allow(ruleset: libc::c_int, path: &Path, access: u64) {
        let Ok(c_path) = CString::new(path.as_os_str().as_bytes()) else {
            return;
        };
        // SAFETY: c_path is NUL-terminated.
        let fd = unsafe { libc::open(c_path.as_ptr(), libc::O_PATH | libc::O_CLOEXEC) };
        if fd < 0 {
            return;
        }
        let rule = PathBeneathAttr {
            allowed_access: if path.is_dir() {
                access
            } else {
                access & FS_FILE
            },
            parent_fd: fd,
        };
        // SAFETY: rule outlives the call; fd is valid until closed below.
        unsafe {
            libc::syscall(
                libc::SYS_landlock_add_rule,
                ruleset,
                RULE_PATH_BENEATH,
                &rule as *const PathBeneathAttr,
                0 as libc::c_uint,
            );
            libc::close(fd);
        }
    }

    /// Read-only areas: the system, toolchains on PATH, and the program's
    /// own install tree. Home directories are not included, so ~/.ssh and
    /// friends stay unreadable.
    fn readable_paths(program: &str) -> Vec<PathBuf> {
        const SYSTEM: [&str; 11] = [
            "/usr", "/lib", "/lib32", "/lib64", "/libx32", "/bin", "/sbin", "/etc", "/opt",
            "/proc", "/sys",
        ];
        let mut paths: Vec<PathBuf> = SYSTEM.iter().map(PathBuf::from).collect();
        paths.extend(["/snap", "/nix"].map(PathBuf::from));
        for var in ["PATH", "LD_LIBRARY_PATH"] {
            if let Some(value) = std::env::var_os(var) {
                paths.extend(std::env::split_paths(&value));
            }
        }
        if let Some(java_home) = std::env::var_os("JAVA_HOME") {
            paths.push(PathBuf::from(java_home));
        }
        if let Some(home) = std::env::var_os("HOME") {
            // pip install --user packages.
            paths.push(Path::new(&home).join(".local/lib"));
        }
        // pyenv, conda and SDKMAN interpreters live under $HOME: allow the
        // install prefix of the resolved binary (…/bin/python -> …).
        if let Some(dir) = resolve_program(program)
            .and_then(|p| p.canonicalize().ok())
            .and_then(|p| p.parent().map(Path::to_path_buf))
        {
            if dir.file_name() == Some(std::ffi::OsStr::new("bin")) {
                if let Some(prefix) = dir.parent() {
                    paths.push(prefix.to_path_buf());
                }
            }
            paths.push(dir);
        }
        paths
    }

    fn resolve_program(program: &str) -> Option<PathBuf> {
        if program.contains('/') {
            return Some(PathBuf::from(program));
        }
        std::env::split_paths(&std::env::var_os("PATH")?)
            .map(|dir| dir.join(program))
            .find(|p| p.is_file())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::PathBuf;
    use std::process::Command;

    use super::Policy;

    pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

    /// The program under `sandbox-exec`, or plain when that is missing
    /// (`status()` reports it).
    pub fn command(policy: &Policy, program: &str, args: &[String]) -> Command {
        if !std::path::Path::new(SANDBOX_EXEC).exists() {
            let mut cmd = Command::new(program);
            cmd.args(args);
            return cmd;
        }
        let mut cmd = Command::new(SANDBOX_EXEC);
        cmd.arg("-p")
            .arg(profile(&policy.writable))
            .arg(program)
            .args(args);
        cmd
    }

    /// SBPL: everything allowed except IP networking and writes outside the
    /// project, scratch and temp folders. Paths must be real paths
    /// (/var -> /private/var), hence canonicalize.
    fn profile(writable: &[PathBuf]) -> String {
        let mut p = String::from(
            "(version 1)\n(allow default)\n(deny network*)\n(allow network* (remote unix-socket))\n\
             (deny file-write*)\n(allow file-write*\n  (literal \"/dev/null\") (literal \"/dev/tty\")\n  \
             (regex #\"^/dev/ttys[0-9]+$\") (regex #\"^/dev/fd/\")\n  \
             (subpath \"/private/tmp\") (subpath \"/private/var/folders\")",
        );
        for dir in writable {
            let real = dir.canonicalize().unwrap_or_else(|_| dir.clone());
            let escaped = real
                .to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"");
            p.push_str(&format!("\n  (subpath \"{escaped}\")"));
        }
        p.push_str(")\n");
        p
    }
}

#[cfg(windows)]
pub use self::windows::Guard;

/// Restrictions applied from outside after spawn. Only Windows needs one;
/// elsewhere the launcher already applied everything, so this is a no-op.
#[cfg(not(windows))]
pub struct Guard;

#[cfg(not(windows))]
impl Guard {
    pub fn attach(_policy: &Policy, _pid: u32) -> Result<Guard, String> {
        Ok(Guard)
    }

    pub fn terminate(&self) {}

    pub fn limit_hit(&self) -> Option<StopReason> {
        None
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::io;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation,
        JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::System::IO::{
        CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED,
    };

    use super::{Policy, StopReason};

    // JOB_OBJECT_MSG_* from winnt.h.
    const MSG_END_OF_JOB_TIME: u32 = 1;
    const MSG_END_OF_PROCESS_TIME: u32 = 2;
    const MSG_ACTIVE_PROCESS_LIMIT: u32 = 3;
    const MSG_PROCESS_MEMORY_LIMIT: u32 = 9;
    const MSG_JOB_MEMORY_LIMIT: u32 = 10;

    /// A Job Object holding the program and everything it starts.
    ///
    /// portable_pty cannot spawn suspended, so the program is assigned just
    /// after CreateProcess returns. Children it starts after that inherit the
    /// job; the gap is microseconds, long before a program's main() runs.
    /// Dropping the guard kills whatever is still in the job.
    pub struct Guard {
        job: HANDLE,
        port: HANDLE,
    }

    // SAFETY: kernel handles may be used from any thread.
    unsafe impl Send for Guard {}
    unsafe impl Sync for Guard {}

    fn check(ok: i32) -> io::Result<()> {
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    impl Guard {
        /// Creates a job with `policy`'s limits and moves process `pid` into it.
        pub fn attach(policy: &Policy, pid: u32) -> Result<Guard, String> {
            let guard = Guard::new(policy).map_err(|e| format!("Job Object: {e}"))?;
            // SAFETY: plain handle calls; the process handle is closed here.
            unsafe {
                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() {
                    return Err(format!(
                        "could not open the program's process: {}",
                        io::Error::last_os_error()
                    ));
                }
                let assigned = check(AssignProcessToJobObject(guard.job, process));
                CloseHandle(process);
                assigned
                    .map_err(|e| format!("could not assign the program to a Job Object: {e}"))?;
            }
            Ok(guard)
        }

        /// A job with `policy`'s limits and a completion port that records
        /// which limit, if any, the program hit.
        pub fn new(policy: &Policy) -> io::Result<Guard> {
            // SAFETY: every pointer passed points at a live local of the
            // size given; the handles are owned by the returned guard.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, std::ptr::null_mut(), 0, 1);
                let guard = Guard { job, port };
                if port.is_null() {
                    return Err(io::Error::last_os_error());
                }

                let assoc = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
                    CompletionKey: std::ptr::null_mut(),
                    CompletionPort: port,
                };
                check(SetInformationJobObject(
                    job,
                    JobObjectAssociateCompletionPortInformation,
                    &assoc as *const _ as *const c_void,
                    std::mem::size_of_val(&assoc) as u32,
                ))?;

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                let basic = &mut info.BasicLimitInformation;
                basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                    | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                    | JOB_OBJECT_LIMIT_PROCESS_MEMORY
                    | JOB_OBJECT_LIMIT_JOB_TIME
                    | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
                basic.ActiveProcessLimit = policy.processes.min(u32::MAX as u64) as u32;
                // 100-nanosecond units.
                basic.PerJobUserTimeLimit = (policy.cpu_secs * 10_000_000) as i64;
                info.ProcessMemoryLimit = policy.memory_bytes as usize;
                check(SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    std::mem::size_of_val(&info) as u32,
                ))?;
                Ok(guard)
            }
        }

        /// Kills every process in the job.
        pub fn terminate(&self) {
            // SAFETY: the job handle is valid for the guard's lifetime.
            unsafe { TerminateJobObject(self.job, 1) };
        }

        /// The first limit the job reported hitting, if any.
        pub fn limit_hit(&self) -> Option<StopReason> {
            let mut hit = None;
            loop {
                let mut message = 0u32;
                let mut key = 0usize;
                let mut overlapped: *mut OVERLAPPED = std::ptr::null_mut();
                // SAFETY: valid out-pointers; zero timeout never blocks.
                let got = unsafe {
                    GetQueuedCompletionStatus(self.port, &mut message, &mut key, &mut overlapped, 0)
                };
                if got == 0 {
                    return hit;
                }
                let reason = match message {
                    MSG_END_OF_JOB_TIME | MSG_END_OF_PROCESS_TIME => Some(StopReason::CpuLimit),
                    MSG_PROCESS_MEMORY_LIMIT | MSG_JOB_MEMORY_LIMIT => {
                        Some(StopReason::MemoryLimit)
                    }
                    MSG_ACTIVE_PROCESS_LIMIT => Some(StopReason::ProcessLimit),
                    _ => None,
                };
                hit = hit.or(reason);
            }
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: closing handles this guard owns; KILL_ON_JOB_CLOSE ends
            // any process still in the job.
            unsafe {
                if !self.job.is_null() {
                    CloseHandle(self.job);
                }
                if !self.port.is_null() {
                    CloseHandle(self.port);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_round_trips_through_launcher_args() {
        let policy = Policy::for_run(Path::new("/work/my project"), Path::new("/tmp/codeui-1"));
        let mut args = policy.to_args();
        args.extend(["--", "prog", "--flag", "a=b"].map(String::from));
        let (parsed, command) = Policy::parse_args(&args).expect("parses");
        assert_eq!(parsed, policy);
        assert_eq!(command, ["prog", "--flag", "a=b"]);
    }

    #[test]
    fn malformed_launcher_args_are_rejected() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(
            Policy::parse_args(&args(&["cpu=1", "prog"])).is_none(),
            "no --"
        );
        assert!(Policy::parse_args(&args(&["cpu=x", "--", "p"])).is_none());
        assert!(Policy::parse_args(&args(&["bogus=1", "--", "p"])).is_none());
    }

    #[test]
    fn status_only_claims_sandboxed_for_isolation() {
        let s = status();
        eprintln!("{s:#?}");
        let isolated = s.network == NETWORK_BLOCKED || s.filesystem != FS_UNRESTRICTED;
        assert_eq!(s.execution == "Sandboxed", isolated, "{s:?}");
        assert!(!s.sandbox.is_empty());
        assert!(!s.resource_limits.is_empty());
        #[cfg(windows)]
        assert_eq!(
            s.network, NETWORK_ALLOWED,
            "Windows has no network isolation"
        );
    }

    #[test]
    fn launcher_is_only_used_on_unix() {
        let policy = Policy::for_run(Path::new("."), Path::new("."));
        let wrapped = launcher_command(&policy, "prog", &["a".into()]).unwrap();
        if cfg!(unix) {
            let (_, argv) = wrapped.expect("unix uses the launcher");
            assert_eq!(argv[0], LAUNCHER_FLAG);
            assert_eq!(&argv[argv.len() - 2..], ["prog", "a"]);
        } else {
            assert!(wrapped.is_none());
        }
    }
}
