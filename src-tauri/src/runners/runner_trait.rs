//! The contract every language runner implements.

use std::path::PathBuf;

use serde::Serialize;

/// Everything a runner needs to know about one execution request.
#[derive(Debug, Clone)]
pub struct RunContext {
    /// Absolute path of the file the student pressed Run on.
    pub source: PathBuf,
    /// Private directory for build artifacts; deleted after the run.
    pub scratch: PathBuf,
    /// Working directory for the student's program.
    pub workdir: PathBuf,
}

impl RunContext {
    pub fn stem(&self) -> String {
        self.source
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "program".to_string())
    }

    pub fn source_str(&self) -> String {
        self.source.to_string_lossy().into_owned()
    }
}

/// A concrete command to execute. Never a shell string.
#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

impl CommandSpec {
    pub fn new(program: impl Into<String>, args: Vec<String>, cwd: PathBuf) -> Self {
        Self {
            program: program.into(),
            args,
            cwd,
        }
    }
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum RunnerError {
    #[error("no runner is registered for this file type")]
    UnsupportedLanguage,
    #[error("required tool `{0}` was not found on PATH")]
    ToolMissing(String),
    #[error("could not read the source file: {0}")]
    SourceUnreadable(String),
    #[error("{0}")]
    Invalid(String),
}

pub trait LanguageRunner: Send + Sync {
    /// Stable identifier reported to the frontend, e.g. `"cpp"`.
    fn id(&self) -> &'static str;

    /// Human-readable label for status messages.
    fn display_name(&self) -> &'static str;

    /// Build step, or `None` for interpreted languages.
    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError>;

    /// The command that runs the student's program.
    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError>;
}

/// Resolves a tool on PATH without invoking it.
///
/// Running `--version` would misreport a broken-but-present toolchain as absent.
pub fn require_tool(name: &str) -> Result<(), RunnerError> {
    which::which(name)
        .map(|_| ())
        .map_err(|_| RunnerError::ToolMissing(name.to_string()))
}
