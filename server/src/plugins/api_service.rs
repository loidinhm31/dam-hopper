use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;

use super::authorization::PluginAuthorizationService;
use super::contexts::{ContextRecord, PluginContextTable};
use super::contract::budgets::MAX_PAYLOAD_BYTES;
use super::contract::{
    ContextCloseResult, ContextOpenParams, ContextOpenResult,
    PluginInvokeParams, PluginMetadataItem, RequestCancelResult,
};
use super::error::PluginError;
use super::runner_client::RunnerClient;
use crate::api::auth::AuthenticatedActor;
use crate::workspace_target::{ProjectTargetRef, WorkspaceTargetResolver};

pub struct PluginApiService {
    runner_client: Arc<RunnerClient>,
    auth_service: Arc<PluginAuthorizationService>,
    context_table: Arc<PluginContextTable>,
    workspace_target_resolver: WorkspaceTargetResolver,
    last_runner_generation: AtomicU64,
    cached_plugins: RwLock<Option<(u64, Vec<PluginMetadataItem>)>>,
}

impl PluginApiService {
    pub fn new(
        runner_client: Arc<RunnerClient>,
        auth_service: Arc<PluginAuthorizationService>,
        context_table: Arc<PluginContextTable>,
        workspace_target_resolver: WorkspaceTargetResolver,
    ) -> Self {
        let initial_gen = runner_client.generation();
        Self {
            runner_client,
            auth_service,
            context_table,
            workspace_target_resolver,
            last_runner_generation: AtomicU64::new(initial_gen),
            cached_plugins: RwLock::new(None),
        }
    }

    pub fn runner_client(&self) -> &Arc<RunnerClient> {
        &self.runner_client
    }

    pub fn auth_service(&self) -> &Arc<PluginAuthorizationService> {
        &self.auth_service
    }

    pub fn context_table(&self) -> &Arc<PluginContextTable> {
        &self.context_table
    }

    /// Check if runner generation changed (reconnect occurred), and invalidate caches and revoke contexts if so.
    pub fn check_runner_generation(&self) {
        let current_gen = self.runner_client.generation();
        let old_gen = self.last_runner_generation.swap(current_gen, Ordering::SeqCst);
        if old_gen > 0 && current_gen != old_gen {
            tracing::warn!(
                old_generation = old_gen,
                new_generation = current_gen,
                "Runner client generation changed (reconnect detected); revoking all contexts"
            );
            *self.cached_plugins.write() = None;
            self.context_table.revoke_all();
        }
    }

    /// List plugins visible to the authenticated actor for a target.
    pub async fn list_plugins(
        &self,
        actor: &AuthenticatedActor,
        target_ref: &ProjectTargetRef,
        no_auth: bool,
    ) -> Result<Vec<PluginMetadataItem>, PluginError> {
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        self.check_runner_generation();

        // Query runner client for plugins
        let list_res = self.runner_client.list_plugins(false).await?;
        let plugins = list_res.plugins;

        // Visibility filter: include only plugins for which the actor has some grant or default visibility
        let target_str = &target_ref.project;
        let visible = plugins
            .into_iter()
            .filter(|p| {
                self.auth_service
                    .has_actor_visibility(&actor.subject, &p.id, target_str)
            })
            .collect();

        Ok(visible)
    }

    /// Open an authorized connection-bound plugin context.
    pub async fn open_context(
        &self,
        actor: &AuthenticatedActor,
        epoch_id: u64,
        installation_id: &str,
        target_ref: &ProjectTargetRef,
        configured_project_root: &Path,
        allowed_operations: Vec<String>,
        allow_current_account_policy: bool,
        no_auth: bool,
    ) -> Result<ContextOpenResult, PluginError> {
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        self.check_runner_generation();

        let target_str = target_ref.project.clone();

        // 1. Authorize actor and epoch against grants
        self.auth_service.check_open_authorization(
            actor,
            epoch_id,
            installation_id,
            &target_str,
            &allowed_operations,
            allow_current_account_policy,
            no_auth,
        )?;

        // 2. Resolve project target strictly using WorkspaceTargetResolver
        let resolved_target = self
            .workspace_target_resolver
            .resolve(target_ref, configured_project_root)
            .await
            .map_err(|e| {
                PluginError::invalid_input(format!(
                    "Failed to resolve project target '{}/{}': {e}",
                    target_ref.project,
                    target_ref.worktree_path.as_deref().unwrap_or("")
                ))
            })?;

        // 3. Open context on the runner
        let activation_gen = self.runner_client.generation();
        let open_params = ContextOpenParams {
            actor_subject: actor.subject.clone(),
            installation_id: installation_id.to_string(),
            configured_project_target: resolved_target.target_path().to_string_lossy().to_string(),
            worktree_path: target_ref.worktree_path.clone(),
            allowed_operations: allowed_operations.clone(),
            allow_current_account_policy,
            api_connection_epoch: epoch_id,
            activation_generation: activation_gen,
        };

        let res = self.runner_client.open_context(open_params).await?;

        // 4. Record context in local context table
        let record = ContextRecord {
            context_id: res.context_id.clone(),
            actor_subject: actor.subject.clone(),
            api_connection_epoch: epoch_id,
            installation_id: installation_id.to_string(),
            configured_project_target: target_str,
            resolved_root: resolved_target.target_path().to_path_buf(),
            allowed_operations,
            allow_current_account_policy,
            binding_revision: res.binding_revision,
            grant_revision: res.grant_revision,
            activation_generation: res.activation_generation,
            in_flight: 0,
            expires_at_secs: res.expires_at,
        };

        self.context_table.insert(record)?;

        Ok(res)
    }

