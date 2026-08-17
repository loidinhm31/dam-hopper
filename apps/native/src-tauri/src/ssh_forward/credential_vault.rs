//! Windows Credential Manager boundary for short-lived SSH credential reuse.

use std::{fmt, sync::Arc};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::model::UtcTimestamp;

#[cfg(test)]
pub(crate) mod fake;
#[cfg(windows)]
mod windows;

#[cfg(all(windows, not(test)))]
pub(crate) use windows::WindowsCredentialVault;

pub(crate) const APP_ID: &str = "com.damhopper.desktop";
pub(crate) const REMEMBER_FOR_DAYS: u16 = 30;
const MAX_TARGET_BYTES: usize = 240;
const MAX_SECRET_BYTES: usize = 4096;
const MAX_BLOB_BYTES: usize = 16 * 1024;
const MAX_FUTURE_SKEW_SECONDS: i64 = 300;
const SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum VaultAuthIdentity {
    Password,
    KeyPassphrase(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CredentialIdentity {
    pub(crate) scope_id: String,
    pub(crate) profile_id: String,
    pub(crate) endpoint_host: String,
    pub(crate) endpoint_port: u16,
    pub(crate) ssh_user: String,
    pub(crate) auth: VaultAuthIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VaultTarget {
    target: String,
    scope_prefix: String,
    identity_digest: String,
}

impl VaultTarget {
    pub(crate) fn target(&self) -> &str {
        &self.target
    }

    pub(crate) fn scope_prefix(&self) -> &str {
        &self.scope_prefix
    }

    pub(crate) fn identity_digest(&self) -> &str {
        &self.identity_digest
    }
}

pub(crate) fn target_for(identity: &CredentialIdentity) -> Result<VaultTarget, VaultError> {
    if identity.scope_id.is_empty()
        || identity.profile_id.is_empty()
        || identity.endpoint_host.is_empty()
        || identity.ssh_user.is_empty()
        || identity.endpoint_port == 0
    {
        return Err(VaultError::InvalidIdentity);
    }
    if let VaultAuthIdentity::KeyPassphrase(key_id) = &identity.auth {
        if key_id.is_empty()
            || key_id.len() > 128
            || !key_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(VaultError::InvalidIdentity);
        }
    }
    let scope_prefix = scope_prefix_for(&identity.scope_id)?;
    let auth_tag = auth_tag(&identity.auth);
    let identity_digest = digest(
        "identity",
        &[
            APP_ID,
            &identity.scope_id,
            &identity.profile_id,
            &identity.endpoint_host,
            &identity.endpoint_port.to_string(),
            &identity.ssh_user,
            auth_tag.as_str(),
        ],
    );
    let target = format!("{scope_prefix}.credential.{identity_digest}");
    if target.len() > MAX_TARGET_BYTES {
        return Err(VaultError::InvalidIdentity);
    }
    Ok(VaultTarget {
        target,
        scope_prefix,
        identity_digest,
    })
}

pub(crate) fn scope_prefix_for(scope_id: &str) -> Result<String, VaultError> {
    if scope_id.is_empty() {
        return Err(VaultError::InvalidIdentity);
    }
    let scope_digest = digest("scope", &[APP_ID, scope_id]);
    Ok(format!(
        "DamHopper.SshForward.v{SCHEMA_VERSION}.scope.{scope_digest}"
    ))
}

fn auth_tag(auth: &VaultAuthIdentity) -> String {
    match auth {
        VaultAuthIdentity::Password => "password".into(),
        VaultAuthIdentity::KeyPassphrase(key_id) => format!("key-passphrase:{key_id}"),
    }
}

fn digest(domain: &str, fields: &[&str]) -> String {
    let mut hasher = Sha256::new();
    write_field(&mut hasher, domain);
    for field in fields {
        write_field(&mut hasher, field);
    }
    hex(&hasher.finalize())
}

fn write_field(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u32).to_be_bytes());
    hasher.update(value.as_bytes());
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|byte| [HEX[(byte >> 4) as usize], HEX[(byte & 0xf) as usize]])
        .map(char::from)
        .collect()
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CredentialKind {
    Password,
    KeyPassphrase,
}

#[derive(Clone)]
pub(crate) struct CredentialRecord {
    pub(crate) kind: CredentialKind,
    pub(crate) secret: Zeroizing<String>,
    pub(crate) identity_digest: String,
    pub(crate) created_at: UtcTimestamp,
    pub(crate) expires_at: UtcTimestamp,
    pub(crate) rejected_at: Option<UtcTimestamp>,
}

