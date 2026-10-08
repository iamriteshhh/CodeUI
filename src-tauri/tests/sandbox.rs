//! OS sandbox and process-tree checks.
//!
//! Each restriction is only asserted when `sandbox::status()` says this
//! machine enforces it; otherwise the test prints why it skipped.
//!
//! The "student program" is this test binary re-invoked with
//! `CODEUI_SANDBOX_HELPER=<action>`, so no compiler or interpreter is needed.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use codeui_lib::proc::sandbox::{self, Policy};
use codeui_lib::proc::{detach_process_group, kill_tree};

const HELPER_ENV: &str = "CODEUI_SANDBOX_HELPER";
/// Windows: the helper waits for a line on stdin so the test can put it in a
/// Job Object before it does anything.
const WAIT_ENV: &str = "CODEUI_SANDBOX_HELPER_WAIT";

/// Not a real test: the entry point when this binary runs as the helper.
#[test]
fn sandbox_helper() {
    if let Ok(action) = std::env::var(HELPER_ENV) {
        std::process::exit(helper(&action));
    }
}

fn helper_args() -> Vec<String> {
    [
        "sandbox_helper",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]
    .map(String::from)
    .to_vec()
}

fn helper_command(action: &str) -> Command {
    let mut cmd = Command::new(std::env::current_exe().unwrap());
    cmd.args(helper_args()).env(HELPER_ENV, action);
    cmd
}

// "tree" and "orphan" leave children behind on purpose: the tests check that
// the supervisor, not the program, cleans them up.
#[allow(clippy::zombie_processes)]
fn helper(action: &str) -> i32 {
    if std::env::var_os(WAIT_ENV).is_some() {
        let mut line = String::new();
        let _ = std::io::stdin().read_line(&mut line);
    }
    let (verb, arg) = action.split_once(':').unwrap_or((action, ""));
    match verb {
        "hello" => {
            println!("hello from helper");
            0
        }
        "exit" => arg.parse().unwrap(),
        "sleep" => {
            std::thread::sleep(Duration::from_secs(arg.parse().unwrap()));
            0
        }
        "spin" => loop {
            std::hint::black_box(0u64);
        },
        "connect" => match std::net::TcpStream::connect(("127.0.0.1", arg.parse().unwrap())) {
            Ok(_) => 0,
            Err(e) => {
                println!("connect failed: {e}");
                3
            }
        },
        "write" => match std::fs::write(arg, b"x") {
            Ok(()) => 0,
            Err(e) => {
                println!("write failed: {e}");
                3
            }
        },
        "alloc" => {
            let bytes = arg.parse::<usize>().unwrap() << 20;
            let mut buf: Vec<u8> = Vec::new();
            if buf.try_reserve_exact(bytes).is_err() {
                println!("allocation refused");
                return 4;
            }
            buf.resize(bytes, 1);
            println!("allocated {}", std::hint::black_box(buf).len());
            0
        }
        "spawn" => {
            let mut children = Vec::new();
            for _ in 0..arg.parse::<usize>().unwrap() {
                let spawned = helper_command("sleep:20")
                    .env_remove(WAIT_ENV)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
                match spawned {
                    Ok(child) => children.push(child),
                    Err(_) => break,
                }
            }
            println!("spawned {}", children.len());
            for mut child in children {
                let _ = child.kill();
                let _ = child.wait();
            }
            0
        }
        // Starts a sleeping child, reports its pid, then sleeps itself.
        "tree" => {
            let child = helper_command("sleep:30")
                .env_remove(WAIT_ENV)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .spawn()
                .unwrap();
            println!("child {}", child.id());
            std::thread::sleep(Duration::from_secs(30));
            0
        }
        // Starts a sleeping child, reports its pid and exits, orphaning it.
        "orphan" => {
            let child = helper_command("sleep:30")
                .env_remove(WAIT_ENV)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .spawn()
                .unwrap();
            println!("child {}", child.id());
            0
        }
        other => panic!("unknown helper action {other}"),
    }
}

/// Waits up to `limit`, killing the tree if it is still running.
fn wait_or_kill(child: &mut Child, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            let _ = kill_tree(child);
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    true
}

/// The value after `key` in the helper's output. libtest prints its own
/// "test sandbox_helper ... " prefix on the same line, so match anywhere.
fn reported<'a>(output: &'a str, key: &str) -> Option<&'a str> {
    output
        .lines()
        .find_map(|l| l.split_once(key).map(|(_, v)| v.trim()))
}

