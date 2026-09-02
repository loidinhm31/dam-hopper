use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::RwLock;

use super::error::WorkflowError;
use super::model::WorkflowWorkspace;
use super::store::{WorkflowStore, WorkflowStoreError};
use crate::config::DamHopperConfig;
use crate::diagnostics::DiagnosticStore;
use crate::pty::PtySessionManager;
use crate::workspace_target::{
    ProjectTargetRef, ResolvedProjectTarget, WorkspaceTargetResolver,
};

const MAX_DIAGNOSTIC_DURATION_MS: u128 = 60_000;
const MAX_DIAGNOSTIC_COUNT: usize = 1_000;

#[derive(Clone)]
pub struct WorkflowService {
    pub store: WorkflowStore,
    pub config: Arc<RwLock<DamHopperConfig>>,
    pub resolver: WorkspaceTargetResolver,
    pub workspace_guard: Arc<RwLock<()>>,
    pub pty_manager: PtySessionManager,
    pub diagnostics: DiagnosticStore,
}

fn bounded_duration(started: Instant) -> String {
    started
        .elapsed()
        .as_millis()
        .min(MAX_DIAGNOSTIC_DURATION_MS)
        .to_string()
}

fn bounded_count(count: usize) -> String {
    count.min(MAX_DIAGNOSTIC_COUNT).to_string()
}

fn outcome(error: &WorkflowError) -> &'static str {
    match error {
        WorkflowError::NotFound => "not_found",
        WorkflowError::Conflict => "conflict",
        WorkflowError::InvalidTransition => "invalid_transition",
        WorkflowError::TargetUnavailable => "target_unavailable",
        WorkflowError::LimitExceeded => "limit_exceeded",
        WorkflowError::StoreUnavailable => "store_unavailable",
        WorkflowError::InvalidRequest => "invalid_request",
    }
}

impl WorkflowService {
    pub fn new(
        store: WorkflowStore,
        config: Arc<RwLock<DamHopperConfig>>,
        resolver: WorkspaceTargetResolver,
        workspace_guard: Arc<RwLock<()>>,
        pty_manager: PtySessionManager,
    ) -> Self {
        Self::new_with_diagnostics(
            store,
            config,
            resolver,
            workspace_guard,
            pty_manager,
            DiagnosticStore::default(),
        )
    }

    pub fn new_with_diagnostics(
        store: WorkflowStore,
        config: Arc<RwLock<DamHopperConfig>>,
        resolver: WorkspaceTargetResolver,
        workspace_guard: Arc<RwLock<()>>,
        pty_manager: PtySessionManager,
        diagnostics: DiagnosticStore,
    ) -> Self {
        Self {
            store,
            config,
            resolver,
            workspace_guard,
            pty_manager,
            diagnostics,
        }
    }
    fn record_operation(
        &self,
        operation: &'static str,
        result: Result<(), &WorkflowError>,
        started: Instant,
        row_count: usize,
        event_count: usize,
    ) {
        let (outcome_label, availability) = match result {
            Ok(()) => ("ok", "available"),
            Err(error) => (
                outcome(error),
                if matches!(error, WorkflowError::StoreUnavailable) {
                    "unavailable"
                } else {
                    "available"
                },
            ),
        };
        self.diagnostics.record_terminal_event(
            "workflow",
            "workflow.operation",
            std::collections::BTreeMap::from([
                ("operation".to_string(), operation.to_string()),
                ("outcome".to_string(), outcome_label.to_string()),
                ("duration_ms".to_string(), bounded_duration(started)),
                ("row_count".to_string(), bounded_count(row_count)),
                ("event_count".to_string(), bounded_count(event_count)),
                (
                    "count".to_string(),
                    bounded_count(row_count.saturating_add(event_count)),
                ),
                ("store_availability".to_string(), availability.to_string()),
            ]),
        );
    }
    /// Extract current workspace canonical locator, name, and configured projects.
    pub async fn scope(&self) -> Result<(String, String, Vec<(String, PathBuf)>), WorkflowError> {
        let started = Instant::now();
        let cfg = self.config.read().await;
        let result = cfg
            .config_path
            .to_str()
            .map(|locator| {
                let projects: Vec<(String, PathBuf)> = cfg
                    .projects
                    .iter()
                    .map(|p| (p.name.clone(), PathBuf::from(&p.path)))
                    .collect();
                (locator.to_owned(), cfg.workspace.name.clone(), projects)
            })
            .ok_or(WorkflowError::StoreUnavailable);
        self.record_operation(
            "scope",
            result.as_ref().map(|_| ()).map_err(|error| error),
            started,
            result.as_ref().map(|(_, _, projects)| projects.len()).unwrap_or(0),
            0,
        );
        result
    }

