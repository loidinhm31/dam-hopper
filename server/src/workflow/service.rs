use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

use super::error::WorkflowError;
use super::model::WorkflowWorkspace;
use super::store::{WorkflowStore, WorkflowStoreError};
use crate::config::DamHopperConfig;
use crate::pty::PtySessionManager;
use crate::workspace_target::{
    ProjectTargetRef, ResolvedProjectTarget, WorkspaceTargetResolver,
};

#[derive(Clone)]
pub struct WorkflowService {
    pub store: WorkflowStore,
    pub config: Arc<RwLock<DamHopperConfig>>,
    pub resolver: WorkspaceTargetResolver,
    pub workspace_guard: Arc<RwLock<()>>,
    pub pty_manager: PtySessionManager,
}

impl WorkflowService {
    pub fn new(
        store: WorkflowStore,
        config: Arc<RwLock<DamHopperConfig>>,
        resolver: WorkspaceTargetResolver,
        workspace_guard: Arc<RwLock<()>>,
        pty_manager: PtySessionManager,
    ) -> Self {
        Self {
            store,
            config,
            resolver,
            workspace_guard,
            pty_manager,
        }
    }

    /// Extract current workspace canonical locator, name, and configured projects.
    pub async fn scope(&self) -> Result<(String, String, Vec<(String, PathBuf)>), WorkflowError> {
        let cfg = self.config.read().await;
        let locator = cfg
            .config_path
            .to_str()
            .ok_or(WorkflowError::StoreUnavailable)?
            .to_owned();
        let projects = cfg
            .projects
            .iter()
            .map(|p| (p.name.clone(), PathBuf::from(&p.path)))
            .collect();
        Ok((locator, cfg.workspace.name.clone(), projects))
    }

    /// Resolve or lazily initialize the current workspace entity.
    pub async fn workspace(&self, now: u64) -> Result<WorkflowWorkspace, WorkflowError> {
        let (locator, name, _) = self.scope().await?;
        self.store_call(move |s| s.get_or_create_workspace(&locator, &name, now))
            .await
    }

    /// Resolve a target reference against current configured projects.
    pub async fn resolve_target(
        &self,
        target: &ProjectTargetRef,
    ) -> Result<ResolvedProjectTarget, WorkflowError> {
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

    /// Execute a blocking store operation on the Tokio blocking pool.
    pub async fn store_call<T, F>(&self, f: F) -> Result<T, WorkflowError>
    where
        T: Send + 'static,
        F: FnOnce(WorkflowStore) -> Result<T, WorkflowStoreError> + Send + 'static,
    {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || f(store))
            .await
            .map_err(|_| WorkflowError::StoreUnavailable)?
            .map_err(WorkflowError::from)
    }

    /// Run bounded retention purge for expired events and soft-deleted notes.
    pub async fn purge_expired(&self) -> Result<(usize, usize), WorkflowError> {
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
        Ok((e_total, n_total))
    }

    /// Reconcile persisted terminal links against live PTY sessions after startup restore.
    pub async fn reconcile_terminal_links(
        &self,
        live_terminals: Vec<(String, u64)>,
    ) -> Result<(usize, usize), WorkflowError> {
        let now = crate::api::workflow::mapping::now_ms();
        self.store_call(move |s| {
            crate::workflow::reconcile::reconcile_startup_terminal_links(&s, &live_terminals, now)
        })
        .await
    }
}
