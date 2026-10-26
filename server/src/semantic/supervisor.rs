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
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot, RwLock, Semaphore};

use super::launch::{BundledLaunchSpec, LaunchError};
use super::pressure::{EnqueuedCommand, SessionPressureCounters};
use super::protocol::{
    ConnectionId, SemanticAggregateStatus, SemanticState, SessionIdentityFence, SessionKey,
};
use super::resources::{
    FORCE_KILL_REAP_BUDGET, MAX_GLOBAL_OVERLAY_BYTES, MAX_GLOBAL_SEMANTIC_TREES,
    MAX_TREES_PER_CONNECTION, RESOURCE_POLICY_VERSION, TOTAL_TEARDOWN_BUDGET,
};
use super::session::{
    RevocationToken, SemanticSessionActor, SemanticSessionHandle, SessionCommand, SessionError,
};
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
    #[error("Session shutdown error: {0}")]
    Shutdown(String),
}

/// Tracked retiring or failed session entry retained until physical child-tree reap is verified.
struct RetiringSessionEntry {
    key: SessionKey,
    fence: SessionIdentityFence,
    weak_cmd_tx: mpsc::WeakSender<EnqueuedCommand<SessionCommand>>,
    failed_handle: Option<SemanticSessionHandle>,
    revocation: RevocationToken,
    cleanly_reaped: Arc<AtomicBool>,
    actor_done: Arc<AtomicBool>,
    current_pgid: Arc<AtomicU32>,
    counters: Arc<SessionPressureCounters>,
    initial_overlay_bytes: usize,
}

impl RetiringSessionEntry {
    fn from_handle(handle: &SemanticSessionHandle) -> Self {
        let (_, initial_bytes) = handle.cached_overlay_stats();
        let (revocation, cleanly_reaped, actor_done, current_pgid, counters) =
            handle.shared_flags();
        Self {
            key: handle.key.clone(),
            fence: handle.fence.clone(),
            weak_cmd_tx: handle.downgrade_cmd_tx(),
            failed_handle: None,
            revocation,
            cleanly_reaped,
            actor_done,
            current_pgid,
            counters,
            initial_overlay_bytes: initial_bytes,
        }
    }

    fn is_finished_and_clean(&self) -> bool {
        self.failed_handle.is_none()
            && self.actor_done.load(Ordering::Acquire)
            && self.cleanly_reaped.load(Ordering::Acquire)
    }

    fn to_handle(&self) -> Option<SemanticSessionHandle> {
        if let Some(h) = &self.failed_handle {
            return Some(h.clone());
        }
        let cmd_tx = self.weak_cmd_tx.upgrade()?;
        Some(SemanticSessionHandle::from_parts(
            self.key.clone(),
            self.fence.clone(),
            cmd_tx,
            self.revocation.clone(),
            Arc::clone(&self.cleanly_reaped),
            Arc::clone(&self.actor_done),
            Arc::clone(&self.current_pgid),
            Arc::clone(&self.counters),
        ))
    }
}

/// Shared bounded toolchain integrity verifier with diagnostic status publication.
#[derive(Clone)]
pub struct ToolchainVerifier {
    profile: SemanticToolProfile,
    semaphore: Arc<Semaphore>,
    last_integrity_status: Arc<StdMutex<Option<ToolIntegrityStatus>>>,
}

impl ToolchainVerifier {
    pub fn new(profile: SemanticToolProfile) -> Self {
        Self {
            profile,
            semaphore: Arc::new(Semaphore::new(1)),
            last_integrity_status: Arc::new(StdMutex::new(Some(ToolIntegrityStatus::Unverified))),
        }
    }

    pub fn profile(&self) -> &SemanticToolProfile {
        &self.profile
    }

    pub fn semaphore(&self) -> Arc<Semaphore> {
        self.semaphore.clone()
    }

    pub fn cached_status(&self) -> Option<ToolIntegrityStatus> {
        let guard = self
            .last_integrity_status
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.clone()
    }

