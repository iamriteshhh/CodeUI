//! Table-driven runners for every language without a dedicated runner: one entry per
//! file extension, using whatever tool is installed. Placeholders in arguments:
//! `{src}` the source file, `{out}` the program built in the scratch folder,
//! `{jar}` a jar in the scratch folder.

use super::runner_trait::{CommandSpec, LanguageRunner, RunContext, RunnerError};

/// One way to run a language: the first tool found on PATH wins.
struct Tool {
    program: &'static str,
    args: &'static [&'static str],
}

struct Lang {
    exts: &'static [&'static str],
    name: &'static str,
    /// Build step (compiled languages); `None` for interpreted ones.
    compile: &'static [Tool],
    run: &'static [Tool],
}

/// Folders under $HOME a tool must be able to create files in (see
/// `sandbox::tool_cache_dirs`). Created before the run so the sandbox can allow them.
fn home_dirs(lang: &str) -> &'static [&'static str] {
    match lang {
        "C#" | "F#" | "PowerShell" => &[
            ".dotnet",
            ".nuget",
            ".cache",
            ".local/share",
            ".config/powershell",
        ],
        "Dart" => &[".dart-tool", ".dartServer", ".pub-cache"],
        "Zig" | "Nim" | "Go" | "Swift" | "Kotlin" => &[".cache"],
        "Scala" => &[".scalac", ".cache"],
        "Haskell" => &[".ghc", ".cache"],
        _ => &[],
    }
}