    /// Resolve or lazily initialize the current workspace entity.
    pub async fn workspace(&self, now: u64) -> Result<WorkflowWorkspace, WorkflowError> {
        let (locator, name, _) = self.scope().await?;
        let started = Instant::now();
        let result = self
            .store_call(move |s| s.get_or_create_workspace(&locator, &name, now))
            .await;
        self.record_operation(
            "workspace",
            result.as_ref().map(|_| ()).map_err(|error| error),
            started,
            if result.is_ok() { 1 } else { 0 },
            0,
        );
        result
    }

    /// Resolve a target reference against current configured projects.
    pub async fn resolve_target(
        &self,
        target: &ProjectTargetRef,
    ) -> Result<ResolvedProjectTarget, WorkflowError> {
        let started = Instant::now();
        let result = async {
            let (_, _, projects) = self.scope().await?;
            let root = projects
                .into_iter()
                .find(|(n, _)| n == &target.project)
                .map(|(_, p)| p)
                .ok_or(WorkflowError::NotFound)?;
            self.resolver
                .resolve(target, &root)
                .await
                .map_err(|e| match e {
                    crate::error::AppError::WorkspaceTarget(t) => WorkflowError::from(t),
                    _ => WorkflowError::TargetUnavailable,
                })
        }
        .await;
        self.record_operation(
            "target_resolve",
            result.as_ref().map(|_| ()).map_err(|error| error),
            started,
            if result.is_ok() { 1 } else { 0 },
            0,
        );
        result
    }

    /// Execute a blocking store operation on the Tokio blocking pool.
    pub async fn store_call<T, F>(&self, f: F) -> Result<T, WorkflowError>
    where
        T: Send + 'static,
        F: FnOnce(WorkflowStore) -> Result<T, WorkflowStoreError> + Send + 'static,
    {
        let started = Instant::now();
        let store = self.store.clone();
        let result = match tokio::task::spawn_blocking(move || f(store)).await {
            Ok(result) => result.map_err(WorkflowError::from),
            Err(_) => Err(WorkflowError::StoreUnavailable),
        };
        self.record_operation(
            "store_call",
            result.as_ref().map(|_| ()).map_err(|error| error),
            started,
            0,
            0,
        );
        result
    }

    /// Run bounded retention purge for expired events and soft-deleted notes.
    pub async fn purge_expired(&self) -> Result<(usize, usize), WorkflowError> {
        let started = Instant::now();
        let now = crate::api::workflow::mapping::now_ms();
        let days = {
            let c = self.config.read().await;
            c.server.workflow_deleted_note_retention_days as u64
        };
        let ws = self.workspace(now).await?;
        let cutoff = now.saturating_sub(days * 86_400_000);
        let mut e_total = 0;
        let mut n_total = 0;
        loop {
            let (e, n) = self
                .store_call({
                    let id = ws.id.clone();
                    move |s| {
                        Ok((
                            s.purge_expired_events(&id, now, 500)?,
                            s.purge_soft_deleted_notes(&id, cutoff, 500)?,
                        ))
                    }
                })
                .await?;
            e_total += e;
            n_total += n;
            if e < 500 && n < 500 {
                break;
            }
            tokio::task::yield_now().await;
        }
        self.record_operation(
            "retention_purge",
            Ok(()),
            started,
            e_total.saturating_add(n_total),
            e_total,
        );
        Ok((e_total, n_total))
    }
    /// Reconcile persisted terminal links against live PTY sessions after startup restore.
    pub async fn reconcile_terminal_links(
        &self,
        live_terminals: Vec<(String, u64)>,
    ) -> Result<(usize, usize), WorkflowError> {
        let now = crate::api::workflow::mapping::now_ms();
        let diagnostics = self.diagnostics.clone();
        self.store_call(move |s| {
            crate::workflow::reconcile::reconcile_startup_terminal_links_with_diagnostics(
                &s,
                &live_terminals,
                now,
                diagnostics,
            )
        })
        .await
    }
}

