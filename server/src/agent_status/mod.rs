pub mod claude_integration;
pub mod codex_integration;
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
pub use claude_integration::{
    check_claude_status, install_claude, uninstall_claude, CLAUDE_MANAGED_EVENTS,
};
pub use codex_integration::{
    check_codex_status, install_codex, uninstall_codex, CODEX_MANAGED_EVENTS,
};
pub use integration::{
    check_extension_status, check_native_integration_status, install_extension,
    install_native_integration, uninstall_extension, uninstall_native_integration,
    AgentPathsVerification, ExtensionStatusReport, IntegrationError, ManagedExtensionStatus,
    ManagedHookManifest, ManagedInstallationStatus, ManagedReadinessStatus,
    NativeIntegrationStatusReport, EXTENSION_SUBPATH, MANAGED_ADAPTER_VERSION,
    MANAGED_LAUNCHER_SUBPATH, MANAGED_MANIFEST_SUBPATH, MAX_CONFIG_FILE_BYTES,
    NATIVE_LAUNCHER_ASSET, OMP_AGENT_STATUS_ASSET,
};
pub use integration::read_bounded_safe_file;
pub use reducer::{AgentStatusRegistry, ReducerOutput, TerminalAgentReducer};
pub use runtime::{
    AgentStatusRuntime, CredentialReservation, CredentialState, ScopedCredential, TokenAuthResult,
};
pub use types::*;
