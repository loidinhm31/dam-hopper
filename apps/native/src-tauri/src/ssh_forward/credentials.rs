//! Bounded OS-agent and opaque safe-key inventory boundary.

use std::fmt;

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

const MAX_AGENT_IDENTITIES: usize = 64;
const MAX_INVENTORY_ENTRIES: usize = 256;
const MAX_KEY_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SafeKeyRecord {
    pub(crate) key_id: String,
    pub(crate) label: String,
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CredentialError {
    AgentUnavailable,
    KeyNotFound,
    KeyUnsafe,
    KeyEncrypted,
    InvalidInventory,
}

impl fmt::Display for CredentialError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AgentUnavailable => "agent_unavailable",
            Self::KeyNotFound => "key_not_found",
            Self::KeyUnsafe => "key_unsafe",
            Self::KeyEncrypted => "key_encrypted",
            Self::InvalidInventory => "invalid_inventory",
        })
    }
}

pub(crate) fn max_agent_identities() -> usize {
    MAX_AGENT_IDENTITIES
}

#[cfg(windows)]
pub(crate) async fn agent_inventory() -> Result<Vec<SafeKeyRecord>, CredentialError> {
    windows::agent_inventory().await
}

#[cfg(unix)]
pub(crate) async fn agent_inventory() -> Result<Vec<SafeKeyRecord>, CredentialError> {
    unix::agent_inventory().await
}

#[cfg(windows)]
pub(crate) fn safe_key_inventory() -> Result<Vec<SafeKeyRecord>, CredentialError> {
    windows::safe_key_inventory()
}

#[cfg(windows)]
pub(crate) fn load_safe_key(key_id: &str) -> Result<Vec<u8>, CredentialError> {
    windows::load_safe_key(key_id)
}

#[cfg(windows)]
pub(crate) fn is_bounded_inventory(count: usize) -> bool {
    count <= MAX_INVENTORY_ENTRIES
}

#[cfg(test)]
mod tests {
    use super::{max_agent_identities, CredentialError};

    #[test]
    fn credential_limits_are_bounded_and_redacted() {
        assert_eq!(max_agent_identities(), 64);
        assert_eq!(CredentialError::KeyEncrypted.to_string(), "key_encrypted");
    }
}
