//! Unix SSH_AUTH_SOCK agent adapter kept separate from the Windows inventory.

use std::time::Duration;

use russh::keys::{agent::client::AgentClient, HashAlg};
use tokio::time::timeout;

use super::{CredentialError, KeySource, SafeKeyRecord};

pub(crate) async fn agent_inventory() -> Result<Vec<SafeKeyRecord>, CredentialError> {
    let mut agent = timeout(Duration::from_secs(5), AgentClient::connect_env())
        .await
        .map_err(|_| CredentialError::AgentUnavailable)?
        .map_err(|_| CredentialError::AgentUnavailable)?;
    let identities = timeout(Duration::from_secs(5), agent.request_identities())
        .await
        .map_err(|_| CredentialError::AgentUnavailable)?
        .map_err(|_| CredentialError::AgentUnavailable)?;
    Ok(identities
        .into_iter()
        .take(super::MAX_AGENT_IDENTITIES)
        .enumerate()
        .map(|(index, identity)| {
            let public_key = identity.public_key();
            SafeKeyRecord {
                key_id: format!("agent-{index}"),
                label: format!("Agent identity {}", index + 1),
                algorithm: public_key.algorithm().to_string(),
                fingerprint: public_key.fingerprint(HashAlg::Sha256).to_string(),
                encrypted: false,
                source: KeySource::Agent,
            }
        })
        .collect())
}
