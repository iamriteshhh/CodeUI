//! One-click compile-and-run engine with streamed output and a timeout watchdog.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::proc::{
    crash_hint, detach_process_group, kill_tree, kill_tree_by_pid, take_utf8, DEFAULT_TIMEOUT_SECS,
};
use crate::runners::{runner_for_path, CommandSpec, RunContext, RunnerError};

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum RunError {
    #[error("{0}")]
    Runner(#[from] RunnerError),
    #[error("no run is active with id {0}")]
    UnknownRun(String),
    #[error("{0}")]
    Io(String),
}

/// Output is batched on this cadence. A tight `while(1) printf(...)` loop would
/// otherwise emit thousands of IPC messages a second and stall the UI.
const FLUSH_INTERVAL: Duration = Duration::from_millis(30);
const FLUSH_BYTES: usize = 8192;

/// How long to wait for output pumps to drain once the program has exited.
const DRAIN_GRACE: Duration = Duration::from_millis(250);

/// Compilers get their own budget. Pathological C++ templates can run for
/// minutes, and an unbounded compile would hang the app with no way out.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(60);

/// Ceiling on forwarded output per run. A runaway print loop can emit hundreds
/// of megabytes in twelve seconds, which would take the webview down with it.
const OUTPUT_CAP: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub run_id: String,
    /// `"stdout"` or `"stderr"`.
    pub stream: &'static str,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum RunStatus {
    #[serde(rename_all = "camelCase")]
    Compiling { language: String },
    #[serde(rename_all = "camelCase")]
    CompileFailed { exit_code: Option<i32> },
    #[serde(rename_all = "camelCase")]
    Running { language: String, pid: u32 },
    #[serde(rename_all = "camelCase")]
    Finished {
        exit_code: Option<i32>,
        timed_out: bool,
        stopped_by_user: bool,
        duration_ms: u64,
        hint: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed { message: String },
}

#[derive(Clone)]
enum ActiveChild {
    Piped(Arc<Mutex<Child>>),
    Pty {
        child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
        pid: u32,
    },
}

#[derive(Clone)]
enum ActiveStdin {
    Piped(Arc<Mutex<Option<ChildStdin>>>),
    Pty(Arc<Mutex<Option<Box<dyn Write + Send>>>>),
}

struct ActiveRun {
    child: ActiveChild,
    stdin: ActiveStdin,
    stopped_by_user: Arc<AtomicBool>,
    last_input: Arc<Mutex<Instant>>,
}

#[derive(Default)]
pub struct RunRegistry {
    runs: Mutex<HashMap<String, ActiveRun>>,
}

impl RunRegistry {
    fn insert(&self, id: String, run: ActiveRun) {
        self.runs.lock().expect("run registry").insert(id, run);
    }

    fn remove(&self, id: &str) {
        self.runs.lock().expect("run registry").remove(id);
    }

    pub fn stop(&self, id: &str) -> Result<(), RunError> {
        let (child, stdin, stopped_by_user) = {
            let runs = self.runs.lock().expect("run registry");
            let run = runs
                .get(id)
                .ok_or_else(|| RunError::UnknownRun(id.to_string()))?;
            (
                run.child.clone(),
                run.stdin.clone(),
                Arc::clone(&run.stopped_by_user),
            )
        };

        stopped_by_user.store(true, Ordering::SeqCst);

        match child {
            ActiveChild::Piped(child) => {
                let mut child = child.lock().expect("child");
                kill_tree(&mut child).map_err(|e| RunError::Io(e.to_string()))?;
            }
            ActiveChild::Pty { child, pid } => {
                if let ActiveStdin::Pty(writer) = stdin {
                    if let Ok(mut guard) = writer.lock() {
                        if let Some(w) = guard.as_mut() {
                            let _ = w.write_all(b"\x03");
                            let _ = w.flush();
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
                let mut child = child.lock().expect("pty child");
                let _ = child.kill();
                if pid > 0 {
                    kill_tree_by_pid(pid);
                }
            }
        }
        Ok(())
    }

    pub fn write_stdin(&self, id: &str, data: &str) -> Result<(), RunError> {
        let (stdin, last_input) = {
            let runs = self.runs.lock().expect("run registry");
            let run = runs
                .get(id)
                .ok_or_else(|| RunError::UnknownRun(id.to_string()))?;
            (run.stdin.clone(), Arc::clone(&run.last_input))
        };

        if let Ok(mut ts) = last_input.lock() {
            *ts = Instant::now();
        }

        match stdin {
            ActiveStdin::Piped(stdin) => {
                let mut guard = stdin.lock().expect("stdin");
                match guard.as_mut() {
                    Some(pipe) => pipe
                        .write_all(data.as_bytes())
                        .and_then(|_| pipe.flush())
                        .map_err(|e| RunError::Io(e.to_string())),
                    None => Err(RunError::Io("program is not accepting input".into())),
                }
            }
            ActiveStdin::Pty(writer) => {
                let mut guard = writer.lock().expect("pty writer");
                match guard.as_mut() {
                    Some(w) => w
                        .write_all(data.as_bytes())
                        .and_then(|_| w.flush())
                        .map_err(|e| RunError::Io(e.to_string())),
                    None => Err(RunError::Io("program is not accepting input".into())),
                }
            }
        }
    }

    pub fn close_stdin(&self, id: &str) -> Result<(), RunError> {
        let stdin = {
            let runs = self.runs.lock().expect("run registry");
            let run = runs
                .get(id)
                .ok_or_else(|| RunError::UnknownRun(id.to_string()))?;
            run.stdin.clone()
        };

        match stdin {
            ActiveStdin::Piped(stdin) => {
                stdin.lock().expect("stdin").take();
            }
            ActiveStdin::Pty(writer) => {
                let mut guard = writer.lock().expect("pty writer");
                if let Some(w) = guard.as_mut() {
                    #[cfg(windows)]
                    let _ = w.write_all(b"\x1a\r\n");
                    #[cfg(not(windows))]
                    let _ = w.write_all(b"\x04");
                    let _ = w.flush();
                }
                guard.take();
            }
        }
        Ok(())
    }

    /// Kills every live run. Called on window close so nothing survives the app.
    pub fn shutdown_all(&self) {
        let runs: Vec<ActiveRun> = {
            let mut runs = self.runs.lock().expect("run registry");
            runs.drain().map(|(_, run)| run).collect()
        };
        for run in runs {
            match run.child {
                ActiveChild::Piped(child) => {
                    if let Ok(mut child) = child.lock() {
                        let _ = kill_tree(&mut child);
                    }
                }
                ActiveChild::Pty { child, pid } => {
                    if let Ok(mut child) = child.lock() {
                        let _ = child.kill();
                    }
                    if pid > 0 {
                        kill_tree_by_pid(pid);
                    }
                }
            }
        }
    }
}

/// Shared output allowance for one run, spanning compile and execution.
#[derive(Default)]
struct OutputBudget {
    used: AtomicUsize,
    notified: AtomicBool,
}

impl OutputBudget {
    fn allow(&self, len: usize) -> bool {
        self.used.fetch_add(len, Ordering::Relaxed) + len <= OUTPUT_CAP
    }

    /// True for exactly one caller, so the cap is announced once per run.
    fn claim_notice(&self) -> bool {
        !self.notified.swap(true, Ordering::SeqCst)
    }
}

struct Outcome {
    exit_code: Option<i32>,
    timed_out: bool,
}

fn status_event(run_id: &str) -> String {
    format!("run-status-{run_id}")
}

fn output_event(run_id: &str) -> String {
    format!("run-output-{run_id}")
}

/// Compiles (if needed) and runs `path`, streaming output back over Tauri events.
///
/// Returns immediately with the run id; progress arrives on `run-status-{id}`
/// and `run-output-{id}`.
#[tauri::command]
pub fn run_file(
    app: AppHandle,
    path: String,
    run_id: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<String, RunError> {
    let source = std::path::PathBuf::from(&path);
    let runner = runner_for_path(&source)?;

    let workdir = source
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let run_id = run_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let scratch = std::env::temp_dir().join(format!("codeui-{run_id}"));
    std::fs::create_dir_all(&scratch).map_err(|e| RunError::Io(e.to_string()))?;
    restrict_scratch(&scratch);

    let ctx = RunContext {
        source,
        scratch: scratch.clone(),
        workdir,
    };

    // Resolving the commands can fail (missing toolchain, Java name mismatch).
    // The scratch directory already exists by then, so clean it up rather than
    // leaving one behind in /tmp for every failed run.
    let specs = runner
        .compile(&ctx)
        .and_then(|compile| runner.execute(&ctx).map(|exec| (compile, exec)));

    let (compile_spec, exec_spec) = match specs {
        Ok(specs) => specs,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&scratch);
            return Err(e.into());
        }
    };

    let language = runner.display_name().to_string();
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS));

    let app_bg = app.clone();
    let id_bg = run_id.clone();

    std::thread::spawn(move || {
        let started = Instant::now();
        let budget = Arc::new(OutputBudget::default());
        let stopped_by_user = Arc::new(AtomicBool::new(false));
        let status = status_event(&id_bg);

        let finish = |status: RunStatus| {
            let _ = app_bg.emit(&status_event(&id_bg), status);
            let _ = std::fs::remove_dir_all(&scratch);
        };

        if let Some(spec) = compile_spec {
            let _ = app_bg.emit(
                &status,
                RunStatus::Compiling {
                    language: language.clone(),
                },
            );

            let compiled = supervise(
                &app_bg,
                &id_bg,
                spec,
                COMPILE_TIMEOUT,
                &budget,
                &stopped_by_user,
                false,
                |_| {},
            );

            let outcome = match compiled {
                Ok(outcome) => outcome,
                Err(message) => return finish(RunStatus::Failed { message }),
            };

            // Checked before the exit code: stopping the compiler kills it, and
            // that shows up as a non-zero exit. Reporting it as a compile error
            // would put the student in front of an empty diagnostics panel.
            if stopped_by_user.load(Ordering::SeqCst) {
                return finish(RunStatus::Finished {
                    exit_code: None,
                    timed_out: false,
                    stopped_by_user: true,
                    duration_ms: started.elapsed().as_millis() as u64,
                    hint: None,
                });
            }

            if outcome.timed_out {
                return finish(RunStatus::Failed {
                    message: format!(
                        "The compiler did not finish within {} seconds and was stopped.",
                        COMPILE_TIMEOUT.as_secs()
                    ),
                });
            }

            if outcome.exit_code != Some(0) {
                return finish(RunStatus::CompileFailed {
                    exit_code: outcome.exit_code,
                });
            }
        }

        let announce = |pid: u32| {
            let _ = app_bg.emit(
                &status,
                RunStatus::Running {
                    language: language.clone(),
                    pid,
                },
            );
        };

        let outcome = supervise_pty(
            &app_bg,
            &id_bg,
            exec_spec,
            timeout,
            &budget,
            &stopped_by_user,
            announce,
        );

        match outcome {
            Err(message) => finish(RunStatus::Failed { message }),
            Ok(outcome) => {
                let stopped = stopped_by_user.load(Ordering::SeqCst);
                let hint = if outcome.timed_out {
                    Some(format!(
                        "Program was inactive (no user input) for {} seconds and was stopped.",
                        timeout.as_secs()
                    ))
                } else if stopped {
                    None
                } else {
                    outcome.exit_code.and_then(crash_hint).map(str::to_string)
                };

                finish(RunStatus::Finished {
                    exit_code: outcome.exit_code,
                    timed_out: outcome.timed_out,
                    stopped_by_user: stopped,
                    duration_ms: started.elapsed().as_millis() as u64,
                    hint,
                })
            }
        }
    });

    Ok(run_id)
}

/// Runs the execution phase in its own dedicated pseudo-terminal (PTY).
///
/// A real PTY provides line buffering, real-time unbuffered stdout for prompts
/// like `printf("Enter: ")`, interactive terminal stdin (`scanf`, `cin`, `input()`),
/// and clean signals without shell script injection.
fn supervise_pty(
    app: &AppHandle,
    run_id: &str,
    spec: CommandSpec,
    timeout: Duration,
    budget: &Arc<OutputBudget>,
    stopped_by_user: &Arc<AtomicBool>,
    on_spawn: impl FnOnce(u32),
) -> Result<Outcome, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("could not open pseudo-terminal: {e}"))?;

    let mut builder = CommandBuilder::new(&spec.program);
    builder.args(&spec.args);
    builder.cwd(&spec.cwd);
    builder.env("TERM", "xterm-256color");
    builder.env("PATH", crate::proc::augmented_path());

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("could not start {}: {e}", spec.program))?;

    let pid = child.process_id().unwrap_or(0);
    on_spawn(pid);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("could not read from pty: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("could not take pty writer: {e}"))?;

    #[cfg(windows)]
    let _slave_holder = Some(pair.slave);
    #[cfg(not(windows))]
    let _slave_holder: Option<()> = {
        drop(pair.slave);
        None
    };

    let last_input = Arc::new(Mutex::new(Instant::now()));
    let child = Arc::new(Mutex::new(child));
    let writer = Arc::new(Mutex::new(Some(writer)));

    app.state::<RunRegistry>().insert(
        run_id.to_string(),
        ActiveRun {
            child: ActiveChild::Pty {
                child: Arc::clone(&child),
                pid,
            },
            stdin: ActiveStdin::Pty(Arc::clone(&writer)),
            stopped_by_user: Arc::clone(stopped_by_user),
            last_input: Arc::clone(&last_input),
        },
    );

    let (done_tx, done_rx) = std::sync::mpsc::channel();
    spawn_pump(
        app.clone(),
        run_id.to_string(),
        "stdout",
        reader,
        Arc::clone(budget),
        done_tx,
    );

    let started = Instant::now();
    let hard_ceiling = Duration::from_secs(300);
    let mut timed_out = false;

    let poll = || -> Result<Option<Option<i32>>, String> {
        let mut guard = child.lock().map_err(|e| e.to_string())?;
        match guard.try_wait() {
            Ok(Some(status)) => {
                let code = if status.success() {
                    0
                } else {
                    status.exit_code() as i32
                };
                Ok(Some(Some(code)))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    };

    let exit_code = loop {
        let state = match poll() {
            Ok(state) => state,
            Err(e) => {
                app.state::<RunRegistry>().remove(run_id);
                return Err(e);
            }
        };

        if let Some(code) = state {
            break code;
        }

        if stopped_by_user.load(Ordering::SeqCst) {
            let mut guard = child.lock().expect("pty child");
            let _ = guard.kill();
            if pid > 0 {
                kill_tree_by_pid(pid);
            }
            break Some(137);
        }

        let now = Instant::now();
        let inactive = now.duration_since(*last_input.lock().unwrap());
        if inactive >= timeout {
            timed_out = true;
            let mut guard = child.lock().expect("pty child");
            let _ = guard.kill();
            if pid > 0 {
                kill_tree_by_pid(pid);
            }
            break Some(124);
        }

        if now.duration_since(started) >= hard_ceiling {
            timed_out = true;
            let mut guard = child.lock().expect("pty child");
            let _ = guard.kill();
            if pid > 0 {
                kill_tree_by_pid(pid);
            }
            break Some(124);
        }

        std::thread::sleep(Duration::from_millis(15));
    };

    let _ = done_rx.recv_timeout(DRAIN_GRACE);
    app.state::<RunRegistry>().remove(run_id);

    Ok(Outcome {
        exit_code,
        timed_out,
    })
}

/// Runs one child to completion under a timeout, streaming its output.
///
/// Used for both the compile and the execute phase so that a runaway compiler
/// is just as stoppable as a runaway program.
#[allow(clippy::too_many_arguments)]
fn supervise(
    app: &AppHandle,
    run_id: &str,
    spec: CommandSpec,
    timeout: Duration,
    budget: &Arc<OutputBudget>,
    stopped_by_user: &Arc<AtomicBool>,
    interactive: bool,
    on_spawn: impl FnOnce(u32),
) -> Result<Outcome, String> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        .env("PATH", crate::proc::augmented_path())
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .stdin(if interactive {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    detach_process_group(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", spec.program))?;

    // The clock starts here, not when the request arrived: a slow compile must
    // not eat into the student's execution budget.
    let deadline = Instant::now() + timeout;

    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let child = Arc::new(Mutex::new(child));
    app.state::<RunRegistry>().insert(
        run_id.to_string(),
        ActiveRun {
            child: ActiveChild::Piped(Arc::clone(&child)),
            stdin: ActiveStdin::Piped(Arc::new(Mutex::new(stdin))),
            stopped_by_user: Arc::clone(stopped_by_user),
            last_input: Arc::new(Mutex::new(Instant::now())),
        },
    );

    on_spawn(pid);

    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let mut pump_count = 0;
    for (stream, source) in [
        ("stdout", stdout.map(PumpSource::Out)),
        ("stderr", stderr.map(PumpSource::Err)),
    ] {
        if let Some(source) = source {
            spawn_pump(
                app.clone(),
                run_id.to_string(),
                stream,
                source,
                Arc::clone(budget),
                done_tx.clone(),
            );
            pump_count += 1;
        }
    }
    drop(done_tx);

    let mut timed_out = false;
    let poll = || -> Result<Option<Option<i32>>, String> {
        match child.lock().expect("child").try_wait() {
            Ok(Some(status)) => Ok(Some(exit_status_code(status))),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    };

    let exit_code = loop {
        // Unregister before returning on error, or the entry outlives the run.
        let state = match poll() {
            Ok(state) => state,
            Err(e) => {
                app.state::<RunRegistry>().remove(run_id);
                return Err(e);
            }
        };

        if let Some(code) = state {
            break code;
        }

        if Instant::now() >= deadline {
            timed_out = true;
            let mut guard = child.lock().expect("child");
            let _ = kill_tree(&mut guard);
            break guard
                .try_wait()
                .ok()
                .flatten()
                .map(exit_status_code)
                .unwrap_or(Some(137));
        }

        std::thread::sleep(Duration::from_millis(15));
    };

    // Let the pumps flush what is left. This must stay bounded: a grandchild
    // that escaped the process group can hold the pipes open indefinitely, and
    // waiting on it would mean the run never reports finished.
    for _ in 0..pump_count {
        if done_rx.recv_timeout(DRAIN_GRACE).is_err() {
            break;
        }
    }

    app.state::<RunRegistry>().remove(run_id);

    Ok(Outcome {
        exit_code,
        timed_out,
    })
}

/// Keeps the two pipe types in one thread-spawning path without boxing.
enum PumpSource {
    Out(std::process::ChildStdout),
    Err(std::process::ChildStderr),
}

impl Read for PumpSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            PumpSource::Out(r) => r.read(buf),
            PumpSource::Err(r) => r.read(buf),
        }
    }
}

fn exit_status_code(status: std::process::ExitStatus) -> Option<i32> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        // A signalled process has no exit code; report it the way a shell does.
        if let Some(sig) = status.signal() {
            return Some(128 + sig);
        }
    }
    status.code()
}

