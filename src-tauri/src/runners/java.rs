use super::runner_trait::{require_tool, CommandSpec, LanguageRunner, RunContext, RunnerError};

pub struct JavaRunner;

impl LanguageRunner for JavaRunner {
    fn id(&self) -> &'static str {
        "java"
    }

    fn display_name(&self) -> &'static str {
        "Java"
    }

    fn compile(&self, ctx: &RunContext) -> Result<Option<CommandSpec>, RunnerError> {
        require_tool("javac")?;
        Ok(Some(CommandSpec::new(
            "javac",
            vec![
                "-d".into(),
                ctx.scratch.to_string_lossy().into_owned(),
                ctx.source_str(),
            ],
            ctx.workdir.clone(),
        )))
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        require_tool("java")?;
        let source = std::fs::read_to_string(&ctx.source)
            .map_err(|e| RunnerError::SourceUnreadable(e.to_string()))?;
        let detected = detect_main_class(&source).ok_or_else(|| {
            RunnerError::Invalid("could not find a class declaration in this file".into())
        })?;

        // javac rejects a public class whose file name differs, with a message
        // that sends students hunting through their code. Catch it up front,
        // before any compile runs, and say exactly what to rename.
        let stem = ctx.stem();
        if detected.is_public && detected.name != stem {
            return Err(RunnerError::Invalid(format!(
                "public class `{}` must live in a file named `{}.java`, but this file is `{}.java`. \
                 Rename the file to `{}.java`, or rename the class to `{}`.",
                detected.name, detected.name, stem, detected.name, stem
            )));
        }

        // javac writes a packaged class to <scratch>/com/example/Name.class, and
        // `java` only finds it by its fully qualified name.
        let entry_point = match detect_package(&source) {
            Some(package) => format!("{package}.{}", detected.name),
            None => detected.name,
        };

        Ok(CommandSpec::new(
            "java",
            vec![
                "-cp".into(),
                ctx.scratch.to_string_lossy().into_owned(),
                entry_point,
            ],
            ctx.workdir.clone(),
        ))
    }
}

/// Reads the `package a.b.c;` declaration, if the file has one.
pub fn detect_package(source: &str) -> Option<String> {
    let cleaned = strip_comments_and_literals(source);
    let mut tokens = cleaned.split_whitespace();

    while let Some(token) = tokens.next() {
        match token {
            "package" => {
                let name: String = tokens
                    .next()?
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$' || *c == '.')
                    .collect();
                return (!name.is_empty()).then_some(name);
            }
            // The declaration must precede any type; stop once one begins.
            "class" | "interface" | "enum" | "record" => return None,
            _ => {}
        }
    }
    None
}

/// A class declaration found in the source.
#[derive(Debug, PartialEq, Eq)]
pub struct DetectedClass {
    pub name: String,
    /// Public classes are the ones javac ties to the file name.
    pub is_public: bool,
}

/// Finds the class to hand to `java`, preferring the `public` one.
///
/// Java requires the public class to match the filename, but students rename
/// files constantly, so the declaration in the source is the source of truth.
pub fn detect_main_class(source: &str) -> Option<DetectedClass> {
    let cleaned = strip_comments_and_literals(source);
    let tokens: Vec<&str> = cleaned.split_whitespace().collect();

    let mut first_class: Option<DetectedClass> = None;

    for (i, token) in tokens.iter().enumerate() {
        if *token != "class" {
            continue;
        }
        let Some(name) = tokens.get(i + 1).and_then(|t| sanitize_identifier(t)) else {
            continue;
        };
        if is_public_declaration(&tokens, i) {
            return Some(DetectedClass {
                name,
                is_public: true,
            });
        }
        if first_class.is_none() {
            first_class = Some(DetectedClass {
                name,
                is_public: false,
            });
        }
    }

    first_class
}

/// Walks backwards over modifiers to see whether this declaration is public.
fn is_public_declaration(tokens: &[&str], class_idx: usize) -> bool {
    const MODIFIERS: [&str; 5] = ["final", "abstract", "strictfp", "static", "sealed"];
    let mut i = class_idx;
    while i > 0 {
        i -= 1;
        match tokens[i] {
            "public" => return true,
            t if MODIFIERS.contains(&t) => continue,
            _ => return false,
        }
    }
    false
}

/// Keeps the leading identifier, dropping trailing `{`, `<T>`, `implements`, etc.
fn sanitize_identifier(token: &str) -> Option<String> {
    let name: String = token
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
        .collect();
    if name.is_empty() || name.chars().next()?.is_numeric() {
        None
    } else {
        Some(name)
    }
}

