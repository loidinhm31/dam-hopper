//! AppState-owned semantic session supervisor.
//!
//! Enforces:
//! - Default-OFF runtime state with passive toolchain verification.
//! - Global tree concurrency limit (`MAX_GLOBAL_SEMANTIC_TREES = 2`).
//! - Per-connection concurrency limit (`MAX_TREES_PER_CONNECTION = 1`).
//! - Global overlay memory limit (`MAX_GLOBAL_OVERLAY_BYTES = 8 MiB`).
//! - Finite idle session eviction (60s with zero open documents and zero pending requests).
//! - Clean, complete-tree shutdown on server teardown.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{mpsc, RwLock};

use super::launch::{BundledLaunchSpec, LaunchError};
use super::protocol::{
    ConnectionId, SemanticAggregateStatus, SemanticState, SessionIdentityFence, SessionKey,
};
use super::resources::{
    MAX_GLOBAL_OVERLAY_BYTES, MAX_GLOBAL_SEMANTIC_TREES, MAX_TREES_PER_CONNECTION,
    RESOURCE_POLICY_VERSION,
};
use super::session::{SemanticSessionActor, SemanticSessionHandle, SessionError};
use super::tool_profile::{SemanticToolProfile, ToolIntegrityStatus};

#[derive(Debug, Error)]
pub enum SupervisorError {
    #[error("Semantic subsystem is disabled")]
    Disabled,

    #[error("Bundled toolchain missing or integrity invalid: {0}")]
    ToolProfile(String),

    #[error("Global semantic tree concurrency limit ({0}) exceeded")]
    GlobalTreeLimitExceeded(usize),

    #[error("Per-connection semantic tree limit ({0}) exceeded")]
    ConnectionTreeLimitExceeded(usize),

    #[error("Global overlay memory limit exceeded ({bytes} >= {max})")]
    GlobalOverlayLimitExceeded { bytes: usize, max: usize },

    #[error("Session error: {0}")]
    Session(#[from] SessionError),

    #[error("Launch configuration error: {0}")]
    Launch(#[from] LaunchError),
}

/// Inner state of the semantic supervisor.
struct SupervisorInner {
    enabled: AtomicBool,
    toolchain_verified: AtomicBool,
    runtime_epoch: std::sync::atomic::AtomicU64,
    next_connection_epoch: std::sync::atomic::AtomicU64,
    connection_epochs: RwLock<HashMap<ConnectionId, Option<u64>>>,
    sessions: RwLock<HashMap<SessionKey, SemanticSessionHandle>>,
    tool_profile: Option<SemanticToolProfile>,
    idle_notify_tx: mpsc::Sender<SessionKey>,
    session_generation_counter: std::sync::atomic::AtomicU64,
}

/// Global semantic session supervisor managing session lifecycles and admission.
#[derive(Clone)]
pub struct SemanticSupervisor {
    inner: Arc<SupervisorInner>,
}

impl SemanticSupervisor {
    /// Create a new disabled supervisor with optional passive toolchain verification.
    /// Does NOT spawn any child processes.
    pub fn new(tool_profile: Option<SemanticToolProfile>) -> Self {
        let (idle_notify_tx, mut idle_notify_rx) = mpsc::channel::<SessionKey>(32);

        let inner = Arc::new(SupervisorInner {
            enabled: AtomicBool::new(false),
            toolchain_verified: AtomicBool::new(false),
            runtime_epoch: std::sync::atomic::AtomicU64::new(1),
            next_connection_epoch: std::sync::atomic::AtomicU64::new(1),
            connection_epochs: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            tool_profile,
            idle_notify_tx,
            session_generation_counter: std::sync::atomic::AtomicU64::new(1),
        });

        let supervisor = Self { inner };

        // Background worker to reap idle sessions (holds Weak reference to avoid Arc cycle)
        let weak_inner = Arc::downgrade(&supervisor.inner);
        tokio::spawn(async move {
            while let Some(key) = idle_notify_rx.recv().await {
                if let Some(inner) = weak_inner.upgrade() {
                    let sup = SemanticSupervisor { inner };
                    sup.handle_idle_session(key).await;
                } else {
                    break;
                }
            }
        });

        supervisor
    }

    /// Check if the semantic subsystem is enabled.
    pub fn is_enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Acquire)
    }

