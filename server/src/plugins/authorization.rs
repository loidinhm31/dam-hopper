use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use rand::Rng;

use super::contract::{ContextScopeKind, GrantKey};
use super::error::PluginError;
use super::registry_state::OwnerHistorySource;
use crate::api::auth::AuthenticatedActor;

const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionEpoch {
    pub epoch_id: u64,
    pub actor_subject: String,
    pub expires_at: Option<u64>,
    pub created_at: u64,
    pub is_valid: bool,
}

#[derive(Debug, Default)]
pub struct EpochRegistry {
    epochs: RwLock<HashMap<u64, ConnectionEpoch>>,
    actor_index: RwLock<HashMap<String, Vec<u64>>>,
}

impl EpochRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Issue a cryptographically random, non-zero epoch that round-trips through JavaScript.
    pub fn issue_epoch(&self, actor_subject: &str, expires_at: Option<u64>) -> u64 {
        let mut rng = rand::thread_rng();
        let epoch_id = loop {
            let val = rng.gen_range(1..=MAX_JAVASCRIPT_SAFE_INTEGER);
            if !self.epochs.read().contains_key(&val) {
                break val;
            }
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let epoch = ConnectionEpoch {
            epoch_id,
            actor_subject: actor_subject.to_string(),
            expires_at,
            created_at: now,
            is_valid: true,
        };

        self.epochs.write().insert(epoch_id, epoch);
        self.actor_index
            .write()
            .entry(actor_subject.to_string())
            .or_default()
            .push(epoch_id);

        tracing::debug!(epoch = epoch_id, actor = actor_subject, "Issued API connection epoch");
        epoch_id
    }

    /// Validate an epoch against current time and expected actor.
    pub fn validate_epoch(&self, epoch_id: u64, expected_actor: &str) -> Result<ConnectionEpoch, PluginError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Fast path: acquire read lock
        {
            let epochs = self.epochs.read();
            let epoch = epochs.get(&epoch_id).ok_or_else(|| {
                PluginError::unauthorized(format!("Invalid or unknown API connection epoch '{epoch_id}'"))
            })?;

            if !epoch.is_valid {
                return Err(PluginError::unauthorized(format!(
                    "API connection epoch '{epoch_id}' has been revoked"
                )));
            }

            if epoch.actor_subject != expected_actor {
                return Err(PluginError::unauthorized(format!(
                    "API connection epoch '{epoch_id}' belongs to actor '{}', not '{expected_actor}'",
                    epoch.actor_subject
                )));
            }

            if let Some(exp) = epoch.expires_at {
                if now < exp {
                    return Ok(epoch.clone());
                }
            } else {
                return Ok(epoch.clone());
            }
        }

        // Slow path: mark expired with write lock
        let mut epochs = self.epochs.write();
        if let Some(epoch) = epochs.get_mut(&epoch_id) {
            epoch.is_valid = false;
        }
        Err(PluginError::unauthorized(format!(
            "API connection epoch '{epoch_id}' has expired"
        )))
    }

    /// Revoke an epoch explicitly and remove from memory.
    pub fn revoke_epoch(&self, epoch_id: u64) -> Option<String> {
        let mut epochs = self.epochs.write();
        if let Some(epoch) = epochs.remove(&epoch_id) {
            let actor = epoch.actor_subject;
            let mut actor_idx = self.actor_index.write();
            if let Some(list) = actor_idx.get_mut(&actor) {
                list.retain(|&id| id != epoch_id);
                if list.is_empty() {
                    actor_idx.remove(&actor);
                }
            }
            tracing::debug!(epoch = epoch_id, actor = %actor, "Revoked and evicted API connection epoch");
            Some(actor)
        } else {
            None
        }
    }

    /// Revoke all epochs for an actor (e.g. on logout or user disable).
    pub fn revoke_by_actor(&self, actor_subject: &str) -> Vec<u64> {
        let mut epochs = self.epochs.write();
        let mut actor_idx = self.actor_index.write();

        let epoch_ids = actor_idx.remove(actor_subject).unwrap_or_default();
        for &id in &epoch_ids {
            if let Some(ep) = epochs.get_mut(&id) {
                ep.is_valid = false;
            }
        }
        tracing::debug!(actor = actor_subject, count = epoch_ids.len(), "Revoked all epochs for actor");
        epoch_ids
    }
}