/// The pid from the helper's "child <pid>" line.
fn read_child_pid(child: &mut Child) -> u32 {
    let stdout = child.stdout.take().unwrap();
    let line = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        .find(|l| l.contains("child "))
        .expect("helper reports its child");
    reported(&line, "child ").unwrap().parse().unwrap()
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    // A zombie has exited; only its exit status is left to collect.
    if let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        if let Some((_, rest)) = stat.rsplit_once(')') {
            if rest.trim_start().starts_with('Z') {
                return false;
            }
        }
    }
    // SAFETY: signal 0 only checks for existence.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_TIMEOUT: u32 = 258;
    // SAFETY: plain handle calls on a pid; the handle is closed.
    unsafe {
        let handle = OpenProcess(SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let running = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
        CloseHandle(handle);
        running
    }
}

fn wait_until_dead(pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    true
}

/// Stopping a run must take the processes it started down with it.
#[test]
fn kill_tree_takes_grandchildren_down() {
    let mut cmd = helper_command("tree");
    cmd.stdout(Stdio::piped());
    detach_process_group(&mut cmd);
    let mut child = cmd.spawn().unwrap();
    let grandchild = read_child_pid(&mut child);
    assert!(alive(grandchild), "grandchild started");

    kill_tree(&mut child).unwrap();
    assert!(child.try_wait().unwrap().is_some(), "child dead");
    assert!(
        wait_until_dead(grandchild),
        "grandchild {grandchild} survived"
    );
}

fn test_policy() -> (tempfile::TempDir, Policy) {
    // Under the target dir, not /tmp: /tmp is writable inside the sandbox,
    // so "outside" paths there would prove nothing.
    let base = tempfile::tempdir_in(env!("CARGO_TARGET_TMPDIR")).unwrap();
    let project = base.path().join("project");
    let scratch = base.path().join("scratch");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&scratch).unwrap();
    let policy = Policy::for_run(&project, &scratch);
    (base, policy)
}

#[cfg(unix)]
fn skip(reason: &str) {
    eprintln!("skipping: {reason}");
}

/// Runs a runner's exec spec under the default sandbox, as a Run would.
fn run_spec_sandboxed(policy: &Policy, spec: &codeui_lib::runners::CommandSpec) -> Output {
    #[cfg(unix)]
    {
        let mut args = vec![sandbox::LAUNCHER_FLAG.to_string()];
        args.extend(policy.to_args());
        args.push("--".into());
        args.push(spec.program.clone());
        args.extend(spec.args.iter().cloned());
        Command::new(env!("CARGO_BIN_EXE_codeui"))
            .args(args)
            .current_dir(&spec.cwd)
            .env("PATH", codeui_lib::proc::augmented_path())
            .output()
            .unwrap()
    }
    #[cfg(windows)]
    {
        let child = Command::new(&spec.program)
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .env("PATH", codeui_lib::proc::augmented_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let _guard = sandbox::Guard::attach(policy, child.id()).expect("job attached");
        child.wait_with_output().unwrap()
    }
}

/// The default limits must not break real toolchains: the JVM in particular
/// reserves far more memory than it uses, and Landlock must leave the
/// interpreter's install tree readable.
#[test]
fn default_policy_runs_real_toolchains() {
    use codeui_lib::runners::{runner_for_path, RunContext};
    let programs = [
        (
            "Hello.java",
            "public class Hello { public static void main(String[] a) { System.out.println(\"hello java\"); } }",
            "hello java",
        ),
        ("hello.py", "print('hello python')\n", "hello python"),
        (
            "hello.c",
            "#include <stdio.h>\nint main(void){ puts(\"hello c\"); return 0; }\n",
            "hello c",
        ),
    ];
    for (file, source, expected) in programs {
        let (_dir, policy) = test_policy();
        let ctx = RunContext {
            source: policy.writable[0].join(file),
            scratch: policy.writable[1].clone(),
            workdir: policy.writable[0].clone(),
        };
        std::fs::write(&ctx.source, source).unwrap();
        let runner = runner_for_path(&ctx.source).unwrap();
        let (Ok(compile), Ok(exec)) = (runner.compile(&ctx), runner.execute(&ctx)) else {
            eprintln!("skipping {file}: toolchain not installed");
            continue;
        };
        if let Some(spec) = compile {
            let built = Command::new(&spec.program)
                .args(&spec.args)
                .current_dir(&spec.cwd)
                .output()
                .unwrap();
            assert!(built.status.success(), "{file} did not compile");
        }
        let out = run_spec_sandboxed(&policy, &exec);
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            out.status.success() && stdout.contains(expected),
            "{file} failed under the sandbox: {:?}\n{stdout}\n{}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

// ---------------------------------------------------------------------------
// Unix: the re-exec launcher
// ---------------------------------------------------------------------------

/// Runs `action` in the helper through the real launcher binary.
#[cfg(unix)]
fn run_sandboxed(policy: &Policy, action: &str, limit: Duration) -> Option<Output> {
    let mut args = vec![sandbox::LAUNCHER_FLAG.to_string()];
    args.extend(policy.to_args());
    args.push("--".into());
    args.push(
        std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
    );
    args.extend(helper_args());
    let mut child = Command::new(env!("CARGO_BIN_EXE_codeui"))
        .args(args)
        .env(HELPER_ENV, action)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Drain output on threads so a chatty helper cannot block on a full pipe.
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || std::io::read_to_string(stdout).unwrap_or_default());
    let err = std::thread::spawn(move || std::io::read_to_string(stderr).unwrap_or_default());
    if !wait_or_kill(&mut child, limit) {
        return None;
    }
    let status = child.wait().unwrap();
    Some(Output {
        status,
        stdout: out.join().unwrap().into_bytes(),
        stderr: err.join().unwrap().into_bytes(),
    })
}

#[cfg(unix)]
fn text(out: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

#[cfg(unix)]
#[test]
fn launcher_runs_the_program_and_forwards_its_exit_code() {
    let (_dir, policy) = test_policy();
    let out = run_sandboxed(&policy, "hello", Duration::from_secs(30)).expect("finished");
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&out).contains("hello from helper"));

    let out = run_sandboxed(&policy, "exit:7", Duration::from_secs(30)).expect("finished");
    assert_eq!(out.status.code(), Some(7), "{}", text(&out));
}

#[cfg(unix)]
#[test]
fn launcher_explains_a_missing_program() {
    let (_dir, policy) = test_policy();
    let mut args = vec![sandbox::LAUNCHER_FLAG.to_string()];
    args.extend(policy.to_args());
    args.extend(["--", "/nonexistent/codeui-program"].map(String::from));
    let out = Command::new(env!("CARGO_BIN_EXE_codeui"))
        .args(args)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(127));
    assert!(String::from_utf8_lossy(&out.stderr).contains("was not found"));
}

