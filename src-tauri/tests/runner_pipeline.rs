//! End-to-end checks that each runner's commands actually compile and run.
//!
//! These drive the runner traits directly rather than through Tauri, so they
//! verify the real compiler invocations without needing a webview.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::time::{Duration, Instant};

use codeui_lib::proc::{crash_hint, detach_process_group, kill_tree, KillOutcome};
use codeui_lib::runners::{runner_for_path, CommandSpec, RunContext, RunnerError};

struct Fixture {
    _dir: tempfile::TempDir,
    ctx: RunContext,
}

/// Mirrors production layout: the project and the scratch area are separate
/// trees, so an assertion about one cannot be satisfied by the other.
fn fixture(filename: &str, source: &str) -> Fixture {
    fixture_in("project", filename, source)
}

fn fixture_in(project: &str, filename: &str, source: &str) -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let workdir = dir.path().join(project);
    let scratch = dir.path().join("scratch");
    std::fs::create_dir_all(&workdir).expect("workdir");
    std::fs::create_dir_all(&scratch).expect("scratch");

    let src = workdir.join(filename);
    std::fs::write(&src, source).expect("write source");

    Fixture {
        ctx: RunContext {
            source: src,
            scratch,
            workdir,
        },
        _dir: dir,
    }
}

fn tool_present(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Compiles (if needed) then runs, returning stdout.
fn compile_and_run(fixture: &Fixture) -> String {
    let runner = runner_for_path(&fixture.ctx.source).expect("runner");

    if let Some(spec) = runner.compile(&fixture.ctx).expect("compile spec") {
        let out = Command::new(&spec.program)
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .output()
            .expect("compiler ran");
        assert!(
            out.status.success(),
            "{} failed:\n{}",
            spec.program,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    let spec = runner.execute(&fixture.ctx).expect("run spec");
    let out = Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .output()
        .expect("program ran");

    assert!(
        out.status.success(),
        "program exited {:?}:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn c_program_compiles_and_runs() {
    if !tool_present("gcc") {
        eprintln!("skipping: gcc not installed");
        return;
    }
    let f = fixture(
        "hello.c",
        "#include <stdio.h>\nint main(void){printf(\"hello from c\\n\");return 0;}",
    );
    assert!(compile_and_run(&f).contains("hello from c"));
}

#[test]
fn cpp_program_compiles_and_runs() {
    if !tool_present("g++") {
        eprintln!("skipping: g++ not installed");
        return;
    }
    let f = fixture(
        "hello.cpp",
        "#include <iostream>\nint main(){std::cout<<\"hello from cpp\"<<std::endl;return 0;}",
    );
    assert!(compile_and_run(&f).contains("hello from cpp"));
}

#[test]
fn python_program_runs_unbuffered() {
    if !tool_present("python3") {
        eprintln!("skipping: python3 not installed");
        return;
    }
    let f = fixture("hello.py", "print('hello from python')\n");

    let runner = runner_for_path(&f.ctx.source).unwrap();
    let spec = runner.execute(&f.ctx).unwrap();
    // -u is what makes output stream instead of arriving all at once at exit.
    assert!(
        spec.args.contains(&"-u".to_string()),
        "python must run unbuffered, got {:?}",
        spec.args
    );

    assert!(compile_and_run(&f).contains("hello from python"));
}

#[test]
fn java_program_compiles_and_runs_from_detected_class() {
    if !tool_present("javac") || !tool_present("java") {
        eprintln!("skipping: JDK not installed");
        return;
    }
    let f = fixture(
        "Greeter.java",
        "public class Greeter { public static void main(String[] a){ System.out.println(\"hello from java\"); } }",
    );

    let runner = runner_for_path(&f.ctx.source).unwrap();
    let spec = runner.execute(&f.ctx).unwrap();
    assert_eq!(spec.args.last().unwrap(), "Greeter");

    assert!(compile_and_run(&f).contains("hello from java"));
}

/// javac refuses a public class in a differently-named file. The runner has to
/// catch that itself so the student never burns a compile cycle on it.
#[test]
fn java_filename_mismatch_fails_before_compiling() {
    if !tool_present("java") {
        eprintln!("skipping: JDK not installed");
        return;
    }
    let f = fixture("Scratch.java", "public class Greeter { }");
    let runner = runner_for_path(&f.ctx.source).unwrap();

    let err = runner
        .execute(&f.ctx)
        .expect_err("mismatch must be rejected");
    let message = err.to_string();
    assert!(
        message.contains("Greeter") && message.contains("Scratch"),
        "{message}"
    );
    assert!(
        !f.ctx.scratch.join("Greeter.class").exists(),
        "nothing should have been compiled"
    );
}

#[test]
fn java_class_files_land_in_scratch_not_the_project() {
    if !tool_present("javac") {
        eprintln!("skipping: javac not installed");
        return;
    }
    let f = fixture(
        "Tidy.java",
        "public class Tidy { public static void main(String[] a){} }",
    );

    let runner = runner_for_path(&f.ctx.source).unwrap();
    let spec = runner.compile(&f.ctx).unwrap().expect("java compiles");
    Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .output()
        .expect("javac ran");

    assert!(
        f.ctx.scratch.join("Tidy.class").exists(),
        "class in scratch"
    );
    assert!(
        !f.ctx.workdir.join("Tidy.class").exists(),
        "student's folder must stay clean"
    );
}

#[test]
fn runaway_program_is_terminated() {
    if !tool_present("gcc") {
        eprintln!("skipping: gcc not installed");
        return;
    }
    let f = fixture("spin.c", "int main(void){ for(;;){} return 0; }");
    let runner = runner_for_path(&f.ctx.source).unwrap();

    let spec = runner.compile(&f.ctx).unwrap().unwrap();
    let built = Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .output()
        .expect("gcc ran");
    assert!(built.status.success());

    let exec = runner.execute(&f.ctx).unwrap();
    let mut cmd = Command::new(&exec.program);
    cmd.args(&exec.args)
        .current_dir(&exec.cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    detach_process_group(&mut cmd);

    let mut child = cmd.spawn().expect("infinite loop started");
    // It is genuinely running, not already dead.
    assert!(child.try_wait().unwrap().is_none());

    let outcome = kill_tree(&mut child).expect("kill");
    assert!(
        matches!(outcome, KillOutcome::Terminated | KillOutcome::Killed),
        "expected the watchdog to stop it, got {outcome:?}"
    );
    assert!(child.try_wait().unwrap().is_some(), "no orphan left behind");
}

#[test]
fn unknown_extension_is_rejected_before_spawning_anything() {
    assert!(runner_for_path(&PathBuf::from("notes.md")).is_err());
}

/// Packaged classes compile into nested directories and only launch under their
/// fully qualified name.
#[test]
fn java_packaged_class_compiles_and_runs() {
    if !tool_present("javac") || !tool_present("java") {
        eprintln!("skipping: JDK not installed");
        return;
    }
    let f = fixture(
        "Main.java",
        "package com.example;\npublic class Main { public static void main(String[] a){ System.out.println(\"hello from package\"); } }",
    );

    let runner = runner_for_path(&f.ctx.source).unwrap();
    assert_eq!(
        runner.execute(&f.ctx).unwrap().args.last().unwrap(),
        "com.example.Main"
    );

    assert!(compile_and_run(&f).contains("hello from package"));
    assert!(
        f.ctx.scratch.join("com/example/Main.class").exists(),
        "javac nests packaged output"
    );
}

#[test]
fn salivo_program_compiles_and_runs() {
    if !tool_present("sf") {
        eprintln!("skipping: sf not installed");
        return;
    }
    let f = fixture(
        "hello.sal",
        "module main;\nfunc main() -> int {\n    outln(\"hello from salivo\");\n    return 0;\n}\n",
    );
    assert!(compile_and_run(&f).contains("hello from salivo"));
}

/// `sf build` writes to its working directory, so the runner must point that at
/// scratch or every run drops a build/ folder into the student's project.
#[test]
fn salivo_build_artifacts_stay_out_of_the_project() {
    if !tool_present("sf") {
        eprintln!("skipping: sf not installed");
        return;
    }
    let f = fixture(
        "tidy.sal",
        "module main;\nfunc main() -> int {\n    return 0;\n}\n",
    );

    let runner = runner_for_path(&f.ctx.source).unwrap();
    let spec = runner.compile(&f.ctx).unwrap().expect("salivo compiles");
    Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .output()
        .expect("sf ran");

    assert!(f.ctx.scratch.join("build").exists(), "artifacts in scratch");
    assert!(
        !f.ctx.workdir.join("build").exists(),
        "student's folder must stay clean"
    );
}

// ---------------------------------------------------------------------------
// Failure modes, I/O and edge cases
// ---------------------------------------------------------------------------

/// Runs the compile step, returning its output (`None` for interpreted files).
fn compile(fixture: &Fixture) -> Option<Output> {
    let runner = runner_for_path(&fixture.ctx.source).expect("runner");
    let spec = runner.compile(&fixture.ctx).expect("compile spec")?;
    Some(command(&spec).output().expect("compiler ran"))
}

fn command(spec: &CommandSpec) -> Command {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        // Pipes default to the ANSI code page on Windows; the IDE uses a
        // UTF-8 terminal, so mirror that.
        .env("PYTHONIOENCODING", "utf-8");
    cmd
}

/// Compiles (asserting success) and returns the exec command.
fn build(fixture: &Fixture) -> Command {
    if let Some(out) = compile(fixture) {
        assert!(
            out.status.success(),
            "compile failed:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let runner = runner_for_path(&fixture.ctx.source).unwrap();
    command(&runner.execute(&fixture.ctx).expect("run spec"))
}

/// The Python runner's command when an interpreter exists (store stubs
/// excluded, exactly as the IDE resolves it).
fn python(fixture: &Fixture) -> Option<Command> {
    let runner = runner_for_path(&fixture.ctx.source).unwrap();
    match runner.execute(&fixture.ctx) {
        Ok(spec) => Some(command(&spec)),
        Err(_) => {
            eprintln!("skipping: python not installed");
            None
        }
    }
}

fn has_jdk() -> bool {
    let ok = tool_present("javac") && tool_present("java");
    if !ok {
        eprintln!("skipping: JDK not installed");
    }
    ok
}

fn has(tool: &str) -> bool {
    let ok = tool_present(tool);
    if !ok {
        eprintln!("skipping: {tool} not installed");
    }
    ok
}

/// Waits up to `limit`; kills the whole tree and returns `None` if the
/// program is still running then.
fn wait_or_kill(child: &mut Child, limit: Duration) -> Option<ExitStatus> {
    let deadline = Instant::now() + limit;
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return Some(status);
        }
        if Instant::now() >= deadline {
            kill_tree(child).unwrap();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn c_compile_error_fails_the_build_with_a_diagnostic() {
    if !has("gcc") {
        return;
    }
    let f = fixture("broken.c", "int main(void) { return 0 }\n");
    let out = compile(&f).unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("error"), "{stderr}");
    assert!(
        stderr.contains("broken.c"),
        "diagnostic names the file: {stderr}"
    );
}

#[test]
fn cpp_compile_error_fails_the_build() {
    if !has("g++") {
        return;
    }
    let f = fixture("broken.cpp", "int main() { undeclared_thing(); }\n");
    let out = compile(&f).unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("error"));
}

#[test]
fn java_compile_error_fails_the_build() {
    if !has_jdk() {
        return;
    }
    let f = fixture("Bad.java", "public class Bad { void x( }\n");
    let out = compile(&f).unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("error"));
}

#[test]
fn c_nonzero_exit_code_is_reported() {
    if !has("gcc") {
        return;
    }
    let f = fixture("three.c", "int main(void) { return 3; }\n");
    let status = build(&f).status().unwrap();
    assert_eq!(status.code(), Some(3));
}

#[test]
fn c_crash_gets_a_plain_language_hint() {
    if !has("gcc") {
        return;
    }
    let f = fixture(
        "crash.c",
        "int main(void) { volatile int *p = 0; *p = 1; return 0; }\n",
    );
    let status = build(&f).status().unwrap();
    #[cfg(unix)]
    let code = {
        use std::os::unix::process::ExitStatusExt;
        status.signal().map(|s| 128 + s).or(status.code()).unwrap()
    };
    #[cfg(windows)]
    let code = status.code().unwrap();
    assert!(crash_hint(code).is_some(), "no hint for exit code {code}");
}

#[test]
fn python_runtime_error_exits_nonzero_with_traceback() {
    let f = fixture("boom.py", "raise ValueError('boom')\n");
    let Some(mut cmd) = python(&f) else { return };
    let out = cmd.output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("ValueError: boom"));
}

#[test]
fn java_runtime_exception_exits_nonzero() {
    if !has_jdk() {
        return;
    }
    let f = fixture(
        "Thrower.java",
        "public class Thrower { public static void main(String[] a) { \
         throw new IllegalStateException(\"bad state\"); } }",
    );
    let out = build(&f).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("IllegalStateException"));
}

#[test]
fn sleeping_program_is_stopped_by_the_timeout() {
    let f = fixture("slow.py", "import time\ntime.sleep(60)\n");
    let Some(mut cmd) = python(&f) else { return };
    detach_process_group(&mut cmd);
    let mut child = cmd.spawn().unwrap();
    let started = Instant::now();
    assert!(
        wait_or_kill(&mut child, Duration::from_millis(500)).is_none(),
        "must still be running when the timeout fires"
    );
    assert!(child.try_wait().unwrap().is_some(), "killed");
    assert!(started.elapsed() < Duration::from_secs(10));
}

/// A flood of output must be drained completely and promptly; a pipe left
/// full would block the program forever.
#[test]
fn huge_output_is_drained_without_blocking() {
    let f = fixture(
        "flood.py",
        "import sys\nline = 'x' * 1023 + '\\n'\nfor _ in range(20 * 1024):\n    sys.stdout.write(line)\n",
    );
    let Some(mut cmd) = python(&f) else { return };
    let started = Instant::now();
    let out = cmd.output().unwrap();
    assert!(out.status.success());
    assert!(out.stdout.len() >= 20 * 1024 * 1024, "{}", out.stdout.len());
    assert!(started.elapsed() < Duration::from_secs(60));
}

#[test]
fn unicode_output_survives_the_round_trip() {
    let f = fixture(
        "uni.py",
        "print('h\u{e9}llo \u{2713} \u{4f60}\u{597d} \u{1F600}')\n",
    );
    let Some(mut cmd) = python(&f) else { return };
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8(out.stdout).expect("valid UTF-8");
    assert!(
        text.contains("h\u{e9}llo \u{2713} \u{4f60}\u{597d} \u{1F600}"),
        "{text}"
    );
}

#[test]
fn c_program_prints_utf8_bytes_unchanged() {
    if !has("gcc") {
        return;
    }
    let f = fixture(
        "uni.c",
        "#include <stdio.h>\nint main(void){ fputs(\"caf\u{e9} \u{2500}\u{2500}\\n\", stdout); return 0; }\n",
    );
    let out = build(&f).output().unwrap();
    assert_eq!(
        String::from_utf8(out.stdout).unwrap().trim_end(),
        "caf\u{e9} \u{2500}\u{2500}"
    );
}

#[test]
fn stdin_is_read_until_closed() {
    let f = fixture(
        "count.py",
        "import sys\nlines = sys.stdin.read().splitlines()\nprint(len(lines), lines[-1])\n",
    );
    let Some(mut cmd) = python(&f) else { return };
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"one\ntwo\nthree\n").unwrap();
    // Closing stdin is the EOF that `sys.stdin.read()` waits for.
    drop(stdin);
    assert!(
        wait_or_kill(&mut child, Duration::from_secs(20)).is_some(),
        "EOF reached"
    );
    let out = child.wait_with_output().unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "3 three");
}

#[test]
fn c_scanf_reads_interactive_input() {
    if !has("gcc") {
        return;
    }
    let f = fixture(
        "sum.c",
        "#include <stdio.h>\nint main(void){ int a, b; printf(\"Enter: \"); fflush(stdout);\n\
         if (scanf(\"%d %d\", &a, &b) != 2) return 2; printf(\"%d\\n\", a + b); return 0; }\n",
    );
    let mut child = build(&f)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"20 22\n").unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("42"));
}

