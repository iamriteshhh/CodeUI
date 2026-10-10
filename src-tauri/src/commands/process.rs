//! One-click compile-and-run engine with streamed output and a timeout watchdog.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::workspace::{resolve_in_workspace, WorkspaceState};
use crate::proc::sandbox::{self, Guard, Policy};
use crate::proc::{
    crash_hint, detach_process_group, explain_spawn_error, idle_timeout, kill_tree,
    kill_tree_by_pid, os_error_in, stop_hint, take_utf8, StopReason, COMPILE_TIMEOUT_SECS,
    MAX_RUNTIME_SECS,
};
use crate::runners::{runner_for_path, CommandSpec, RunContext, RunnerError};

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("{0}")]
    Runner(#[from] RunnerError),
    #[error("no run is active with id {0}")]
    UnknownRun(String),
    #[error("{0}")]
    Io(String),
}

/// `{ kind, message }` with `message` the readable text. Derived serialization nested the
/// runner error as an object, so the UI showed raw JSON and lost texts such as
/// "`javac` is needed to run this file".
impl Serialize for RunError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            RunError::Runner(_) => "Runner",
            RunError::UnknownRun(_) => "UnknownRun",
            RunError::Io(_) => "Io",
        };
        let mut out = serializer.serialize_struct("RunError", 2)?;
        out.serialize_field("kind", kind)?;
        out.serialize_field("message", &self.to_string())?;
        out.end()
    }
}

/// Output is batched on this cadence. A tight `while(1) printf(...)` loop would
/// otherwise emit thousands of IPC messages a second and stall the UI.
const FLUSH_INTERVAL: Duration = Duration::from_millis(30);
const FLUSH_BYTES: usize = 8192;

/// Locale for compilers: untranslated messages (the diagnostics parser reads them), and UTF-8
/// on Unix so non-ASCII file names in the folder do not break them. Plain "C" made javac
/// fail on any such name ("Malformed input or input contains unmappable characters").
#[cfg(unix)]
const COMPILER_LOCALE: &str = "C.UTF-8";
#[cfg(not(unix))]
const COMPILER_LOCALE: &str = "C";

/// How long to wait for output pumps to drain once the program has exited.
const DRAIN_GRACE: Duration = Duration::from_millis(250);

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
        child: Arc<Mutex<PtyChild>>,
        pid: u32,
        guard: Option<Arc<Guard>>,
    },
}

type PtyChild = Box<dyn portable_pty::Child + Send + Sync>;

/// Ends a PTY run: its Job (Windows), the program, and its process group/tree.
fn kill_pty_run(child: &Mutex<PtyChild>, pid: u32, guard: Option<&Guard>) {
    if let Some(guard) = guard {
        guard.terminate();
    }
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
    }
    if pid > 0 {
        kill_tree_by_pid(pid);
    }
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
    /// Program terminal of the execution phase; `None` while compiling.
    pty_master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
}

#[derive(Default)]
pub struct RunRegistry {
    runs: Mutex<HashMap<String, ActiveRun>>,
    /// Bumped by `shutdown_all` (app exit, folder switch). A run started before it may not
    /// register its process afterwards.
    generation: AtomicU64,
}

