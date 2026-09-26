use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use parking_lot::Mutex;

use super::contract::budgets::{
    CONTEXT_IDLE_TTL_SECS, CRASH_WINDOW_SECS, MAX_ACTIVE_SCANS_PER_WORKER, MAX_CONTEXTS_PER_WORKER,
    MAX_CRASH_FAILURES, MAX_OPERATIONS_PER_CONTEXT, MAX_OPERATIONS_PER_WORKER,
    ORDINARY_REQUEST_TIMEOUT_SECS, SCAN_DEADLINE_SECS,
};
use super::contract::{
    CancelOutcome, ContextCloseParams, ContextCloseResult, ContextOpenParams, ContextOpenResult,
    ContextScopeDescriptor, ContextScopeKind, PluginInvokeParams, PluginInvokeResult,
    RequestCancelParams, RequestCancelResult,
};
use super::error::PluginError;
use super::registry::PluginRegistry;
use super::worker_process::{WorkerProcess, WorkerProcessConfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisorStatus {
    Stopped,
    Starting,
    Ready,
    Draining,
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct ContextEntry {
    pub context_id: String,
    pub installation_id: String,
    pub actor_subject: String,
    pub configured_project_target: String,
    pub scope: Option<ContextScopeDescriptor>,
    pub worktree_path: Option<String>,
    pub allowed_operations: Vec<String>,
    pub allow_current_account_policy: bool,
    pub activation_generation: u64,
    pub worker_generation: u64,
    pub binding_revision: u64,
    pub grant_revision: u64,
    pub in_flight: usize,
    pub expires_at_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrackedRequestStatus {
    Queued,
    InFlight,
    Settled,
}

struct SupervisorInner {
    status: SupervisorStatus,
    generation: u64,
    worker: Option<Arc<WorkerProcess>>,
    contexts: HashMap<String, ContextEntry>,
    in_flight_ops: usize,
    in_flight_long_running: usize,
    request_tracker: HashMap<String, TrackedRequestStatus>,
    crash_timestamps: VecDeque<Instant>,
}

pub struct InstallationSupervisor {
    pub installation_id: String,
    pub plugin_id: String,
    pub active_package_digest: String,
    pub active_version: String,
    pub activation_generation: u64,
    pub package_dir: PathBuf,
    pub entrypoint: PathBuf,
    pub node_bin: PathBuf,
    inner: Mutex<SupervisorInner>,
    registry: Arc<PluginRegistry>,
}

impl InstallationSupervisor {
    pub fn new(
        installation_id: String,
        plugin_id: String,
        active_package_digest: String,
        active_version: String,
        package_dir: PathBuf,
        entrypoint: PathBuf,
        node_bin: PathBuf,
        generation: u64,
        registry: Arc<PluginRegistry>,
    ) -> Self {
        Self {
            installation_id,
            plugin_id,
            active_package_digest,
            activation_generation: generation,
            active_version,
            package_dir,
            entrypoint,
            node_bin,
            inner: Mutex::new(SupervisorInner {
                status: SupervisorStatus::Stopped,
                generation,
                worker: None,
                contexts: HashMap::new(),
                in_flight_ops: 0,
                in_flight_long_running: 0,
                request_tracker: HashMap::new(),
                crash_timestamps: VecDeque::new(),
            }),
            registry,
        }
    }

    pub fn status(&self) -> SupervisorStatus {
        self.inner.lock().status.clone()
    }

    pub fn activation_generation(&self) -> u64 {
        self.activation_generation
    }
    pub fn generation(&self) -> u64 {
        self.inner.lock().generation
    }

    pub async fn activate(&self) -> Result<(), PluginError> {
        let (old_worker, config) = {
            let mut inner = self.inner.lock();
            if matches!(inner.status, SupervisorStatus::Ready) {
                return Ok(());
            }

            if let SupervisorStatus::Failed(reason) = &inner.status {
                return Err(PluginError::runner_unavailable(format!(
                    "Installation '{0}' is in failed state: {reason}. Explicit reactivation required.",
                    self.installation_id
                )));
            }

            Self::prune_crashes_locked(&mut inner);
            if inner.crash_timestamps.len() >= MAX_CRASH_FAILURES {
                let reason = format!(
                    "Exceeded {MAX_CRASH_FAILURES} crashes within {CRASH_WINDOW_SECS} seconds"
                );
                inner.status = SupervisorStatus::Failed(reason.clone());
                let _ = self
                    .registry
                    .record_installation_failure(&self.installation_id, &reason);
                return Err(PluginError::runner_unavailable(format!(
                    "Installation '{0}' failed: {reason}",
                    self.installation_id
                )));
            }

            let old_worker = inner.worker.take();
            inner.status = SupervisorStatus::Starting;
            inner.generation += 1;

            let config = WorkerProcessConfig {
                node_bin: self.node_bin.clone(),
                package_dir: self.package_dir.clone(),
                entrypoint: self.entrypoint.clone(),
                installation_id: self.installation_id.clone(),
                generation: inner.generation,
            };

            (old_worker, config)
        };

        if let Some(w) = old_worker {
            w.kill_process_group().await;
        }

        match WorkerProcess::spawn(config).await {
            Ok(worker) => {
                let mut inner = self.inner.lock();
                inner.worker = Some(worker);
                inner.status = SupervisorStatus::Ready;
                tracing::info!(
                    installation_id = %self.installation_id,
                    generation = inner.generation,
                    "Supervisor activated worker"
                );
                Ok(())
            }
            Err(e) => {
                let mut inner = self.inner.lock();
                inner.crash_timestamps.push_back(Instant::now());
                inner.status = SupervisorStatus::Stopped;
                Err(e)
            }
        }
    }

    pub async fn deactivate(&self) -> Result<(), PluginError> {
        let worker = {
            let mut inner = self.inner.lock();
            inner.status = SupervisorStatus::Draining;
            let w = inner.worker.take();
            inner.contexts.clear();
            inner.in_flight_ops = 0;
            inner.in_flight_long_running = 0;
            inner.status = SupervisorStatus::Stopped;
            w
        };

        if let Some(w) = worker {
            w.kill_process_group().await;
        }
        Ok(())
    }

    pub async fn drain_and_stop(&self, timeout: Duration) -> Result<(), PluginError> {
        let start = Instant::now();
        {
            let mut inner = self.inner.lock();
            inner.status = SupervisorStatus::Draining;
            inner.contexts.clear();
        }

        while start.elapsed() < timeout {
            let in_flight = {
                let inner = self.inner.lock();
                inner.in_flight_ops
            };
            if in_flight == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let worker = {
            let mut inner = self.inner.lock();
            inner.in_flight_ops = 0;
            inner.in_flight_long_running = 0;
            inner.status = SupervisorStatus::Stopped;
            inner.worker.take()
        };

        if let Some(w) = worker {
            w.kill_process_group().await;
        }
        Ok(())
    }

    pub async fn open_context(
        &self,
        params: ContextOpenParams,
    ) -> Result<ContextOpenResult, PluginError> {
        if params.activation_generation != self.activation_generation {
            return Err(PluginError::context_revoked(
                "Plugin activation changed before context open",
            ));
        }
        let inst = self.registry.get_installation(&self.installation_id)?.ok_or_else(|| {
            PluginError::context_revoked("Installation not found")
        })?;
        if !inst.enabled {
            return Err(PluginError::context_revoked("Installation is disabled"));
        }
        if params.scope.as_ref().map(|s| s.kind) == Some(ContextScopeKind::HistoryRoot) {
            let Some(owner_source) = &inst.owner_history_source else {
                return Err(PluginError::forbidden(format!(
                    "Installation '{}' has no owner-history source configured",
                    self.installation_id
                )));
            };
            if !owner_source.all_authenticated_history_read {
                return Err(PluginError::forbidden(format!(
                    "Installation '{}' does not permit authenticated history read",
                    self.installation_id
                )));
            }
            if let Some(req_scope) = &params.scope {
                if let Some(req_id) = &req_scope.root_identity {
                    if req_id != &owner_source.root_identity {
                        return Err(PluginError::forbidden("Scope root identity mismatch"));
                    }
                }
                if let Some(req_rev) = req_scope.source_revision {
                    if req_rev != owner_source.source_revision {
                        return Err(PluginError::forbidden("Scope source revision mismatch"));
                    }
                }
            }

            let root_path = std::path::Path::new(&owner_source.root_path);
            let symlink_meta = std::fs::symlink_metadata(root_path).map_err(|e| {
                PluginError::source_missing(format!("Owner history root path is unavailable: {e}"))
            })?;
            let canonical = root_path.canonicalize().map_err(|e| {
                PluginError::source_missing(format!("Owner history root path is unavailable: {e}"))
            })?;
            if canonical != root_path {
                return Err(PluginError::source_permission_denied(
                    "Owner history root path must be a canonical path without symlink components",
                ));
            }
            if symlink_meta.file_type().is_symlink() {
                return Err(PluginError::source_permission_denied(
                    "Owner history root path cannot be a symlink",
                ));
            }
            if !symlink_meta.is_dir() {
                return Err(PluginError::source_missing(
                    "Owner history root path is not a directory",
                ));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let current_uid = unsafe { libc::geteuid() };
                if symlink_meta.uid() != current_uid && current_uid != 0 {
                    return Err(PluginError::source_permission_denied(
                        "Owner history root directory is not owned by the runner owner UID",
                    ));
                }
            }
        } else {
            let has_valid_grant = inst.grants.iter().any(|g| {
                g.actor_subject == params.actor_subject
                    && (g.configured_project_target == "*" || g.configured_project_target == params.configured_project_target)
                    && (!params.allow_current_account_policy || g.allow_current_account_policy)
                    && params.allowed_operations.iter().all(|op| g.allowed_operations.contains(&"*".to_string()) || g.allowed_operations.contains(op))
            });
            if !has_valid_grant {
                return Err(PluginError::forbidden(format!(
                    "Actor '{}' has no active grant for installation '{}' on target '{}'",
                    params.actor_subject, self.installation_id, params.configured_project_target
                )));
            }
        }
        if matches!(self.status(), SupervisorStatus::Stopped) && inst.enabled {
            self.activate().await?;
        }
        let (worker, context_id, expires_at_secs) = {
            let mut inner = self.inner.lock();
            if !matches!(inner.status, SupervisorStatus::Ready) {
                return Err(PluginError::runner_unavailable(format!(
                    "Supervisor for installation '{}' is not ready (status: {:?})",
                    self.installation_id, inner.status
                )));
            }

            Self::prune_expired_contexts_locked(&mut inner);

            if inner.contexts.len() >= MAX_CONTEXTS_PER_WORKER {
                return Err(PluginError::overloaded(format!(
                    "Worker exceeded maximum active contexts limit of {MAX_CONTEXTS_PER_WORKER}"
                )));
            }

            let context_id = format!("ctx:{}:{}", self.installation_id, uuid::Uuid::new_v4());
            let expires_at_secs = (Utc::now().timestamp() as u64) + CONTEXT_IDLE_TTL_SECS;
            let generation = inner.generation;

            let entry = ContextEntry {
                context_id: context_id.clone(),
                installation_id: self.installation_id.clone(),
                actor_subject: params.actor_subject.clone(),
                configured_project_target: params.configured_project_target.clone(),
                scope: params.scope.clone(),
                worktree_path: params.worktree_path.clone(),
                allowed_operations: params.allowed_operations.clone(),
                allow_current_account_policy: params.allow_current_account_policy,
                activation_generation: self.activation_generation,
                worker_generation: generation,
                binding_revision: 1,
                grant_revision: 1,
                in_flight: 0,
                expires_at_secs,
            };

            inner.contexts.insert(context_id.clone(), entry);
            let worker = inner.worker.clone();
            (worker, context_id, expires_at_secs)
        };

        if let Some(worker) = worker {
            let worker_params = serde_json::json!({
                "contextId": context_id,
                "actorSubject": params.actor_subject,
                "installationId": self.installation_id,
                "configuredProjectTarget": params.configured_project_target,
                "scope": params.scope,
                "worktreePath": params.worktree_path,
                "allowedOperations": params.allowed_operations,
                "allowCurrentAccountPolicy": params.allow_current_account_policy,
                "apiConnectionEpoch": params.api_connection_epoch,
                "activationGeneration": self.activation_generation,
                "bindingRevision": 1,
                "grantRevision": 1,
            });
            let req_id = worker.generate_request_id();
            let worker_res = worker
                .send_request(
                    &req_id,
                    "context.open",
                    worker_params,
                    Duration::from_secs(5),
                )
                .await;
            if let Err(e) = worker_res {
                let mut inner = self.inner.lock();
                inner.contexts.remove(&context_id);
                return Err(e);
            }
        }

        let scope_kind = params.scope.as_ref().map(|s| s.kind);
        Ok(ContextOpenResult {
            context_id,
            scope_kind,
            binding_revision: 1,
            grant_revision: 1,
            activation_generation: self.activation_generation,
            expires_at: expires_at_secs,
        })
    }

    pub async fn close_context(
        &self,
        params: ContextCloseParams,
    ) -> Result<ContextCloseResult, PluginError> {
        let (removed, worker) = {
            let mut inner = self.inner.lock();
            let removed = inner.contexts.remove(&params.context_id).is_some();
            let worker = inner.worker.clone();
            (removed, worker)
        };
        if let Some(worker) = worker {
            let req_id = worker.generate_request_id();
            let _ = worker
                .send_request(
                    &req_id,
                    "context.close",
                    serde_json::json!({ "contextId": params.context_id, "reason": params.reason }),
                    Duration::from_secs(5),
                )
                .await;
        }
        Ok(ContextCloseResult { closed: removed })
    }

    pub async fn invoke(
        &self,
        request_id: &str,
        params: PluginInvokeParams,
    ) -> Result<PluginInvokeResult, PluginError> {
        let inst = self.registry.get_installation(&self.installation_id)?.ok_or_else(|| {
            PluginError::context_revoked("Installation not found")
        })?;
        if !inst.enabled {
            return Err(PluginError::context_revoked("Installation is disabled"));
        }

        let (ctx_actor, ctx_target, ctx_scope) = {
            let inner = self.inner.lock();
            let c = inner.contexts.get(&params.context_id).ok_or_else(|| {
                PluginError::invalid_input(format!("Context '{}' not found", params.context_id))
            })?;
            (c.actor_subject.clone(), c.configured_project_target.clone(), c.scope.clone())
        };

        if ctx_scope.as_ref().map(|s| s.kind) == Some(ContextScopeKind::HistoryRoot) {
            let Some(owner_source) = &inst.owner_history_source else {
                return Err(PluginError::context_revoked("Owner history root is revoked"));
            };
            if !owner_source.all_authenticated_history_read {
                return Err(PluginError::context_revoked("Authenticated history read is revoked"));
            }
            if let Some(req_id) = ctx_scope.as_ref().and_then(|s| s.root_identity.as_ref()) {
                if req_id != &owner_source.root_identity {
                    return Err(PluginError::context_revoked("Owner history root identity changed"));
                }
            }
            if let Some(rev) = ctx_scope.as_ref().and_then(|s| s.source_revision) {
                if rev != owner_source.source_revision {
                    return Err(PluginError::context_revoked("Owner history source revision changed"));
                }
            }
        } else {
            let has_valid_grant = inst.grants.iter().any(|g| {
                g.actor_subject == ctx_actor
                    && (g.configured_project_target == "*" || g.configured_project_target == ctx_target)
                    && (g.allowed_operations.contains(&"*".to_string()) || g.allowed_operations.contains(&params.operation))
            });
            if !has_valid_grant {
                return Err(PluginError::context_revoked(format!(
                    "Grant revoked for actor '{}' operation '{}' on target '{}'",
                    ctx_actor, params.operation, ctx_target
                )));
            }
        }
        let is_long_running =
            params.operation == "advisor.scan" || params.deadline_ms.map_or(false, |d| d > 10_000);

        if matches!(self.status(), SupervisorStatus::Stopped) && inst.enabled {
            self.activate().await?;
        }
        let (worker, req_timeout, req_payload) = {
            let mut inner = self.inner.lock();
            if !matches!(inner.status, SupervisorStatus::Ready) {
                return Err(PluginError::runner_unavailable(format!(
                    "Installation '{}' is not ready",
                    self.installation_id
                )));
            }

            let worker = inner.worker.clone().ok_or_else(|| {
                PluginError::runner_unavailable("Worker process reference missing")
            })?;

            if inner.in_flight_ops >= MAX_OPERATIONS_PER_WORKER {
                return Err(PluginError::overloaded(format!(
                    "Worker exceeded global concurrency limit of {MAX_OPERATIONS_PER_WORKER}"
                )));
            }

            if is_long_running && inner.in_flight_long_running >= MAX_ACTIVE_SCANS_PER_WORKER {
                return Err(PluginError::overloaded(
                    "Worker already executing maximum active declared long-running operations (1)",
                ));
            }

            let now_secs = Utc::now().timestamp() as u64;
            let context_expired = match inner.contexts.get(&params.context_id) {
                Some(c) => now_secs > c.expires_at_secs,
                None => {
                    return Err(PluginError::invalid_input(format!(
                        "Context '{}' not found or expired",
                        params.context_id
                    )))
                }
            };

            if context_expired {
                inner.contexts.remove(&params.context_id);
                return Err(PluginError::invalid_input("Context has expired"));
            }

            let generation = inner.generation;
            let ctx = inner.contexts.get_mut(&params.context_id).unwrap();
            if ctx.worker_generation != generation {
                return Err(PluginError::context_revoked(
                    "Context belongs to prior worker generation and has been revoked",
                ));
            }
            if !ctx.allowed_operations.contains(&params.operation) {
                return Err(PluginError::forbidden(format!(
                    "Operation '{}' is not permitted for context '{}'",
                    params.operation, params.context_id
                )));
            }

            if ctx.in_flight >= MAX_OPERATIONS_PER_CONTEXT {
                return Err(PluginError::overloaded(format!(
                    "Context exceeded per-context concurrency limit of {MAX_OPERATIONS_PER_CONTEXT}"
                )));
            }

            ctx.in_flight += 1;
            ctx.expires_at_secs = now_secs + CONTEXT_IDLE_TTL_SECS;

            inner.in_flight_ops += 1;
            if is_long_running {
                inner.in_flight_long_running += 1;
            }

            inner
                .request_tracker
                .insert(request_id.to_string(), TrackedRequestStatus::InFlight);

            let req_timeout = match params.deadline_ms {
                Some(ms) => Duration::from_millis(ms.min(SCAN_DEADLINE_SECS * 1000)),
                None => {
                    if is_long_running {
                        Duration::from_secs(SCAN_DEADLINE_SECS)
                    } else {
                        Duration::from_secs(ORDINARY_REQUEST_TIMEOUT_SECS)
                    }
                }
            };

            let req_payload = serde_json::json!({
                "contextId": params.context_id,
                "operation": params.operation,
                "payload": params.payload,
                "deadlineMs": req_timeout.as_millis() as u64,
            });

            (worker, req_timeout, req_payload)
        };

        // Network/pipe I/O awaited outside the supervisor lock!
        let invoke_res = worker
            .send_request(request_id, "plugin.invoke", req_payload, req_timeout)
            .await;

        let needs_crash_handling = {
            let mut inner = self.inner.lock();
            if let Some(c) = inner.contexts.get_mut(&params.context_id) {
                if c.in_flight > 0 {
                    c.in_flight -= 1;
                }
            }
            if inner.in_flight_ops > 0 {
                inner.in_flight_ops -= 1;
            }
            if is_long_running && inner.in_flight_long_running > 0 {
                inner.in_flight_long_running -= 1;
            }

            inner
                .request_tracker
                .insert(request_id.to_string(), TrackedRequestStatus::Settled);

            let is_deadline = matches!(&invoke_res, Err(e) if e.code == super::error::PluginErrorCode::DeadlineExceeded);
            is_deadline || (invoke_res.is_err() && !worker.is_alive())
        };

        if needs_crash_handling {
            self.handle_worker_crash().await;
        }

        invoke_res.map(|val| {
            if let Ok(res) = serde_json::from_value::<PluginInvokeResult>(val.clone()) {
                res
            } else {
                PluginInvokeResult { result: val }
            }
        })
    }

    pub async fn cancel_request(&self, params: RequestCancelParams) -> RequestCancelResult {
        let (status, worker_opt) = {
            let mut inner = self.inner.lock();
            let status = inner.request_tracker.get(&params.request_id).cloned();
            if let Some(TrackedRequestStatus::Queued) = &status {
                inner
                    .request_tracker
                    .insert(params.request_id.clone(), TrackedRequestStatus::Settled);
            }
            (status, inner.worker.clone())
        };

        match status {
            Some(TrackedRequestStatus::Queued) => RequestCancelResult {
                outcome: CancelOutcome::Accepted,
            },
            Some(TrackedRequestStatus::InFlight) => {
                if let Some(worker) = worker_opt {
                    let _ = worker
                        .send_notification(
                            "request.cancel",
                            serde_json::json!({
                                "contextId": params.context_id,
                                "requestId": params.request_id
                            }),
                        )
                        .await;
                }
                RequestCancelResult {
                    outcome: CancelOutcome::Accepted,
                }
            }
            Some(TrackedRequestStatus::Settled) => RequestCancelResult {
                outcome: CancelOutcome::AlreadySettled,
            },
            None => RequestCancelResult {
                outcome: CancelOutcome::Unknown,
            },
        }
    }

    async fn handle_worker_crash(&self) {
        tracing::warn!(
            installation_id = %self.installation_id,
            "Worker process crashed or became unavailable"
        );

        let old_worker = {
            let mut inner = self.inner.lock();
            inner.crash_timestamps.push_back(Instant::now());
            let w = inner.worker.take();
            inner.contexts.clear();
            inner.in_flight_ops = 0;
            inner.in_flight_long_running = 0;

            Self::prune_crashes_locked(&mut inner);
            if inner.crash_timestamps.len() >= MAX_CRASH_FAILURES {
                let reason = format!(
                    "Exceeded {MAX_CRASH_FAILURES} crashes within {CRASH_WINDOW_SECS} seconds"
                );
                inner.status = SupervisorStatus::Failed(reason.clone());
                let _ = self
                    .registry
                    .record_installation_failure(&self.installation_id, &reason);
            } else {
                inner.status = SupervisorStatus::Stopped;
            }
            w
        };

        if let Some(w) = old_worker {
            w.kill_process_group().await;
        }
    }

    fn prune_crashes_locked(inner: &mut SupervisorInner) {
        let window = Duration::from_secs(CRASH_WINDOW_SECS);
        let now = Instant::now();
        while let Some(t) = inner.crash_timestamps.front() {
            if now.duration_since(*t) > window {
                inner.crash_timestamps.pop_front();
            } else {
                break;
            }
        }
    }

    fn prune_expired_contexts_locked(inner: &mut SupervisorInner) {
        let now_secs = Utc::now().timestamp() as u64;
        inner
            .contexts
            .retain(|_, entry| entry.expires_at_secs > now_secs);
    }
}

pub fn parse_context_installation_id(context_id: &str) -> Option<&str> {
    if let Some(rest) = context_id.strip_prefix("ctx:") {
        rest.rsplit_once(':').map(|(id, _)| id)
    } else if let Some(rest) = context_id.strip_prefix("ctx-") {
        rest.rsplit_once('-').map(|(id, _)| id)
    } else {
        None
    }
}

pub struct SupervisorManager {
    supervisors: tokio::sync::Mutex<HashMap<String, Arc<InstallationSupervisor>>>,
    registry: Arc<PluginRegistry>,
    node_bin: PathBuf,
}

impl SupervisorManager {
    pub fn new(registry: Arc<PluginRegistry>, node_bin: PathBuf) -> Self {
        Self {
            supervisors: tokio::sync::Mutex::new(HashMap::new()),
            registry,
            node_bin,
        }
    }

    pub async fn get_or_create(
        &self,
        installation_id: &str,
    ) -> Result<Arc<InstallationSupervisor>, PluginError> {
        let mut map = self.supervisors.lock().await;
        if let Some(sup) = map.get(installation_id) {
            if matches!(sup.status(), SupervisorStatus::Stopped) {
                sup.activate().await?;
            }
            return Ok(sup.clone());
        }

        let inst = self
            .registry
            .get_installation(installation_id)?
            .ok_or_else(|| {
                PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
            })?;

        if !inst.enabled {
            return Err(PluginError::forbidden(format!(
                "Installation '{installation_id}' is disabled"
            )));
        }

        let state = self.registry.read_state()?;
        let pkg_key = format!(
            "{}@{}#{}",
            inst.plugin_id, inst.active_version, inst.active_package_digest
        );
        let pkg = state.packages.get(&pkg_key).ok_or_else(|| {
            PluginError::runner_unavailable(format!("Package '{pkg_key}' missing from registry"))
        })?;

        let package_dir = self.registry.layout.package_dir(
            &inst.plugin_id,
            &inst.active_version,
            &inst.active_package_digest,
        );

        let entrypoint = PathBuf::from(&pkg.entrypoints.backend.entry);

        let sup = Arc::new(InstallationSupervisor::new(
            inst.installation_id.clone(),
            inst.plugin_id.clone(),
            inst.active_package_digest.clone(),
            inst.active_version.clone(),
            package_dir,
            entrypoint,
            self.node_bin.clone(),
            inst.activation_generation,
            self.registry.clone(),
        ));
        sup.activate().await?;


        map.insert(installation_id.to_string(), sup.clone());
        Ok(sup)
    }

    pub async fn activate_candidate(
        &self,
        installation_id: &str,
        plugin_id: &str,
        version: &str,
        digest: &str,
        generation: u64,
        entrypoint: &str,
    ) -> Result<Arc<InstallationSupervisor>, PluginError> {
        let package_dir = self.registry.layout.package_dir(plugin_id, version, digest);
        let entrypoint_path = PathBuf::from(entrypoint);

        let sup = Arc::new(InstallationSupervisor::new(
            installation_id.to_string(),
            plugin_id.to_string(),
            digest.to_string(),
            version.to_string(),
            package_dir,
            entrypoint_path,
            self.node_bin.clone(),
            generation,
            self.registry.clone(),
        ));

        sup.activate().await?;

        let mut map = self.supervisors.lock().await;
        map.insert(installation_id.to_string(), sup.clone());
        Ok(sup)
    }

    pub async fn get_by_context(
        &self,
        context_id: &str,
    ) -> Result<Arc<InstallationSupervisor>, PluginError> {
        let inst_id = parse_context_installation_id(context_id).ok_or_else(|| {
            PluginError::invalid_input(format!("Malformed context ID '{context_id}'"))
        })?;
        self.get_or_create(inst_id).await
    }

    pub async fn deactivate(&self, installation_id: &str) -> Result<(), PluginError> {
        let sup = {
            let map = self.supervisors.lock().await;
            map.get(installation_id).cloned()
        };

        if let Some(s) = sup {
            s.deactivate().await?;
        }
        Ok(())
    }

    pub async fn drain_and_stop(&self, installation_id: &str) -> Result<(), PluginError> {
        let sup = {
            let mut map = self.supervisors.lock().await;
            map.remove(installation_id)
        };
        if let Some(s) = sup {
            s.drain_and_stop(Duration::from_millis(500)).await?;
        }
        Ok(())
    }

    pub async fn get_status(&self, installation_id: &str) -> String {
        let map = self.supervisors.lock().await;
        if let Some(s) = map.get(installation_id) {
            match s.status() {
                SupervisorStatus::Ready => "ready".to_string(),
                SupervisorStatus::Starting => "starting".to_string(),
                SupervisorStatus::Draining => "draining".to_string(),
                SupervisorStatus::Stopped => "stopped".to_string(),
                SupervisorStatus::Failed(e) => format!("failed: {e}"),
            }
        } else {
            "stopped".to_string()
        }
    }

    pub async fn deactivate_all(&self) {
        let map = self.supervisors.lock().await;
        for s in map.values() {
            let _ = s.deactivate().await;
        }
    }

    pub async fn cancel_request(&self, params: RequestCancelParams) -> RequestCancelResult {
        let supervisors = {
            let map = self.supervisors.lock().await;
            map.values().cloned().collect::<Vec<_>>()
        };
        for s in supervisors {
            let res = s.cancel_request(params.clone()).await;
            if res.outcome != CancelOutcome::Unknown {
                return res;
            }
        }
        RequestCancelResult {
            outcome: CancelOutcome::Unknown,
        }
    }
}