#[test]
fn paths_with_spaces_compile_and_run() {
    if !has("gcc") {
        return;
    }
    let f = fixture_in(
        "my project",
        "hello world.c",
        "#include <stdio.h>\nint main(void){ puts(\"spaced out\"); return 0; }\n",
    );
    assert!(compile_and_run(&f).contains("spaced out"));
}

#[test]
fn python_path_with_spaces_runs() {
    let f = fixture_in("my project", "hello world.py", "print('spaced python')\n");
    let Some(mut cmd) = python(&f) else { return };
    let out = cmd.output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("spaced python"));
}

#[test]
fn missing_tool_is_reported_in_plain_words() {
    let err = codeui_lib::runners::runner_trait::resolve_tool_cmd(&["codeui-no-such-compiler"])
        .unwrap_err();
    assert!(matches!(err, RunnerError::ToolMissing(_)));
    let message = err.to_string();
    assert!(message.contains("codeui-no-such-compiler") && message.contains("not found"));
}

#[test]
fn missing_program_spawn_error_is_explained() {
    let err = Command::new("codeui-no-such-program").spawn().unwrap_err();
    let message = codeui_lib::proc::explain_spawn_error("codeui-no-such-program", &err);
    assert!(message.contains("was not found"), "{message}");
}

#[test]
fn unsupported_extension_lists_what_can_run() {
    let err = runner_for_path(&PathBuf::from("notes.txt"))
        .err()
        .expect("rejected");
    let message = err.to_string();
    assert!(
        message.contains(".py") && message.contains(".java"),
        "{message}"
    );
}
