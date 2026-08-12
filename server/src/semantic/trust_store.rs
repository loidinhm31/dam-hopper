//! Persisted, server-owned project trust records.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::utils::atomic_write;

use super::protocol::{validate_opaque_id, MAX_SEQUENCE};
use super::trust::{
    RequestedTrust, SemanticTrust, SemanticTrustChallenge, SemanticTrustState,
    SemanticTrustTransitionRequest, TrustConfirmationChallenge, TrustError, TrustTransitionReason,
};

pub const DEFAULT_CHALLENGE_TTL_MS: u64 = 5 * 60 * 1000;
const TRUST_STORE_VERSION: u16 = 1;
const MAX_TRUST_STORE_BYTES: u64 = 1024 * 1024;
const MAX_TRUST_RECORDS: usize = 256;

#[derive(Clone)]
pub struct ProjectTrustStore {
    /// `None` means this process has no durable, server-owned trust location.
    /// It is intentionally not represented by a filesystem sentinel.
    path: Arc<Option<PathBuf>>,
    inner: Arc<Mutex<TrustStoreInner>>,
}

#[derive(Debug, Default)]
struct TrustStoreInner {
    records: HashMap<String, PersistedTrustRecord>,
    challenges: HashMap<String, TrustConfirmationChallenge>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustRecord {
    pub project_id: String,
    pub canonical_project: String,
    pub trust: SemanticTrust,
    pub policy_revision: u64,
    pub decided_at: Option<u64>,
    pub updated_at: u64,
    pub revoked_at: Option<u64>,
    pub audit_reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedTrustRecord {
    project_id: String,
    canonical_project: String,
    trust: SemanticTrust,
    policy_revision: u64,
    decided_at: Option<u64>,
    updated_at: u64,
    revoked_at: Option<u64>,
    audit_reason: String,
}

impl ProjectTrustStore {
    pub fn in_memory() -> Self {
        Self {
            path: Arc::new(None),
            inner: Arc::new(Mutex::new(TrustStoreInner::default())),
        }
    }

    pub fn open(path: impl Into<PathBuf>) -> Result<Self, TrustStoreError> {
        let path = path.into();
        let records = if !path.exists() {
            HashMap::new()
        } else {
            let metadata = std::fs::metadata(&path).map_err(|_| TrustStoreError::ReadFailed)?;
            if metadata.len() > MAX_TRUST_STORE_BYTES {
                return Err(TrustStoreError::InvalidFile);
            }
            let raw = std::fs::read_to_string(&path).map_err(|_| TrustStoreError::ReadFailed)?;
            let file: TrustStoreFile =
                serde_json::from_str(&raw).map_err(|_| TrustStoreError::InvalidFile)?;
            if file.version != TRUST_STORE_VERSION {
                return Err(TrustStoreError::InvalidFile);
            }
            if file.records.len() > MAX_TRUST_RECORDS {
                return Err(TrustStoreError::InvalidFile);
            }
            let mut records = HashMap::new();
            for record in file.records {
                validate_record(&record)?;
                if records
                    .insert(record.canonical_project.clone(), record)
                    .is_some()
                {
                    return Err(TrustStoreError::InvalidFile);
                }
            }
            records
        };
        Ok(Self {
            path: Arc::new(Some(path)),
            inner: Arc::new(Mutex::new(TrustStoreInner {
                records,
                challenges: HashMap::new(),
            })),
        })
    }

    pub fn state(
        &self,
        project_id: &str,
        project_path: &Path,
    ) -> Result<SemanticTrustState, TrustStoreError> {
        let record = self.record(project_id, project_path)?;
        Ok(SemanticTrustState {
            project_id: record.project_id,
            trust: record.trust,
            can_transition: self.path.is_some(),
            transition_reason: self
                .path
                .as_ref()
                .as_ref()
                .map(|_| TrustTransitionReason::ConfirmationRequired),
            policy_revision: record.policy_revision,
        })
    }

    pub fn record(
        &self,
        project_id: &str,
        project_path: &Path,
    ) -> Result<TrustRecord, TrustStoreError> {
        let key = canonical_project(project_path)?;
        let guard = self
            .inner
            .lock()
            .map_err(|_| TrustStoreError::LockPoisoned)?;
        if let Some(record) = guard.records.get(&key) {
            if record.project_id != project_id {
                return Err(TrustStoreError::ProjectIdMismatch);
            }
            return Ok(to_public_record(record));
        }
        Ok(TrustRecord {
            project_id: project_id.to_string(),
            canonical_project: key,
            trust: SemanticTrust::Restricted,
            policy_revision: 0,
            decided_at: None,
            updated_at: 0,
            revoked_at: None,
            audit_reason: "default-restricted".into(),
        })
    }

    pub fn issue_challenge(
        &self,
        project_id: &str,
        project_path: &Path,
        ttl_ms: u64,
    ) -> Result<SemanticTrustChallenge, TrustStoreError> {
        self.issue_challenge_at(project_id, project_path, now_ms(), ttl_ms)
    }

    pub(crate) fn issue_challenge_at(
        &self,
        project_id: &str,
        project_path: &Path,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Result<SemanticTrustChallenge, TrustStoreError> {
        let key = canonical_project(project_path)?;
        let record = self.record(project_id, project_path)?;
        let challenge = TrustConfirmationChallenge::issue(
            record.project_id.clone(),
            Uuid::new_v4().simple().to_string(),
            record.policy_revision,
            now_ms.saturating_add(ttl_ms.min(DEFAULT_CHALLENGE_TTL_MS)),
        )?;
        let public = challenge.public_challenge();
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| TrustStoreError::LockPoisoned)?;
        guard.challenges.insert(key, challenge);
        Ok(public)
    }

    pub fn transition(
        &self,
        request: &SemanticTrustTransitionRequest,
        project_path: &Path,
        audit_reason: &str,
    ) -> Result<TrustRecord, TrustStoreError> {
        self.transition_at(request, project_path, now_ms(), audit_reason)
    }

    pub(crate) fn transition_at(
        &self,
        request: &SemanticTrustTransitionRequest,
        project_path: &Path,
        now_ms: u64,
        audit_reason: &str,
    ) -> Result<TrustRecord, TrustStoreError> {
        request.validate()?;
        validate_reason(audit_reason)?;
        let key = canonical_project(project_path)?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| TrustStoreError::LockPoisoned)?;
        if self.path.is_none() {
            return Err(TrustStoreError::PersistenceUnavailable);
        }
        let current = guard
            .records
            .get(&key)
            .cloned()
            .unwrap_or_else(|| PersistedTrustRecord {
                project_id: request.project_id.clone(),
                canonical_project: key.clone(),
                trust: SemanticTrust::Restricted,
                policy_revision: 0,
                decided_at: None,
                updated_at: 0,
                revoked_at: None,
                audit_reason: "default-restricted".into(),
            });
        if current.project_id != request.project_id {
            return Err(TrustStoreError::ProjectIdMismatch);
        }
        let challenge = guard
            .challenges
            .get_mut(&key)
            .ok_or(TrustStoreError::ChallengeMissing)?;
        let desired = challenge.consume(request, current.policy_revision, now_ms)?;
        let next_trust = match desired {
            RequestedTrust::Restricted => SemanticTrust::Restricted,
            RequestedTrust::Trusted => SemanticTrust::Trusted,
        };
        let next = PersistedTrustRecord {
            project_id: current.project_id.clone(),
            canonical_project: current.canonical_project.clone(),
            trust: next_trust,
            policy_revision: current.policy_revision.saturating_add(1),
            decided_at: Some(now_ms),
            updated_at: now_ms,
            revoked_at: None,
            audit_reason: audit_reason.to_string(),
        };
        guard.records.insert(key.clone(), next.clone());
        let path = self
            .path
            .as_deref()
            .expect("checked durable trust path above");
        if let Err(error) = persist_records(path, &guard.records) {
            guard.records.insert(key.clone(), current);
            if let Some(challenge) = guard.challenges.get_mut(&key) {
                challenge.restore_after_persistence_failure();
            }
            return Err(error);
        }
        Ok(to_public_record(&next))
    }

    pub fn revoke(
        &self,
        project_id: &str,
        project_path: &Path,
        audit_reason: &str,
    ) -> Result<TrustRecord, TrustStoreError> {
        self.revoke_at(project_id, project_path, now_ms(), audit_reason)
    }

    pub(crate) fn revoke_at(
        &self,
        project_id: &str,
        project_path: &Path,
        now_ms: u64,
        audit_reason: &str,
    ) -> Result<TrustRecord, TrustStoreError> {
        validate_reason(audit_reason)?;
        let key = canonical_project(project_path)?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| TrustStoreError::LockPoisoned)?;
        if self.path.is_none() {
            return Err(TrustStoreError::PersistenceUnavailable);
        }
        let current = guard
            .records
            .get(&key)
            .cloned()
            .unwrap_or_else(|| PersistedTrustRecord {
                project_id: project_id.to_string(),
                canonical_project: key.clone(),
                trust: SemanticTrust::Restricted,
                policy_revision: 0,
                decided_at: None,
                updated_at: 0,
                revoked_at: None,
                audit_reason: "default-restricted".into(),
            });
        if current.project_id != project_id {
            return Err(TrustStoreError::ProjectIdMismatch);
        }
        let next = PersistedTrustRecord {
            project_id: current.project_id.clone(),
            canonical_project: current.canonical_project.clone(),
            trust: SemanticTrust::Revoked,
            policy_revision: current.policy_revision.saturating_add(1),
            decided_at: current.decided_at,
            updated_at: now_ms,
            revoked_at: Some(now_ms),
            audit_reason: audit_reason.to_string(),
        };
        guard.records.insert(key.clone(), next.clone());
        let previous_challenge = guard.challenges.remove(&key);
        let path = self
            .path
            .as_deref()
            .expect("checked durable trust path above");
        if let Err(error) = persist_records(path, &guard.records) {
            guard.records.insert(key.clone(), current);
            if let Some(challenge) = previous_challenge {
                guard.challenges.insert(key, challenge);
            }
            return Err(error);
        }
        Ok(to_public_record(&next))
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TrustStoreFile {
    version: u16,
    records: Vec<PersistedTrustRecord>,
}

fn persist_records(
    path: &Path,
    records: &HashMap<String, PersistedTrustRecord>,
) -> Result<(), TrustStoreError> {
    let mut values: Vec<_> = records.values().cloned().collect();
    values.sort_by(|left, right| left.canonical_project.cmp(&right.canonical_project));
    let content = serde_json::to_string_pretty(&TrustStoreFile {
        version: TRUST_STORE_VERSION,
        records: values,
    })
    .map_err(|_| TrustStoreError::WriteFailed)?;
    atomic_write(path, &content).map_err(|_| TrustStoreError::WriteFailed)
}

fn canonical_project(path: &Path) -> Result<String, TrustStoreError> {
    if !path.is_absolute() {
        return Err(TrustStoreError::InvalidProjectIdentity);
    }
    let canonical =
        std::fs::canonicalize(path).map_err(|_| TrustStoreError::InvalidProjectIdentity)?;
    if !canonical.is_dir() {
        return Err(TrustStoreError::InvalidProjectIdentity);
    }
    Ok(canonical.to_string_lossy().to_string())
}

fn validate_record(record: &PersistedTrustRecord) -> Result<(), TrustStoreError> {
    record.trust.initialization_policy();
    if validate_opaque_id(&record.project_id, "project_id").is_err()
        || record.canonical_project.is_empty()
        || !Path::new(&record.canonical_project).is_absolute()
        || record.policy_revision > MAX_SEQUENCE
        || record.audit_reason.len() > 512
        || record.audit_reason.contains('\0')
    {
        return Err(TrustStoreError::InvalidFile);
    }
    Ok(())
}

fn validate_reason(reason: &str) -> Result<(), TrustStoreError> {
    if reason.trim().is_empty() || reason.len() > 512 || reason.contains('\0') {
        return Err(TrustStoreError::InvalidAuditReason);
    }
    Ok(())
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn to_public_record(record: &PersistedTrustRecord) -> TrustRecord {
    TrustRecord {
        project_id: record.project_id.clone(),
        canonical_project: record.canonical_project.clone(),
        trust: record.trust,
        policy_revision: record.policy_revision,
        decided_at: record.decided_at,
        updated_at: record.updated_at,
        revoked_at: record.revoked_at,
        audit_reason: record.audit_reason.clone(),
    }
}

#[derive(Debug, Error)]
pub enum TrustStoreError {
    #[error("trust store could not be read")]
    ReadFailed,
    #[error("trust store is invalid")]
    InvalidFile,
    #[error("trust store could not be written")]
    WriteFailed,
    #[error("durable trust storage is unavailable; trust elevation is disabled")]
    PersistenceUnavailable,
    #[error("trust store lock is poisoned")]
    LockPoisoned,
    #[error("project identity must be absolute")]
    InvalidProjectIdentity,
    #[error("project id does not match the persisted project identity")]
    ProjectIdMismatch,
    #[error("trust challenge is missing")]
    ChallengeMissing,
    #[error("trust audit reason is invalid")]
    InvalidAuditReason,
    #[error(transparent)]
    Trust(#[from] TrustError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_restricted_and_persists_trust_by_canonical_project() {
        let dir = tempfile::tempdir().unwrap();
        let store_path = dir.path().join("trust.json");
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let store = ProjectTrustStore::open(&store_path).unwrap();
        assert_eq!(
            store.record("p", &project).unwrap().trust,
            SemanticTrust::Restricted
        );
        let challenge = store.issue_challenge_at("p", &project, 10, 1_000).unwrap();
        let record = store
            .transition_at(
                &SemanticTrustTransitionRequest {
                    project_id: "p".into(),
                    desired_trust: RequestedTrust::Trusted,
                    confirmation: challenge.challenge,
                },
                &project,
                20,
                "explicit user confirmation",
            )
            .unwrap();
        assert_eq!(record.trust, SemanticTrust::Trusted);
        assert_eq!(record.policy_revision, 1);

        let restored = ProjectTrustStore::open(&store_path).unwrap();
        assert_eq!(
            restored.record("p", &project).unwrap().trust,
            SemanticTrust::Trusted
        );
    }

    #[test]
    fn revocation_increments_revision_and_clears_challenge() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let store = ProjectTrustStore::open(dir.path().join("trust.json")).unwrap();
        store.issue_challenge_at("p", &project, 10, 100).unwrap();
        let record = store.revoke_at("p", &project, 20, "user revoked").unwrap();
        assert_eq!(record.trust, SemanticTrust::Revoked);
        assert_eq!(record.policy_revision, 1);
        assert!(matches!(
            store.transition_at(
                &SemanticTrustTransitionRequest {
                    project_id: "p".into(),
                    desired_trust: RequestedTrust::Trusted,
                    confirmation: "stale".into(),
                },
                &project,
                30,
                "retry",
            ),
            Err(TrustStoreError::ChallengeMissing)
        ));
    }

    #[test]
    fn in_memory_store_cannot_elevate_or_revoke_trust() {
        let project = tempfile::tempdir().unwrap();
        let store = ProjectTrustStore::in_memory();
        let challenge = store
            .issue_challenge_at("p", project.path(), 10, 100)
            .unwrap();
        assert!(matches!(
            store.transition_at(
                &SemanticTrustTransitionRequest {
                    project_id: "p".into(),
                    desired_trust: RequestedTrust::Trusted,
                    confirmation: challenge.challenge,
                },
                project.path(),
                20,
                "must not persist",
            ),
            Err(TrustStoreError::PersistenceUnavailable)
        ));
        assert!(matches!(
            store.revoke_at("p", project.path(), 20, "must not persist"),
            Err(TrustStoreError::PersistenceUnavailable)
        ));
    }
}
