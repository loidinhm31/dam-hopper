pub mod decoder;
pub mod health;
pub mod normalizer;
pub mod receiver;
pub mod secret;

#[cfg(test)]
mod tests;

pub use health::{CollectorHealth, CollectorHealthSnapshot};
pub use receiver::{start_collector, CollectorHandle};