impl RunRegistry {
    /// Current generation, taken when a run starts.
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Registers a run started in `generation`. False if `shutdown_all` ran since: the
    /// caller must end the process itself, as nothing else will.
    #[must_use]
    fn insert(&self, id: String, run: ActiveRun, generation: u64) -> bool {
        let mut runs = self.runs.lock().expect("run registry");
        if self.generation.load(Ordering::SeqCst) != generation {
            return false;
        }
        runs.insert(id, run);
        true
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
            ActiveChild::Pty { child, pid, guard } => {
                if let ActiveStdin::Pty(writer) = stdin {
                    if let Ok(mut guard) = writer.lock() {
                        if let Some(w) = guard.as_mut() {
                            let _ = w.write_all(b"\x03");
                            let _ = w.flush();
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
                kill_pty_run(&child, pid, guard.as_deref());
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

    /// Keeps the program's terminal as wide as the Run panel. Without it the
    /// PTY stays 80x24 and Windows ConPTY re-wraps output and moves the cursor
    /// to positions that do not exist in the panel.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), RunError> {
        let master = {
            let runs = self.runs.lock().expect("run registry");
            let run = runs
                .get(id)
                .ok_or_else(|| RunError::UnknownRun(id.to_string()))?;
            run.pty_master.clone()
        };
        let Some(master) = master else {
            return Ok(());
        };
        let size = PtySize {
            rows: rows.max(4),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        };
        let result = master.lock().expect("pty master").resize(size);
        result.map_err(|e| RunError::Io(e.to_string()))
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
            self.generation.fetch_add(1, Ordering::SeqCst);
            runs.drain().map(|(_, run)| run).collect()
        };
        for run in runs {
            match run.child {
                ActiveChild::Piped(child) => {
                    if let Ok(mut child) = child.lock() {
                        let _ = kill_tree(&mut child);
                    }
                }
                ActiveChild::Pty { child, pid, guard } => {
                    kill_pty_run(&child, pid, guard.as_deref());
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
    /// Why the run ended early, when the supervisor or the OS ended it.
    reason: Option<StopReason>,
    /// Time from spawn to exit, excluding compile and output drain.
    elapsed: Duration,
}

fn status_event(run_id: &str) -> String {
    format!("run-status-{run_id}")
}

fn output_event(run_id: &str) -> String {
    format!("run-output-{run_id}")
}

pub fn validate_run_id(run_id: Option<String>) -> Result<String, RunError> {
    match run_id {
        Some(id) if !id.trim().is_empty() => {
            let trimmed = id.trim();
            if trimmed.len() > 64
                || !trimmed
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(RunError::Io(
                    "invalid run_id: must only contain alphanumeric characters, hyphens, or underscores"
                        .into(),
                ));
            }
            Ok(trimmed.to_string())
        }
        _ => Ok(uuid::Uuid::new_v4().to_string()),
    }
}

/// Compiles (if needed) and runs `path`, streaming output back over Tauri events.
///
/// Returns immediately with the run id; progress arrives on `run-status-{id}`
/// and `run-output-{id}`.
#[tauri::command]
pub fn run_file(
    app: AppHandle,
    workspace: State<'_, WorkspaceState>,
    path: String,
    run_id: Option<String>,
    timeout_secs: Option<u64>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, RunError> {
    // Same scope rule as the fs commands: only workspace files (or a file the
    // user picked) may be compiled and run. The canonical form is only checked;
    // compilers get the path as the UI sent it.
    resolve_in_workspace(&workspace, &path).map_err(|e| RunError::Io(e.to_string()))?;
    let source = std::path::PathBuf::from(&path);
    let runner = runner_for_path(&source)?;

    let workdir = source
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let run_id = validate_run_id(run_id)?;
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
    // Idle timeout: restarted by every line of input. MAX_RUNTIME_SECS caps the total.
    let idle = idle_timeout(timeout_secs);
    let policy = Policy::for_run(&ctx.workdir, &scratch);
    let size = PtySize {
        rows: rows.unwrap_or(24).max(4),
        cols: cols.unwrap_or(80).max(20),
        pixel_width: 0,
        pixel_height: 0,
    };

    let app_bg = app.clone();
    let id_bg = run_id.clone();

    // Folder switch or exit after this point cancels the run (see RunRegistry::insert).
    let generation = app.state::<RunRegistry>().generation();
    std::thread::spawn(move || {
        let started = Instant::now();
        let budget = Arc::new(OutputBudget::default());
        let stopped_by_user = Arc::new(AtomicBool::new(false));
        let status = status_event(&id_bg);

        let finish = |status: RunStatus| {
            app_bg.state::<RunRegistry>().remove(&id_bg);
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
                Duration::from_secs(COMPILE_TIMEOUT_SECS),
                &budget,
                &stopped_by_user,
                generation,
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
                        "The compiler did not finish within {COMPILE_TIMEOUT_SECS} seconds and was stopped."
                    ),
                });
            }

            if outcome.exit_code != Some(0) {
                return finish(RunStatus::CompileFailed {
                    exit_code: outcome.exit_code,
                });
            }

            // The compiler stays registered until the program replaces it, so a
            // stop pressed in between lands here instead of on an unknown run.
            if stopped_by_user.load(Ordering::SeqCst) {
                return finish(RunStatus::Finished {
                    exit_code: None,
                    timed_out: false,
                    stopped_by_user: true,
                    duration_ms: 0,
                    hint: None,
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
            size,
            &policy,
            idle,
            &budget,
            &stopped_by_user,
            generation,
            announce,
        );

        match outcome {
            Err(message) => finish(RunStatus::Failed { message }),
            Ok(outcome) => {
                let stopped = stopped_by_user.load(Ordering::SeqCst);
                let hint = if let Some(reason) = outcome.reason {
                    Some(stop_hint(reason, idle))
                } else if stopped {
                    None
                } else {
                    outcome.exit_code.and_then(crash_hint).map(str::to_string)
                };

                finish(RunStatus::Finished {
                    exit_code: outcome.exit_code,
                    timed_out: outcome.timed_out,
                    stopped_by_user: stopped,
                    duration_ms: outcome.elapsed.as_millis() as u64,
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
///
/// The program runs under the OS sandbox (`proc::sandbox`) when this machine
/// supports it; if the sandbox cannot be set up, the run continues under
/// supervision only and the student is told so in the output.
///
/// Stops the program when `idle` passes without input, or after
/// [`MAX_RUNTIME_SECS`] regardless of input.
#[allow(clippy::too_many_arguments)]
fn supervise_pty(
    app: &AppHandle,
    run_id: &str,
    spec: CommandSpec,
    size: PtySize,
    policy: &Policy,
    idle: Duration,
    budget: &Arc<OutputBudget>,
    stopped_by_user: &Arc<AtomicBool>,
    generation: u64,
    on_spawn: impl FnOnce(u32),
) -> Result<Outcome, String> {
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("could not open pseudo-terminal: {e}"))?;
    // Taken before the program starts: failing after it would leave it running unwatched.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("could not read from pty: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("could not take pty writer: {e}"))?;

    let command = |program: &str, args: &[String]| {
        let mut builder = CommandBuilder::new(program);
        builder.args(args);
        builder.cwd(&spec.cwd);
        builder.env("TERM", "xterm-256color");
        builder.env("PATH", crate::proc::augmented_path());
        // Programs print UTF-8 for the terminal even where no UTF-8 locale is set.
        if let Some(lang) = crate::proc::utf8_locale_override() {
            builder.env("LANG", lang);
            builder.env("LC_ALL", lang);
        }
        builder
    };

    let mut notices = Vec::new();
    let launcher =
        sandbox::launcher_command(policy, &spec.program, &spec.args).unwrap_or_else(|reason| {
            notices.push(format!(
                "Sandbox unavailable ({reason}); running with supervision only."
            ));
            None
        });
    let spawned = match launcher {
        Some((exe, args)) => pair.slave.spawn_command(command(&exe, &args)).or_else(|e| {
            notices.push(format!(
                "Sandbox launcher could not start ({e}); running with supervision only."
            ));
            pair.slave.spawn_command(command(&spec.program, &spec.args))
        }),
        None => pair.slave.spawn_command(command(&spec.program, &spec.args)),
    };
    let mut child = spawned.map_err(|e| {
        let text = e.to_string();
        match os_error_in(&text) {
            Some(err) => explain_spawn_error(&spec.program, &err),
            None => format!("Could not start `{}`: {text}", spec.program),
        }
    })?;

    let pid = child.process_id().unwrap_or(0);
    let guard = match Guard::attach(policy, pid) {
        Ok(guard) => Some(Arc::new(guard)),
        // A program that already finished cannot join a job; nothing to warn about.
        Err(_) if matches!(child.try_wait(), Ok(Some(_))) => None,
        Err(reason) => {
            notices.push(format!(
                "Resource limits unavailable ({reason}); running with supervision only."
            ));
            None
        }
    };
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

    let registered = app.state::<RunRegistry>().insert(
        run_id.to_string(),
        ActiveRun {
            child: ActiveChild::Pty {
                child: Arc::clone(&child),
                pid,
                guard: guard.clone(),
            },
            stdin: ActiveStdin::Pty(Arc::clone(&writer)),
            stopped_by_user: Arc::clone(stopped_by_user),
            last_input: Arc::clone(&last_input),
            pty_master: Some(Arc::new(Mutex::new(pair.master))),
        },
        generation,
    );
    if !registered {
        kill_pty_run(&child, pid, guard.as_deref());
        return Err("The run was cancelled: the folder was closed.".into());
    }
    // Announced only once registered, so input typed after "Running" appears
    // reaches this program and not the compiler entry it replaces.
    on_spawn(pid);
    for notice in notices {
        emit_chunk(app, run_id, "stderr", format!("[CodeUI] {notice}\r\n"));
    }

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
    let max_runtime = Duration::from_secs(MAX_RUNTIME_SECS);
    let mut reason = None;
    // Output counts as activity too: only a program that neither prints nor
    // gets input for `idle` is treated as stuck.
    let mut output_seen = budget.used.load(Ordering::Relaxed);
    let mut last_output = started;

    let poll = || -> Result<Option<i32>, String> {
        let mut guard = child.lock().map_err(|e| e.to_string())?;
        match guard.try_wait() {
            Ok(status) => Ok(status.map(|s| pty_exit_code(&s))),
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
            break Some(code);
        }

        if stopped_by_user.load(Ordering::SeqCst) {
            kill_pty_run(&child, pid, guard.as_deref());
            break Some(137);
        }

        let now = Instant::now();
        let output_now = budget.used.load(Ordering::Relaxed);
        if output_now != output_seen {
            output_seen = output_now;
            last_output = now;
        }
        let last_activity = (*last_input.lock().unwrap()).max(last_output);
        let early = if now.duration_since(last_activity) >= idle {
            Some(StopReason::IdleTimeout)
        } else if now.duration_since(started) >= max_runtime {
            Some(StopReason::MaxRuntime)
        } else {
            None
        };
        if early.is_some() {
            reason = early;
            kill_pty_run(&child, pid, guard.as_deref());
            break Some(124);
        }

        std::thread::sleep(Duration::from_millis(15));
    };
    let elapsed = started.elapsed();

    // Close the terminal before draining: the reader only sees EOF once both
    // ends are gone (on Windows, ConPTY), so draining with them open always
    // waits out DRAIN_GRACE and late output lands after the exit line.
    app.state::<RunRegistry>().remove(run_id);
    #[cfg(windows)]
    drop(_slave_holder);
    let _ = done_rx.recv_timeout(DRAIN_GRACE);

    // An OS limit (Windows Job) explains a crash better than its exit code.
    if reason.is_none() && !stopped_by_user.load(Ordering::SeqCst) {
        reason = guard.as_ref().and_then(|g| g.limit_hit());
    }

    Ok(Outcome {
        exit_code,
        timed_out: matches!(
            reason,
            Some(StopReason::IdleTimeout | StopReason::MaxRuntime)
        ),
        reason,
        elapsed,
    })
}

/// Exit code of a PTY child, with signals reported shell-style (128 + n).
///
/// portable_pty reports a signalled child as code 1 plus the signal's name,
/// which would hide every segfault from `crash_hint`.
fn pty_exit_code(status: &portable_pty::ExitStatus) -> i32 {
    if status.success() {
        return 0;
    }
    #[cfg(unix)]
    if let Some(sig) = status
        .to_string()
        .strip_prefix("Terminated by ")
        .and_then(crate::proc::signal_from_name)
    {
        return 128 + sig;
    }
    status.exit_code() as i32
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
    generation: u64,
    interactive: bool,
    on_spawn: impl FnOnce(u32),
) -> Result<Outcome, String> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        .env("PATH", crate::proc::augmented_path())
        .env("LC_ALL", COMPILER_LOCALE)
        .env("LANG", COMPILER_LOCALE)
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
        .map_err(|e| explain_spawn_error(&spec.program, &e))?;

    // The clock starts here, not when the request arrived: a slow compile must
    // not eat into the student's execution budget.
    let started = Instant::now();
    let deadline = started + timeout;

    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let child = Arc::new(Mutex::new(child));
    let registered = app.state::<RunRegistry>().insert(
        run_id.to_string(),
        ActiveRun {
            child: ActiveChild::Piped(Arc::clone(&child)),
            stdin: ActiveStdin::Piped(Arc::new(Mutex::new(stdin))),
            stopped_by_user: Arc::clone(stopped_by_user),
            last_input: Arc::new(Mutex::new(Instant::now())),
            pty_master: None,
        },
        generation,
    );
    if !registered {
        let _ = kill_tree(&mut child.lock().expect("child"));
        return Err("The run was cancelled: the folder was closed.".into());
    }

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
    let elapsed = started.elapsed();

    // Let the pumps flush what is left. This must stay bounded: a grandchild
    // that escaped the process group can hold the pipes open indefinitely, and
    // waiting on it would mean the run never reports finished.
    for _ in 0..pump_count {
        if done_rx.recv_timeout(DRAIN_GRACE).is_err() {
            break;
        }
    }

    // Still registered: the caller's `finish` unregisters it, or the program
    // run replaces the entry (see `run_file`).
    Ok(Outcome {
        exit_code,
        timed_out,
        reason: None,
        elapsed,
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

/// Resizes the running program's terminal to match the Run panel.
#[tauri::command]
pub fn resize_run(
    registry: State<'_, RunRegistry>,
    run_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), RunError> {
    registry.resize(&run_id, cols, rows)
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

    fn piped_run(child: Child) -> ActiveRun {
        ActiveRun {
            child: ActiveChild::Piped(Arc::new(Mutex::new(child))),
            stdin: ActiveStdin::Piped(Arc::new(Mutex::new(None))),
            stopped_by_user: Arc::new(AtomicBool::new(false)),
            last_input: Arc::new(Mutex::new(Instant::now())),
            pty_master: None,
        }
    }

    fn quick_child() -> Child {
        #[cfg(windows)]
        let mut cmd = Command::new("cmd");
        #[cfg(windows)]
        cmd.args(["/C", "exit"]);
        #[cfg(not(windows))]
        let cmd = &mut Command::new("true");
        cmd.spawn().expect("spawn")
    }

    #[test]
    fn run_started_before_shutdown_cannot_register() {
        // A program starting while the folder switches or the window closes must not slip
        // past shutdown_all.
        let registry = RunRegistry::default();
        let before = registry.generation();
        assert!(registry.insert("a".into(), piped_run(quick_child()), before));
        registry.shutdown_all();
        // Started before the shutdown (folder switch / exit): refused.
        assert!(!registry.insert("b".into(), piped_run(quick_child()), before));
        assert!(registry.runs.lock().unwrap().is_empty());
        // A run started afterwards works as usual.
        let after = registry.generation();
        assert!(registry.insert("c".into(), piped_run(quick_child()), after));
    }

    #[test]
    fn run_errors_reach_the_ui_as_readable_text() {
        let v = serde_json::to_value(RunError::Runner(RunnerError::ToolMissing("javac".into())))
            .unwrap();
        assert_eq!(v["kind"], "Runner");
        let msg = v["message"].as_str().expect("message is text");
        assert!(msg.contains("`javac` is needed"), "{msg}");
        let v = serde_json::to_value(RunError::from(RunnerError::UnsupportedLanguage)).unwrap();
        assert!(v["message"]
            .as_str()
            .unwrap()
            .contains("cannot run this file type"));
    }

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

    #[test]
    fn validate_run_id_rejects_path_traversal() {
        assert!(validate_run_id(Some("../../evil".into())).is_err());
        assert!(validate_run_id(Some("../etc/passwd".into())).is_err());
        assert!(validate_run_id(Some("foo/bar".into())).is_err());
        assert!(validate_run_id(Some("foo\\bar".into())).is_err());
        assert!(validate_run_id(Some("foo bar".into())).is_err());
        assert!(validate_run_id(Some("a".repeat(65))).is_err());
        assert!(validate_run_id(Some("valid-id_123".into())).is_ok());
        assert!(validate_run_id(None).is_ok());
        assert!(validate_run_id(Some("".into())).is_ok());
    }
}