    pub async fn verify_fresh(&self) -> Result<ToolIntegrityStatus, SupervisorError> {
        let permit =
            self.semaphore.clone().acquire_owned().await.map_err(|e| {
                SupervisorError::ToolProfile(format!("Verifier semaphore closed: {e}"))
            })?;

        let p = self.profile.clone();
        let status_target = Arc::clone(&self.last_integrity_status);
        let status = match tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let res =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.verify_integrity()))
                    .unwrap_or(ToolIntegrityStatus::Unverified);
            let mut guard = status_target.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(res.clone());
            res
        })
        .await
        {
            Ok(s) => s,
            Err(e) => {
                return Err(SupervisorError::ToolProfile(format!(
                    "Verifier task join error: {e}"
                )));
            }
        };
        if !status.is_valid() {
            return Err(SupervisorError::ToolProfile(format!("{:?}", status)));
        }

        Ok(status)
    }
}
/// Inner state of the semantic supervisor.
struct SupervisorInner {
    enabled: AtomicBool,
    admission_revoked: AtomicBool,
    verifier: Option<ToolchainVerifier>,
    runtime_epoch: AtomicU64,
    next_connection_epoch: AtomicU64,
    connection_epochs: RwLock<HashMap<ConnectionId, Option<u64>>>,
    sessions: RwLock<HashMap<SessionKey, SemanticSessionHandle>>,
    retiring_sessions: StdMutex<HashMap<u64, RetiringSessionEntry>>,
    idle_notify_tx: mpsc::Sender<SessionKey>,
    session_generation_counter: AtomicU64,
    transition_lock: tokio::sync::Mutex<()>,
    safe_disabled: AtomicBool,
    last_transition_error: RwLock<Option<String>>,
    active_reap_tasks: StdMutex<Vec<tokio::task::JoinHandle<()>>>,
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
        let verifier = tool_profile.map(ToolchainVerifier::new);