#[cfg(unix)]
#[test]
fn sandboxed_program_cannot_reach_the_network() {
    let status = sandbox::status();
    if status.network != "Blocked" {
        return skip("network isolation not enforced on this machine");
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let action = format!("connect:{port}");

    // Control: the same helper outside the sandbox does connect.
    let control = helper_command(&action).output().unwrap();
    assert!(control.status.success(), "control connect failed");

    let (_dir, policy) = test_policy();
    let out = run_sandboxed(&policy, &action, Duration::from_secs(30)).expect("finished");
    assert_eq!(
        out.status.code(),
        Some(3),
        "connected anyway: {}",
        text(&out)
    );
}

#[cfg(unix)]
#[test]
fn sandboxed_program_writes_only_inside_the_project_and_scratch() {
    let status = sandbox::status();
    if status.filesystem == "User privileges" {
        return skip("filesystem restriction not enforced on this machine");
    }
    let (dir, policy) = test_policy();
    let outside_dir = dir.path().join("outside");
    std::fs::create_dir_all(&outside_dir).unwrap();

    let inside = policy.writable[0].join("ok.txt");
    let out = run_sandboxed(
        &policy,
        &format!("write:{}", inside.display()),
        Duration::from_secs(30),
    )
    .expect("finished");
    assert!(
        out.status.success(),
        "project write refused: {}",
        text(&out)
    );

    let outside = outside_dir.join("nope.txt");
    let out = run_sandboxed(
        &policy,
        &format!("write:{}", outside.display()),
        Duration::from_secs(30),
    )
    .expect("finished");
    assert_eq!(out.status.code(), Some(3), "{}", text(&out));
    assert!(!outside.exists(), "file written outside the sandbox");
}

#[cfg(target_os = "linux")]
#[test]
fn memory_hog_is_refused() {
    let (_dir, mut policy) = test_policy();
    policy.memory_bytes = 128 * 1024 * 1024;
    let out = run_sandboxed(&policy, "alloc:1024", Duration::from_secs(60)).expect("finished");
    assert!(!out.status.success(), "1 GB allocated under a 128 MB limit");
}

#[cfg(unix)]
#[test]
fn fork_bomb_is_contained() {
    let status = sandbox::status();
    if status
        .resource_limits
        .iter()
        .any(|l| l.starts_with("Processes") && l.contains("not enforced"))
    {
        return skip("process limit not enforced on this machine");
    }
    let (_dir, mut policy) = test_policy();
    policy.processes = 16;
    let out = run_sandboxed(&policy, "spawn:400", Duration::from_secs(120)).expect("finished");
    let report = text(&out);
    let spawned: usize = reported(&report, "spawned ")
        .and_then(|n| n.parse().ok())
        .unwrap_or_else(|| panic!("helper did not report: {report}"));
    assert!(spawned < 400, "all 400 children started: {report}");
}

#[cfg(unix)]
#[test]
fn infinite_loop_is_stopped_by_the_cpu_limit() {
    use std::os::unix::process::ExitStatusExt;
    let (_dir, mut policy) = test_policy();
    policy.cpu_secs = 1;
    let out = run_sandboxed(&policy, "spin", Duration::from_secs(30))
        .expect("CPU limit did not stop the loop within 30 s");
    assert!(
        matches!(out.status.signal(), Some(libc::SIGXCPU | libc::SIGKILL)),
        "{:?}",
        out.status
    );
}

// ---------------------------------------------------------------------------
// Windows: Job Objects
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn run_in_job(
    policy: &Policy,
    action: &str,
) -> (Output, Option<codeui_lib::proc::StopReason>, sandbox::Guard) {
    use std::io::Write;
    let mut child = helper_command(action)
        .env(WAIT_ENV, "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let guard = sandbox::Guard::attach(policy, child.id()).expect("job attached");
    child.stdin.take().unwrap().write_all(b"go\n").unwrap();
    let out = child.wait_with_output().unwrap();
    let hit = guard.limit_hit();
    (out, hit, guard)
}

#[cfg(windows)]
#[test]
fn job_refuses_a_memory_hog() {
    use codeui_lib::proc::StopReason;
    let (_dir, mut policy) = test_policy();
    policy.memory_bytes = 128 * 1024 * 1024;
    let (out, hit, _guard) = run_in_job(&policy, "alloc:1024");
    assert_eq!(out.status.code(), Some(4), "{out:?}");
    assert_eq!(hit, Some(StopReason::MemoryLimit));
}

#[cfg(windows)]
#[test]
fn job_contains_a_fork_bomb() {
    use codeui_lib::proc::StopReason;
    let (_dir, mut policy) = test_policy();
    policy.processes = 8;
    let (out, hit, _guard) = run_in_job(&policy, "spawn:50");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let spawned: usize = reported(&stdout, "spawned ")
        .and_then(|n| n.parse().ok())
        .unwrap_or_else(|| panic!("helper did not report: {stdout}"));
    assert!(spawned < 50, "{stdout}");
    assert_eq!(hit, Some(StopReason::ProcessLimit));
}

#[cfg(windows)]
#[test]
fn job_cpu_limit_stops_an_infinite_loop() {
    use codeui_lib::proc::StopReason;
    let (_dir, mut policy) = test_policy();
    policy.cpu_secs = 1;
    let started = Instant::now();
    let (out, hit, _guard) = run_in_job(&policy, "spin");
    assert!(!out.status.success());
    assert_eq!(hit, Some(StopReason::CpuLimit));
    assert!(started.elapsed() < Duration::from_secs(30));
}

#[cfg(windows)]
#[test]
fn ending_the_job_kills_orphaned_children() {
    let (_dir, policy) = test_policy();
    let mut child = helper_command("orphan")
        .env(WAIT_ENV, "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let guard = sandbox::Guard::attach(&policy, child.id()).expect("job attached");
    {
        use std::io::Write;
        child.stdin.take().unwrap().write_all(b"go\n").unwrap();
    }
    let orphan = read_child_pid(&mut child);
    assert!(wait_or_kill(&mut child, Duration::from_secs(30)));
    assert!(alive(orphan), "orphan outlives its parent");

    drop(guard);
    assert!(wait_until_dead(orphan), "orphan {orphan} survived the job");
}

#[cfg(windows)]
#[test]
fn windows_reports_no_network_or_filesystem_isolation() {
    let status = sandbox::status();
    assert_eq!(status.network, "Allowed");
    assert_eq!(status.filesystem, "User privileges");
    assert_eq!(status.execution, "Supervised");
}
