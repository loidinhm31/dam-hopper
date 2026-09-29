pub mod collector;
pub mod hook_ingress;
pub mod hook_reporter;
pub mod integration;
pub mod reducer;
pub mod runtime;
pub mod types;

#[cfg(test)]
mod tests;

pub use collector::AgentStatusCollector;
pub use hook_ingress::{validate_hook_envelope, verify_reporter_ancestry, TokenRateLimiter};
pub use integration::{
    check_extension_status, install_extension, uninstall_extension, AgentPathsVerification,
    ExtensionStatusReport, IntegrationError, ManagedExtensionStatus, EXTENSION_SUBPATH,
    MANAGED_ADAPTER_VERSION, OMP_AGENT_STATUS_ASSET,
};
pub use reducer::{AgentStatusRegistry, ReducerOutput, TerminalAgentReducer};
pub use runtime::{
    AgentStatusRuntime, CredentialReservation, CredentialState, ScopedCredential, TokenAuthResult,
};
pub use types::*;