    /// Invoke a plugin operation with re-authorization and concurrency tracking.
    pub async fn invoke(
        &self,
        actor: &AuthenticatedActor,
        epoch_id: u64,
        context_id: &str,
        operation: &str,
        payload: serde_json::Value,
        deadline_ms: Option<u64>,
        no_auth: bool,
    ) -> Result<serde_json::Value, PluginError> {
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        self.check_runner_generation();

        // Enforce generic request payload ceiling
        let payload_size = serde_json::to_vec(&payload)
            .map(|v| v.len())
            .unwrap_or(0);
        if payload_size > MAX_PAYLOAD_BYTES {
            return Err(PluginError::invalid_input(format!(
                "Payload size ({payload_size} bytes) exceeds maximum ceiling of {MAX_PAYLOAD_BYTES} bytes"
            )));
        }

        // 1. Begin invoke in local context table (checks concurrency limits, actor, epoch, operation)
        let ctx = self.context_table.begin_invoke(
            context_id,
            &actor.subject,
            epoch_id,
            operation,
        )?;

        // Ensure in_flight counter is decremented when scope exits
        struct InvokeGuard<'a> {
            table: &'a PluginContextTable,
            ctx_id: &'a str,
        }
        impl<'a> Drop for InvokeGuard<'a> {
            fn drop(&mut self) {
                self.table.finish_invoke(self.ctx_id);
            }
        }
        let _guard = InvokeGuard {
            table: &self.context_table,
            ctx_id: context_id,
        };

        // 2. Recheck authorization on EVERY invoke!
        self.auth_service.check_invoke_authorization(
            actor,
            epoch_id,
            &ctx.installation_id,
            &ctx.configured_project_target,
            operation,
            ctx.allow_current_account_policy,
            no_auth,
        )?;

        // 3. Forward invoke to runner
        let invoke_params = PluginInvokeParams {
            context_id: context_id.to_string(),
            operation: operation.to_string(),
            payload,
            deadline_ms,
        };

        let invoke_res = self.runner_client.invoke(invoke_params).await?;
        Ok(invoke_res.result)
    }

    /// Cancel a running request on a context.
    pub async fn cancel_request(
        &self,
        actor: &AuthenticatedActor,
        epoch_id: u64,
        context_id: &str,
        request_id: &str,
        no_auth: bool,
    ) -> Result<RequestCancelResult, PluginError> {
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        self.check_runner_generation();

        // Validate context belongs to this actor and epoch
        let ctx = self.context_table.get(context_id).ok_or_else(|| {
            PluginError::context_revoked(format!("Context '{context_id}' not found or expired"))
        })?;

        if ctx.actor_subject != actor.subject {
            return Err(PluginError::unauthorized(format!(
                "Context '{context_id}' belongs to '{}', not '{}'",
                ctx.actor_subject, actor.subject
            )));
        }

        if ctx.api_connection_epoch != epoch_id {
            return Err(PluginError::unauthorized(format!(
                "Context '{context_id}' was opened under epoch {}, cannot cancel with epoch {epoch_id}",
                ctx.api_connection_epoch
            )));
        }

        self.runner_client.cancel_request(context_id, request_id).await
    }

    /// Close a context idempotently.
    pub async fn close_context(
        &self,
        actor: &AuthenticatedActor,
        epoch_id: u64,
        context_id: &str,
        no_auth: bool,
    ) -> Result<ContextCloseResult, PluginError> {
        if no_auth {
            return Err(PluginError::unauthorized(
                "Plugin operations are strictly denied in --no-auth mode",
            ));
        }

        // Close in local table first
        let removed = self
            .context_table
            .close(context_id, &actor.subject, epoch_id)?;

        if removed.is_some() {
            // Forward close to runner (best effort)
            let _ = self.runner_client.close_context(context_id, Some("Closed by client request".to_string())).await;
        }

        Ok(ContextCloseResult { closed: true })
    }

    /// Revoke epoch and all its owned contexts.
    pub async fn revoke_epoch(&self, epoch_id: u64) {
        self.auth_service.epoch_registry().revoke_epoch(epoch_id);
        let revoked = self.context_table.revoke_by_epoch(epoch_id);
        for ctx in revoked {
            let _ = self.runner_client.close_context(&ctx.context_id, Some("Epoch revoked on connection teardown".to_string())).await;
        }
    }

    /// Revoke actor and all their owned contexts.
    pub async fn revoke_actor(&self, actor_subject: &str) {
        self.auth_service.epoch_registry().revoke_by_actor(actor_subject);
        let revoked = self.context_table.revoke_by_actor(actor_subject);
        for ctx in revoked {
            let _ = self.runner_client.close_context(&ctx.context_id, Some(format!("Actor '{actor_subject}' logged out or disabled"))).await;
        }
    }
}
