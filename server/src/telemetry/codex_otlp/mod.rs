mod config_file;
pub mod config_manager;
pub mod decoder;
pub mod health;
pub mod normalizer;
pub mod receiver;
pub mod secret;

#[cfg(test)]
mod tests;

pub use config_manager::{CodexExporterManager, CodexExporterStatus};
pub use health::{CollectorHealth, CollectorHealthSnapshot};
pub(crate) use receiver::start_collector_at;
pub use receiver::{start_collector, CollectorHandle};
