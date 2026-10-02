use super::runner_trait::{require_tool, CommandSpec, LanguageRunner, RunContext, RunnerError};

pub struct CRunner;

impl LanguageRunner for CRunner {
    fn id(&self) -> &'static str {
        "c"
    }

    fn display_name(&self) -> &'static str {
        "C"
    }

    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        require_tool("gcc")?;
        let out = ctx.scratch.join(ctx.stem());
        Ok(Some(CommandSpec::new(
            "gcc",
            vec![
                "-Wall".into(),
                "-g".into(),
                "-o".into(),
                out.to_string_lossy().into_owned(),
                ctx.source_str(),
            ],
            ctx.workdir.clone(),
        )))
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        let bin = ctx.scratch.join(ctx.stem());
        Ok(CommandSpec::new(
            bin.to_string_lossy().into_owned(),
            vec![],
            ctx.workdir.clone(),
        ))
    }
}
