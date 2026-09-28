pub mod reducer;
pub mod types;
pub mod runtime;
pub mod collector;

#[cfg(test)]
mod tests;

pub use reducer::{AgentStatusRegistry, ReducerOutput, TerminalAgentReducer};
pub use types::*;
pub use runtime::{
    AgentStatusRuntime, CredentialReservation, CredentialState, ScopedCredential, TokenAuthResult,
};
pub use collector::AgentStatusCollector;
