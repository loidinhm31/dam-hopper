pub mod agent_import;
pub mod agent_memory;
pub mod agent_store;
pub mod auth;
pub mod commands;
pub mod config;
pub mod error;
pub mod git;
pub mod router;
pub mod settings;
pub mod terminal;
pub mod workspace;
pub mod ws;

#[cfg(test)]
mod tests;

pub use router::build_router;
