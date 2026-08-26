//! Exact, memory-only credentials used by one connection generation.

use zeroize::Zeroizing;

use super::{
    credential_vault::{CredentialIdentity, CredentialKind, CredentialRecord},
    model::UtcTimestamp,
};

#[derive(Clone)]
pub(crate) struct CredentialLease {
    identity: CredentialIdentity,
    attempt_id: String,
    expires_at: Option<UtcTimestamp>,
    saved_reuse: bool,
    material: CredentialMaterial,
}

#[derive(Clone)]
enum CredentialMaterial {
    Password {
        username: Zeroizing<String>,
        password: Zeroizing<String>,
    },
    KeyPassphrase(Zeroizing<String>),
}

impl CredentialLease {
    pub(crate) fn new_password(
        identity: CredentialIdentity,
        attempt_id: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            identity,
            attempt_id: attempt_id.into(),
            expires_at: None,
            saved_reuse: false,
            material: CredentialMaterial::Password {
                username: Zeroizing::new(username.into()),
                password: Zeroizing::new(password.into()),
            },
        }
    }

    pub(crate) fn new_key_passphrase(
        identity: CredentialIdentity,
        attempt_id: impl Into<String>,
        passphrase: impl Into<String>,
    ) -> Self {
        Self {
            identity,
            attempt_id: attempt_id.into(),
            expires_at: None,
            saved_reuse: false,
            material: CredentialMaterial::KeyPassphrase(Zeroizing::new(passphrase.into())),
        }
    }

    pub(crate) fn from_record(
        identity: CredentialIdentity,
        attempt_id: impl Into<String>,
        record: CredentialRecord,
        username: Option<String>,
    ) -> Option<Self> {
        let CredentialRecord {
            kind,
            secret,
            expires_at,
            ..
        } = record;
        match (kind, username) {
            (CredentialKind::Password, Some(username)) => Some(Self {
                identity,
                attempt_id: attempt_id.into(),
                expires_at: Some(expires_at),
                saved_reuse: true,
                material: CredentialMaterial::Password {
                    username: Zeroizing::new(username),
                    password: secret,
                },
            }),
            (CredentialKind::KeyPassphrase, None) => Some(Self {
                identity,
                attempt_id: attempt_id.into(),
                expires_at: Some(expires_at),
                saved_reuse: true,
                material: CredentialMaterial::KeyPassphrase(secret),
            }),
            _ => None,
        }
    }

    pub(crate) fn identity(&self) -> &CredentialIdentity {
        &self.identity
    }

    pub(crate) fn attempt_id(&self) -> &str {
        &self.attempt_id
    }

    pub(crate) fn is_expired(&self, now: UtcTimestamp) -> bool {
        self.expires_at.is_some_and(|expires_at| expires_at <= now)
    }

    pub(crate) fn with_expiry(&self, expires_at: UtcTimestamp) -> Self {
        let mut lease = self.clone();
        lease.expires_at = Some(expires_at);
        lease
    }

    pub(crate) fn saved_reuse(&self) -> bool {
        self.saved_reuse
    }

    pub(crate) fn password(&self) -> Option<(&str, &str)> {
        match &self.material {
            CredentialMaterial::Password { username, password } => {
                Some((username.as_str(), password.as_str()))
            }
            CredentialMaterial::KeyPassphrase(_) => None,
        }
    }

    pub(crate) fn passphrase(&self) -> Option<&str> {
        match &self.material {
            CredentialMaterial::Password { .. } => None,
            CredentialMaterial::KeyPassphrase(passphrase) => Some(passphrase.as_str()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CredentialIdentity, CredentialLease};
    use crate::ssh_forward::credential_vault::VaultAuthIdentity;

    fn identity() -> CredentialIdentity {
        CredentialIdentity {
            scope_id: "scope".into(),
            profile_id: "profile".into(),
            endpoint_host: "host.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        }
    }

    #[test]
    fn lease_exposes_only_the_matching_auth_material() {
        let password = CredentialLease::new_password(identity(), "attempt", "operator", "secret");
        assert_eq!(password.password(), Some(("operator", "secret")));
        assert!(password.passphrase().is_none());
        let key = CredentialLease::new_key_passphrase(identity(), "attempt", "phrase");
        assert!(key.password().is_none());
        assert_eq!(key.passphrase(), Some("phrase"));
    }
}
