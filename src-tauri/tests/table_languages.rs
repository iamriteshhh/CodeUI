//! Every language of the runner table, run with its real toolchain when installed: each
//! program reads one line ("42") and prints it back. Languages whose tool is missing on
//! this machine are skipped; any that is present must work.

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use codeui_lib::runners::{runner_for_path, CommandSpec, RunContext, RunnerError};

const PROGRAMS: &[(&str, &str, &str)] = &[
    ("a.js", "const rl = require(\"readline\").createInterface({ input: process.stdin });\nrl.question(\"name: \", (n) => { console.log(\"js ok \" + n); rl.close(); });\n", "js ok 42"),
    ("a.ts", "const greet = (n: number): string => `ts ok ${n * 2}`;\nconsole.log(greet(21));\n", "ts ok 42"),
    ("a.rs", "use std::io::stdin;\nfn main() { let mut s = String::new(); stdin().read_line(&mut s).unwrap(); println!(\"rust ok {}\", s.trim()); }\n", "rust ok 42"),
    ("a.go", "package main\nimport \"fmt\"\nfunc main() { var n string; fmt.Scanln(&n); fmt.Println(\"go ok\", n) }\n", "go ok 42"),
    ("a.kt", "fun main() { val n = readLine(); println(\"kotlin ok $n\") }\n", "kotlin ok 42"),
    ("a.cs", "var n = Console.ReadLine();\nConsole.WriteLine($\"csharp ok {n}\");\n", "csharp ok 42"),
    ("a.swift", "let n = readLine() ?? \"\"\nprint(\"swift ok \\(n)\")\n", "swift ok 42"),
    ("a.dart", "import 'dart:io';\nvoid main() { final n = stdin.readLineSync(); print('dart ok $n'); }\n", "dart ok 42"),
    ("a.rb", "n = gets.strip; puts \"ruby ok #{n}\"\n", "ruby ok 42"),
    ("a.php", "<?php $n = trim(fgets(STDIN)); echo \"php ok $n\\n\";\n", "php ok 42"),
    ("a.pl", "my $n = <STDIN>; chomp $n; $n =~ s/\\r$//; print \"perl ok $n\\n\";\n", "perl ok 42"),
    ("a.lua", "local n = io.read(); print(\"lua ok \" .. n)\n", "lua ok 42"),
    ("a.r", "n <- readLines(file(\"stdin\"), n = 1); cat(\"r ok\", n, \"\\n\")\n", "r ok 42"),
    ("a.jl", "n = readline(); println(\"julia ok \", n)\n", "julia ok 42"),
    ("a.hs", "main = getLine >>= \\n -> putStrLn (\"haskell ok \" ++ n)\n", "haskell ok 42"),
    ("a.ml", "let () = let n = read_line () in print_endline (\"ocaml ok \" ^ n)\n", "ocaml ok 42"),
    ("a.exs", "n = IO.gets(\"\") |> String.trim(); IO.puts(\"elixir ok #{n}\")\n", "elixir ok 42"),
    ("a.erl", "#!/usr/bin/env escript\nmain(_) -> N = string:trim(io:get_line(\"\")), io:format(\"erlang ok ~s~n\", [N]).\n", "erlang ok 42"),
    ("a.clj", "(println \"clojure ok\" (read-line))\n", "clojure ok 42"),
    ("a.scala", "object A { def main(args: Array[String]): Unit = println(\"scala ok \" + scala.io.StdIn.readLine()) }\n", "scala ok 42"),
    ("a.groovy", "def n = System.in.newReader().readLine(); println \"groovy ok $n\"\n", "groovy ok 42"),
    ("a.zig", "const std = @import(\"std\");\npub fn main() !void {\n    var buf: [64]u8 = undefined;\n    const line = (try std.io.getStdIn().reader().readUntilDelimiterOrEof(&buf, '\\n')) orelse \"\";\n    try std.io.getStdOut().writer().print(\"zig ok {s}\\n\", .{std.mem.trim(u8, line, \"\\r\")});\n}\n", "zig ok 42"),
    ("a.nim", "let n = readLine(stdin); echo \"nim ok \", n\n", "nim ok 42"),
    ("a.d", "import std.stdio, std.string;\nvoid main() { auto n = readln().strip; writeln(\"d ok \", n); }\n", "d ok 42"),
    ("a.f90", "program a\n  character(len=32) :: n\n  read(*,\"(A)\") n\n  print \"(A,A)\", \"fortran ok \", trim(n)\nend program a\n", "fortran ok 42"),
    ("a.pas", "program a;\nvar n: string;\nbegin\n  readln(n);\n  writeln('pascal ok ', n);\nend.\n", "pascal ok 42"),
    ("a.sh", "read n\necho \"shell ok $n\"\n", "shell ok 42"),
    ("a.ps1", "$n = [Console]::In.ReadLine()\nWrite-Output \"powershell ok $n\"\n", "powershell ok 42"),
    ("a.bat", "@echo off\nset /p n=\necho batch ok %n%\n", "batch ok 42"),
];

fn command(spec: &CommandSpec) -> Command {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).current_dir(&spec.cwd);
    cmd.env("PATH", codeui_lib::proc::augmented_path());
    cmd
}

/// Runs `cmd` with `input` on stdin, killing it after `limit`.
fn run(mut cmd: Command, input: &str, limit: Duration) -> Result<String, String> {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;
    child.stdin.take().unwrap().write_all(input.as_bytes()).ok();
    let start = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            return Err("timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(stdout)
    } else {
        Err(format!(
            "exit {:?}\n{stdout}\n{}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        ))
    }
}

#[test]
fn every_installed_table_language_runs() {
    let (mut ran, mut skipped, mut failed) = (Vec::new(), Vec::new(), Vec::new());
    for (file, source, expected) in PROGRAMS {
        if *file == "a.bat" && !cfg!(windows) {
            continue;
        }
        let dir = tempfile::tempdir().unwrap();
        let (workdir, scratch) = (dir.path().join("project"), dir.path().join("scratch"));
        std::fs::create_dir_all(&workdir).unwrap();
        std::fs::create_dir_all(&scratch).unwrap();
        let source_path = workdir.join(file);
        std::fs::write(&source_path, source).unwrap();
        let ctx = RunContext {
            source: source_path.clone(),
            scratch,
            workdir,
        };
        let runner = runner_for_path(&source_path).expect("table has the language");

        let missing = |e: &RunnerError| matches!(e, RunnerError::ToolMissing(_));
        let compile = match runner.compile(&ctx) {
            Err(e) if missing(&e) => {
                skipped.push(*file);
                continue;
            }
            other => other.expect("compile spec"),
        };
        if let Some(spec) = compile {
            if let Err(e) = run(command(&spec), "", Duration::from_secs(300)) {
                failed.push(format!("{file} build: {e}"));
                continue;
            }
        }
        let spec = match runner.execute(&ctx) {
            Err(e) if missing(&e) => {
                skipped.push(*file);
                continue;
            }
            other => other.expect("run spec"),
        };
        match run(command(&spec), "42\n", Duration::from_secs(180)) {
            Ok(out) if out.contains(expected) => ran.push(*file),
            Ok(out) => failed.push(format!("{file}: expected {expected:?}, got {out:?}")),
            Err(e) => failed.push(format!("{file}: {e}")),
        }
    }
    eprintln!("ran: {ran:?}\nskipped (tool not installed): {skipped:?}");
    assert!(failed.is_empty(), "failed:\n{}", failed.join("\n---\n"));
}
