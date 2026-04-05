pub mod presets;
pub mod registry;

pub use registry::{CommandRegistry, SearchResult, SearchResultCommand};
pub use presets::{CommandDefinition, CommandDatabase};

#[cfg(test)]
mod tests;
