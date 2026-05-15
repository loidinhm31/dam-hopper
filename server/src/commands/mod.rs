pub mod presets;
pub mod registry;

pub use presets::{CommandDatabase, CommandDefinition};
pub use registry::{CommandRegistry, SearchResult, SearchResultCommand};

#[cfg(test)]
mod tests;
