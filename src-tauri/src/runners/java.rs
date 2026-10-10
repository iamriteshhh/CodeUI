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
        let source = std::fs::read_to_string(&ctx.source)
            .map_err(|e| RunnerError::SourceUnreadable(e.to_string()))?;
        // javac compiles the other classes the program uses from here: the file's folder, or
        // for `package com.demo;` the folder that holds `com/`. Without it a class in the same
        // package is "cannot find symbol".
        let source_root = package_root(&ctx.source, detect_package(&source).as_deref());
        Ok(Some(CommandSpec::new(
            "javac",
            vec![
                // CodeUI saves UTF-8; JDK 17 and older would read the source in the Windows
                // code page and reject any non-ASCII string ("unmappable character").
                "-encoding".into(),
                "UTF-8".into(),
                "-d".into(),
                ctx.scratch.to_string_lossy().into_owned(),
                "-sourcepath".into(),
                source_root.to_string_lossy().into_owned(),
                ctx.source_str(),
            ],
            ctx.workdir.clone(),
        )))
    }

    fn execute(&self, ctx: &RunContext) -> Result<CommandSpec, RunnerError> {
        require_tool("java")?;
        let source = std::fs::read_to_string(&ctx.source)
            .map_err(|e| RunnerError::SourceUnreadable(e.to_string()))?;
        let scan = scan_top_level(&source);
        let stem = ctx.stem();

        // javac rejects a public class whose file name differs, with a message
        // that sends students hunting through their code. Catch it up front,
        // before any compile runs, and say exactly what to rename.
        if let Some(public) = scan.types.iter().find(|t| t.is_public) {
            if public.name != stem {
                let name = &public.name;
                return Err(RunnerError::Invalid(format!(
                    "public class `{name}` must live in a file named `{name}.java`, but this file is `{stem}.java`. \
                     Rename the file to `{name}.java`, or rename the class to `{stem}`."
                )));
            }
        }

        let entry = match pick_entry(&scan.types) {
            Some(found) => found.name.clone(),
            // A compact source file (Java 25+): `void main()` with no class
            // around it. javac names the implicit class after the file.
            None if scan.top_level_main => stem,
            None => {
                return Err(RunnerError::Invalid(
                    "No class found in this file. A Java program needs a class with a \
                     `public static void main(String[] args)` method."
                        .into(),
                ))
            }
        };

        // javac writes a packaged class to <scratch>/com/example/Name.class, and
        // `java` only finds it by its fully qualified name.
        let entry_point = match detect_package(&source) {
            Some(package) => format!("{package}.{entry}"),
            None => entry,
        };

        Ok(CommandSpec::new(
            "java",
            vec![
                // Keep the heap inside the sandbox memory limit, so a runaway
                // program gets an OutOfMemoryError instead of a JVM crash.
                format!(
                    "-Xmx{}m",
                    crate::proc::sandbox::MEMORY_LIMIT_BYTES / 2 / (1024 * 1024)
                ),
                "-cp".into(),
                ctx.scratch.to_string_lossy().into_owned(),
                entry_point,
            ],
            ctx.workdir.clone(),
        ))
    }
}

/// Reads the `package a.b.c;` declaration, if the file has one.
/// The folder javac should look for sources in: for `package a.b;` in `<root>/a/b/X.java`
/// that is `<root>`; otherwise (or if the folders do not match the package) the file's folder.
pub fn package_root(source: &std::path::Path, package: Option<&str>) -> std::path::PathBuf {
    let dir = source
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf();
    let Some(package) = package else { return dir };
    let mut root = dir.clone();
    for part in package.split('.').rev() {
        if root.file_name().and_then(|n| n.to_str()) != Some(part) {
            return dir;
        }
        root.pop();
    }
    root
}

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

/// A top-level type (class, interface, enum or record).
struct TopLevelType {
    name: String,
    is_public: bool,
    /// Declares `void main(` directly in its body.
    has_main: bool,
}

struct Scan {
    types: Vec<TopLevelType>,
    /// `void main(` outside any type: a Java 25 compact source file.
    top_level_main: bool,
}

