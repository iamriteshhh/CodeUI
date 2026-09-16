//! End-to-end checks that each runner's commands actually compile and run.
//!
//! These drive the runner traits directly rather than through Tauri, so they
//! verify the real compiler invocations without needing a webview.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use codeui_lib::proc::{detach_process_group, kill_tree, KillOutcome};
use codeui_lib::runners::{runner_for_path, RunContext};

struct Fixture {
    _dir: tempfile::TempDir,
    ctx: RunContext,
}

/// Mirrors production layout: the project and the scratch area are separate
/// trees, so an assertion about one cannot be satisfied by the other.
fn fixture(filename: &str, source: &str) -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let workdir = dir.path().join("project");
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
