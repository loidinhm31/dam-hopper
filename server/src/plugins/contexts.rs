use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;

use super::contract::budgets::{
    CONTEXT_IDLE_TTL_SECS, MAX_CONTEXTS_PER_WORKER, MAX_OPERATIONS_PER_CONTEXT,
    MAX_OPERATIONS_PER_WORKER,
};
use super::error::PluginError;

#[derive(Debug, Clone)]
pub struct ContextRecord {
    pub context_id: String,
    pub actor_subject: String,
    pub api_connection_epoch: u64,
    pub installation_id: String,
    pub configured_project_target: String,
    pub resolved_root: PathBuf,
    pub allowed_operations: Vec<String>,
    pub allow_current_account_policy: bool,
    pub binding_revision: u64,
    pub grant_revision: u64,
    pub activation_generation: u64,
    pub in_flight: usize,
    pub expires_at_secs: u64,
}

#[derive(Debug, Default)]
pub struct PluginContextTable {
    contexts: RwLock<HashMap<String, ContextRecord>>,
}

impl PluginContextTable {
    pub fn new() -> Self {
        Self::default()
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Insert a newly opened context, enforcing per-installation limits.
    pub fn insert(&self, record: ContextRecord) -> Result<(), PluginError> {
        let mut table = self.contexts.write();
        let now = Self::now_secs();

        // Evict expired contexts for this installation first
        table.retain(|_, c| c.expires_at_secs > now);

        let count_for_installation = table
            .values()
            .filter(|c| c.installation_id == record.installation_id)
            .count();

        if count_for_installation >= MAX_CONTEXTS_PER_WORKER {
            return Err(PluginError::overloaded(format!(
                "Worker context ceiling reached: maximum {MAX_CONTEXTS_PER_WORKER} contexts allowed for installation '{}'",
                record.installation_id
            )));
        }

        table.insert(record.context_id.clone(), record);
        Ok(())
    }

    /// Get context by ID if it exists and has not expired.
    pub fn get(&self, context_id: &str) -> Option<ContextRecord> {
        let now = Self::now_secs();
        let table = self.contexts.read();
        table.get(context_id).filter(|c| c.expires_at_secs > now).cloned()
    }

    /// Check authorization, expiry, and concurrency ceilings before an invoke.
    /// Increments in_flight and resets idle TTL.
    pub fn begin_invoke(
        &self,
        context_id: &str,
        expected_actor: &str,
        expected_epoch: u64,
        operation: &str,
    ) -> Result<ContextRecord, PluginError> {
        let mut table = self.contexts.write();
        let now = Self::now_secs();

        let ctx = table.get(context_id).cloned().ok_or_else(|| {
            PluginError::context_revoked(format!("Context '{context_id}' not found or closed"))
        })?;

        if now >= ctx.expires_at_secs {
            table.remove(context_id);
            return Err(PluginError::context_revoked(format!(
                "Context '{context_id}' has expired"
            )));
        }

        if ctx.actor_subject != expected_actor {
            return Err(PluginError::unauthorized(format!(
                "Context '{context_id}' belongs to actor '{}', not '{expected_actor}'",
                ctx.actor_subject
            )));
        }

        if ctx.api_connection_epoch != expected_epoch {
            return Err(PluginError::unauthorized(format!(
                "Context '{context_id}' was opened under epoch {}, request presented epoch {expected_epoch}",
                ctx.api_connection_epoch
            )));
        }

        // Operation authorization
        if !ctx.allowed_operations.contains(&"*".to_string())
            && !ctx.allowed_operations.contains(&operation.to_string())
        {
            return Err(PluginError::forbidden(format!(
                "Operation '{operation}' is not permitted for context '{context_id}'"
            )));
        }

        if operation == "policy.readCurrent" && !ctx.allow_current_account_policy {
            return Err(PluginError::forbidden(format!(
                "Context '{context_id}' does not allow account-wide policy read"
            )));
        }

        // Context concurrency ceiling (4 ops / context)
        if ctx.in_flight >= MAX_OPERATIONS_PER_CONTEXT {
            return Err(PluginError::overloaded(format!(
                "Context '{context_id}' reached concurrency limit of {MAX_OPERATIONS_PER_CONTEXT} in-flight operations"
            )));
        }

        // Installation concurrency ceiling (16 ops / worker)
        let worker_in_flight: usize = table
            .values()
            .filter(|c| c.installation_id == ctx.installation_id)
            .map(|c| c.in_flight)
            .sum();

        if worker_in_flight >= MAX_OPERATIONS_PER_WORKER {
            return Err(PluginError::overloaded(format!(
                "Installation '{}' reached concurrency limit of {MAX_OPERATIONS_PER_WORKER} in-flight operations",
                ctx.installation_id
            )));
        }

        let ctx_mut = table.get_mut(context_id).unwrap();
        ctx_mut.in_flight += 1;
        ctx_mut.expires_at_secs = now + CONTEXT_IDLE_TTL_SECS;

        Ok(ctx_mut.clone())
    }
    pub fn finish_invoke(&self, context_id: &str) {
        let mut table = self.contexts.write();
        if let Some(ctx) = table.get_mut(context_id) {
            if ctx.in_flight > 0 {
                ctx.in_flight -= 1;
            }
        }
    }

    /// Close context idempotently. Returns the closed record if found.
    pub fn close(
        &self,
        context_id: &str,
        expected_actor: &str,
        expected_epoch: u64,
    ) -> Result<Option<ContextRecord>, PluginError> {
        let mut table = self.contexts.write();
        if let Some(ctx) = table.get(context_id) {
            if ctx.actor_subject != expected_actor {
                return Err(PluginError::unauthorized(format!(
                    "Cannot close context '{context_id}': belongs to '{}', not '{expected_actor}'",
                    ctx.actor_subject
                )));
            }
            if ctx.api_connection_epoch != expected_epoch {
                return Err(PluginError::unauthorized(format!(
                    "Cannot close context '{context_id}': epoch mismatch (expected {}, got {expected_epoch})",
                    ctx.api_connection_epoch
                )));
            }
            let removed = table.remove(context_id);
            Ok(removed)
        } else {
            Ok(None)
        }
    }

    /// Revoke all contexts belonging to an API connection epoch.
    pub fn revoke_by_epoch(&self, epoch: u64) -> Vec<ContextRecord> {
        let mut table = self.contexts.write();
        let mut revoked = Vec::new();
        table.retain(|_, ctx| {
            if ctx.api_connection_epoch == epoch {
                revoked.push(ctx.clone());
                false
            } else {
                true
            }
        });
        if !revoked.is_empty() {
            tracing::info!(epoch = epoch, count = revoked.len(), "Revoked contexts for epoch");
        }
        revoked
    }

    /// Revoke all contexts for an actor subject.
    pub fn revoke_by_actor(&self, actor_subject: &str) -> Vec<ContextRecord> {
        let mut table = self.contexts.write();
        let mut revoked = Vec::new();
        table.retain(|_, ctx| {
            if ctx.actor_subject == actor_subject {
                revoked.push(ctx.clone());
                false
            } else {
                true
            }
        });
        if !revoked.is_empty() {
            tracing::info!(actor = actor_subject, count = revoked.len(), "Revoked contexts for actor");
        }
        revoked
    }

    /// Revoke all contexts for an installation (e.g. disabled, updated, uninstalled).
    pub fn revoke_by_installation(&self, installation_id: &str) -> Vec<ContextRecord> {
        let mut table = self.contexts.write();
        let mut revoked = Vec::new();
        table.retain(|_, ctx| {
            if ctx.installation_id == installation_id {
                revoked.push(ctx.clone());
                false
            } else {
                true
            }
        });
        if !revoked.is_empty() {
            tracing::info!(
                installation = installation_id,
                count = revoked.len(),
                "Revoked contexts for installation"
            );
        }
        revoked
    }

    /// Revoke all contexts for a configured target (e.g. project removed or pruned).
    pub fn revoke_by_target(&self, project_target: &str) -> Vec<ContextRecord> {
        let mut table = self.contexts.write();
        let mut revoked = Vec::new();
        table.retain(|_, ctx| {
            if ctx.configured_project_target == project_target {
                revoked.push(ctx.clone());
                false
            } else {
                true
            }
        });
        if !revoked.is_empty() {
            tracing::info!(
                target = project_target,
                count = revoked.len(),
                "Revoked contexts for project target"
            );
        }
        revoked
    }

    /// Clear all contexts on API shutdown or runner reconnect.
    pub fn revoke_all(&self) -> Vec<ContextRecord> {
        let mut table = self.contexts.write();
        let records: Vec<ContextRecord> = table.drain().map(|(_, v)| v).collect();
        if !records.is_empty() {
            tracing::info!(count = records.len(), "Revoked all plugin contexts");
        }
        records
    }

    /// Sweep expired contexts.
    pub fn cleanup_expired(&self) -> Vec<ContextRecord> {
        let now = Self::now_secs();
        let mut table = self.contexts.write();
        let mut expired = Vec::new();
        table.retain(|_, ctx| {
            if ctx.expires_at_secs <= now {
                expired.push(ctx.clone());
                false
            } else {
                true
            }
        });
        expired
    }
}