/// Lists the top-level types, ignoring nested ones and anything inside
/// comments or string literals.
fn scan_top_level(source: &str) -> Scan {
    let cleaned = strip_comments_and_literals(source);
    let tokens: Vec<&str> = cleaned.split_whitespace().collect();
    let mut scan = Scan {
        types: Vec::new(),
        top_level_main: false,
    };
    let mut depth = 0usize;

    for (i, token) in tokens.iter().enumerate() {
        match *token {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "class" | "interface" | "enum" | "record" if depth == 0 => {
                if let Some(name) = tokens.get(i + 1).and_then(|t| sanitize_identifier(t)) {
                    scan.types.push(TopLevelType {
                        name,
                        is_public: is_public_declaration(&tokens, i),
                        has_main: false,
                    });
                }
            }
            "main" if i > 0 && tokens[i - 1] == "void" && tokens.get(i + 1) == Some(&"(") => {
                match (depth, scan.types.last_mut()) {
                    (1, Some(current)) => current.has_main = true,
                    (0, _) => scan.top_level_main = true,
                    _ => {}
                }
            }
            _ => {}
        }
    }
    scan
}

/// The type `java` should launch: one with a `main` method (public first),
/// else the public type, else the first.
fn pick_entry(types: &[TopLevelType]) -> Option<&TopLevelType> {
    types
        .iter()
        .find(|t| t.has_main && t.is_public)
        .or_else(|| types.iter().find(|t| t.has_main))
        .or_else(|| types.iter().find(|t| t.is_public))
        .or_else(|| types.first())
}

/// Finds the class to hand to `java`.
///
/// Java requires the public class to match the filename, but students rename
/// files constantly, so the declaration in the source is the source of truth.
pub fn detect_main_class(source: &str) -> Option<DetectedClass> {
    pick_entry(&scan_top_level(source).types).map(|t| DetectedClass {
        name: t.name.clone(),
        is_public: t.is_public,
    })
}

