//! Narrow, typed IPC surface.
//!
//! Every command does exactly one thing. There is deliberately no generic
//! "execute this shell string" entry point.

pub mod diagnostics;
pub mod env_detect;
pub mod extensions;
pub mod fs;
pub mod process;
pub mod settings;
pub mod terminal;