impl CredentialRecord {
    pub(crate) fn new(
        kind: CredentialKind,
        secret: impl Into<String>,
        identity_digest: &str,
        now: UtcTimestamp,
    ) -> Result<Self, VaultError> {
        let secret = secret.into();
        if secret.is_empty()
            || secret.len() > MAX_SECRET_BYTES
            || identity_digest.len() != 64
            || !identity_digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(VaultError::InvalidRecord);
        }
        let expires_at = now
            .checked_add_days(i64::from(REMEMBER_FOR_DAYS))
            .map_err(|_| VaultError::InvalidRecord)?;
        Ok(Self {
            kind,
            secret: Zeroizing::new(secret),
            identity_digest: identity_digest.into(),
            created_at: now,
            expires_at,
            rejected_at: None,
        })
    }

    pub(crate) fn is_expired(&self, now: UtcTimestamp) -> bool {
        self.expires_at <= now
    }

    pub(crate) fn is_rejected(&self) -> bool {
        self.rejected_at.is_some()
    }

    pub(crate) fn mark_rejected(&mut self, now: UtcTimestamp) {
        self.rejected_at = Some(now);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CredentialStatus {
    None,
    Saved,
    Rejected,
    Expired,
    Unavailable,
}

pub(crate) struct VaultRead {
    pub(crate) status: CredentialStatus,
    pub(crate) credential: Option<CredentialRecord>,
    pub(crate) expires_at: Option<UtcTimestamp>,
    pub(crate) cleanup_warning: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SweepResult {
    pub(crate) expired: u32,
    pub(crate) cleanup_failures: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum VaultError {
    Unavailable,
    Corrupt,
    InvalidIdentity,
    InvalidRecord,
    WriteFailed,
    DeleteFailed,
}

impl fmt::Display for VaultError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "credential_vault_unavailable",
            Self::Corrupt => "credential_vault_corrupt",
            Self::InvalidIdentity => "credential_identity_invalid",
            Self::InvalidRecord => "credential_record_invalid",
            Self::WriteFailed => "credential_vault_write_failed",
            Self::DeleteFailed => "credential_vault_delete_failed",
        })
    }
}

pub(crate) trait Clock: Send + Sync {
    fn now(&self) -> UtcTimestamp;
}

#[derive(Default)]
pub(crate) struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> UtcTimestamp {
        UtcTimestamp::now()
    }
}

pub(crate) trait CredentialVault: Send + Sync {
    fn save(&self, target: &VaultTarget, record: &CredentialRecord) -> Result<(), VaultError>;
    fn load(&self, target: &VaultTarget, now: UtcTimestamp) -> Result<VaultRead, VaultError>;
    fn mark_rejected(&self, target: &VaultTarget, now: UtcTimestamp) -> Result<(), VaultError>;
    fn forget(&self, target: &VaultTarget) -> Result<(), VaultError>;
    fn forget_scope(&self, scope_prefix: &str) -> Result<(), VaultError>;
    fn sweep_expired(&self, now: UtcTimestamp) -> Result<SweepResult, VaultError>;
}

pub(crate) fn encode_record(record: &CredentialRecord) -> Result<Vec<u8>, VaultError> {
    let blob = StoredCredentialBlob {
        version: SCHEMA_VERSION,
        kind: record.kind,
        secret: record.secret.clone(),
        identity_digest: record.identity_digest.clone(),
        created_at: record.created_at,
        expires_at: record.expires_at,
        rejected_at: record.rejected_at,
    };
    let bytes = serde_json::to_vec(&blob).map_err(|_| VaultError::Corrupt)?;
    (bytes.len() <= MAX_BLOB_BYTES)
        .then_some(bytes)
        .ok_or(VaultError::InvalidRecord)
}

