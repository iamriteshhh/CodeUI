//! Language execution modules and the extension -> runner registry.

pub mod c;
pub mod cpp;
pub mod generic;
pub mod java;
pub mod python;
pub mod runner_trait;
pub mod salivo;

use std::path::Path;

pub use runner_trait::{CommandSpec, LanguageRunner, RunContext, RunnerError};

/// Picks a runner from the file extension.
pub fn runner_for_path(path: &Path) -> Result<Box<dyn LanguageRunner>, RunnerError> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "c" => Ok(Box::new(c::CRunner)),
        "cpp" | "cc" | "cxx" => Ok(Box::new(cpp::CppRunner)),
        "java" => Ok(Box::new(java::JavaRunner)),
        "py" => Ok(Box::new(python::PythonRunner)),
        "sal" => Ok(Box::new(salivo::SalivoRunner)),
        // Every other language with an entry in the table (JavaScript, Rust, Go, ...).
        other => generic::runner_for_ext(other)
            .map(|r| Box::new(r) as Box<dyn LanguageRunner>)
            .ok_or(RunnerError::UnsupportedLanguage),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn maps_extensions_to_runners() {
        let cases = [
            ("main.c", "c"),
            ("main.cpp", "cpp"),
            ("main.CC", "cpp"),
            ("Main.java", "java"),
            ("script.py", "python"),
            ("game.sal", "salivo"),
        ];
        for (file, expected) in cases {
            let runner = runner_for_path(&PathBuf::from(file)).expect(file);
            assert_eq!(runner.id(), expected, "{file}");
        }
    }

    #[test]
    fn rejects_unknown_extension() {
        assert!(matches!(
            runner_for_path(&PathBuf::from("notes.txt")),
            Err(RunnerError::UnsupportedLanguage)
        ));
        assert!(matches!(
            runner_for_path(&PathBuf::from("Makefile")),
            Err(RunnerError::UnsupportedLanguage)
        ));
    }
}
