use super::runner_trait::{resolve_tool_cmd, CommandSpec, LanguageRunner, RunContext, RunnerError};

pub struct PythonRunner;

impl LanguageRunner for PythonRunner {
    fn id(&self) -> &'static str {
        "python"
    }

    fn display_name(&self) -> &'static str {
        "Python"
    }

    fn compile(&self, _ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        Ok(None)
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        #[cfg(windows)]
        let candidates = ["python", "py", "python3"];
        #[cfg(not(windows))]
        let candidates = ["python3", "python"];

        let resolved = resolve_tool_cmd(&candidates)?;
        let mut args = vec!["-u".into()];
        if resolved.ends_with("py.exe") || resolved.ends_with("py") {
            args.insert(0, "-3".into());
        }
        args.push(ctx.source_str());

        Ok(CommandSpec::new(
            resolved,
            args,
            ctx.workdir.clone(),
        ))
    }
}