/// Forwards a pipe to the frontend.
///
/// Reads bytes rather than lines so an unterminated `printf("Enter: ")` prompt
/// reaches the student before their program blocks on input.
fn spawn_pump<R: Read + Send + 'static>(
    app: AppHandle,
    run_id: String,
    stream: &'static str,
    mut source: R,
    budget: Arc<OutputBudget>,
    done: std::sync::mpsc::Sender<()>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        let mut last_flush = Instant::now();

        loop {
            match source.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => pending.extend_from_slice(&buf[..n]),
            }

            // Rate-limit without ever stranding output: if this batch arrived
            // too soon after the last one, wait out the remainder of the window
            // and flush anyway. The pipe keeps filling meanwhile, so torrential
            // output coalesces while a lone prompt is never held back further
            // than one interval.
            let wait = FLUSH_INTERVAL.saturating_sub(last_flush.elapsed());
            if !wait.is_zero() && pending.len() < FLUSH_BYTES {
                std::thread::sleep(wait);
            }

            if let Some(chunk) = take_utf8(&mut pending) {
                forward(&app, &run_id, stream, chunk, &budget);
            }
            last_flush = Instant::now();
        }

        // Whatever is left is final; trailing bytes here are genuinely malformed.
        if !pending.is_empty() {
            let chunk = String::from_utf8_lossy(&pending).into_owned();
            forward(&app, &run_id, stream, chunk, &budget);
        }
        let _ = done.send(());
    });
}

