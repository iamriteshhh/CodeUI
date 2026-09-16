use super::runner_trait::{require_tool, CommandSpec, LanguageRunner, RunContext, RunnerError};

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
        require_tool("python3")?;
        Ok(CommandSpec::new(
            "python3",
            // -u is mandatory: without it stdout is block-buffered when piped and
            // the student sees nothing until the program exits.
            vec!["-u".into(), ctx.source_str()],
            ctx.workdir.clone(),
        ))
    }
}