pub(crate) fn decode_record(
    bytes: &[u8],
    target: &VaultTarget,
    now: UtcTimestamp,
) -> Result<CredentialRecord, VaultError> {
    if bytes.is_empty() || bytes.len() > MAX_BLOB_BYTES {
        return Err(VaultError::Corrupt);
    }
    let blob: StoredCredentialBlob =
        serde_json::from_slice(bytes).map_err(|_| VaultError::Corrupt)?;
    let future_limit = now
        .checked_add_seconds(MAX_FUTURE_SKEW_SECONDS)
        .map_err(|_| VaultError::Corrupt)?;
    if blob.version != SCHEMA_VERSION
        || blob.identity_digest != target.identity_digest
        || blob.secret.is_empty()
        || blob.secret.len() > MAX_SECRET_BYTES
        || blob.created_at > future_limit
        || blob.expires_at
            != blob
                .created_at
                .checked_add_days(i64::from(REMEMBER_FOR_DAYS))
                .map_err(|_| VaultError::Corrupt)?
        || blob
            .rejected_at
            .is_some_and(|rejected_at| rejected_at < blob.created_at || rejected_at > future_limit)
    {
        return Err(VaultError::Corrupt);
    }
    Ok(CredentialRecord {
        kind: blob.kind,
        secret: blob.secret,
        identity_digest: blob.identity_digest,
        created_at: blob.created_at,
        expires_at: blob.expires_at,
        rejected_at: blob.rejected_at,
    })
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredCredentialBlob {
    version: u8,
    kind: CredentialKind,
    secret: Zeroizing<String>,
    identity_digest: String,
    created_at: UtcTimestamp,
    expires_at: UtcTimestamp,
    #[serde(default)]
    rejected_at: Option<UtcTimestamp>,
}

pub(crate) fn status_from_read(read: &VaultRead) -> CredentialStatus {
    read.status
}

pub(crate) fn arc_clock() -> Arc<dyn Clock> {
    Arc::new(SystemClock)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::fake::{FakeClock, FakeCredentialVault};
    use super::{
        target_for, Clock, CredentialIdentity, CredentialKind, CredentialRecord, CredentialStatus,
        CredentialVault, VaultAuthIdentity, VaultError,
    };
    use crate::ssh_forward::model::UtcTimestamp;

    const NOW: &str = "2026-08-17T00:00:00.000Z";

    fn identity() -> CredentialIdentity {
        CredentialIdentity {
            scope_id: "scope-id".into(),
            profile_id: "profile-id".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::KeyPassphrase("key-a".into()),
        }
    }

    #[test]
    fn target_is_opaque_and_identity_bound() {
        let first = target_for(&identity()).unwrap();
        assert!(!first.target().contains("bastion"));
        assert!(!first.target().contains("operator"));
        let mut other = identity();
        other.endpoint_port = 23;
        assert_ne!(first.target(), target_for(&other).unwrap().target());
        other = identity();
        other.auth = VaultAuthIdentity::KeyPassphrase("key-b".into());
        assert_ne!(first.target(), target_for(&other).unwrap().target());
    }

    #[test]
    fn fake_vault_keeps_a_fixed_expiry_and_quarantines_rejection() {
        let now = UtcTimestamp::parse(NOW).unwrap();
        let clock = FakeClock::new(now);
        let vault = Arc::new(FakeCredentialVault::new());
        let target = target_for(&identity()).unwrap();
        let record = CredentialRecord::new(
            CredentialKind::KeyPassphrase,
            "phrase",
            target.identity_digest(),
            clock.now(),
        )
        .unwrap();
        let expiry = record.expires_at;
        vault.save(&target, &record).unwrap();
        clock.set(now.checked_add_seconds(30).unwrap());
        let loaded = vault.load(&target, clock.now()).unwrap();
        assert_eq!(loaded.status, CredentialStatus::Saved);
        assert_eq!(loaded.expires_at, Some(expiry));
        vault.mark_rejected(&target, clock.now()).unwrap();
        let rejected = vault.load(&target, clock.now()).unwrap();
        assert_eq!(rejected.status, CredentialStatus::Rejected);
        assert!(rejected.credential.is_none());
        assert_eq!(rejected.expires_at, Some(expiry));
    }

    #[test]
    fn expiry_is_at_the_boundary_and_cleanup_is_authoritative() {
        let now = UtcTimestamp::parse(NOW).unwrap();
        let vault = FakeCredentialVault::new();
        let target = target_for(&identity()).unwrap();
        let record = CredentialRecord::new(
            CredentialKind::Password,
            "secret",
            target.identity_digest(),
            now,
        )
        .unwrap();
        let expiry = record.expires_at;
        vault.save(&target, &record).unwrap();
        let at_expiry = vault.load(&target, expiry).unwrap();
        assert_eq!(at_expiry.status, CredentialStatus::Expired);
        assert!(!vault.contains(&target));
    }

    #[test]
    fn expiry_cleanup_failure_never_returns_the_secret() {
        let now = UtcTimestamp::parse(NOW).unwrap();
        let vault = FakeCredentialVault::new();
        let target = target_for(&identity()).unwrap();
        let record = CredentialRecord::new(
            CredentialKind::Password,
            "secret",
            target.identity_digest(),
            now,
        )
        .unwrap();
        vault.save(&target, &record).unwrap();
        vault.set_failures(false, false, true);
        let expired = vault
            .load(&target, record.expires_at)
            .expect("logical expiry remains readable");
        assert_eq!(expired.status, CredentialStatus::Expired);
        assert!(expired.credential.is_none());
        assert!(expired.cleanup_warning);
        assert!(vault.contains(&target));
    }

    #[test]
    fn failed_write_does_not_replace_an_existing_saved_entry() {
        let now = UtcTimestamp::parse(NOW).unwrap();
        let vault = FakeCredentialVault::new();
        let target = target_for(&identity()).unwrap();
        let first = CredentialRecord::new(
            CredentialKind::KeyPassphrase,
            "first",
            target.identity_digest(),
            now,
        )
        .unwrap();
        vault.save(&target, &first).unwrap();
        vault.set_failures(false, true, false);
        let second = CredentialRecord::new(
            CredentialKind::KeyPassphrase,
            "second",
            target.identity_digest(),
            now.checked_add_seconds(1).unwrap(),
        )
        .unwrap();
        assert_eq!(vault.save(&target, &second), Err(VaultError::WriteFailed));
        vault.set_failures(false, false, false);
        let loaded = vault.load(&target, now).unwrap();
        assert_eq!(loaded.credential.unwrap().secret.as_str(), "first");
    }
}