    /// Enable or disable the semantic subsystem.
    pub async fn set_enabled(&self, enabled: bool) {
        let was_enabled = self.inner.enabled.swap(enabled, Ordering::AcqRel);
        if was_enabled != enabled {
            self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);
            if was_enabled && !enabled {
                // Turning OFF: tear down all active sessions and reap descendants
                self.shutdown().await;
            }
        }
    }

    /// Get current runtime epoch.
    pub fn runtime_epoch(&self) -> u64 {
        self.inner.runtime_epoch.load(Ordering::Acquire)
    }
    /// Register a new connection and allocate a unique monotonic admission epoch.
    pub async fn register_connection(&self, connection_id: &ConnectionId) -> u64 {
        let mut epochs = self.inner.connection_epochs.write().await;
        if let Some(existing) = epochs.get(connection_id) {
            return existing.unwrap_or(0);
        }
        let epoch = self
            .inner
            .next_connection_epoch
            .fetch_add(1, Ordering::SeqCst);
        epochs.insert(connection_id.clone(), Some(epoch));
        epoch
    }

    /// Get current admission epoch for a connection. Returns None if invalidated or released.
    pub async fn get_connection_epoch(&self, connection_id: &ConnectionId) -> Option<u64> {
        let epochs = self.inner.connection_epochs.read().await;
        epochs.get(connection_id).copied().flatten()
    }

    /// Retrieve toolchain integrity status without launching a child process.
    pub fn tool_integrity_status(&self) -> Option<ToolIntegrityStatus> {
        self.inner
            .tool_profile
            .as_ref()
            .map(|profile| profile.verify_integrity())
    }

    /// Acquire or create an isolated semantic session for a connection and target.
    pub async fn get_or_create_session(
        &self,
        connection_id: ConnectionId,
        project: &str,
        worktree: Option<String>,
        target_root: PathBuf,
        expected_epoch: u64,
    ) -> Result<SemanticSessionHandle, SupervisorError> {
        if !self.is_enabled() {
            return Err(SupervisorError::Disabled);
        }
        let start_runtime_epoch = self.inner.runtime_epoch.load(Ordering::Acquire);
        match self.get_connection_epoch(&connection_id).await {
            Some(e) if e == expected_epoch => e,
            _ => return Err(SupervisorError::Session(SessionError::Invalidated)),
        };
        // Verify toolchain integrity passively (cached to prevent repeated SHA-256 computation)
        if !self.inner.toolchain_verified.load(Ordering::Acquire) {
            if let Some(profile) = &self.inner.tool_profile {
                let p = profile.clone();
                let integrity = tokio::task::spawn_blocking(move || p.verify_integrity())
                    .await
                    .map_err(|e| SupervisorError::ToolProfile(e.to_string()))?;
                if !integrity.is_valid() {
                    return Err(SupervisorError::ToolProfile(format!("{:?}", integrity)));
                }
            }
            self.inner.toolchain_verified.store(true, Ordering::Release);
        }

        let key = SessionKey::new(connection_id.clone(), project, worktree.clone());

        // Fast path: check existing session without holding write lock
        let existing_opt = {
            let guard = self.inner.sessions.read().await;
            guard.get(&key).cloned()
        };

        if let Some(existing) = existing_opt {
            let state = existing.get_state().await;
            if !matches!(state, SemanticState::Crashed | SemanticState::Invalidated) {
                return Ok(existing);
            }
            // Shut down old handle before removing, comparing session generation
            let old_opt = {
                let mut guard = self.inner.sessions.write().await;
                if let Some(cur) = guard.get(&key) {
                    if cur.fence.session_generation == existing.fence.session_generation {
                        guard.remove(&key)
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if let Some(old) = old_opt {
                let _ = old.shutdown().await;
            }
        }

        // Snapshot handles under read lock to query stats without holding write lock
        let active_handles: Vec<SemanticSessionHandle> = {
            let guard = self.inner.sessions.read().await;
            let conn_count = guard
                .keys()
                .filter(|k| k.connection_id == connection_id)
                .count();
            if conn_count >= MAX_TREES_PER_CONNECTION {
                return Err(SupervisorError::ConnectionTreeLimitExceeded(
                    MAX_TREES_PER_CONNECTION,
                ));
            }
            if guard.len() >= MAX_GLOBAL_SEMANTIC_TREES {
                return Err(SupervisorError::GlobalTreeLimitExceeded(
                    MAX_GLOBAL_SEMANTIC_TREES,
                ));
            }
            guard.values().cloned().collect()
        };

        let mut total_global_overlay_bytes = 0;
        for handle in active_handles {
            let (_, bytes) = handle.get_overlay_stats().await;
            total_global_overlay_bytes += bytes;
        }
        if total_global_overlay_bytes >= MAX_GLOBAL_OVERLAY_BYTES {
            return Err(SupervisorError::GlobalOverlayLimitExceeded {
                bytes: total_global_overlay_bytes,
                max: MAX_GLOBAL_OVERLAY_BYTES,
            });
        }
        // Resolve bundled launch spec
        let profile = self
            .inner
            .tool_profile
            .as_ref()
            .ok_or_else(|| SupervisorError::ToolProfile("No tool profile configured".into()))?;

        let spec = BundledLaunchSpec::new(
            profile.node_path(),
            profile.tsls_entrypoint(),
            &target_root,
            &target_root,
        )?
        .with_tsserver_path(profile.tsserver_path());
        let session_generation = self
            .inner
            .session_generation_counter
            .fetch_add(1, Ordering::SeqCst);

        let fence = SessionIdentityFence {
            connection_id: connection_id.clone(),
            connection_generation: 1,
            project: project.to_string(),
            worktree,
            target_generation: 1,
            session_generation,
            child_incarnation: 0,
        };

        let handle = SemanticSessionActor::spawn(
            key.clone(),
            fence,
            target_root,
            spec,
            self.inner.idle_notify_tx.clone(),
        );
        let mut guard = self.inner.sessions.write().await;
        if !self.is_enabled()
            || self.inner.runtime_epoch.load(Ordering::Acquire) != start_runtime_epoch
        {
            drop(guard);
            let _ = handle.shutdown().await;
            return Err(SupervisorError::Disabled);
        }
        let current_conn_epoch = {
            let epochs = self.inner.connection_epochs.read().await;
            epochs.get(&connection_id).copied().flatten()
        };
        if current_conn_epoch != Some(expected_epoch) {
            drop(guard);
            let _ = handle.shutdown().await;
            return Err(SupervisorError::Session(SessionError::Invalidated));
        }
        if let Some(existing) = guard.get(&key).cloned() {
            drop(guard);
            let _ = handle.shutdown().await;
            return Ok(existing);
        }
        let conn_count = guard
            .keys()
            .filter(|k| k.connection_id == connection_id)
            .count();
        if conn_count >= MAX_TREES_PER_CONNECTION {
            drop(guard);
            let _ = handle.shutdown().await;
            return Err(SupervisorError::ConnectionTreeLimitExceeded(
                MAX_TREES_PER_CONNECTION,
            ));
        }
        if guard.len() >= MAX_GLOBAL_SEMANTIC_TREES {
            drop(guard);
            let _ = handle.shutdown().await;
            return Err(SupervisorError::GlobalTreeLimitExceeded(
                MAX_GLOBAL_SEMANTIC_TREES,
            ));
        }
        guard.insert(key, handle.clone());

        Ok(handle)
    }

    /// Retrieve an existing active session handle if present.
    pub async fn get_session(&self, key: &SessionKey) -> Option<SemanticSessionHandle> {
        let guard = self.inner.sessions.read().await;
        guard.get(key).cloned()
    }

    /// Close and reap a specific session.
    pub async fn close_session(&self, key: &SessionKey) {
        let handle_opt = {
            let mut guard = self.inner.sessions.write().await;
            guard.remove(key)
        };

        if let Some(handle) = handle_opt {
            let _ = handle.shutdown().await;
        }
    }

    /// Invalidate and reap all sessions associated with a specific connection.
    /// Also increments the connection's admission epoch to cancel pending admissions.
    pub async fn invalidate_connection(&self, connection_id: &ConnectionId) {
        {
            let mut epochs = self.inner.connection_epochs.write().await;
            epochs.insert(connection_id.clone(), None); // Tombstone: None means closed/invalidated
        }

        let to_close: Vec<SessionKey> = {
            let guard = self.inner.sessions.read().await;
            guard
                .keys()
                .filter(|k| &k.connection_id == connection_id)
                .cloned()
                .collect()
        };

        for key in to_close {
            self.close_session(&key).await;
        }
    }

    /// Release tracking state for a disconnected connection, preventing memory growth.
    pub async fn release_connection(&self, connection_id: &ConnectionId) {
        let mut epochs = self.inner.connection_epochs.write().await;
        epochs.remove(connection_id);
    }

    /// Invalidate and reap all sessions associated with a specific project/target root.
    pub async fn invalidate_project(&self, project: &str) {
        let to_close: Vec<SessionKey> = {
            let guard = self.inner.sessions.read().await;
            guard
                .keys()
                .filter(|k| k.project == project)
                .cloned()
                .collect()
        };

        for key in to_close {
            self.close_session(&key).await;
        }
    }

    /// Query aggregate runtime metrics for diagnostics and administration.
    pub async fn get_aggregate_status(&self) -> SemanticAggregateStatus {
        let enabled = self.is_enabled();
        let handles: Vec<SemanticSessionHandle> = {
            let guard = self.inner.sessions.read().await;
            guard.values().cloned().collect()
        };
        let active_sessions = handles.len();

        let mut total_open_documents = 0;
        let mut total_overlay_bytes = 0;

        for handle in handles {
            let (docs, bytes) = handle.get_overlay_stats().await;
            total_open_documents += docs;
            total_overlay_bytes += bytes;
        }

        let tool_integrity = self.tool_integrity_status().map(|s| format!("{:?}", s));

        let state = if !enabled {
            SemanticState::Disabled
        } else if active_sessions == 0 {
            SemanticState::Idle
        } else {
            SemanticState::Ready
        };

        SemanticAggregateStatus {
            state,
            enabled,
            active_sessions,
            active_trees: active_sessions,
            open_documents: total_open_documents,
            total_overlay_bytes,
            in_flight_requests: 0,
            resource_policy_version: RESOURCE_POLICY_VERSION.to_string(),
            tool_integrity_status: tool_integrity,
        }
    }

    /// Handle background idle eviction notification for a session.
    async fn handle_idle_session(&self, key: SessionKey) {
        let handle_opt = {
            let guard = self.inner.sessions.read().await;
            guard.get(&key).cloned()
        };

        if let Some(handle) = handle_opt {
            let (docs, _) = handle.get_overlay_stats().await;
            if docs == 0 {
                self.close_session(&key).await;
            }
        }
    }

    /// Clean shutdown of all running semantic child processes and sessions.
    pub async fn shutdown(&self) {
        let handles: Vec<(SessionKey, SemanticSessionHandle)> = {
            let mut guard = self.inner.sessions.write().await;
            guard.drain().collect()
        };

        for (_, handle) in handles {
            let _ = handle.shutdown().await;
        }
    }
}