/// Emits a chunk unless the run has exhausted its output allowance.
///
/// Reading always continues past the cap: leaving the pipe full would block the
/// student's program instead of merely silencing it.
fn forward(
    app: &AppHandle,
    run_id: &str,
    stream: &'static str,
    chunk: String,
    budget: &OutputBudget,
) {
    if budget.allow(chunk.len()) {
        emit_chunk(app, run_id, stream, chunk);
    } else if budget.claim_notice() {
        emit_chunk(
            app,
            run_id,
            "stderr",
            format!(
                "\n[CodeUI] Output passed {} MB and is no longer being shown. The program is still running.\n",
                OUTPUT_CAP / (1024 * 1024)
            ),
        );
    }
}

fn emit_chunk(app: &AppHandle, run_id: &str, stream: &'static str, chunk: String) {
    let _ = app.emit(
        &output_event(run_id),
        OutputChunk {
            run_id: run_id.to_string(),
            stream,
            chunk,
        },
    );
}

/// Keeps build artifacts out of other lab users' reach.
fn restrict_scratch(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Stops a run through the same escalation path as the timeout watchdog.
#[tauri::command]
pub fn stop_run(registry: State<'_, RunRegistry>, run_id: String) -> Result<(), RunError> {
    registry.stop(&run_id)
}

/// Feeds a line to a program waiting on `scanf` / `input()`.
#[tauri::command]
pub fn write_run_stdin(
    registry: State<'_, RunRegistry>,
    run_id: String,
    data: String,
) -> Result<(), RunError> {
    registry.write_stdin(&run_id, &data)
}

/// Signals end-of-input.
///
/// Programs that loop until EOF (`while (scanf(...) != EOF)`, `sys.stdin.read()`)
/// never terminate otherwise, because the pipe stays open for the whole run.
#[tauri::command]
pub fn close_run_stdin(registry: State<'_, RunRegistry>, run_id: String) -> Result<(), RunError> {
    registry.close_stdin(&run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_stops_admitting_past_the_cap() {
        let budget = OutputBudget::default();
        assert!(budget.allow(OUTPUT_CAP - 10));
        assert!(!budget.allow(20), "crossing the cap is refused");
        assert!(!budget.allow(1), "and stays refused");
    }

    #[test]
    fn cap_is_announced_exactly_once() {
        let budget = OutputBudget::default();
        assert!(budget.claim_notice());
        assert!(!budget.claim_notice(), "both pumps must not both announce");
    }

    #[test]
    fn budget_admits_normal_output() {
        let budget = OutputBudget::default();
        for _ in 0..100 {
            assert!(budget.allow(1024));
        }
    }
}