/// Blanks out comments and literals so a `class` inside them is never matched.
fn strip_comments_and_literals(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '/' if chars.peek() == Some(&'/') => {
                for n in chars.by_ref() {
                    if n == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut prev = '\0';
                for n in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
                out.push(' ');
            }
            '"' | '\'' => {
                let quote = c;
                let mut escaped = false;
                for n in chars.by_ref() {
                    if escaped {
                        escaped = false;
                    } else if n == '\\' {
                        escaped = true;
                    } else if n == quote {
                        break;
                    }
                }
                out.push(' ');
            }
            // Separate tokens so `class Foo{` splits cleanly.
            '{' | '}' | '(' | ')' | '<' | '>' | ';' | ',' => {
                out.push(' ');
                out.push(c);
                out.push(' ');
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name_of(src: &str) -> Option<String> {
        detect_main_class(src).map(|d| d.name)
    }

    #[test]
    fn finds_public_class() {
        let src = "public class Main { public static void main(String[] a) {} }";
        let found = detect_main_class(src).unwrap();
        assert_eq!(found.name, "Main");
        assert!(found.is_public);
    }

    #[test]
    fn prefers_public_over_earlier_package_private() {
        let src = "class Helper {}\npublic class Assignment3 {}";
        assert_eq!(name_of(src).as_deref(), Some("Assignment3"));
    }

    #[test]
    fn handles_modifiers_between_public_and_class() {
        let src = "public final class Widget {}";
        assert_eq!(name_of(src).as_deref(), Some("Widget"));
    }

    #[test]
    fn falls_back_to_package_private_class() {
        let found = detect_main_class("class OnlyOne { }").unwrap();
        assert_eq!(found.name, "OnlyOne");
        assert!(
            !found.is_public,
            "package-private may differ from the filename"
        );
    }

    #[test]
    fn ignores_class_inside_comment_or_string() {
        let src =
            "// public class Ghost\n/* class Phantom */\nString s = \"class Fake\";\nclass Real {}";
        assert_eq!(name_of(src).as_deref(), Some("Real"));
    }

    #[test]
    fn strips_generic_parameters() {
        let src = "public class Box<T> { }";
        assert_eq!(name_of(src).as_deref(), Some("Box"));
    }

    #[test]
    fn returns_none_without_a_class() {
        assert!(detect_main_class("int x = 5;").is_none());
    }

    /// The runner must explain a filename/class mismatch itself; javac's own
    /// wording sends students looking in the wrong place.
    #[test]
    fn public_class_mismatch_is_reported_with_both_names() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Scratch.java");
        std::fs::write(&source, "public class Greeter { }").unwrap();

        let ctx = RunContext {
            source,
            scratch: dir.path().join("build"),
            workdir: dir.path().to_path_buf(),
        };

        match JavaRunner.execute(&ctx) {
            Err(RunnerError::Invalid(msg)) => {
                assert!(msg.contains("Greeter"), "names the class: {msg}");
                assert!(msg.contains("Scratch"), "names the file: {msg}");
            }
            other => panic!("expected a mismatch error, got {other:?}"),
        }
    }

    #[test]
    fn reads_the_package_declaration() {
        let src = "package com.example.app;\npublic class Main { }";
        assert_eq!(detect_package(src).as_deref(), Some("com.example.app"));
    }

    #[test]
    fn no_package_declaration_means_default_package() {
        assert_eq!(detect_package("public class Main { }"), None);
        // `package` inside a comment is not a declaration.
        assert_eq!(detect_package("// package a.b;\nclass Main {}"), None);
    }

    #[test]
    fn packaged_class_runs_by_qualified_name() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Main.java");
        std::fs::write(&source, "package com.example;\npublic class Main { }").unwrap();

        let ctx = RunContext {
            source,
            scratch: dir.path().join("build"),
            workdir: dir.path().to_path_buf(),
        };

        if which::which("java").is_ok() {
            let spec = JavaRunner.execute(&ctx).expect("packaged class is valid");
            assert_eq!(spec.args.last().unwrap(), "com.example.Main");
        }
    }

    #[test]
    fn package_private_class_may_differ_from_filename() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Scratch.java");
        std::fs::write(&source, "class Helper { }").unwrap();

        let ctx = RunContext {
            source,
            scratch: dir.path().join("build"),
            workdir: dir.path().to_path_buf(),
        };

        // Only meaningful where a JDK exists; require_tool gates the rest.
        if which::which("java").is_ok() {
            let spec = JavaRunner.execute(&ctx).expect("package-private is legal");
            assert_eq!(spec.args.last().unwrap(), "Helper");
        }
    }
}