        let inner = Arc::new(SupervisorInner {
            enabled: AtomicBool::new(false),
            admission_revoked: AtomicBool::new(false),
            verifier,
            runtime_epoch: AtomicU64::new(1),
            next_connection_epoch: AtomicU64::new(1),
            connection_epochs: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            retiring_sessions: StdMutex::new(HashMap::new()),
            idle_notify_tx,
            session_generation_counter: AtomicU64::new(1),
            transition_lock: tokio::sync::Mutex::new(()),
            safe_disabled: AtomicBool::new(false),
            last_transition_error: RwLock::new(None),
            active_reap_tasks: StdMutex::new(Vec::new()),
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

    /// Check if the semantic subsystem is in a safe-disabled state due to a failed transition.
    pub fn is_safe_disabled(&self) -> bool {
        self.inner.safe_disabled.load(Ordering::Acquire)
    }

    /// Check if the semantic subsystem is effectively active and admitting requests.
    pub fn is_effective_enabled(&self) -> bool {
        self.is_enabled() && !self.is_safe_disabled() && !self.is_admission_revoked()
    }

    /// Check whether admission has been globally revoked (e.g. during server shutdown).
    pub fn is_admission_revoked(&self) -> bool {
        self.inner.admission_revoked.load(Ordering::Acquire)
    }

    /// Revoke all new admissions immediately (e.g. on shutdown signal).
    pub fn revoke_admission(&self) {
        self.inner.admission_revoked.store(true, Ordering::Release);
        self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// Reset admission revocation (e.g. after enable or for tests).
    pub fn reset_admission_revocation(&self) {
        self.inner.admission_revoked.store(false, Ordering::Release);
    }

    /// Get any recorded transition error.
    pub async fn last_transition_error(&self) -> Option<String> {
        self.inner.last_transition_error.read().await.clone()
    }

    /// Reference to the bundled tool profile, if configured.
    pub fn tool_profile(&self) -> Option<&SemanticToolProfile> {
        self.inner.verifier.as_ref().map(|v| v.profile())
    }

    /// Transition lock guarding semantic lifecycle mutations.
    pub fn transition_lock(&self) -> &tokio::sync::Mutex<()> {
        &self.inner.transition_lock
    }

    /// Synchronously register detached handles in `retiring_sessions` and revoke their tokens.
    fn detach_and_register_retiring(&self, handles: &[SemanticSessionHandle]) {
        if handles.is_empty() {
            return;
        }
        let mut retiring = self
            .inner
            .retiring_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        retiring.retain(|_, entry| !entry.is_finished_and_clean());
        for h in handles {
            let entry = RetiringSessionEntry::from_handle(h);
            h.revoke_now();
            h.try_enqueue_invalidate();
            retiring.entry(h.fence.session_generation).or_insert(entry);
        }
    }

    /// Prune completed clean entries from `retiring_sessions` and return `(retiring_total, per_conn_counts, retiring_overlay_bytes, retiring_with_child)`.
    fn snapshot_retiring_accounting(&self) -> (usize, HashMap<ConnectionId, usize>, usize, usize) {
        let mut retiring = self
            .inner
            .retiring_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        retiring.retain(|_, entry| !entry.is_finished_and_clean());
        let total = retiring.len();
        let mut by_conn = HashMap::new();
        let mut overlay_bytes = 0usize;
        let mut with_child = 0usize;
        for entry in retiring.values() {
            *by_conn.entry(entry.key.connection_id.clone()).or_insert(0) += 1;
            let current_bytes = entry.counters.overlay_bytes.load(Ordering::Acquire);
            overlay_bytes += current_bytes.max(entry.initial_overlay_bytes);
            if !entry.cleanly_reaped.load(Ordering::Acquire)
                || entry.current_pgid.load(Ordering::Acquire) > 0
                || entry.failed_handle.is_some()
            {
                with_child += 1;
            }
        }
        (total, by_conn, overlay_bytes, with_child)
    }

    /// Check whether any retiring, in-flight reap, or unclean failed child resources remain.
    pub fn has_unclean_or_retiring_resources(&self) -> bool {
        {
            let mut retiring = self
                .inner
                .retiring_sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            retiring.retain(|_, entry| !entry.is_finished_and_clean());
            if !retiring.is_empty() {
                return true;
            }
        }
        {
            let mut tasks = self
                .inner
                .active_reap_tasks
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            tasks.retain(|t| !t.is_finished());
            if !tasks.is_empty() {
                return true;
            }
        }
        if let Ok(guard) = self.inner.sessions.try_read() {
            for handle in guard.values() {
                if !handle.is_cleanly_reaped() && handle.is_revoked() {
                    return true;
                }
            }
        }
        false
    }

    async fn reap_single_handle(&self, handle: SemanticSessionHandle) -> Result<(), String> {
        let session_gen = handle.fence.session_generation;
        let key = handle.key.clone();
        // Outer timeout includes 1s margin above session cleanup (5.5s) and child budget (5.0s)
        let res = tokio::time::timeout(
            TOTAL_TEARDOWN_BUDGET + Duration::from_millis(1000),
            handle.shutdown(),
        )
        .await;

        match res {
            Ok(Ok(())) if handle.is_cleanly_reaped() => {
                let mut retiring = self
                    .inner
                    .retiring_sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                retiring.remove(&session_gen);
                Ok(())
            }
            Ok(Ok(())) => {
                let msg = format!(
                    "Session {key:?} shutdown returned Ok but child tree not verified reaped"
                );
                tracing::warn!("{msg}");
                let mut retiring = self
                    .inner
                    .retiring_sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(entry) = retiring.get_mut(&session_gen) {
                    entry.failed_handle = Some(handle);
                }
                Err(msg)
            }
            Ok(Err(err)) => {
                tracing::warn!(error = %err, session_key = ?key, "Failed to cleanly shut down session");
                let mut retiring = self
                    .inner
                    .retiring_sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(entry) = retiring.get_mut(&session_gen) {
                    entry.failed_handle = Some(handle);
                }
                Err(err.to_string())
            }
            Err(_) => {
                tracing::warn!(session_key = ?key, "Session teardown timed out");
                let mut retiring = self
                    .inner
                    .retiring_sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(entry) = retiring.get_mut(&session_gen) {
                    entry.failed_handle = Some(handle);
                }
                Err("Session shutdown timed out".to_string())
            }
        }
    }

    /// Prepare to disable semantic navigation:
    /// - Revokes admission immediately (enabled = false, bump epoch).
    /// - Closes connection epochs.
    /// - Synchronously revokes all session tokens and detaches into tracked `retiring_sessions`.
    /// - Executes bounded complete-tree reaping in a tracked task so dropping the caller future
    ///   cannot abandon in-progress child teardown.
    pub async fn prepare_disable(&self) -> Result<(), SupervisorError> {
        self.inner.enabled.store(false, Ordering::Release);
        self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);

        {
            let mut epochs = self.inner.connection_epochs.write().await;
            for val in epochs.values_mut() {
                *val = None;
            }
        }

        let drained: Vec<SemanticSessionHandle> = {
            let mut guard = self.inner.sessions.write().await;
            let handles: Vec<SemanticSessionHandle> = guard.drain().map(|(_, h)| h).collect();
            self.detach_and_register_retiring(&handles);
            handles
        };

        // Also collect any previously retiring/failed handles for actionable retry
        let mut all_to_reap: HashMap<u64, SemanticSessionHandle> = HashMap::new();
        for h in drained {
            all_to_reap.insert(h.fence.session_generation, h);
        }
        let mut orphan_pgids: Vec<(u64, u32)> = Vec::new();
        {
            let mut retiring = self
                .inner
                .retiring_sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            retiring.retain(|_, entry| !entry.is_finished_and_clean());
            for (&gen, entry) in retiring.iter() {
                if !all_to_reap.contains_key(&gen) {
                    if let Some(h) = entry.to_handle() {
                        all_to_reap.insert(gen, h);
                    } else {
                        let pgid = entry.current_pgid.load(Ordering::Acquire);
                        if pgid > 0 {
                            orphan_pgids.push((gen, pgid));
                        }
                    }
                }
            }
        }

        let (res_tx, res_rx) = oneshot::channel();
        let this = self.clone();
        let task = tokio::spawn(async move {
            let mut failed_handles = Vec::new();
            let mut first_error: Option<String> = None;

            for (_, handle) in all_to_reap {
                if let Err(err_msg) = this.reap_single_handle(handle.clone()).await {
                    if first_error.is_none() {
                        first_error = Some(err_msg);
                    }
                    failed_handles.push(handle);
                }
            }

            for (gen, pgid) in orphan_pgids {
                #[cfg(unix)]
                {
                    use nix::sys::signal::Signal;
                    let _ = super::reaper::signal_pgid(pgid, Some(Signal::SIGKILL));
                }
                if super::reaper::verify_pgid_reaped(pgid, FORCE_KILL_REAP_BUDGET).await {
                    let mut retiring = this
                        .inner
                        .retiring_sessions
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if let Some(entry) = retiring.get(&gen) {
                        entry.cleanly_reaped.store(true, Ordering::Release);
                        entry.current_pgid.store(0, Ordering::Release);
                    }
                    retiring.remove(&gen);
                } else if first_error.is_none() {
                    first_error = Some(format!("Descendant leak in PGID {pgid}"));
                }
            }

            let outcome = if !failed_handles.is_empty() || first_error.is_some() {
                let mut guard = this.inner.sessions.write().await;
                for handle in failed_handles {
                    guard.insert(handle.key.clone(), handle);
                }
                this.inner.safe_disabled.store(true, Ordering::Release);
                let err_msg =
                    first_error.unwrap_or_else(|| "Failed to tear down child session".into());
                Err(SupervisorError::Shutdown(err_msg))
            } else {
                Ok(())
            };

            let _ = res_tx.send(outcome);
        });

        {
            let mut guard = self
                .inner
                .active_reap_tasks
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            guard.retain(|t| !t.is_finished());
            guard.push(task);
        }

        res_rx.await.unwrap_or_else(|_| {
            Err(SupervisorError::Shutdown(
                "Disable reap task cancelled unexpectedly".into(),
            ))
        })
    }

    /// Commit disabled state after persistence succeeds.
    pub async fn commit_disable(&self) {
        self.inner.safe_disabled.store(false, Ordering::Release);
        *self.inner.last_transition_error.write().await = None;
    }

    /// Record a failure during disable (e.g. teardown error or persist error).
    /// Enforces safe-disabled state so admission remains revoked.
    pub async fn record_disable_failure(&self, reason: String) {
        self.inner.enabled.store(false, Ordering::Release);
        self.inner.safe_disabled.store(true, Ordering::Release);
        *self.inner.last_transition_error.write().await = Some(reason);
    }

    /// Passive integrity and configuration verification for turning ON.
    /// Refuses enablement if any retiring or unclean failed child resources remain,
    /// while permitting explicit admin recovery from `safe_disabled` once zero resources remain.
    /// Spawns ZERO child processes.
    pub async fn prepare_enable(&self) -> Result<(), SupervisorError> {
        if self.has_unclean_or_retiring_resources() {
            return Err(SupervisorError::Shutdown(
                "Cannot enable semantic runtime while retiring or unclean child resources remain"
                    .into(),
            ));
        }

        let start_epoch = self.inner.runtime_epoch.load(Ordering::Acquire);

        let integrity = self.verify_toolchain_fresh().await?;
        if !integrity.is_valid() {
            return Err(SupervisorError::ToolProfile(format!("{:?}", integrity)));
        }

        // Post-verification fences: cannot late-enable if admission revoked, resources became unclean,
        // or runtime epoch changed during verification
        if self.is_admission_revoked() {
            return Err(SupervisorError::Session(SessionError::Invalidated));
        }
        if self.has_unclean_or_retiring_resources() {
            return Err(SupervisorError::Shutdown(
                "Cannot enable semantic runtime while retiring or unclean child resources remain"
                    .into(),
            ));
        }
        if self.inner.runtime_epoch.load(Ordering::Acquire) != start_epoch {
            return Err(SupervisorError::Disabled);
        }

        Ok(())
    }

    /// Commit enabled state after persistence succeeds.
    /// Spawns ZERO child processes.
    pub async fn commit_enable(&self) {
        if self.is_admission_revoked() {
            return;
        }
        self.inner.enabled.store(true, Ordering::Release);
        self.inner.safe_disabled.store(false, Ordering::Release);
        self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);
        *self.inner.last_transition_error.write().await = None;
        if self.is_admission_revoked() {
            self.inner.enabled.store(false, Ordering::Release);
            self.inner.safe_disabled.store(true, Ordering::Release);
        }
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
        if self.is_admission_revoked() {
            epochs.insert(connection_id.clone(), None);
            return 0;
        }
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
        self.inner.verifier.as_ref().and_then(|v| v.cached_status())
    }

    /// Perform a fresh, bounded off-thread integrity verification of the bundled toolchain.
    ///
    /// Invariants:
    /// - Cached valid NEVER authorizes. A fresh filesystem and digest verification is always performed.
    /// - Concurrency is strictly bounded by `verifier_semaphore` (1 permit).
    /// - Permit acquisition occurs asynchronously BEFORE spawning the blocking task.
    /// - The permit is owned by the `spawn_blocking` closure and held until the blocking check completes,
    ///   even if the caller's await is cancelled or dropped.
    /// - Verification runs off-thread without holding any supervisor locks (avoiding lock-held hashing).
    /// - The result (both `Valid` and failure variants) is published to `last_integrity_status`.
    pub async fn verify_toolchain_fresh(&self) -> Result<ToolIntegrityStatus, SupervisorError> {
        self.inner
            .verifier
            .as_ref()
            .ok_or_else(|| SupervisorError::ToolProfile("No tool profile configured".into()))?
            .verify_fresh()
            .await
    }

    /// Bounded verifier semaphore (1 permit) for deterministic concurrency coordination.
    #[doc(hidden)]
    pub fn verifier_semaphore(&self) -> Option<Arc<Semaphore>> {
        self.inner.verifier.as_ref().map(|v| v.semaphore())
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
        if !self.is_effective_enabled() {
            return Err(SupervisorError::Disabled);
        }
        let start_runtime_epoch = self.inner.runtime_epoch.load(Ordering::Acquire);
        match self.get_connection_epoch(&connection_id).await {
            Some(e) if e == expected_epoch => e,
            _ => return Err(SupervisorError::Session(SessionError::Invalidated)),
        };

        let key = SessionKey::new(connection_id.clone(), project, worktree.clone());

        // Fast path: check existing session without holding write lock
        let existing_opt = {
            let guard = self.inner.sessions.read().await;
            guard.get(&key).cloned()
        };

        if let Some(existing) = existing_opt {
            let state = existing.get_state().await;
            if !existing.is_revoked()
                && !matches!(state, SemanticState::Crashed | SemanticState::Invalidated)
            {
                return Ok(existing);
            }
            // Shut down old handle before removing, comparing session generation
            let old_opt = {
                let mut guard = self.inner.sessions.write().await;
                if let Some(cur) = guard.get(&key) {
                    if cur.fence.session_generation == existing.fence.session_generation {
                        let removed = guard.remove(&key);
                        if let Some(h) = &removed {
                            self.detach_and_register_retiring(std::slice::from_ref(h));
                        }
                        removed
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if let Some(old) = old_opt {
                let _ = self.reap_single_handle(old).await;
            }
        }
        // Mandatory fresh verification before launch using bounded verifier.
        // Cached valid NEVER authorizes.
        let integrity = self.verify_toolchain_fresh().await?;
        if !integrity.is_valid() {
            return Err(SupervisorError::ToolProfile(format!("{:?}", integrity)));
        }

        // Post-verification fences: cannot launch if runtime disabled or admission revoked
        if !self.is_effective_enabled() || self.is_admission_revoked() {
            return Err(SupervisorError::Disabled);
        }
        match self.get_connection_epoch(&connection_id).await {
            Some(e) if e == expected_epoch => e,
            _ => return Err(SupervisorError::Session(SessionError::Invalidated)),
        };
        if self.inner.runtime_epoch.load(Ordering::Acquire) != start_runtime_epoch {
            return Err(SupervisorError::Disabled);
        }

        let (retiring_total, retiring_by_conn, retiring_overlay_bytes, _) =
            self.snapshot_retiring_accounting();
        let retiring_for_conn = retiring_by_conn.get(&connection_id).copied().unwrap_or(0);

        // Snapshot handles under read lock to query stats without holding write lock
        let active_handles: Vec<SemanticSessionHandle> = {
            let guard = self.inner.sessions.read().await;
            let conn_count = guard
                .keys()
                .filter(|k| k.connection_id == connection_id)
                .count()
                + retiring_for_conn;
            if conn_count >= MAX_TREES_PER_CONNECTION {
                return Err(SupervisorError::ConnectionTreeLimitExceeded(
                    MAX_TREES_PER_CONNECTION,
                ));
            }
            if guard.len() + retiring_total >= MAX_GLOBAL_SEMANTIC_TREES {
                return Err(SupervisorError::GlobalTreeLimitExceeded(
                    MAX_GLOBAL_SEMANTIC_TREES,
                ));
            }
            guard.values().cloned().collect()
        };

        let mut total_global_overlay_bytes = retiring_overlay_bytes;
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
            .tool_profile()
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
            self.inner.verifier.clone(),
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
        let (retiring_total_now, retiring_by_conn_now, _, _) = self.snapshot_retiring_accounting();
        let retiring_conn_now = retiring_by_conn_now
            .get(&connection_id)
            .copied()
            .unwrap_or(0);
        let conn_count = guard
            .keys()
            .filter(|k| k.connection_id == connection_id)
            .count()
            + retiring_conn_now;
        if conn_count >= MAX_TREES_PER_CONNECTION {
            drop(guard);
            let _ = handle.shutdown().await;
            return Err(SupervisorError::ConnectionTreeLimitExceeded(
                MAX_TREES_PER_CONNECTION,
            ));
        }
        if guard.len() + retiring_total_now >= MAX_GLOBAL_SEMANTIC_TREES {
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
            let removed = guard.remove(key);
            if let Some(h) = &removed {
                self.detach_and_register_retiring(std::slice::from_ref(h));
            }
            removed
        };

        if let Some(handle) = handle_opt {
            let _ = self.reap_single_handle(handle).await;
        }
    }

    /// Invalidate and reap all sessions associated with a specific connection.
    /// Also increments the connection's admission epoch to cancel pending admissions.
    pub async fn invalidate_connection(&self, connection_id: &ConnectionId) {
        {
            let mut epochs = self.inner.connection_epochs.write().await;
            epochs.insert(connection_id.clone(), None); // Tombstone: None means closed/invalidated
        }

        let handles: Vec<SemanticSessionHandle> = {
            let mut guard = self.inner.sessions.write().await;
            let keys_to_remove: Vec<SessionKey> = guard
                .keys()
                .filter(|k| &k.connection_id == connection_id)
                .cloned()
                .collect();
            let mut out = Vec::with_capacity(keys_to_remove.len());
            for k in keys_to_remove {
                if let Some(h) = guard.remove(&k) {
                    out.push(h);
                }
            }
            self.detach_and_register_retiring(&out);
            out
        };

        self.reap_sessions(handles).await;
    }

    /// Release tracking state for a disconnected connection, preventing memory growth.
    pub async fn release_connection(&self, connection_id: &ConnectionId) {
        let mut epochs = self.inner.connection_epochs.write().await;
        epochs.remove(connection_id);
    }

    /// Phase 1: Synchronously revoke admission and detach all sessions across all connections and targets.
    /// Performs zero actor mailbox `.await` calls while holding registry or caller locks.
    pub async fn prepare_invalidate_all(&self) -> Vec<SemanticSessionHandle> {
        self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);
        {
            let mut epochs = self.inner.connection_epochs.write().await;
            for val in epochs.values_mut() {
                *val = None; // Tombstone all connections
            }
        }
        let mut guard = self.inner.sessions.write().await;
        let handles: Vec<SemanticSessionHandle> = guard.drain().map(|(_, h)| h).collect();
        self.detach_and_register_retiring(&handles);
        handles
    }

    /// Phase 1: Synchronously revoke admission and detach sessions for a specific project.
    /// Performs zero actor mailbox `.await` calls while holding registry or caller locks.
    pub async fn prepare_invalidate_project(&self, project: &str) -> Vec<SemanticSessionHandle> {
        self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);
        let mut guard = self.inner.sessions.write().await;
        let keys_to_remove: Vec<SessionKey> = guard
            .keys()
            .filter(|k| k.project == project)
            .cloned()
            .collect();
        let mut handles = Vec::with_capacity(keys_to_remove.len());
        for key in keys_to_remove {
            if let Some(h) = guard.remove(&key) {
                handles.push(h);
            }
        }
        self.detach_and_register_retiring(&handles);
        handles
    }

    /// Phase 1: Synchronously revoke admission and detach sessions for a specific project and worktree.
    /// Performs zero actor mailbox `.await` calls while holding registry or caller locks.
    pub async fn prepare_invalidate_target(
        &self,
        project: &str,
        worktree: Option<&str>,
    ) -> Vec<SemanticSessionHandle> {
        self.inner.runtime_epoch.fetch_add(1, Ordering::SeqCst);
        let mut guard = self.inner.sessions.write().await;
        let keys_to_remove: Vec<SessionKey> = guard
            .keys()
            .filter(|k| k.project == project && k.worktree.as_deref() == worktree)
            .cloned()
            .collect();
        let mut handles = Vec::with_capacity(keys_to_remove.len());
        for key in keys_to_remove {
            if let Some(h) = guard.remove(&key) {
                handles.push(h);
            }
        }
        self.detach_and_register_retiring(&handles);
        handles
    }

    /// Phase 2: Await graceful shutdown and bounded SIGKILL reaping for detached session handles.
    /// Should be called OUTSIDE any outer workspace/configuration locks.
    pub async fn reap_sessions(&self, handles: Vec<SemanticSessionHandle>) {
        if handles.is_empty() {
            return;
        }
        self.detach_and_register_retiring(&handles);
        let reap_futures = handles
            .into_iter()
            .map(|handle| self.reap_single_handle(handle));
        let _ = futures_util::future::join_all(reap_futures).await;
    }

    /// Spawn asynchronous reaping of detached session handles in a synchronously tracked background task.
    pub fn spawn_reap_sessions(&self, handles: Vec<SemanticSessionHandle>) {
        if handles.is_empty() {
            return;
        }
        self.detach_and_register_retiring(&handles);
        let this = self.clone();
        let mut guard = self
            .inner
            .active_reap_tasks
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.retain(|t| !t.is_finished());
        let task = tokio::spawn(async move {
            this.reap_sessions(handles).await;
        });
        guard.push(task);
    }

    /// Full two-phase invalidation of all sessions (convenience method).
    pub async fn invalidate_all(&self) {
        let handles = self.prepare_invalidate_all().await;
        self.reap_sessions(handles).await;
    }

    /// Full two-phase invalidation of project sessions (convenience method).
    pub async fn invalidate_project(&self, project: &str) {
        let handles = self.prepare_invalidate_project(project).await;
        self.reap_sessions(handles).await;
    }

    /// Full two-phase invalidation of target sessions (convenience method).
    pub async fn invalidate_target(&self, project: &str, worktree: Option<&str>) {
        let handles = self.prepare_invalidate_target(project, worktree).await;
        self.reap_sessions(handles).await;
    }

    /// Query aggregate runtime metrics for diagnostics and administration.
    pub async fn get_aggregate_status(&self) -> SemanticAggregateStatus {
        let enabled = self.is_effective_enabled();
        let handles: Vec<SemanticSessionHandle> = {
            let guard = self.inner.sessions.read().await;
            guard.values().cloned().collect()
        };
        let active_sessions = handles.len();
        let (_, _, _, retiring_trees_with_child) = self.snapshot_retiring_accounting();

        let mut total_open_documents = 0;
        let mut total_overlay_bytes = 0;
        let mut total_in_flight_requests = 0;

        for handle in handles {
            let diag = handle.diagnostics();
            total_open_documents += diag.open_documents;
            total_overlay_bytes += diag.overlay_bytes;
            total_in_flight_requests += diag.in_flight_requests;
        }

        let tool_integrity = self.tool_integrity_status().map(|s| format!("{:?}", s));

        let state = if self.is_safe_disabled() {
            SemanticState::SafeDisabled
        } else if !enabled {
            SemanticState::Disabled
        } else if active_sessions == 0 && retiring_trees_with_child == 0 {
            SemanticState::Idle
        } else {
            SemanticState::Ready
        };
        SemanticAggregateStatus {
            state,
            enabled,
            active_sessions,
            active_trees: active_sessions + retiring_trees_with_child,
            open_documents: total_open_documents,
            total_overlay_bytes,
            in_flight_requests: total_in_flight_requests,
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
            let diag = handle.diagnostics();
            if diag.open_documents == 0 && diag.in_flight_requests == 0 {
                self.close_session(&key).await;
            }
        }
    }

    /// Clean shutdown of all running semantic child processes and sessions,
    /// also awaiting any in-flight background reap tasks and retiring handles.
    pub async fn shutdown(&self) {
        self.revoke_admission();
        let handles: Vec<SemanticSessionHandle> = {
            let mut guard = self.inner.sessions.write().await;
            let list: Vec<SemanticSessionHandle> = guard.drain().map(|(_, h)| h).collect();
            self.detach_and_register_retiring(&list);
            list
        };

        self.reap_sessions(handles).await;

        let tasks = {
            let mut reap_guard = self
                .inner
                .active_reap_tasks
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut *reap_guard)
        };
        for task in tasks {
            let _ = task.await;
        }

        let remaining_retiring: Vec<SemanticSessionHandle> = {
            let mut retiring = self
                .inner
                .retiring_sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            retiring.retain(|_, entry| !entry.is_finished_and_clean());
            retiring
                .values()
                .filter_map(|entry| entry.to_handle())
                .collect()
        };
        if !remaining_retiring.is_empty() {
            self.reap_sessions(remaining_retiring).await;
        }
    }
}