pub const ROOT_HISTORY_ALLOWED_OPERATIONS: &[&str] = &[
    "history.refresh",
    "history.summary",
    "history.page",
    "history.detail",
];

/// Authorization manager maintaining grants, security revisions, and checking actor authority.
#[derive(Debug)]
pub struct PluginAuthorizationService {
    epoch_registry: Arc<EpochRegistry>,
    security_revision: AtomicU64,
    grants: RwLock<HashMap<String, Vec<GrantKey>>>,
    owner_history_sources: RwLock<HashMap<String, OwnerHistorySource>>,
}

impl PluginAuthorizationService {
    pub fn new(epoch_registry: Arc<EpochRegistry>) -> Self {
        Self {
            epoch_registry,
            security_revision: AtomicU64::new(1),
            grants: RwLock::new(HashMap::new()),
            owner_history_sources: RwLock::new(HashMap::new()),
        }
    }

    pub fn epoch_registry(&self) -> &Arc<EpochRegistry> {
        &self.epoch_registry
    }

    pub fn security_revision(&self) -> u64 {
        self.security_revision.load(Ordering::SeqCst)
    }

    pub fn bump_security_revision(&self) -> u64 {
        self.security_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Set explicit grants for an actor subject.
    pub fn set_actor_grants(&self, actor_subject: &str, grants: Vec<GrantKey>) {
        self.grants.write().insert(actor_subject.to_string(), grants);
        self.bump_security_revision();
    }
    /// Set or update the owner-history source for an installation.
    pub fn set_owner_history_source(&self, installation_id: &str, source: Option<OwnerHistorySource>) {
        let mut sources = self.owner_history_sources.write();
        if let Some(src) = source {
            sources.insert(installation_id.to_string(), src);
        } else {
            sources.remove(installation_id);
        }
        self.bump_security_revision();
    }

    /// Get owner-history source for an installation if present.
    pub fn get_owner_history_source(&self, installation_id: &str) -> Option<OwnerHistorySource> {
        self.owner_history_sources.read().get(installation_id).cloned()
    }

    /// Check if installation has an owner-history source configured with authenticated read allowed.
    pub fn has_owner_history_source(&self, installation_id: &str) -> bool {
        self.owner_history_sources
            .read()
            .get(installation_id)
            .map_or(false, |s| s.all_authenticated_history_read)
    }
    /// Check if an actor has visibility of an installation for a target.
    pub fn has_actor_visibility(
        &self,
        actor_subject: &str,
        installation_id: &str,
        project_target: &str,
    ) -> bool {
        if self.has_owner_history_source(installation_id) {
            return true;
        }
        let grants_guard = self.grants.read();
        grants_guard
            .get(actor_subject)
            .is_some_and(|grants| {
                grants.iter().any(|g| {
                    g.installation_id == installation_id
                        && (g.configured_project_target == "*"
                            || g.configured_project_target == project_target)
                })
            })
    }


    /// Check if context open is authorized for actor, epoch, target, and installation.
    pub fn check_open_authorization(
        &self,
        actor: &AuthenticatedActor,
        epoch_id: u64,
        installation_id: &str,
        project_target: &str,
        scope_kind: Option<ContextScopeKind>,
        requested_ops: &[String],
        allow_current_policy: bool,
        no_auth: bool,
    ) -> Result<ConnectionEpoch, PluginError> {
        // Requirement 2: Deny all production plugin endpoints when --no-auth is active.
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        // Validate epoch and actor binding
        let epoch = self.epoch_registry.validate_epoch(epoch_id, &actor.subject)?;

        if scope_kind == Some(ContextScopeKind::HistoryRoot) {
            let sources = self.owner_history_sources.read();
            let source = sources.get(installation_id).ok_or_else(|| {
                PluginError::forbidden(format!(
                    "Installation '{installation_id}' does not have an owner-history root configured"
                ))
            })?;
            if !source.all_authenticated_history_read {
                return Err(PluginError::forbidden(format!(
                    "Installation '{installation_id}' does not permit authenticated history read"
                )));
            }

            let has_non_history_ops = requested_ops
                .iter()
                .any(|op| !ROOT_HISTORY_ALLOWED_OPERATIONS.contains(&op.as_str()));
            if has_non_history_ops || allow_current_policy {
                self.verify_grant(
                    &actor.subject,
                    installation_id,
                    project_target,
                    requested_ops,
                    allow_current_policy,
                )?;
            }
        } else {
            // Project mode: standard grant verification
            self.verify_grant(
                &actor.subject,
                installation_id,
                project_target,
                requested_ops,
                allow_current_policy,
            )?;
        }

        Ok(epoch)
    }

    /// Check if invoke is authorized. Repeated on EVERY invoke!
    pub fn check_invoke_authorization(
        &self,
        actor: &AuthenticatedActor,
        epoch_id: u64,
        installation_id: &str,
        project_target: &str,
        scope_kind: Option<ContextScopeKind>,
        operation: &str,
        allow_current_policy: bool,
        no_auth: bool,
    ) -> Result<ConnectionEpoch, PluginError> {
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        // Validate epoch
        let epoch = self.epoch_registry.validate_epoch(epoch_id, &actor.subject)?;

        if scope_kind == Some(ContextScopeKind::HistoryRoot) {
            let sources = self.owner_history_sources.read();
            let source = sources.get(installation_id).ok_or_else(|| {
                PluginError::context_revoked(format!(
                    "Installation '{installation_id}' owner-history root is revoked or not configured"
                ))
            })?;
            if !source.all_authenticated_history_read {
                return Err(PluginError::context_revoked(format!(
                    "Installation '{installation_id}' does not permit authenticated history read"
                )));
            }

            if !ROOT_HISTORY_ALLOWED_OPERATIONS.contains(&operation) {
                self.verify_grant(
                    &actor.subject,
                    installation_id,
                    project_target,
                    &[operation.to_string()],
                    allow_current_policy,
                )?;
            }
        } else {
            self.verify_grant(
                &actor.subject,
                installation_id,
                project_target,
                &[operation.to_string()],
                allow_current_policy,
            )?;
        }

        Ok(epoch)
    }

    fn verify_grant(
        &self,
        actor_subject: &str,
        installation_id: &str,
        project_target: &str,
        operations: &[String],
        allow_current_policy: bool,
    ) -> Result<(), PluginError> {
        let grants_guard = self.grants.read();
        let Some(actor_grants) = grants_guard.get(actor_subject) else {
            return Err(PluginError::forbidden(format!(
                "Actor '{actor_subject}' has no configured plugin grants (default deny)"
            )));
        };

        // Explicit grants configured: find matching grant
        let matching = actor_grants.iter().find(|g| {
            g.actor_subject == actor_subject
                && g.installation_id == installation_id
                && (g.configured_project_target == "*" || g.configured_project_target == project_target)
        });

        match matching {
            Some(grant) => {
                if allow_current_policy && !grant.allow_current_account_policy {
                    return Err(PluginError::forbidden(format!(
                        "Actor '{actor_subject}' does not have allowCurrentAccountPolicy grant"
                    )));
                }
                for op in operations {
                    if !grant.allowed_operations.contains(&"*".to_string())
                        && !grant.allowed_operations.contains(op)
                    {
                        return Err(PluginError::forbidden(format!(
                            "Operation '{op}' is not in allowed operations for actor '{actor_subject}'"
                        )));
                    }
                }
                Ok(())
            }
            None => Err(PluginError::forbidden(format!(
                "Actor '{actor_subject}' has no grant for installation '{installation_id}' on target '{project_target}'"
            ))),
        }
    }
}
