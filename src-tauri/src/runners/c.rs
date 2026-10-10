use super::runner_trait::{resolve_tool_cmd, CommandSpec, LanguageRunner, RunContext, RunnerError};

pub struct CRunner;

impl LanguageRunner for CRunner {
    fn id(&self) -> &'static str {
        "c"
    }

    fn display_name(&self) -> &'static str {
        "C"
    }

    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        let compiler = resolve_tool_cmd(&["gcc", "clang"])?;
        let out = ctx
            .scratch
            .join(format!("{}{}", ctx.stem(), std::env::consts::EXE_SUFFIX));
        #[allow(unused_mut)]
        let mut args = vec![
            "-Wall".into(),
            "-g".into(),
            "-o".into(),
            out.to_string_lossy().into_owned(),
            ctx.source_str(),
        ];
        // glibc keeps sqrt/pow/... in libm, which gcc does not link by default: without this
        // every program using <math.h> fails with "undefined reference to `sqrt'" on Linux.
        // After the source, as the linker resolves left to right. (MinGW links it implicitly,
        // and clang with the MSVC linker on Windows would reject -lm.)
        #[cfg(not(windows))]
        args.push("-lm".into());
        Ok(Some(CommandSpec::new(compiler, args, ctx.workdir.clone())))
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
