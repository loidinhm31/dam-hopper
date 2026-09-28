pub mod reducer;
pub mod types;
pub mod runtime;
pub mod collector;
pub mod integration;

#[cfg(test)]
mod tests;

pub use reducer::{AgentStatusRegistry, ReducerOutput, TerminalAgentReducer};
pub use types::*;
pub use runtime::{
    AgentStatusRuntime, CredentialReservation, CredentialState, ScopedCredential, TokenAuthResult,
};
pub use collector::AgentStatusCollector;
pub use integration::{
    check_extension_status, install_extension, uninstall_extension, ExtensionStatusReport,
    IntegrationError, ManagedExtensionStatus, EXTENSION_SUBPATH, MANAGED_ADAPTER_VERSION,
    OMP_AGENT_STATUS_ASSET,
};
