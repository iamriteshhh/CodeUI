use super::runner_trait::{resolve_tool_cmd, CommandSpec, LanguageRunner, RunContext, RunnerError};

pub struct CppRunner;

impl LanguageRunner for CppRunner {
    fn id(&self) -> &'static str {
        "cpp"
    }

    fn display_name(&self) -> &'static str {
        "C++"
    }

    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        let compiler = resolve_tool_cmd(&["g++", "clang++"])?;
        let out = ctx
            .scratch
            .join(format!("{}{}", ctx.stem(), std::env::consts::EXE_SUFFIX));
        Ok(Some(CommandSpec::new(
            compiler,
            vec![
                "-Wall".into(),
                "-g".into(),
                "-std=c++17".into(),
                "-o".into(),
                out.to_string_lossy().into_owned(),
                ctx.source_str(),
            ],
            ctx.workdir.clone(),
        )))
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        let bin = ctx
            .scratch
            .join(format!("{}{}", ctx.stem(), std::env::consts::EXE_SUFFIX));
        Ok(CommandSpec::new(
            bin.to_string_lossy().into_owned(),
            vec![],
            ctx.workdir.clone(),
        ))
    }
}