const fn t(program: &'static str, args: &'static [&'static str]) -> Tool {
    Tool { program, args }
}

/// The program `{out}` itself, for compiled languages.
const OUT: &[Tool] = &[t("{out}", &[])];

static LANGS: &[Lang] = &[
    Lang {
        exts: &["js", "mjs", "cjs"],
        name: "JavaScript",
        compile: &[],
        run: &[
            t("node", &["{src}"]),
            t("bun", &["{src}"]),
            t("deno", &["run", "-A", "{src}"]),
        ],
    },
    Lang {
        exts: &["ts", "mts", "cts"],
        name: "TypeScript",
        compile: &[],
        run: &[
            t("tsx", &["{src}"]),
            t("bun", &["{src}"]),
            t("deno", &["run", "-A", "{src}"]),
            t("ts-node", &["{src}"]),
        ],
    },
    Lang {
        exts: &["rs"],
        name: "Rust",
        compile: &[t(
            "rustc",
            &["--edition", "2021", "-g", "-o", "{out}", "{src}"],
        )],
        run: OUT,
    },
    Lang {
        exts: &["go"],
        name: "Go",
        compile: &[t("go", &["build", "-o", "{out}", "{src}"])],
        run: OUT,
    },
    Lang {
        exts: &["kt"],
        name: "Kotlin",
        compile: &[t("kotlinc", &["{src}", "-include-runtime", "-d", "{jar}"])],
        run: &[t("java", &["-jar", "{jar}"])],
    },
    Lang {
        exts: &["cs"],
        name: "C#",
        // The build (outside the sandbox) restores packages over the network; the run
        // itself is offline, as every student program is.
        compile: &[t("dotnet", &["build", "{src}"])],
        run: &[t("dotnet", &["run", "--no-build", "{src}"])],
    },
    Lang {
        exts: &["fsx"],
        name: "F#",
        compile: &[],
        run: &[t("dotnet", &["fsi", "--quiet", "{src}"])],
    },
    Lang {
        exts: &["swift"],
        name: "Swift",
        compile: &[t("swiftc", &["-o", "{out}", "{src}"])],
        run: OUT,
    },
    Lang {
        exts: &["dart"],
        name: "Dart",
        compile: &[],
        // `dart file.dart` runs the file directly; `dart run` waits on pub.
        run: &[t("dart", &["{src}"])],
    },
    Lang {
        exts: &["rb"],
        name: "Ruby",
        compile: &[],
        run: &[t("ruby", &["{src}"])],
    },
    Lang {
        exts: &["php"],
        name: "PHP",
        compile: &[],
        run: &[t("php", &["{src}"])],
    },
    Lang {
        exts: &["pl"],
        name: "Perl",
        compile: &[],
        run: &[t("perl", &["{src}"])],
    },
    Lang {
        exts: &["lua"],
        name: "Lua",
        compile: &[],
        run: &[t("lua", &["{src}"]), t("luajit", &["{src}"])],
    },
    Lang {
        exts: &["r"],
        name: "R",
        compile: &[],
        run: &[t("Rscript", &["{src}"])],
    },
    Lang {
        exts: &["jl"],
        name: "Julia",
        compile: &[],
        run: &[t("julia", &["{src}"])],
    },
    Lang {
        exts: &["hs"],
        name: "Haskell",
        compile: &[],
        run: &[t("runghc", &["{src}"]), t("runhaskell", &["{src}"])],
    },
    Lang {
        exts: &["ml"],
        name: "OCaml",
        compile: &[],
        run: &[t("ocaml", &["{src}"])],
    },
    Lang {
        exts: &["ex", "exs"],
        name: "Elixir",
        compile: &[],
        run: &[t("elixir", &["{src}"])],
    },
    Lang {
        exts: &["erl"],
        name: "Erlang",
        compile: &[],
        run: &[t("escript", &["{src}"])],
    },
    Lang {
        exts: &["clj"],
        name: "Clojure",
        compile: &[],
        run: &[t("clojure", &["{src}"]), t("clj", &["{src}"])],
    },
    Lang {
        exts: &["scala", "sc"],
        name: "Scala",
        compile: &[],
        run: &[
            t("scala-cli", &["run", "{src}"]),
            t("scala", &["-nc", "{src}"]),
        ],
    },
    Lang {
        exts: &["groovy"],
        name: "Groovy",
        compile: &[],
        run: &[t("groovy", &["{src}"])],
    },
    Lang {
        exts: &["zig"],
        name: "Zig",
        compile: &[],
        run: &[t("zig", &["run", "{src}"])],
    },
    Lang {
        exts: &["nim"],
        name: "Nim",
        compile: &[],
        run: &[t("nim", &["r", "--hints:off", "{src}"])],
    },
    Lang {
        exts: &["d"],
        name: "D",
        compile: &[],
        run: &[t("rdmd", &["{src}"])],
    },
    Lang {
        exts: &["f90", "f95", "f03", "f"],
        name: "Fortran",
        compile: &[t("gfortran", &["-g", "-o", "{out}", "{src}"])],
        run: OUT,
    },
    Lang {
        exts: &["pas", "pp"],
        name: "Pascal",
        compile: &[t("fpc", &["-o{out}", "{src}"])],
        run: OUT,
    },
    Lang {
        exts: &["sh", "bash"],
        name: "Shell",
        compile: &[],
        run: &[t("bash", &["{src}"]), t("sh", &["{src}"])],
    },
    Lang {
        exts: &["ps1"],
        name: "PowerShell",
        compile: &[],
        run: &[
            t("pwsh", &["-NoLogo", "-NoProfile", "-File", "{src}"]),
            t(
                "powershell",
                &[
                    "-NoLogo",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    "{src}",
                ],
            ),
        ],
    },
    Lang {
        exts: &["bat", "cmd"],
        name: "Batch",
        compile: &[],
        run: &[t("cmd", &["/C", "{src}"])],
    },
];

/// Runner for `ext` (lower case), if the table knows the language.
pub fn runner_for_ext(ext: &str) -> Option<GenericRunner> {
    LANGS
        .iter()
        .find(|l| l.exts.contains(&ext))
        .map(|lang| GenericRunner { lang })
}

pub struct GenericRunner {
    lang: &'static Lang,
}

impl GenericRunner {
    /// First installed tool of `tools`, with placeholders filled in.
    fn pick(&self, tools: &[Tool], ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        if let Some(home) = std::env::var_os("HOME") {
            for dir in home_dirs(self.lang.name) {
                let _ = std::fs::create_dir_all(std::path::Path::new(&home).join(dir));
            }
        }
        let out = ctx
            .scratch
            .join(format!("{}{}", ctx.stem(), std::env::consts::EXE_SUFFIX))
            .to_string_lossy()
            .into_owned();
        let jar = ctx
            .scratch
            .join(format!("{}.jar", ctx.stem()))
            .to_string_lossy()
            .into_owned();
        let fill = |s: &str| {
            s.replace("{src}", &ctx.source_str())
                .replace("{out}", &out)
                .replace("{jar}", &jar)
        };
        for tool in tools {
            let program = if tool.program == "{out}" {
                Some(out.clone())
            } else {
                crate::proc::resolve_tool(&[tool.program]).map(|p| p.to_string_lossy().into_owned())
            };
            if let Some(program) = program {
                let args = tool.args.iter().map(|a| fill(a)).collect();
                return Ok(CommandSpec::new(program, args, ctx.workdir.clone()));
            }
        }
        Err(RunnerError::ToolMissing(
            tools.first().map_or("tool", |t| t.program).to_string(),
        ))
    }
}

impl LanguageRunner for GenericRunner {
    fn id(&self) -> &'static str {
        self.lang.exts[0]
    }

    fn display_name(&self) -> &'static str {
        self.lang.name
    }

    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        if self.lang.compile.is_empty() {
            return Ok(None);
        }
        self.pick(self.lang.compile, ctx).map(Some)
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        self.pick(self.lang.run, ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn table_covers_common_languages_and_fills_placeholders() {
        for ext in [
            "js", "ts", "rs", "go", "kt", "cs", "rb", "php", "lua", "sh", "swift", "dart",
        ] {
            assert!(runner_for_ext(ext).is_some(), "{ext}");
        }
        assert!(runner_for_ext("txt").is_none());

        let ctx = RunContext {
            source: PathBuf::from("/w/main.rs"),
            scratch: PathBuf::from("/tmp/s"),
            workdir: PathBuf::from("/w"),
        };
        // The compiled program is run from the scratch folder, whatever is installed.
        let run = runner_for_ext("rs").unwrap().execute(&ctx).unwrap();
        assert!(run.program.contains("main"), "{}", run.program);
    }
}