/// Walks backwards over modifiers and annotations to see whether this
/// declaration is public.
fn is_public_declaration(tokens: &[&str], class_idx: usize) -> bool {
    const MODIFIERS: [&str; 6] = [
        "final",
        "abstract",
        "strictfp",
        "static",
        "sealed",
        "non-sealed",
    ];
    let mut i = class_idx;
    while i > 0 {
        i -= 1;
        match tokens[i] {
            "public" => return true,
            t if MODIFIERS.contains(&t) || t.starts_with('@') => continue,
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

    #[test]
    fn package_root_is_the_folder_above_the_package_path() {
        use std::path::{Path, PathBuf};
        let src = Path::new("/w/pkg/com/demo/Main.java");
        assert_eq!(package_root(src, Some("com.demo")), PathBuf::from("/w/pkg"));
        // No package: the file's own folder.
        assert_eq!(package_root(src, None), PathBuf::from("/w/pkg/com/demo"));
        // Folders that do not match the package: fall back to the file's folder.
        assert_eq!(
            package_root(Path::new("/w/src/Main.java"), Some("com.demo")),
            PathBuf::from("/w/src")
        );
    }

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

    /// Runs `execute` on `source` saved as `<file>.java`; `None` without a JDK.
    fn execute_as(file: &str, source: &str) -> Option<Result<CommandSpec, RunnerError>> {
        if which::which("java").is_err() {
            eprintln!("skipping: java not installed");
            return None;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{file}.java"));
        std::fs::write(&path, source).unwrap();
        let ctx = RunContext {
            source: path,
            scratch: dir.path().join("build"),
            workdir: dir.path().to_path_buf(),
        };
        Some(JavaRunner.execute(&ctx))
    }

    #[test]
    fn public_nested_class_is_not_the_entry_point() {
        // `public static class Node` is nested: it must not be mistaken for
        // the file's public class (which would trigger a bogus rename error).
        let src = "class Main {\n  public static class Node { int v; }\n  \
                   public static void main(String[] a) {}\n}";
        let found = detect_main_class(src).unwrap();
        assert_eq!(found.name, "Main");
        assert!(!found.is_public);
    }

    #[test]
    fn nested_class_inside_public_class() {
        let src = "public class Outer { static class Inner {} \
                   public static void main(String[] a) {} }";
        assert_eq!(name_of(src).as_deref(), Some("Outer"));
    }

    #[test]
    fn record_with_main_is_found() {
        let src = "public record Point(int x, int y) {\n  \
                   public static void main(String[] args) { }\n}";
        let found = detect_main_class(src).unwrap();
        assert_eq!(found.name, "Point");
        assert!(found.is_public);
    }

    #[test]
    fn interface_with_main_is_found() {
        let src = "interface Shape { double area(); }\n\
                   interface App { static void main(String[] a) { } }";
        assert_eq!(name_of(src).as_deref(), Some("App"));
    }

    #[test]
    fn class_with_main_wins_among_several_top_level_classes() {
        let src =
            "class Helper { int x; }\nclass Runner { public static void main(String[] a) {} }\n\
                   class Other {}";
        assert_eq!(name_of(src).as_deref(), Some("Runner"));
    }

    #[test]
    fn enum_with_main_is_found() {
        let src = "enum Color { RED, GREEN; public static void main(String[] a) {} }";
        assert_eq!(name_of(src).as_deref(), Some("Color"));
    }

    #[test]
    fn unicode_identifiers_are_kept_whole() {
        let src = "public class Caf\u{e9}\u{3b1} { public static void main(String[] a) {} }";
        assert_eq!(name_of(src).as_deref(), Some("Caf\u{e9}\u{3b1}"));
    }

    #[test]
    fn class_keyword_in_comments_strings_and_text_blocks_is_ignored() {
        let src = "/* public class Ghost { } */\n\
                   // class Phantom\n\
                   class Real {\n  \
                   String a = \"public class Fake {\";\n  \
                   char q = '\"';\n  \
                   String b = \"\"\"\n    class TextBlock {\n    \"\"\";\n  \
                   public static void main(String[] x) {}\n}";
        let found = detect_main_class(src).unwrap();
        assert_eq!(found.name, "Real");
    }

    #[test]
    fn sealed_and_annotated_public_classes_are_public() {
        assert!(
            detect_main_class("@SuppressWarnings public sealed class S permits T {}")
                .unwrap()
                .is_public
        );
        assert!(
            detect_main_class("public non-sealed class N extends S {}")
                .unwrap()
                .is_public
        );
    }

    #[test]
    fn package_declaration_after_comments() {
        let src = "/* header */\n// package wrong.one;\npackage edu.lab1;\n\nclass Main {}";
        assert_eq!(detect_package(src).as_deref(), Some("edu.lab1"));
    }

    #[test]
    fn non_public_class_with_main_runs_under_any_filename() {
        let Some(result) = execute_as(
            "Whatever",
            "class Lab { public static void main(String[] a) {} }",
        ) else {
            return;
        };
        assert_eq!(result.unwrap().args.last().unwrap(), "Lab");
    }

    #[test]
    fn filename_mismatch_names_both() {
        let Some(result) = execute_as("lab1", "public class Lab1 { }") else {
            return;
        };
        let Err(RunnerError::Invalid(msg)) = result else {
            panic!("expected a mismatch error");
        };
        assert!(
            msg.contains("`Lab1.java`") && msg.contains("`lab1.java`"),
            "{msg}"
        );
    }

    #[test]
    fn compact_source_file_runs_under_its_file_name() {
        let Some(result) = execute_as("Hello", "void main() {\n  IO.println(\"hi\");\n}\n") else {
            return;
        };
        assert_eq!(result.unwrap().args.last().unwrap(), "Hello");
    }

    #[test]
    fn file_without_any_class_is_explained() {
        let Some(result) = execute_as("Empty", "// nothing here\nint x = 5;") else {
            return;
        };
        let Err(RunnerError::Invalid(msg)) = result else {
            panic!("expected an error");
        };
        assert!(msg.contains("main"), "{msg}");
    }

    #[test]
    fn heap_is_capped_below_the_sandbox_memory_limit() {
        let Some(result) = execute_as("Main", "public class Main {}") else {
            return;
        };
        let spec = result.unwrap();
        assert!(spec.args[0].starts_with("-Xmx"), "{:?}", spec.args);
    }
}
