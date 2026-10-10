use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use super::runner_trait::{resolve_tool_cmd, CommandSpec, LanguageRunner, RunContext, RunnerError};

/// Newest C++ standard the compiler accepts, probed once per compiler.
///
/// A fixed `-std=c++17` rejected C++20 code (`std::span`, `std::views`, concepts) on
/// compilers that support it, while `-std=c++20` would break old ones such as MinGW
/// gcc 6, which stops at C++17. `None`: the compiler's own default.
fn newest_std(compiler: &str) -> Option<&'static str> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<&'static str>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(found) = cache.lock().expect("std cache").get(compiler) {
        return *found;
    }
    let found = ["-std=c++20", "-std=c++17"]
        .into_iter()
        .find(|flag| accepts(compiler, flag));
    cache
        .lock()
        .expect("std cache")
        .insert(compiler.to_string(), found);
    found
}

/// Whether `compiler` accepts `flag` (compiles an empty program with it).
fn accepts(compiler: &str, flag: &str) -> bool {
    let mut cmd = Command::new(compiler);
    cmd.args([flag, "-fsyntax-only", "-x", "c++", "-"])
        .env("PATH", crate::proc::augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.status().is_ok_and(|s| s.success())
}

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
        let mut args = vec!["-Wall".into(), "-g".into()];
        if let Some(std) = newest_std(&compiler) {
            args.push(std.into());
        }
        args.extend([
            "-o".into(),
            out.to_string_lossy().into_owned(),
            ctx.source_str(),
        ]);
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
