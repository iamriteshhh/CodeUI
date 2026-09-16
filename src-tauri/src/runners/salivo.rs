use super::runner_trait::{require_tool, CommandSpec, LanguageRunner, RunContext, RunnerError};

pub struct SalivoRunner;

impl LanguageRunner for SalivoRunner {
    fn id(&self) -> &'static str {
        "salivo"
    }

    fn display_name(&self) -> &'static str {
        "Salivo"
    }

    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        require_tool("sf")?;
        // `sf build` has no output flag: it writes to <cwd>/build/. Running it
        // from the scratch directory is therefore the only way to keep the
        // artifacts out of the student's project folder.
        Ok(Some(CommandSpec::new(
            "sf",
            vec!["build".into(), ctx.source_str()],
            ctx.scratch.clone(),
        )))
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        let binary = ctx.scratch.join("build").join(format!(
            "{}{}",
            ctx.stem(),
            std::env::consts::EXE_SUFFIX
        ));

        Ok(CommandSpec::new(
            binary.to_string_lossy().into_owned(),
            vec![],
            // The program itself runs in the project folder, so relative paths
            // in the student's code resolve against their own files.
            ctx.workdir.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn ctx() -> RunContext {
        RunContext {
            source: PathBuf::from("/home/student/work/game.sal"),
            scratch: PathBuf::from("/tmp/codeui-1"),
            workdir: PathBuf::from("/home/student/work"),
        }
    }

    #[test]
    fn builds_from_scratch_so_the_project_stays_clean() {
        let Ok(Some(spec)) = SalivoRunner.compile(&ctx()) else {
            eprintln!("skipping: sf not installed");
            return;
        };
        assert_eq!(spec.args[0], "build");
        assert_eq!(
            spec.cwd,
            PathBuf::from("/tmp/codeui-1"),
            "building in the project folder would litter it with build/"
        );
    }

    #[test]
    fn runs_the_binary_sf_emitted() {
        let spec = SalivoRunner.execute(&ctx()).unwrap();
        assert!(
            spec.program
                .ends_with(&format!("game{}", std::env::consts::EXE_SUFFIX)),
            "unexpected binary path: {}",
            spec.program
        );
        assert!(spec.program.contains("build"));
        assert_eq!(spec.cwd, PathBuf::from("/home/student/work"));
    }
}
