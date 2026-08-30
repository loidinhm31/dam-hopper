use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::OsString,
    io::Read as _,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

use portable_pty::{Child as PtyChild, CommandBuilder, NativePtySystem, PtySize, PtySystem as _};
#[cfg(test)]
use std::sync::atomic::AtomicBool;
use tokio::sync::mpsc;
#[cfg(test)]
use tokio::sync::Notify;
use tracing::{debug, info, warn};

use crate::{
    config::schema::RestartPolicy,
    diagnostics::{redact_diagnostic_text, DiagnosticStore, TerminalTail},
    error::AppError,
    fs::FsSubsystem,
    persistence::SessionStore,
    port_forward::PortForwardManager,
    pty::{
        event_sink::EventSink,
        output_control_parser::Utf8StreamDecoder,
        session::{DeadSession, LiveSession, RespawnOpts, SessionMeta, SessionType},
        shell_integration::ShellIntegration,
        shell_lifecycle::{LifecycleEvent, LifecycleState, ShellLifecycle},
    },
    workspace_target::{
        target_path_identity, target_path_is_within, target_path_relative, ProjectTargetRef,
        WorkspaceTargetError, WorkspaceTargetResolver,
    },
};

#[cfg(not(windows))]
use crate::pty::shell_integration::interactive_shell_executable;

const DEAD_SESSION_TTL: Duration = Duration::from_secs(60);
/// Validation regex equivalent: allow word chars, colons, dots, hyphens.
const SESSION_ID_MAX_LEN: usize = 128;
/// Maximum backoff delay for auto-restart: 30 seconds.
const MAX_RESTART_DELAY_MS: u64 = 30_000;
const SAFE_BASELINE_ENV_VARS: &[&str] = &[
    "PATH",
    // User-owned OTel attributes must survive unchanged.
    "OTEL_RESOURCE_ATTRIBUTES",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "PNPM_HOME",
    "SSH_AUTH_SOCK",
    "GPG_TTY",
    "COLORTERM",
];

#[derive(Debug)]
pub struct TerminalBufferReplay {
    pub data: String,
    pub offset: u64,
    pub reset: bool,
    pub truncated: bool,
}

#[derive(Debug)]
pub struct TerminalAttachSnapshot {
    pub replay: TerminalBufferReplay,
    pub editing_generation: Option<u64>,
}

// ---------------------------------------------------------------------------
// Restart engine types
// ---------------------------------------------------------------------------

/// Command sent from reader_thread to the supervisor task to request a respawn.
#[derive(Clone)]
struct RespawnCmd {
    id: String,
    /// Incarnation that exited and requested this restart. A newer create or
    /// restart with the same public ID invalidates this command.
    incarnation: u64,
    /// Disposal generation of the session that requested the restart.
    /// A dispose increments the generation so queued or in-flight restarts
    /// cannot publish a new live session after cleanup.
    generation: u64,
    _prev_exit_code: i32,
    restart_count: u32,
    respawn_opts: RespawnOpts,
    delay_ms: u64,
}

#[cfg(test)]
pub(crate) struct RespawnTestHook {
    entered: Notify,
    release: Notify,
    pause_next: AtomicBool,
}

#[cfg(test)]
impl RespawnTestHook {
    fn new() -> Self {
        Self {
            entered: Notify::new(),
            release: Notify::new(),
            pause_next: AtomicBool::new(false),
        }
    }

    pub(crate) fn pause_next(&self) {
        self.pause_next.store(true, Ordering::Release);
    }

    pub(crate) async fn wait_until_paused(&self) {
        self.entered.notified().await;
    }

    pub(crate) fn release(&self) {
        self.release.notify_one();
    }

    async fn wait_if_paused(&self) {
        if self.pause_next.swap(false, Ordering::AcqRel) {
            self.entered.notify_one();
            self.release.notified().await;
        }
    }
}

#[cfg(test)]
struct CreatePauseState {
    pause_next: bool,
    paused: bool,
}

#[cfg(test)]
pub(crate) struct CreateTestHook {
    entered: Notify,
    state: Mutex<CreatePauseState>,
    released: Condvar,
}

#[cfg(test)]
impl CreateTestHook {
    fn new() -> Self {
        Self {
            entered: Notify::new(),
            state: Mutex::new(CreatePauseState {
                pause_next: false,
                paused: false,
            }),
            released: Condvar::new(),
        }
    }

    pub(crate) fn pause_next(&self) {
        self.state.lock().unwrap().pause_next = true;
    }

    pub(crate) async fn wait_until_paused(&self) {
        self.entered.notified().await;
    }

    pub(crate) fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.paused = false;
        self.released.notify_one();
    }

    fn wait_if_paused(&self) {
        let mut state = self.state.lock().unwrap();
        if !state.pause_next {
            return;
        }

        state.pause_next = false;
        state.paused = true;
        self.entered.notify_one();
        while state.paused {
            state = self.released.wait(state).unwrap();
        }
    }
}

#[cfg(test)]
struct SpawnPauseState {
    pause_next: bool,
    paused: bool,
}

#[cfg(test)]
pub(crate) struct SpawnTestHook {
    entered: Notify,
    state: Mutex<SpawnPauseState>,
    released: Condvar,
    async_release: Notify,
}

#[cfg(test)]
impl SpawnTestHook {
    fn new() -> Self {
        Self {
            entered: Notify::new(),
            state: Mutex::new(SpawnPauseState {
                pause_next: false,
                paused: false,
            }),
            released: Condvar::new(),
            async_release: Notify::new(),
        }
    }

    pub(crate) fn pause_next(&self) {
        self.state.lock().unwrap().pause_next = true;
    }

    pub(crate) async fn wait_until_paused(&self) {
        self.entered.notified().await;
    }

    pub(crate) fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.paused = false;
        self.released.notify_one();
        self.async_release.notify_one();
    }

    fn begin_pause(&self) -> bool {
        let mut state = self.state.lock().unwrap();
        if !state.pause_next {
            return false;
        }
        state.pause_next = false;
        state.paused = true;
        self.entered.notify_one();
        true
    }

    fn wait_if_paused_sync(&self) {
        if !self.begin_pause() {
            return;
        }

        let mut state = self.state.lock().unwrap();
        while state.paused {
            state = self.released.wait(state).unwrap();
        }
    }

    async fn wait_if_paused_async(&self) {
        if !self.begin_pause() {
            return;
        }
        self.async_release.notified().await;
    }
}

struct LifecycleGateState {
    active: usize,
    disposing: bool,
    closing: bool,
}

struct LifecycleGate {
    state: Mutex<LifecycleGateState>,
    changed: Condvar,
}

struct LifecyclePermit {
    gate: Arc<LifecycleGate>,
}

struct LifecycleDrain {
    gate: Arc<LifecycleGate>,
}

impl LifecycleGate {
    fn new() -> Self {
        Self {
            state: Mutex::new(LifecycleGateState {
                active: 0,
                disposing: false,
                closing: false,
            }),
            changed: Condvar::new(),
        }
    }

    fn begin(self: &Arc<Self>) -> Result<LifecyclePermit, AppError> {
        let mut state = self.state.lock().unwrap();
        while state.disposing {
            state = self.changed.wait(state).unwrap();
        }
        if state.closing {
            return Err(AppError::Unavailable("PTY manager is shutting down".into()));
        }
        state.active += 1;
        Ok(LifecyclePermit {
            gate: Arc::clone(self),
        })
    }

    fn try_begin(self: &Arc<Self>) -> Option<LifecyclePermit> {
        let mut state = self.state.lock().unwrap();
        if state.disposing || state.closing {
            return None;
        }
        state.active += 1;
        Some(LifecyclePermit {
            gate: Arc::clone(self),
        })
    }

    fn begin_dispose(self: &Arc<Self>, closing: bool) -> LifecycleDrain {
        let mut state = self.state.lock().unwrap();
        while state.disposing {
            state = self.changed.wait(state).unwrap();
        }
        state.disposing = true;
        state.closing |= closing;
        while state.active > 0 {
            state = self.changed.wait(state).unwrap();
        }
        LifecycleDrain {
            gate: Arc::clone(self),
        }
    }

    fn is_disposing(&self) -> bool {
        self.state.lock().unwrap().disposing
    }
}

impl Drop for LifecyclePermit {
    fn drop(&mut self) {
        let mut state = self.gate.state.lock().unwrap();
        state.active = state.active.saturating_sub(1);
        if state.active == 0 {
            self.gate.changed.notify_all();
        }
    }
}

impl Drop for LifecycleDrain {
    fn drop(&mut self) {
        let mut state = self.gate.state.lock().unwrap();
        state.disposing = false;
        self.gate.changed.notify_all();
    }
}

struct ReaderRegistry {
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl ReaderRegistry {
    fn new() -> Self {
        Self {
            handles: Mutex::new(Vec::new()),
        }
    }

    fn register(&self, handle: JoinHandle<()>) {
        let mut finished = Vec::new();
        {
            let mut handles = self.handles.lock().unwrap();
            let mut active = Vec::with_capacity(handles.len() + 1);
            for handle in handles.drain(..) {
                if handle.is_finished() {
                    finished.push(handle);
                } else {
                    active.push(handle);
                }
            }
            active.push(handle);
            *handles = active;
        }
        for handle in finished {
            let _ = handle.join();
        }
    }

    fn join_all(&self) {
        let handles = std::mem::take(&mut *self.handles.lock().unwrap());
        for handle in handles {
            let _ = handle.join();
        }
    }
}

// ---------------------------------------------------------------------------
// PtyCreateOpts
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PtyCreateOpts {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    pub project: Option<String>,
    pub worktree_path: Option<String>,
    pub restart_policy: RestartPolicy,
    pub restart_max_retries: u32,
}

impl PtyCreateOpts {
    /// Returns a Clone-safe snapshot suitable for re-spawning this session.
    /// Excludes raw FDs (master/writer) which are not cloneable.
    pub fn clone_for_respawn(&self) -> RespawnOpts {
        RespawnOpts {
            id: self.id.clone(),
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            env: self.env.clone(),
            cols: self.cols,
            rows: self.rows,
            project: self.project.clone(),
            worktree_path: self.worktree_path.clone(),
            restart_policy: self.restart_policy,
            restart_max_retries: self.restart_max_retries,
        }
    }
}

/// Target resolver and lifecycle guard shared by automatic PTY respawns.
/// Installed after application state is built so test-only managers can remain
/// lightweight while production respawns fail closed on stale targets.
#[derive(Clone)]
pub struct PtyTargetContext {
    fs: FsSubsystem,
    resolver: WorkspaceTargetResolver,
    lifecycle_guard: Arc<tokio::sync::RwLock<()>>,
}

impl PtyTargetContext {
    pub fn new(
        fs: FsSubsystem,
        resolver: WorkspaceTargetResolver,
        lifecycle_guard: Arc<tokio::sync::RwLock<()>>,
    ) -> Self {
        Self {
            fs,
            resolver,
            lifecycle_guard,
        }
    }

    async fn validate_targeted_session(
        &self,
        project: &str,
        worktree_path: &str,
        requested_cwd: &str,
    ) -> Result<(String, String), AppError> {
        let sandbox = self.fs.sandbox().map_err(AppError::Fs)?;
        let configured_root = sandbox
            .project_root(project)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project}")))?;
        let target = self
            .resolver
            .resolve(
                &ProjectTargetRef {
                    project: project.to_string(),
                    worktree_path: Some(worktree_path.to_string()),
                },
                &configured_root,
            )
            .await?;
        let requested = PathBuf::from(requested_cwd);
        let proposed = if requested.is_absolute() {
            if target_path_is_within(&requested, target.target_path()) {
                requested
            } else {
                target_path_relative(&requested, &configured_root)
                    .map(|relative| target.target_path().join(relative))
                    .unwrap_or_else(|| PathBuf::from(requested_cwd))
            }
        } else {
            target.target_path().join(requested)
        };
        let cwd = sandbox
            .validate_target(&target, proposed)
            .await
            .map_err(AppError::Fs)?;
        if !cwd.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "Terminal cwd is not a directory: {}",
                cwd.display()
            )));
        }
        Ok((
            target.target_path().to_string_lossy().into_owned(),
            cwd.to_string_lossy().into_owned(),
        ))
    }
}

#[derive(serde::Serialize)]
pub struct SessionDetail {
    #[serde(flatten)]
    pub meta: SessionMeta,
    pub buffer_bytes: usize,
}

// ---------------------------------------------------------------------------
// PtySessionManager
// ---------------------------------------------------------------------------

/// Thread-safe PTY session manager.
///
/// All state is behind an `Arc<Mutex<Inner>>` so axum handlers can `.clone()`
/// the manager handle without wrapping it in another Arc.
#[derive(Clone)]
pub struct PtySessionManager {
    inner: Arc<Mutex<Inner>>,
    lifecycle_gate: Arc<LifecycleGate>,
    /// Serializes persistence snapshots with session replacement/disposal so
    /// an old reader cannot enqueue after a newer same-ID session is published.
    persistence_gate: Arc<Mutex<()>>,
    readers: Arc<ReaderRegistry>,
    sink: Arc<dyn EventSink>,
    /// Bounded sender (256 slots) for respawn requests from reader threads.
    /// Consumed by supervisor_loop task. If queue full, supervisor is dead/slow.
    respawn_tx: mpsc::Sender<RespawnCmd>,
    /// Optional FIFO sender for persistence commands to the worker thread.
    /// Bounded persistence channel. Periodic snapshots are best effort while
    /// lifecycle commands wait for space so shutdown stays durable.
    /// None only if the session DB failed to open at startup.
    persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    /// Optional session store for lazy buffer loading from SQLite.
    /// None only if the session DB failed to open at startup.
    session_store: Option<std::sync::Arc<crate::persistence::SessionStore>>,
    /// Port forward manager — set after construction via `set_port_forward_manager`.
    /// Shared with supervisor_loop so restarted sessions also get stdout scanning.
    pub port_forward_manager: Arc<std::sync::RwLock<Option<Arc<PortForwardManager>>>>,
    /// Backend diagnostics store — set after construction via `set_diagnostics`.
    /// Reader threads and lifecycle methods record terminal events here (Phase 03).
    diagnostics: Arc<std::sync::RwLock<Option<DiagnosticStore>>>,
    /// Target validation and lifecycle guard shared by automatic respawns.
    target_context: Arc<std::sync::RwLock<Option<PtyTargetContext>>>,
    /// Number of reader threads that can still enqueue final persistence
    /// commands. Shutdown waits for this to reach zero before closing the
    /// persistence worker.
    active_reader_count: Arc<AtomicUsize>,
    #[cfg(test)]
    respawn_test_hook: Arc<RespawnTestHook>,
    #[cfg(test)]
    create_test_hook: Arc<CreateTestHook>,
    #[cfg(test)]
    spawn_test_hook: Arc<SpawnTestHook>,
}

struct Inner {
    live: HashMap<String, LiveSession>,
    dead: HashMap<String, DeadSession>,
    /// Target-scoped creates that failed before an in-memory tombstone could
    /// be created. The API may convert one to an unavailable tombstone only
    /// while its public ID remains unclaimed by a newer incarnation.
    failed_replacements: HashMap<String, FailedReplacement>,
    /// Allocator for concrete PTY incarnations. The public session ID is
    /// intentionally reusable, so every persistence command carries this
    /// second identity as well.
    next_incarnation: u64,
    /// Incremented whenever all current sessions are disposed. Respawn commands
    /// from the previous generation are stale, even if their kill marker was
    /// already removed by tombstone cleanup. In-flight creates use the same
    /// fence before publishing a newly spawned session.
    generation: u64,
    /// Set only for terminal server shutdown. Workspace/settings disposal is
    /// reusable and therefore leaves this false.
    closing: bool,
    /// Track session IDs that were explicitly killed by user (kill/remove API).
    /// Reader thread checks this to prevent auto-restart after manual termination.
    killed: HashSet<String>,
    /// Count of replaced readers that must not emit exit events against reused
    /// public ids. Multiple rapid recreates can have multiple old readers.
    suppress_exit_counts: HashMap<String, usize>,
    /// PTY setup currently in progress for each reusable public id. This keeps
    /// a slow stale create/respawn from publishing after a newer replacement
    /// has started.
    pending_replacements: HashMap<String, u64>,
}

struct FailedReplacement {
    meta: SessionMeta,
    incarnation: u64,
    buffer: Option<Arc<Mutex<crate::pty::buffer::ScrollbackBuffer>>>,
    persistence: Option<FailedReplacementPersistence>,
    created_at: std::time::Instant,
}

/// Persistence-only snapshot retained when a target-scoped create fails
/// before a live PTY can emit the normal SessionCreated command.
#[derive(Clone)]
struct FailedReplacementPersistence {
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    restart_max_retries: u32,
}

impl From<&PtyCreateOpts> for FailedReplacementPersistence {
    fn from(opts: &PtyCreateOpts) -> Self {
        Self {
            env: HashMap::clone(&opts.env),
            cols: opts.cols,
            rows: opts.rows,
            restart_max_retries: opts.restart_max_retries,
        }
    }
}

impl Inner {
    fn new() -> Self {
        Self {
            live: HashMap::new(),
            dead: HashMap::new(),
            failed_replacements: HashMap::new(),
            next_incarnation: crate::pty::session::now_ms().saturating_mul(1024),
            generation: 0,
            closing: false,
            killed: HashSet::new(),
            suppress_exit_counts: HashMap::new(),
            pending_replacements: HashMap::new(),
        }
    }

    fn allocate_incarnation(&mut self) -> u64 {
        let incarnation = self.next_incarnation;
        self.next_incarnation = self.next_incarnation.saturating_add(1);
        incarnation
    }

    fn begin_replacement(&mut self, id: &str) -> u64 {
        self.failed_replacements.remove(id);
        let incarnation = self.allocate_incarnation();
        self.pending_replacements
            .insert(id.to_string(), incarnation);
        incarnation
    }

    fn replacement_is_current(&self, id: &str, incarnation: u64) -> bool {
        self.pending_replacements.get(id).copied() == Some(incarnation)
    }

    fn finish_replacement(&mut self, id: &str, incarnation: u64) {
        if self.replacement_is_current(id, incarnation) {
            self.pending_replacements.remove(id);
        }
    }

    fn respawn_source_is_current(&self, id: &str, incarnation: u64) -> bool {
        !self.killed.contains(id)
            && !self.live.contains_key(id)
            && self
                .dead
                .get(id)
                .map(|session| session.incarnation == incarnation)
                .unwrap_or(false)
    }

    fn respawn_replacement_is_current(
        &self,
        id: &str,
        source_incarnation: u64,
        replacement_incarnation: u64,
    ) -> bool {
        self.respawn_source_is_current(id, source_incarnation)
            && self.replacement_is_current(id, replacement_incarnation)
    }

    fn advance_past(&mut self, persisted_max: Option<u64>) {
        if let Some(maximum) = persisted_max {
            self.next_incarnation = self
                .next_incarnation
                .max(maximum.saturating_add(1).min(i64::MAX as u64));
        }
    }
}

/// Serializes reader events against ID reuse. A reader from an older
/// incarnation may finish after a replacement has acquired the same public
/// session ID. Holding the manager lock through the ownership check and the
/// synchronous sink send means either the old event is delivered before the
/// replacement wins, or it is discarded after the replacement wins.
struct IncarnationEventSink {
    sink: Arc<dyn EventSink>,
    inner: Arc<Mutex<Inner>>,
    session_id: String,
    incarnation: u64,
}

impl IncarnationEventSink {
    fn new(
        sink: Arc<dyn EventSink>,
        inner: Arc<Mutex<Inner>>,
        session_id: String,
        incarnation: u64,
    ) -> Self {
        Self {
            sink,
            inner,
            session_id,
            incarnation,
        }
    }

    fn with_current(&self, emit: impl FnOnce(&dyn EventSink)) {
        let guard = self.inner.lock().unwrap();
        let no_newer_replacement = guard
            .pending_replacements
            .get(&self.session_id)
            .map(|incarnation| *incarnation == self.incarnation)
            .unwrap_or(true);
        let current = guard
            .live
            .get(&self.session_id)
            .map(|session| session.incarnation == self.incarnation)
            .or_else(|| {
                guard
                    .dead
                    .get(&self.session_id)
                    .map(|session| session.incarnation == self.incarnation)
            })
            .unwrap_or(false);
        if current && no_newer_replacement {
            emit(self.sink.as_ref());
        }
    }
}

impl EventSink for IncarnationEventSink {
    fn send_terminal_data(&self, session_id: &str, data: &str) {
        self.with_current(|sink| sink.send_terminal_data(session_id, data));
    }

    fn send_terminal_exit(&self, session_id: &str, exit_code: Option<i32>) {
        self.with_current(|sink| {
            sink.send_terminal_exit_enhanced_with_incarnation(
                session_id,
                exit_code,
                false,
                None,
                None,
                Some(self.incarnation),
            )
        });
    }

    fn send_terminal_changed(&self) {
        self.with_current(|sink| sink.send_terminal_changed());
    }

    fn send_terminal_lifecycle(
        &self,
        session_id: &str,
        state: &str,
        generation: u64,
        command: Option<&str>,
    ) {
        self.with_current(|sink| {
            sink.send_terminal_lifecycle(session_id, state, generation, command)
        });
    }

    fn broadcast(&self, event_type: &str, payload: serde_json::Value) {
        self.with_current(|sink| sink.broadcast(event_type, payload));
    }

    fn send_host_alert_changed(&self, alert: &crate::system::AlertSummary) {
        self.sink.send_host_alert_changed(alert);
    }

    fn send_host_resource_alert_changed(
        &self,
        incident: &crate::system::alerts::ResourceAlertIncident,
    ) {
        self.sink.send_host_resource_alert_changed(incident);
    }

    fn send_terminal_exit_enhanced(
        &self,
        session_id: &str,
        exit_code: Option<i32>,
        will_restart: bool,
        restart_in_ms: Option<u64>,
        restart_count: Option<u32>,
    ) {
        self.with_current(|sink| {
            sink.send_terminal_exit_enhanced_with_incarnation(
                session_id,
                exit_code,
                will_restart,
                restart_in_ms,
                restart_count,
                Some(self.incarnation),
            )
        });
    }

    fn send_terminal_exit_enhanced_with_incarnation(
        &self,
        session_id: &str,
        exit_code: Option<i32>,
        will_restart: bool,
        restart_in_ms: Option<u64>,
        restart_count: Option<u32>,
        _incarnation: Option<u64>,
    ) {
        self.with_current(|sink| {
            sink.send_terminal_exit_enhanced_with_incarnation(
                session_id,
                exit_code,
                will_restart,
                restart_in_ms,
                restart_count,
                Some(self.incarnation),
            )
        });
    }

    fn send_process_restarted(
        &self,
        session_id: &str,
        restart_count: u32,
        previous_exit_code: Option<i32>,
    ) {
        self.with_current(|sink| {
            sink.send_process_restarted(session_id, restart_count, previous_exit_code)
        });
    }
}

impl PtySessionManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self::with_persist(sink, None, None)
    }

    pub fn with_persist(
        sink: Arc<dyn EventSink>,
        persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
        session_store: Option<std::sync::Arc<crate::persistence::SessionStore>>,
    ) -> Self {
        // Bounded channel prevents DoS if supervisor hangs/panics.
        // 256 slots = ~5× typical max sessions (50). If full, supervisor is dead/slow.
        let (respawn_tx, respawn_rx) = mpsc::channel(256);

        // Clone respawn_tx before moving it into manager.
        let respawn_tx_clone = respawn_tx.clone();

        // Clone persist_tx before moving it into manager.
        let persist_tx_clone = persist_tx.clone();
        let session_store_clone = session_store.clone();

        let mut initial_inner = Inner::new();
        if let Some(store) = &session_store {
            match store.max_session_incarnation() {
                Ok(maximum) => initial_inner.advance_past(maximum),
                Err(error) => warn!(%error, "Failed to seed PTY incarnation allocator"),
            }
        }

        let manager = Self {
            inner: Arc::new(Mutex::new(initial_inner)),
            lifecycle_gate: Arc::new(LifecycleGate::new()),
            persistence_gate: Arc::new(Mutex::new(())),
            readers: Arc::new(ReaderRegistry::new()),
            sink: Arc::clone(&sink),
            respawn_tx,
            persist_tx,
            session_store,
            port_forward_manager: Arc::new(std::sync::RwLock::new(None)),
            diagnostics: Arc::new(std::sync::RwLock::new(None)),
            target_context: Arc::new(std::sync::RwLock::new(None)),
            active_reader_count: Arc::new(AtomicUsize::new(0)),
            #[cfg(test)]
            respawn_test_hook: Arc::new(RespawnTestHook::new()),
            #[cfg(test)]
            create_test_hook: Arc::new(CreateTestHook::new()),
            #[cfg(test)]
            spawn_test_hook: Arc::new(SpawnTestHook::new()),
        };

        // Spawn the supervisor task that handles respawn requests.
        let inner_clone = Arc::clone(&manager.inner);
        let sink_clone = Arc::clone(&sink);
        let pfm_cell = Arc::clone(&manager.port_forward_manager);
        let diag_cell = Arc::clone(&manager.diagnostics);
        let target_context_cell = Arc::clone(&manager.target_context);
        let active_reader_count = Arc::clone(&manager.active_reader_count);
        let lifecycle_gate = Arc::clone(&manager.lifecycle_gate);
        let persistence_gate = Arc::clone(&manager.persistence_gate);
        let readers = Arc::clone(&manager.readers);
        #[cfg(test)]
        let respawn_test_hook = Arc::clone(&manager.respawn_test_hook);
        #[cfg(test)]
        let spawn_test_hook = Arc::clone(&manager.spawn_test_hook);
        tokio::spawn(supervisor_loop(
            respawn_rx,
            inner_clone,
            sink_clone,
            respawn_tx_clone,
            persist_tx_clone,
            session_store_clone,
            pfm_cell,
            diag_cell,
            target_context_cell,
            active_reader_count,
            lifecycle_gate,
            persistence_gate,
            readers,
            #[cfg(test)]
            respawn_test_hook,
            #[cfg(test)]
            spawn_test_hook,
        ));

        manager
    }

    pub fn set_target_context(&self, context: PtyTargetContext) {
        let mut target_context = self.target_context.write().unwrap();
        *target_context = Some(context);
    }

    pub async fn validate_targeted_session(
        &self,
        project: &str,
        worktree_path: &str,
        requested_cwd: &str,
    ) -> Result<(String, String), AppError> {
        let context = self.target_context.read().unwrap().clone().ok_or_else(|| {
            AppError::Unavailable("terminal target context is unavailable".into())
        })?;
        context
            .validate_targeted_session(project, worktree_path, requested_cwd)
            .await
    }

    #[cfg(test)]
    pub(crate) fn test_respawn_hook(&self) -> Arc<RespawnTestHook> {
        Arc::clone(&self.respawn_test_hook)
    }

    #[cfg(test)]
    pub(crate) fn test_create_hook(&self) -> Arc<CreateTestHook> {
        Arc::clone(&self.create_test_hook)
    }

    #[cfg(test)]
    pub(crate) fn test_spawn_hook(&self) -> Arc<SpawnTestHook> {
        Arc::clone(&self.spawn_test_hook)
    }

    #[cfg(test)]
    pub(crate) fn test_is_disposing(&self) -> bool {
        self.lifecycle_gate.is_disposing()
    }

    /// Wire the backend diagnostics store after construction (Phase 03).
    /// Matches the `set_port_forward_manager` pattern — avoids breaking existing
    /// `PtySessionManager::new` callers in tests.
    pub fn set_diagnostics(&self, store: DiagnosticStore) {
        let mut cell = self.diagnostics.write().unwrap();
        *cell = Some(store);
    }

    /// Best-effort diagnostic event recording. Clones the cheap Arc-backed store
    /// out of the RwLock so no lock is held during `record_event`.
    fn record_diag(&self, source: &str, message: &str, fields: BTreeMap<String, String>) {
        if let Some(store) = self.diagnostics.read().unwrap().clone() {
            store.record_terminal_event(source, message, fields);
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    pub fn create(&self, opts: PtyCreateOpts) -> Result<SessionMeta, AppError> {
        self.create_with_buffer(opts, None)
    }

    /// Create a restored session with its persisted scrollback hydrated before
    /// the reader thread can append output or persist a newer snapshot.
    pub fn create_with_buffer(
        &self,
        opts: PtyCreateOpts,
        initial_buffer: Option<(Vec<u8>, u64)>,
    ) -> Result<SessionMeta, AppError> {
        validate_session_id(&opts.id)?;
        let _lifecycle_permit = self.lifecycle_gate.begin()?;
        let _persistence_guard = self.persistence_gate.lock().unwrap();

        let (retrying_unavailable_target, retry_buffer) = {
            let inner = self.inner.lock().unwrap();
            inner
                .dead
                .get(&opts.id)
                .map(|session| {
                    (
                        session.meta.target_unavailable,
                        session.buffer.as_ref().map(Arc::clone),
                    )
                })
                .unwrap_or((false, None))
        };
        let fallback_buffer = retry_buffer.as_ref().map(Arc::clone);

        // Kill any existing session with this ID before recreating.
        self.kill_internal_impl(&opts.id, true);

        // Allocate the new concrete identity before slow PTY setup. Reader
        // threads from the evicted incarnation may finish at any time, and
        // their persistence commands must never be able to mutate this one.
        let incarnation = {
            let mut inner = self.inner.lock().unwrap();
            inner.begin_replacement(&opts.id)
        };
        let mut failure_meta = SessionMeta::new_with_target(
            opts.id.clone(),
            opts.project.clone(),
            opts.command.clone(),
            opts.cwd.clone(),
            opts.worktree_path.clone(),
            opts.restart_policy,
        );
        failure_meta.incarnation = incarnation;
        let failure_persistence = FailedReplacementPersistence::from(&opts);

        // Release lock before slow I/O operations (openpty, spawn_command).
        // Reacquire after spawn to update state atomically.
        // SAFETY: kill_internal marks session as killed, so supervisor won't
        // restart it even if we're preempted here.
        let creation_generation = {
            let inner = self.inner.lock().unwrap();
            if inner.closing {
                return Err(AppError::Unavailable("PTY manager is shutting down".into()));
            }
            inner.generation
        };

        #[cfg(test)]
        self.spawn_test_hook.wait_if_paused_sync();

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                self.mark_replacement_failed(
                    &opts.id,
                    incarnation,
                    false,
                    retrying_unavailable_target,
                    fallback_buffer.clone(),
                    Some(failure_meta.clone()),
                    Some(failure_persistence.clone()),
                );
                AppError::PtyError(e.to_string())
            })?;

        let integration = ShellIntegration::prepare(&opts.command, &opts.env);
        let mut cmd = build_command(&opts.command, &opts.cwd, &opts.env);
        apply_child_env(&mut cmd, &opts.env);
        if let Some(integration) = &integration {
            integration.apply(&mut cmd);
        }
        // Log env keys only — values may contain secrets (API keys, tokens).
        debug!(id = %opts.id, env_keys = ?opts.env.keys().collect::<Vec<_>>(), "Spawning PTY");
        let session_id_for_diag = opts.id.clone();
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
            let error = format!("spawn failed: {e}");
            let mut fields = BTreeMap::new();
            fields.insert("sessionId".into(), session_id_for_diag.clone());
            fields.insert("error".into(), error.clone());
            if let Some(project) = &opts.project {
                fields.insert("project".into(), project.clone());
            }
            self.record_diag("pty", "terminal.spawn_failed", fields);
            self.mark_replacement_failed(
                &opts.id,
                incarnation,
                false,
                retrying_unavailable_target,
                fallback_buffer.clone(),
                Some(failure_meta.clone()),
                Some(failure_persistence.clone()),
            );
            AppError::PtyError(error)
        })?;

        // portable-pty requires clone_reader before take_writer
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let _ = child.kill();
                self.mark_replacement_failed(
                    &opts.id,
                    incarnation,
                    false,
                    retrying_unavailable_target,
                    fallback_buffer.clone(),
                    Some(failure_meta.clone()),
                    Some(failure_persistence.clone()),
                );
                return Err(AppError::PtyError(format!("clone_reader failed: {error}")));
            }
        };

        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let _ = child.kill();
                self.mark_replacement_failed(
                    &opts.id,
                    incarnation,
                    false,
                    retrying_unavailable_target,
                    fallback_buffer.clone(),
                    Some(failure_meta.clone()),
                    Some(failure_persistence.clone()),
                );
                return Err(AppError::PtyError(format!("take_writer failed: {error}")));
            }
        };

        let child_killer = child.clone_killer();
        let respawn_opts = opts.clone_for_respawn();
        let RespawnOpts {
            env: persisted_env, ..
        } = respawn_opts.clone();
        let project_name = opts.project.clone();
        let meta = failure_meta.clone();

        let lifecycle = integration.as_ref().map(ShellIntegration::lifecycle);
        let session = LiveSession::new(
            meta.clone(),
            incarnation,
            pair.master,
            writer,
            child_killer,
            respawn_opts,
            lifecycle,
            integration,
        );
        let buffer = session.buffer_ref();
        let shutdown = session.shutdown_ref();
        let lifecycle = session.lifecycle.clone();
        let published_editing = session.published_editing_ref();

        #[cfg(test)]
        self.create_test_hook.wait_if_paused();

        let generation = {
            let mut inner = self.inner.lock().unwrap();
            if !inner.replacement_is_current(&opts.id, incarnation) {
                drop(inner);
                session.terminate();
                return Err(AppError::PtyError(
                    "PTY replacement was superseded by a newer request".into(),
                ));
            }
            if self.lifecycle_gate.is_disposing()
                || inner.closing
                || inner.generation != creation_generation
            {
                drop(inner);
                session.terminate();
                return Err(AppError::Unavailable(
                    "PTY manager was disposed during PTY creation".into(),
                ));
            }
            // TOCTOU guard: if concurrent create() already inserted this ID while
            // we were spawning, kill it and replace (matches pre-existing behavior).
            if let Some(existing) = inner.live.remove(&opts.id) {
                warn!(id = %opts.id, "Concurrent create detected, replacing existing session");
                existing.terminate();
            }
            inner.dead.remove(&opts.id);
            // Clear killed flag after successful spawn:
            // 1. Cancels any pending supervisor restart queued during backoff
            // 2. Re-enables auto-restart for future crashes (if policy != never)
            // This ensures create() is fully idempotent across race conditions.
            inner.killed.remove(&opts.id);
            inner.live.insert(opts.id.clone(), session);
            creation_generation
        };

        let port_forward_manager = self.port_forward_manager.read().unwrap().clone();
        if let Some(pfm) = &port_forward_manager {
            pfm.register_session(&opts.id, incarnation);
        }

        // Hydrate before the reader starts appending output. Startup restore
        // supplies the persisted snapshot explicitly; retrying an unavailable
        // identity reuses its in-memory tombstone or loads the durable row.
        if let Some((data, total_written)) = initial_buffer {
            buffer.lock().unwrap().hydrate(&data, total_written);
        } else if retrying_unavailable_target {
            if let Some(retry_buffer) = retry_buffer {
                let (data, total_written) = retry_buffer.lock().unwrap().snapshot();
                buffer.lock().unwrap().hydrate(&data, total_written);
            } else if let Some(store) = &self.session_store {
                match store.load_buffer(&opts.id) {
                    Ok(Some((data, total_written))) => {
                        buffer.lock().unwrap().hydrate(&data, total_written);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        warn!(
                            session_id = %opts.id,
                            %error,
                            "Failed to hydrate persisted terminal buffer"
                        );
                    }
                }
            }
        }

        // Record terminal lifecycle event for diagnostics (Phase 03).
        // Env keys only — values may contain secrets; cwd is a path, not a secret.
        {
            let mut fields = BTreeMap::new();
            fields.insert("sessionId".into(), opts.id.clone());
            fields.insert(
                "sessionType".into(),
                format!("{:?}", SessionType::from_id(&opts.id)),
            );
            fields.insert("cwd".into(), opts.cwd.clone());
            fields.insert("cols".into(), opts.cols.to_string());
            fields.insert("rows".into(), opts.rows.to_string());
            fields.insert(
                "envKeys".into(),
                opts.env.keys().cloned().collect::<Vec<_>>().join(","),
            );
            fields.insert("restartPolicy".into(), format!("{:?}", opts.restart_policy));
            if let Some(project) = &opts.project {
                fields.insert("project".into(), project.clone());
            }
            self.record_diag("pty", "terminal.create", fields);
        }

        // Persist metadata before the reader starts so fast commands cannot
        // flush output before the SQLite session row exists.
        persist_session_created(
            &self.persist_tx,
            self.session_store.as_deref(),
            &meta,
            incarnation,
            &persisted_env,
            opts.cols,
            opts.rows,
            opts.restart_max_retries,
        );

        // Spawn dedicated reader thread — portable-pty reads are blocking.
        // Must NOT use tokio::spawn_blocking: it consumes a Tokio worker thread
        // for the entire session lifetime, causing starvation under load.
        let session_id = opts.id.clone();
        let sink: Arc<dyn EventSink> = Arc::new(IncarnationEventSink::new(
            Arc::clone(&self.sink),
            Arc::clone(&self.inner),
            session_id.clone(),
            incarnation,
        ));
        let inner_ref = Arc::clone(&self.inner);
        let respawn_tx = self.respawn_tx.clone();
        let persist_tx = self.persist_tx.clone();
        let session_store = self.session_store.clone();
        let port_forward_manager_for_failure = port_forward_manager.clone();
        let persistence_gate = Arc::clone(&self.persistence_gate);
        let port_forward_manager = self.port_forward_manager.read().unwrap().clone();
        let rt_handle = tokio::runtime::Handle::try_current().ok();
        let diag_store = self.diagnostics.read().unwrap().clone();
        self.active_reader_count.fetch_add(1, Ordering::AcqRel);
        let active_reader_count = Arc::clone(&self.active_reader_count);
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader:{session_id}"))
            .spawn(move || {
                reader_thread(
                    session_id,
                    incarnation,
                    generation,
                    reader,
                    child,
                    buffer,
                    shutdown,
                    sink,
                    inner_ref,
                    respawn_tx,
                    persist_tx,
                    session_store,
                    persistence_gate,
                    port_forward_manager,
                    project_name,
                    rt_handle,
                    diag_store,
                    lifecycle,
                    published_editing,
                    active_reader_count,
                );
            })
            .map_err(|e| {
                self.active_reader_count.fetch_sub(1, Ordering::AcqRel);
                if let Some(pfm) = &port_forward_manager_for_failure {
                    pfm.unregister_session(&opts.id, incarnation);
                }
                self.mark_replacement_failed(
                    &opts.id,
                    incarnation,
                    false,
                    retrying_unavailable_target,
                    fallback_buffer.clone(),
                    Some(failure_meta.clone()),
                    Some(failure_persistence.clone()),
                );
                self.kill_internal_impl(&opts.id, true);
                AppError::PtyError(format!("thread spawn failed: {e}"))
            })?;
        self.readers.register(reader_handle);

        self.inner
            .lock()
            .unwrap()
            .finish_replacement(&opts.id, incarnation);

        self.sink.send_terminal_changed();
        info!(id = %opts.id, "PTY session created");

        Ok(meta)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner
            .live
            .get(id)
            .ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        session
            .write(data)
            .map_err(|e| AppError::PtyError(e.to_string()))
    }

    /// Capture replay bytes and lifecycle state at one PTY boundary.
    ///
    /// Attach responses are per connection. Returning both values together
    /// prevents a client from combining an older replay with a newer editing
    /// state while the PTY reader advances between separate manager calls.
    pub fn get_attach_snapshot(
        &self,
        id: &str,
        from_offset: Option<u64>,
    ) -> Result<TerminalAttachSnapshot, AppError> {
        let inner = self.inner.lock().unwrap();
        if let Some(session) = inner.live.get(id) {
            let lifecycle = session
                .lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.lock().unwrap());
            let buffer = session.buffer.lock().unwrap();
            let replay = buffer.read_replay(from_offset);
            return Ok(TerminalAttachSnapshot {
                replay: TerminalBufferReplay {
                    data: String::from_utf8_lossy(replay.data).into_owned(),
                    offset: replay.offset,
                    reset: replay.reset,
                    truncated: replay.truncated,
                },
                editing_generation: lifecycle.as_ref().and_then(|lifecycle| {
                    attach_editing_generation(
                        lifecycle,
                        session.published_editing.load(Ordering::Acquire),
                    )
                }),
            });
        }
        drop(inner);

        Ok(TerminalAttachSnapshot {
            replay: self.get_buffer_with_offset(id, from_offset)?,
            editing_generation: None,
        })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner
            .live
            .get(id)
            .ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        session
            .resize(cols, rows)
            .map_err(|e| AppError::PtyError(e.to_string()))
    }

    pub fn get_buffer(&self, id: &str) -> Result<String, AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner
            .live
            .get(id)
            .ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        let buf = session.buffer.lock().unwrap();
        Ok(buf.as_str_lossy().into_owned())
    }

    /// Returns buffer data from a given offset + current buffer offset.
    ///
    /// If `from_offset` is older than buffer start, returns the full buffer.
    /// Returns (data, current_offset) tuple.
    ///
    /// ## Fallback to persistence
    /// If session not found in live sessions, checks persistence store for dead session buffer.
    pub fn get_buffer_with_offset(
        &self,
        id: &str,
        from_offset: Option<u64>,
    ) -> Result<TerminalBufferReplay, AppError> {
        let inner = self.inner.lock().unwrap();

        // Try in-memory first (live sessions)
        if let Some(session) = inner.live.get(id) {
            let buf = session.buffer.lock().unwrap();
            let replay = buf.read_replay(from_offset);
            return Ok(TerminalBufferReplay {
                data: String::from_utf8_lossy(replay.data).into_owned(),
                offset: replay.offset,
                reset: replay.reset,
                truncated: replay.truncated,
            });
        }

        // A dead tombstone can still own the final in-memory buffer while
        // its persistence commands are queued. Prefer it so attach/retry is
        // not briefly behind the bytes the reader has already observed.
        if let Some(session) = inner.dead.get(id) {
            if let Some(buffer) = &session.buffer {
                let buffer = buffer.lock().unwrap();
                let replay = buffer.read_replay(from_offset);
                return Ok(TerminalBufferReplay {
                    data: String::from_utf8_lossy(replay.data).into_owned(),
                    offset: replay.offset,
                    reset: replay.reset,
                    truncated: replay.truncated,
                });
            }
        }

        // Release lock before slow I/O
        drop(inner);

        // Fallback to persistence (for dead sessions)
        if let Some(store) = &self.session_store {
            if let Some((data, total_written)) = store
                .load_buffer(id)
                .map_err(|e| AppError::PersistenceError(e.to_string()))?
            {
                let buffer_start_offset = total_written.saturating_sub(data.len() as u64);
                let (slice, reset, truncated) = match from_offset {
                    None => (&data[..], true, false),
                    Some(offset) if offset < buffer_start_offset => (&data[..], true, true),
                    Some(offset) if offset > total_written => (&data[..], true, false),
                    Some(offset) => {
                        let skip = (offset - buffer_start_offset) as usize;
                        (&data[skip.min(data.len())..], false, false)
                    }
                };
                return Ok(TerminalBufferReplay {
                    data: String::from_utf8_lossy(slice).into_owned(),
                    offset: total_written,
                    reset,
                    truncated,
                });
            }
        }

        Err(AppError::SessionNotFound(id.to_string()))
    }

    /// Returns a capped terminal scrollback tail for diagnostics export (Phase 03).
    /// Tries the in-memory live buffer first, falls back to the persisted buffer
    /// for dead sessions. The returned text is redacted and capped to `max_bytes`.
    /// Returns `None` if the session has no buffer (live or persisted).
    pub fn terminal_tail(&self, id: &str, max_bytes: usize) -> Option<TerminalTail> {
        // Try in-memory live buffer first.
        {
            let inner = self.inner.lock().unwrap();
            if let Some(session) = inner.live.get(id) {
                let buf = session.buffer.lock().unwrap();
                let (data, total_written) = buf.read_from(None);
                let start = data.len().saturating_sub(max_bytes);
                let tail_bytes = data.len() - start;
                let tail = redact_diagnostic_text(&String::from_utf8_lossy(&data[start..]));
                return Some(TerminalTail {
                    session_id: id.to_string(),
                    tail,
                    tail_bytes,
                    total_written,
                    source: "live".to_string(),
                });
            }
        }

        // Fallback to persistence (dead sessions).
        if let Some(store) = &self.session_store {
            if let Ok(Some((data, total_written))) = store.load_buffer(id) {
                let start = data.len().saturating_sub(max_bytes);
                let tail_bytes = data.len() - start;
                let tail = redact_diagnostic_text(&String::from_utf8_lossy(&data[start..]));
                return Some(TerminalTail {
                    session_id: id.to_string(),
                    tail,
                    tail_bytes,
                    total_written,
                    source: "persisted".to_string(),
                });
            }
        }

        None
    }

    pub fn kill(&self, id: &str) -> Result<(), AppError> {
        self.record_diag(
            "pty",
            "terminal.kill",
            BTreeMap::from([("sessionId".into(), id.to_string())]),
        );
        self.kill_internal(id);
        Ok(())
    }

    /// Seeds a live session's scrollback with persisted buffer data.
    /// Called on startup restore so clients see pre-restart history on attach.
    pub fn hydrate_buffer(
        &self,
        id: &str,
        data: &[u8],
        total_written: u64,
    ) -> Result<(), AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner
            .live
            .get(id)
            .ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        session
            .buffer
            .lock()
            .unwrap()
            .hydrate_prefix(data, total_written);
        Ok(())
    }

    /// Kill + immediately evict all metadata (no 60s TTL).
    pub fn remove(&self, id: &str) -> Result<Option<u64>, AppError> {
        let _persistence_guard = self.persistence_gate.lock().unwrap();
        let mut inner = self.inner.lock().unwrap();
        // Allocate a removal watermark after any in-flight replacement. The
        // persistence worker uses it to reject a late SessionCreated from the
        // replacement that the user just removed, while allowing a genuinely
        // later create to persist normally.
        let removal_incarnation = inner.allocate_incarnation();
        let removed_incarnation = inner
            .live
            .get(id)
            .map(|session| session.incarnation)
            .or_else(|| inner.dead.get(id).map(|session| session.incarnation));
        inner.pending_replacements.remove(id);
        inner.failed_replacements.remove(id);
        // Mark as killed so reader thread won't restart.
        inner.killed.insert(id.to_string());
        // Terminate live session (if any) and record whether it was alive.
        let was_live = if let Some(session) = inner.live.remove(id) {
            session.terminate();
            true
        } else {
            false
        };
        inner.dead.remove(id);
        if let Some(incarnation) = removed_incarnation {
            if let Some(pfm) = self.port_forward_manager.read().unwrap().clone() {
                pfm.unregister_session(id, incarnation);
            }
        }
        drop(inner);

        // Record user-requested removal for diagnostics (Phase 03).
        self.record_diag(
            "pty",
            "terminal.remove",
            BTreeMap::from([
                ("sessionId".into(), id.to_string()),
                ("wasLive".into(), was_live.to_string()),
            ]),
        );

        // Send SessionRemoved to persist worker (if enabled)
        if let Some(tx) = &self.persist_tx {
            if let Err(e) = tx.send(crate::persistence::PersistCmd::SessionRemoved {
                session_id: id.to_string(),
                incarnation: removal_incarnation,
            }) {
                warn!("Failed to persist SessionRemoved: {}", e);
                if let Some(store) = &self.session_store {
                    store
                        .delete_session_for_incarnation(id, removal_incarnation)
                        .map_err(|store_error| {
                            AppError::PersistenceError(store_error.to_string())
                        })?;
                } else {
                    return Err(AppError::PersistenceError(e.to_string()));
                }
            }
        } else if let Some(store) = &self.session_store {
            store
                .delete_session_for_incarnation(id, removal_incarnation)
                .map_err(|store_error| AppError::PersistenceError(store_error.to_string()))?;
        }

        self.sink.send_terminal_changed();
        Ok(removed_incarnation)
    }

    pub fn is_alive(&self, id: &str) -> bool {
        self.inner.lock().unwrap().live.contains_key(id)
    }

    pub fn list(&self) -> Vec<SessionMeta> {
        let inner = self.inner.lock().unwrap();
        let mut result: Vec<SessionMeta> = inner.live.values().map(|s| s.meta.clone()).collect();
        result.extend(inner.dead.values().map(|d| d.meta.clone()));
        result
    }

    /// Rehydrate an unavailable session identity without attempting to spawn a
    /// process. Its persisted buffer remains available through the normal
    /// dead-session replay path, and a later create with the same ID can retry.
    pub fn restore_unavailable_session(&self, mut meta: SessionMeta, incarnation: u64) {
        meta.alive = false;
        meta.incarnation = incarnation;
        meta.target_unavailable = true;
        let id = meta.id.clone();
        let mut inner = self.inner.lock().unwrap();
        inner.live.remove(&id);
        inner.pending_replacements.remove(&id);
        inner.failed_replacements.remove(&id);
        inner.killed.remove(&id);
        inner
            .dead
            .insert(id, DeadSession::target_unavailable(meta, incarnation));
    }

    /// Convert a failed automatic respawn into a stable orphan tombstone and
    /// retain it in persistence so reconnecting clients can close or retry it.
    pub fn mark_target_unavailable(&self, id: &str, project: &str, worktree_path: &str) -> bool {
        let target_identity = target_path_identity(Path::new(worktree_path));
        let mut unavailable_persistence: Option<(SessionMeta, FailedReplacementPersistence)> = None;
        let incarnation = {
            let mut inner = self.inner.lock().unwrap();
            // A create failure is reported asynchronously, so it must not be
            // allowed to mark a newer live or in-flight incarnation as lost.
            if inner.live.contains_key(id) || inner.pending_replacements.contains_key(id) {
                return false;
            }
            if let Some(tombstone) = inner.dead.get(id) {
                let matches_target = tombstone.meta.project.as_deref() == Some(project)
                    && tombstone.meta.worktree_path.as_deref().is_some_and(|path| {
                        target_path_identity(Path::new(path)) == target_identity
                    });
                if !matches_target {
                    return false;
                }
                let tombstone = inner
                    .dead
                    .get_mut(id)
                    .expect("dead tombstone was checked immediately above");
                tombstone.meta.alive = false;
                tombstone.meta.target_unavailable = true;
                tombstone.will_restart = false;
                tombstone.restart_in_ms = None;
                tombstone.meta.incarnation = tombstone.incarnation;
                tombstone.incarnation
            } else {
                let Some(failed) = inner.failed_replacements.remove(id) else {
                    return false;
                };
                let matches_target = failed.meta.project.as_deref() == Some(project)
                    && failed.meta.worktree_path.as_deref().is_some_and(|path| {
                        target_path_identity(Path::new(path)) == target_identity
                    });
                if !matches_target {
                    inner.failed_replacements.insert(id.to_string(), failed);
                    return false;
                }
                let FailedReplacement {
                    meta,
                    incarnation: failed_incarnation,
                    buffer,
                    persistence,
                    ..
                } = failed;
                let mut tombstone = DeadSession::target_unavailable(meta, failed_incarnation);
                tombstone.buffer = buffer;
                unavailable_persistence =
                    persistence.map(|persistence| (tombstone.meta.clone(), persistence));
                let incarnation = tombstone.incarnation;
                inner.dead.insert(id.to_string(), tombstone);
                incarnation
            }
        };
        if let Some((meta, persistence)) = unavailable_persistence {
            persist_target_unavailable_with_metadata(
                &self.persist_tx,
                self.session_store.as_deref(),
                &meta,
                incarnation,
                &persistence,
            );
        } else {
            persist_target_unavailable(
                &self.persist_tx,
                self.session_store.as_deref(),
                id,
                incarnation,
            );
        }

        // Use the same incarnation guard as reader/supervisor events. This
        // keeps the initial create-failure path from publishing a stale event
        // if another replacement wins between state mutation and delivery.
        let event_sink: Arc<dyn EventSink> = Arc::new(IncarnationEventSink::new(
            Arc::clone(&self.sink),
            Arc::clone(&self.inner),
            id.to_string(),
            incarnation,
        ));
        event_sink.broadcast(
            "terminal:target-unavailable",
            serde_json::json!({
                "project": project,
                "worktreePath": worktree_path,
                "sessionId": id,
                "incarnation": incarnation,
                "targetUnavailable": true,
                "willRestart": false,
            }),
        );
        event_sink.send_terminal_changed();
        true
    }

    /// Close the replacement window after PTY setup fails. The old session has
    /// already been evicted by `create`; without this tombstone transition its
    /// persisted row could remain alive and be resurrected on restart.
    fn mark_replacement_failed(
        &self,
        id: &str,
        replacement_incarnation: u64,
        target_unavailable: bool,
        preserve_target_unavailable: bool,
        fallback_buffer: Option<Arc<Mutex<crate::pty::buffer::ScrollbackBuffer>>>,
        failure_meta: Option<SessionMeta>,
        failure_persistence: Option<FailedReplacementPersistence>,
    ) {
        finish_failed_replacement(
            &self.inner,
            &self.persist_tx,
            self.session_store.as_deref(),
            id,
            replacement_incarnation,
            target_unavailable,
            preserve_target_unavailable,
            fallback_buffer,
            failure_meta,
            failure_persistence,
        );
    }

    /// Return live sessions that are owned by a target. The immutable target
    /// marker handles shells that later `cd` elsewhere; cwd containment is
    /// reserved for older sessions created before target metadata existed.
    pub fn live_sessions_for_target(&self, project: &str, target_path: &Path) -> Vec<SessionMeta> {
        let inner = self.inner.lock().unwrap();
        inner
            .live
            .values()
            .filter_map(|session| {
                let meta = &session.meta;
                if meta.project.as_deref() != Some(project) {
                    return None;
                }
                let owns_target = match meta.worktree_path.as_deref() {
                    Some(path) => {
                        target_path_identity(Path::new(path)) == target_path_identity(target_path)
                    }
                    None => target_path_is_within(Path::new(&meta.cwd), target_path),
                };
                owns_target.then(|| meta.clone())
            })
            .collect()
    }

    pub fn list_detailed(&self) -> Vec<SessionDetail> {
        let inner = self.inner.lock().unwrap();
        let mut result: Vec<SessionDetail> = inner
            .live
            .values()
            .map(|s| SessionDetail {
                meta: s.meta.clone(),
                buffer_bytes: s.buffer.lock().unwrap().len(),
            })
            .collect();
        result.extend(inner.dead.values().map(|d| SessionDetail {
            meta: d.meta.clone(),
            buffer_bytes: 0,
        }));
        result
    }

    /// Dispose all sessions while keeping the manager reusable.
    pub fn dispose(&self) {
        self.dispose_internal(false);
    }

    /// Permanently close the manager and dispose all sessions for server exit.
    pub fn shutdown(&self) {
        self.dispose_internal(true);
        self.readers.join_all();
    }

    fn dispose_internal(&self, closing: bool) {
        let _lifecycle_drain = self.lifecycle_gate.begin_dispose(closing);
        let _persistence_guard = self.persistence_gate.lock().unwrap();
        let (sessions, live_session_ids) = {
            let mut inner = self.inner.lock().unwrap();
            info!(count = inner.live.len(), "Disposing all PTY sessions");
            inner.closing |= closing;
            inner.generation = inner.generation.wrapping_add(1);
            let live_session_ids = inner
                .live
                .iter()
                .map(|(id, session)| (id.clone(), session.incarnation))
                .collect::<Vec<_>>();
            let session_ids = inner
                .live
                .keys()
                .chain(inner.dead.keys())
                .cloned()
                .collect::<Vec<_>>();
            inner.killed.extend(session_ids);
            let sessions = inner
                .live
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<LiveSession>>();
            inner.dead.clear();
            inner.failed_replacements.clear();
            inner.pending_replacements.clear();
            (sessions, live_session_ids)
        };

        // Mark sessions killed before terminating them so reader threads cannot
        // enqueue an automatic restart while the server is leaving.
        for session in &sessions {
            session.terminate();
        }

        if let Some(pfm) = self.port_forward_manager.read().unwrap().clone() {
            for (id, incarnation) in live_session_ids {
                pfm.unregister_session(&id, incarnation);
            }
        }
    }

    /// Stop every current producer while keeping the reader-owned cleanup
    /// path alive. Reader threads must finish their final snapshots and exit
    /// commands before the persistence worker receives `Shutdown`.
    pub fn stop_all_for_shutdown(&self) {
        let port_forward_manager = self.port_forward_manager.read().unwrap().clone();
        {
            let mut inner = self.inner.lock().unwrap();
            let sessions = inner
                .live
                .iter()
                .map(|(id, session)| (id.clone(), session.incarnation))
                .collect::<Vec<_>>();
            for id in inner.live.keys().cloned().collect::<Vec<_>>() {
                inner.killed.insert(id);
            }
            for id in inner.dead.keys().cloned().collect::<Vec<_>>() {
                inner.killed.insert(id);
            }
            inner.pending_replacements.clear();
            inner.failed_replacements.clear();
            for session in inner.live.values() {
                session.terminate();
            }
            if let Some(pfm) = &port_forward_manager {
                for (id, incarnation) in &sessions {
                    pfm.unregister_session(id, *incarnation);
                }
            }
        }
    }

    /// Wait until all reader threads have completed their terminal persistence
    /// commands. This is async so graceful shutdown does not block a Tokio
    /// worker while a PTY read is unwinding.
    pub async fn wait_for_readers(&self) {
        while self.active_reader_count.load(Ordering::Acquire) != 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Persist full snapshots for all live sessions before graceful shutdown.
    pub fn snapshot_live_buffers(&self) {
        let _persistence_guard = self.persistence_gate.lock().unwrap();
        let snapshots = {
            let inner = self.inner.lock().unwrap();
            inner
                .live
                .iter()
                .map(|(id, session)| {
                    let (data, total_written) = session.buffer.lock().unwrap().snapshot();
                    (id.clone(), session.incarnation, data, total_written)
                })
                .collect::<Vec<_>>()
        };

        if snapshots.is_empty() {
            return;
        }

        for (session_id, incarnation, data, total_written) in snapshots {
            persist_buffer_snapshot(
                &self.persist_tx,
                self.session_store.as_deref(),
                &session_id,
                incarnation,
                data,
                total_written,
            );
        }
    }

    /// Spawn a tokio task that sweeps expired dead-session tombstones every 30s.
    pub fn spawn_cleanup_task(&self) {
        let inner = Arc::clone(&self.inner);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                let mut guard = inner.lock().unwrap();
                let before = guard.dead.len();
                guard
                    .dead
                    .retain(|_, d| d.died_at.elapsed() < DEAD_SESSION_TTL);
                let removed = before - guard.dead.len();
                if removed > 0 {
                    debug!(removed, "Dead session tombstones swept");
                }
                guard
                    .failed_replacements
                    .retain(|_, replacement| replacement.created_at.elapsed() < DEAD_SESSION_TTL);
                // Clean up killed set entries for sessions that no longer exist.
                // Prevents unbounded memory growth when session IDs are never reused.
                let before_killed = guard.killed.len();
                // Collect orphaned IDs to avoid borrow checker conflict with retain closure.
                let orphaned: Vec<String> = guard
                    .killed
                    .iter()
                    .filter(|id| !guard.live.contains_key(*id) && !guard.dead.contains_key(*id))
                    .cloned()
                    .collect();
                for id in orphaned {
                    guard.killed.remove(&id);
                }
                let removed_killed = before_killed - guard.killed.len();
                if removed_killed > 0 {
                    debug!(
                        removed = removed_killed,
                        "Orphaned killed set entries cleaned"
                    );
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    fn kill_internal(&self, id: &str) {
        let _persistence_guard = self.persistence_gate.lock().unwrap();
        self.kill_internal_impl(id, false);
    }

    fn kill_internal_impl(&self, id: &str, suppress_exit: bool) {
        let mut inner = self.inner.lock().unwrap();
        // Mark as killed BEFORE removing from live — reader thread checks this.
        inner.killed.insert(id.to_string());
        let removed_incarnation = if let Some(session) = inner.live.remove(id) {
            if suppress_exit {
                *inner
                    .suppress_exit_counts
                    .entry(id.to_string())
                    .or_insert(0) += 1;
            }

            let incarnation = session.incarnation;
            let buffer = session.buffer_ref();
            let shutdown = session.shutdown_ref();
            session.terminate();
            inner.dead.insert(
                id.to_string(),
                DeadSession::killed(session.meta, incarnation, Some(buffer), shutdown),
            );
            Some(incarnation)
        } else {
            None
        };
        if let Some(incarnation) = removed_incarnation {
            if let Some(pfm) = self.port_forward_manager.read().unwrap().clone() {
                pfm.unregister_session(id, incarnation);
            }
        }
        drop(inner);
    }
}

fn attach_editing_generation(lifecycle: &ShellLifecycle, published: bool) -> Option<u64> {
    (published && lifecycle.is_editing()).then_some(lifecycle.generation())
}

fn consume_suppressed_exit(inner: &mut Inner, session_id: &str) -> bool {
    let Some(count) = inner.suppress_exit_counts.get_mut(session_id) else {
        return false;
    };

    *count -= 1;
    if *count == 0 {
        inner.suppress_exit_counts.remove(session_id);
    }
    true
}

// ---------------------------------------------------------------------------
// Reader thread
// ---------------------------------------------------------------------------

struct ReaderGuard(Arc<AtomicUsize>);

impl Drop for ReaderGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn reader_thread(
    session_id: String,
    incarnation: u64,
    generation: u64,
    mut reader: Box<dyn std::io::Read + Send>,
    mut child: Box<dyn PtyChild + Send + Sync>,
    buffer: Arc<Mutex<crate::pty::buffer::ScrollbackBuffer>>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    sink: Arc<dyn EventSink>,
    inner: Arc<Mutex<Inner>>,
    respawn_tx: mpsc::Sender<RespawnCmd>,
    persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<Arc<SessionStore>>,
    persistence_gate: Arc<Mutex<()>>,
    port_forward_manager: Option<Arc<PortForwardManager>>,
    project: Option<String>,
    rt_handle: Option<tokio::runtime::Handle>,
    diag_store: Option<DiagnosticStore>,
    lifecycle: Option<Arc<Mutex<ShellLifecycle>>>,
    published_editing: Arc<std::sync::atomic::AtomicBool>,
    active_reader_count: Arc<AtomicUsize>,
) {
    let _reader_guard = ReaderGuard(active_reader_count);
    // Local helper to record a terminal lifecycle event from the reader thread.
    let record_diag = |message: &str, mut fields: BTreeMap<String, String>| {
        if let Some(store) = &diag_store {
            fields.insert("sessionId".into(), session_id.clone());
            if let Some(project) = &project {
                fields.insert("project".into(), project.clone());
            }
            store.record_terminal_event("pty", message, fields);
        }
    };

    let mut chunk = vec![0u8; 4096];
    let mut output_decoder = Utf8StreamDecoder::default();
    // Throttle periodic snapshots to one per 16KB. The bounded queue drops these
    // best-effort updates under pressure; reader completion always sends a final
    // snapshot before its lifecycle transition.
    let mut bytes_since_snapshot = 0usize;
    const SNAPSHOT_THRESHOLD: usize = 16 * 1024; // 16KB
                                                 // Lifecycle-only chunks must not announce editing before prompt bytes exist.
    let mut pending_lifecycle_events: Vec<(u64, LifecycleEvent)> = Vec::new();
    let mut visible_output_since_boundary = false;

    let mut process_chunk = |data: &[u8]| {
        let visible_data = if let Some(lifecycle) = &lifecycle {
            let (visible_data, generation, events) = {
                let mut lifecycle = lifecycle.lock().unwrap();
                let generation = lifecycle.generation();
                let alternate_buffer_event = lifecycle.observe_alternate_buffer(data);
                let (visible_data, mut events) = lifecycle.feed_visible(data);
                if let Some(event) = alternate_buffer_event {
                    events.insert(0, event);
                }
                (visible_data, generation, events)
            };
            if events
                .iter()
                .any(|event| event.state != LifecycleState::Editing)
            {
                published_editing.store(false, Ordering::Release);
            }
            for event in events {
                pending_lifecycle_events.push((generation, event));
            }
            visible_data
        } else {
            data.to_vec()
        };
        let snapshot = {
            let mut buf = buffer.lock().unwrap();
            buf.push(&visible_data);
            bytes_since_snapshot += visible_data.len();
            (bytes_since_snapshot >= SNAPSHOT_THRESHOLD && persist_tx.is_some())
                .then(|| buf.snapshot())
        };
        if let Some((snapshot_data, total_written)) = snapshot {
            let _persistence_guard = persistence_gate.lock().unwrap();
            let owns_live_session = {
                let inner_guard = inner.lock().unwrap();
                inner_guard.generation == generation
                    && inner_guard
                        .live
                        .get(&session_id)
                        .map(|session| Arc::ptr_eq(&session.shutdown_ref(), &shutdown))
                        .unwrap_or(false)
            };
            if owns_live_session {
                try_persist_buffer_update(
                    &persist_tx,
                    session_store.as_deref(),
                    &session_id,
                    incarnation,
                    snapshot_data,
                    total_written,
                );
                bytes_since_snapshot = 0;
            }
        }
        let data_str = output_decoder.decode(&visible_data);
        if let (Some(pfm), Some(handle)) = (&port_forward_manager, &rt_handle) {
            crate::port_forward::scan_chunk(
                &visible_data,
                &session_id,
                incarnation,
                project.as_deref(),
                pfm,
                handle,
            );
        }
        // A partial UTF-8 scalar has visible bytes but no terminal text yet.
        // Do not let that empty string flush an editing lifecycle boundary ahead
        // of the completed scalar in a later PTY read.
        if data_str.is_empty() && !visible_data.is_empty() {
            return;
        }
        if send_visible_output_then_lifecycle(
            sink.as_ref(),
            &session_id,
            &data_str,
            &mut pending_lifecycle_events,
            &mut visible_output_since_boundary,
        ) {
            published_editing.store(true, Ordering::Release);
        }
    };

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        match reader.read(&mut chunk) {
            Ok(0) => {
                // EOF — process exited
                debug!(id = %session_id, "PTY reader: EOF");
                record_diag("terminal.eof", BTreeMap::new());
                break;
            }
            Ok(n) => {
                process_chunk(&chunk[..n]);
            }
            Err(e) if is_eof_error(&e) => {
                debug!(id = %session_id, "PTY reader: connection closed");
                record_diag(
                    "terminal.eof",
                    BTreeMap::from([("reason".into(), e.to_string())]),
                );
                break;
            }
            Err(e) => {
                warn!(id = %session_id, error = %e, "PTY reader: read error");
                record_diag(
                    "terminal.read_error",
                    BTreeMap::from([("error".into(), e.to_string())]),
                );
                break;
            }
        }
    }

    drop(process_chunk);
    let decoded_tail = output_decoder.finish();
    if !decoded_tail.is_empty()
        && send_visible_output_then_lifecycle(
            sink.as_ref(),
            &session_id,
            &decoded_tail,
            &mut pending_lifecycle_events,
            &mut visible_output_since_boundary,
        )
    {
        published_editing.store(true, Ordering::Release);
    }

    // Collect real exit code from child. By the time the PTY reader sees EOF the
    // child has exited (slave-side fd closed), so wait() returns immediately.
    // Falls back to 0 on error (treated as clean exit).
    let exit_code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(0);
    info!(id = %session_id, exit_code, "PTY session exited");

    let (
        respawn_opts,
        restart_count,
        _was_killed,
        should_restart,
        _delay_ms,
        emit_exit,
        persist_exit,
    ) = {
        let mut inner_guard = inner.lock().unwrap();
        let was_killed =
            inner_guard.killed.contains(&session_id) || inner_guard.generation != generation;

        let owns_live_session = inner_guard
            .live
            .get(&session_id)
            .map(|session| {
                session.incarnation == incarnation
                    && Arc::ptr_eq(&session.shutdown_ref(), &shutdown)
            })
            .unwrap_or(false);

        if owns_live_session {
            let session = inner_guard
                .live
                .remove(&session_id)
                .expect("checked live session ownership before removal");
            let restart_count = session.meta.restart_count;
            let policy = session.respawn_opts.restart_policy;
            let max_retries = session.respawn_opts.restart_max_retries;
            let respawn_opts = session.respawn_opts.clone();
            let session_shutdown = session.shutdown_ref();

            // Decide if we should restart.
            let restart_decision =
                decide_restart(policy, exit_code, was_killed, restart_count, max_retries);

            let (will_restart, restart_in_ms) = if let Some(delay) = restart_decision {
                (true, Some(delay))
            } else {
                (false, None)
            };

            // Reset restart_count to 0 if this was a clean exit after a previous restart.
            let next_restart_count = if exit_code == 0 && restart_count > 0 {
                0
            } else {
                restart_count
            };

            // Create tombstone with restart metadata.
            let mut tombstone = DeadSession::exited(
                session.meta,
                exit_code,
                incarnation,
                Some(Arc::clone(&buffer)),
                session_shutdown,
            );
            tombstone.will_restart = will_restart;
            tombstone.restart_in_ms = restart_in_ms;
            inner_guard.dead.insert(session_id.clone(), tombstone);

            // Record exit + restart decision for diagnostics (Phase 03).
            record_diag(
                "terminal.exit",
                BTreeMap::from([
                    ("exitCode".into(), exit_code.to_string()),
                    ("wasKilled".into(), was_killed.to_string()),
                    ("willRestart".into(), will_restart.to_string()),
                    ("restartCount".into(), restart_count.to_string()),
                    ("restartInMs".into(), restart_in_ms.unwrap_or(0).to_string()),
                    ("restartPolicy".into(), format!("{policy:?}")),
                ]),
            );

            (
                respawn_opts,
                next_restart_count,
                was_killed,
                restart_decision,
                restart_in_ms.unwrap_or(0),
                true,
                true,
            )
        } else if inner_guard.live.contains_key(&session_id) {
            consume_suppressed_exit(&mut inner_guard, &session_id);
            // A newer PTY with the same public session id was already created.
            // This reader belongs to the old PTY; do not remove or emit exit for
            // the newer session.
            record_diag(
                "terminal.exit_stale",
                BTreeMap::from([
                    ("exitCode".into(), exit_code.to_string()),
                    ("note".into(), "newer live session owns id".into()),
                ]),
            );
            (
                RespawnOpts {
                    id: session_id.clone(),
                    command: String::new(),
                    cwd: String::new(),
                    env: HashMap::new(),
                    cols: 80,
                    rows: 24,
                    project: None,
                    worktree_path: None,
                    restart_policy: RestartPolicy::Never,
                    restart_max_retries: 0,
                },
                0,
                true,
                None,
                0,
                false,
                false,
            )
        } else {
            let suppress_exit = consume_suppressed_exit(&mut inner_guard, &session_id);
            let persist_exit = !suppress_exit
                && inner_guard
                    .dead
                    .get(&session_id)
                    .map(|dead| Arc::ptr_eq(&dead.shutdown, &shutdown))
                    .unwrap_or(false);
            // Session already removed (concurrent kill) — no restart.
            // Still record the exit for diagnostics context.
            record_diag(
                "terminal.exit",
                BTreeMap::from([
                    ("exitCode".into(), exit_code.to_string()),
                    ("wasKilled".into(), "true".into()),
                    ("willRestart".into(), "false".into()),
                    ("note".into(), "session already removed".into()),
                ]),
            );
            (
                RespawnOpts {
                    id: session_id.clone(),
                    command: String::new(),
                    cwd: String::new(),
                    env: HashMap::new(),
                    cols: 80,
                    rows: 24,
                    project: None,
                    worktree_path: None,
                    restart_policy: RestartPolicy::Never,
                    restart_max_retries: 0,
                },
                0,
                true,
                None,
                0,
                !suppress_exit,
                persist_exit,
            )
        }
    };

    // Send a final full snapshot only for the reader that owns the current
    // dead tombstone. Stale/replaced readers must not mark a newer same-ID
    // session dead, and shutdown-drained readers must not enqueue after the
    // persistence worker is told to stop.
    if persist_exit {
        let _persistence_guard = persistence_gate.lock().unwrap();
        let owns_dead_session = {
            let inner_guard = inner.lock().unwrap();
            inner_guard
                .dead
                .get(&session_id)
                .map(|dead| Arc::ptr_eq(&dead.shutdown, &shutdown))
                .unwrap_or(false)
        };
        if owns_dead_session {
            let (data, total_written) = buffer.lock().unwrap().snapshot();
            persist_buffer_snapshot(
                &persist_tx,
                session_store.as_deref(),
                &session_id,
                incarnation,
                data,
                total_written,
            );
            persist_session_exited(
                &persist_tx,
                session_store.as_deref(),
                &session_id,
                incarnation,
            );
        }
    }

    // Send respawn command if needed.
    // try_send (non-blocking) because queue is bounded. If full, supervisor is
    // dead/slow — dropping this respawn is correct (session already in dead map).
    if let Some(delay) = should_restart {
        let cmd = RespawnCmd {
            id: session_id.clone(),
            incarnation,
            generation,
            _prev_exit_code: exit_code,
            restart_count,
            respawn_opts,
            delay_ms: delay,
        };
        if let Err(e) = respawn_tx.try_send(cmd) {
            warn!(
                id = %session_id,
                error = %e,
                "Respawn queue full — supervisor may be dead/slow, dropping restart request"
            );
        }
    }

    if emit_exit {
        sink.send_terminal_exit(&session_id, Some(exit_code));
        sink.send_terminal_changed();
    }

    if let Some(pfm) = &port_forward_manager {
        pfm.unregister_session_with_runtime(&session_id, incarnation, rt_handle.as_ref());
    }
}

/// Delivers prompt/output bytes before their validated lifecycle snapshots.
/// Empty output is never sent and cannot flush a pending editing boundary.
pub(crate) fn send_visible_output_then_lifecycle(
    sink: &dyn EventSink,
    session_id: &str,
    visible_data: &str,
    pending_events: &mut Vec<(u64, LifecycleEvent)>,
    visible_output_since_boundary: &mut bool,
) -> bool {
    if !visible_data.is_empty() {
        sink.send_terminal_data(session_id, visible_data);
        *visible_output_since_boundary = true;
    }
    let ready_count = pending_events
        .iter()
        .position(|(_, event)| match event.state {
            LifecycleState::Unverified => {
                *visible_output_since_boundary = false;
                false
            }
            LifecycleState::Editing => visible_data.is_empty() && !*visible_output_since_boundary,
            _ => false,
        })
        .unwrap_or(pending_events.len());
    let mut published_editing = false;
    for (generation, event) in pending_events.drain(..ready_count) {
        published_editing |= event.state == LifecycleState::Editing;
        sink.send_terminal_lifecycle(
            session_id,
            lifecycle_name(event.state),
            generation,
            event.command.as_deref(),
        );
    }
    published_editing
}

// ---------------------------------------------------------------------------
// Supervisor task — handles respawn requests
// ---------------------------------------------------------------------------

/// Long-lived tokio task that receives RespawnCmd from reader threads and
/// performs async respawn after backoff delay.
async fn supervisor_loop(
    mut respawn_rx: mpsc::Receiver<RespawnCmd>,
    inner: Arc<Mutex<Inner>>,
    sink: Arc<dyn EventSink>,
    respawn_tx: mpsc::Sender<RespawnCmd>,
    persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<Arc<SessionStore>>,
    pfm_cell: Arc<std::sync::RwLock<Option<Arc<PortForwardManager>>>>,
    diag_cell: Arc<std::sync::RwLock<Option<DiagnosticStore>>>,
    target_context_cell: Arc<std::sync::RwLock<Option<PtyTargetContext>>>,
    active_reader_count: Arc<AtomicUsize>,
    lifecycle_gate: Arc<LifecycleGate>,
    persistence_gate: Arc<Mutex<()>>,
    readers: Arc<ReaderRegistry>,
    #[cfg(test)] respawn_test_hook: Arc<RespawnTestHook>,
    #[cfg(test)] spawn_test_hook: Arc<SpawnTestHook>,
) {
    while let Some(cmd) = respawn_rx.recv().await {
        let session_id = cmd.id.clone();
        let restart_attempt = cmd.restart_count + 1;
        let restart_policy = format!("{:?}", cmd.respawn_opts.restart_policy);
        let project = cmd.respawn_opts.project.clone();
        let target_path = cmd.respawn_opts.worktree_path.clone();

        // Wait for backoff delay.
        if cmd.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(cmd.delay_ms)).await;
        }

        // Check if session was killed during backoff.
        {
            let inner_guard = inner.lock().unwrap();
            if !inner_guard.respawn_source_is_current(&session_id, cmd.incarnation)
                || inner_guard.generation != cmd.generation
                || inner_guard.killed.contains(&session_id)
            {
                info!(id = %session_id, "Session killed during backoff — skipping restart");
                continue;
            }
        }

        // Respawn the session.
        info!(
            id = %session_id,
            restart_count = cmd.restart_count + 1,
            delay_ms = cmd.delay_ms,
            "Restarting session"
        );

        let pfm = pfm_cell.read().unwrap().clone();
        let diag_store = diag_cell.read().unwrap().clone();
        let target_context = target_context_cell.read().unwrap().clone();
        let mut cmd = cmd;
        let source_incarnation = cmd.incarnation;
        let mut target_unavailable = false;
        let respawn_result = if let Some(context) = target_context {
            let _lifecycle_guard = context.lifecycle_guard.write().await;
            let validation = if let Some(worktree_path) = cmd.respawn_opts.worktree_path.clone() {
                match cmd.respawn_opts.project.as_deref() {
                    Some(project) => {
                        context
                            .validate_targeted_session(
                                project,
                                &worktree_path,
                                &cmd.respawn_opts.cwd,
                            )
                            .await
                    }
                    None => Err(AppError::InvalidInput(
                        "A worktree target requires a project".into(),
                    )),
                }
            } else {
                Ok((String::new(), cmd.respawn_opts.cwd.clone()))
            };
            match validation {
                Ok((canonical_target, canonical_cwd)) => {
                    if !canonical_target.is_empty() {
                        cmd.respawn_opts.worktree_path = Some(canonical_target);
                    }
                    cmd.respawn_opts.cwd = canonical_cwd;
                    respawn_internal(
                        &session_id,
                        cmd,
                        &inner,
                        &sink,
                        &respawn_tx,
                        persist_tx.clone(),
                        session_store.clone(),
                        pfm,
                        diag_store.clone(),
                        Arc::clone(&active_reader_count),
                        Arc::clone(&lifecycle_gate),
                        Arc::clone(&persistence_gate),
                        Arc::clone(&readers),
                        #[cfg(test)]
                        Arc::clone(&respawn_test_hook),
                        #[cfg(test)]
                        Arc::clone(&spawn_test_hook),
                    )
                    .await
                }
                Err(error) => {
                    target_unavailable = is_target_loss_error(&error);
                    Err(error)
                }
            }
        } else if cmd.respawn_opts.worktree_path.is_some() {
            Err(AppError::Unavailable(
                "terminal target context is unavailable".into(),
            ))
        } else {
            respawn_internal(
                &session_id,
                cmd,
                &inner,
                &sink,
                &respawn_tx,
                persist_tx.clone(),
                session_store.clone(),
                pfm,
                diag_store.clone(),
                Arc::clone(&active_reader_count),
                Arc::clone(&lifecycle_gate),
                Arc::clone(&persistence_gate),
                Arc::clone(&readers),
                #[cfg(test)]
                Arc::clone(&respawn_test_hook),
                #[cfg(test)]
                Arc::clone(&spawn_test_hook),
            )
            .await
        };
        if let Err(e) = respawn_result {
            warn!(id = %session_id, error = %e, "Respawn failed");
            let failure_state = finish_respawn_source_failure(
                &inner,
                &persist_tx,
                session_store.as_deref(),
                &session_id,
                source_incarnation,
                target_unavailable,
            );
            if target_unavailable && failure_state.is_some() {
                if let (Some(project), Some(worktree_path)) =
                    (project.as_deref(), target_path.as_deref())
                {
                    let event_sink: Arc<dyn EventSink> = Arc::new(IncarnationEventSink::new(
                        Arc::clone(&sink),
                        Arc::clone(&inner),
                        session_id.clone(),
                        source_incarnation,
                    ));
                    event_sink.broadcast(
                        "terminal:target-unavailable",
                        serde_json::json!({
                            "project": project,
                            "worktreePath": worktree_path,
                            "sessionId": session_id,
                            "incarnation": source_incarnation,
                            "targetUnavailable": true,
                            "willRestart": false,
                        }),
                    );
                    event_sink.send_terminal_changed();
                }
            }
            if let Some(store) = &diag_store {
                let mut fields = BTreeMap::from([
                    ("sessionId".into(), session_id.clone()),
                    ("restartCount".into(), restart_attempt.to_string()),
                    ("restartPolicy".into(), restart_policy.clone()),
                    ("error".into(), e.to_string()),
                ]);
                if let Some(project) = &project {
                    fields.insert("project".into(), project.clone());
                }
                store.record_terminal_event("pty", "terminal.respawn_failed", fields);
            }
        } else {
            sink.send_terminal_changed();
        }
    }
}

fn is_target_loss_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::WorkspaceTarget(
            WorkspaceTargetError::UnknownProject
                | WorkspaceTargetError::UnregisteredTarget
                | WorkspaceTargetError::UnavailableTarget
                | WorkspaceTargetError::InvalidPath
        ) | AppError::Fs(crate::fs::FsError::NotFound)
    )
}

/// Finish a failed respawn while still owning the source incarnation. A newer
/// replacement may already be pending, so both the state transition and the
/// target-unavailable notification must refuse to touch that newer identity.
fn finish_respawn_source_failure(
    inner: &Arc<Mutex<Inner>>,
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
    target_unavailable: bool,
) -> Option<(u64, bool)> {
    let state = {
        let mut guard = inner.lock().unwrap();
        if guard.pending_replacements.contains_key(session_id) {
            return None;
        }
        let tombstone = guard.dead.get_mut(session_id)?;
        if tombstone.incarnation != incarnation {
            return None;
        }
        tombstone.meta.alive = false;
        tombstone.meta.target_unavailable |= target_unavailable;
        tombstone.will_restart = false;
        tombstone.restart_in_ms = None;
        Some((incarnation, tombstone.meta.target_unavailable))
    };

    if let Some((incarnation, target_unavailable)) = state {
        if target_unavailable {
            persist_target_unavailable(persist_tx, session_store, session_id, incarnation);
        } else {
            persist_session_dead(persist_tx, session_store, session_id, incarnation);
        }
    }
    state
}

/// Convert any failed replacement stage into a retained dead tombstone. The
/// helper covers both setup failures (where the source tombstone still owns
/// the identity) and reader-thread startup failures (where the replacement
/// was already published live), retaining the newest scrollback buffer in
/// either case.
fn finish_failed_replacement(
    inner: &Arc<Mutex<Inner>>,
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    replacement_incarnation: u64,
    target_unavailable: bool,
    preserve_target_unavailable: bool,
    fallback_buffer: Option<Arc<Mutex<crate::pty::buffer::ScrollbackBuffer>>>,
    failure_meta: Option<SessionMeta>,
    failure_persistence: Option<FailedReplacementPersistence>,
) {
    let mut replaced_incarnation_to_mark_dead = None;
    let (incarnation, target_unavailable, failed_session) = {
        let mut guard = inner.lock().unwrap();
        if !guard.replacement_is_current(session_id, replacement_incarnation) {
            return;
        }

        let live_is_current = guard
            .live
            .get(session_id)
            .map(|session| session.incarnation == replacement_incarnation)
            .unwrap_or(false);
        if guard.live.contains_key(session_id) && !live_is_current {
            return;
        }

        let failed_session = if live_is_current {
            guard.live.remove(session_id)
        } else {
            None
        };
        let (incarnation, target_unavailable) = if let Some(session) = &failed_session {
            let mut meta = session.meta.clone();
            meta.alive = false;
            meta.incarnation = replacement_incarnation;
            meta.target_unavailable =
                meta.target_unavailable || target_unavailable || preserve_target_unavailable;
            let target_unavailable = meta.target_unavailable;
            let buffer = fallback_buffer.or_else(|| Some(session.buffer_ref()));
            let shutdown = session.shutdown_ref();
            guard.dead.insert(
                session_id.to_string(),
                DeadSession::exited(meta, -1, replacement_incarnation, buffer, shutdown),
            );
            (replacement_incarnation, target_unavailable)
        } else if let Some(mut meta) = failure_meta
            .clone()
            .filter(|meta| meta.worktree_path.is_some())
        {
            // A replacement may be changing the target while an older dead
            // tombstone is still retained under the reusable public ID. Keep
            // the new target metadata so the authoritative API recheck can
            // promote this exact failed incarnation to unavailable.
            if guard
                .dead
                .get(session_id)
                .is_some_and(|tombstone| tombstone.incarnation > replacement_incarnation)
            {
                guard.finish_replacement(session_id, replacement_incarnation);
                return;
            }
            let old_tombstone = guard.dead.remove(session_id);
            replaced_incarnation_to_mark_dead = old_tombstone
                .as_ref()
                .map(|tombstone| tombstone.incarnation);
            let old_buffer = old_tombstone.and_then(|tombstone| tombstone.buffer);
            meta.alive = false;
            meta.incarnation = replacement_incarnation;
            meta.target_unavailable =
                meta.target_unavailable || target_unavailable || preserve_target_unavailable;
            let target_unavailable = meta.target_unavailable;
            guard.failed_replacements.insert(
                session_id.to_string(),
                FailedReplacement {
                    meta,
                    incarnation: replacement_incarnation,
                    buffer: fallback_buffer.or(old_buffer),
                    persistence: failure_persistence.clone(),
                    created_at: std::time::Instant::now(),
                },
            );
            (replacement_incarnation, target_unavailable)
        } else if let Some(tombstone) = guard.dead.get_mut(session_id) {
            if tombstone.incarnation > replacement_incarnation {
                guard.finish_replacement(session_id, replacement_incarnation);
                return;
            }
            tombstone.meta.alive = false;
            tombstone.meta.incarnation = tombstone.incarnation;
            // Retrying an unavailable target is allowed to fail while the
            // target is still gone. Preserve the recovery marker until a
            // newer incarnation actually succeeds.
            tombstone.meta.target_unavailable = tombstone.meta.target_unavailable
                || target_unavailable
                || preserve_target_unavailable;
            if tombstone.buffer.is_none() {
                tombstone.buffer = fallback_buffer;
            }
            tombstone.will_restart = false;
            tombstone.restart_in_ms = None;
            (tombstone.incarnation, tombstone.meta.target_unavailable)
        } else {
            // A first target-scoped create can fail before it has ever
            // published a live session. Retain only a manager-owned,
            // target-bound marker so the API can convert it after its
            // authoritative target recheck; root/free failures keep the
            // historical no-tombstone behavior.
            let Some(mut meta) = failure_meta.filter(|meta| meta.worktree_path.is_some()) else {
                guard.finish_replacement(session_id, replacement_incarnation);
                return;
            };
            meta.alive = false;
            meta.incarnation = replacement_incarnation;
            meta.target_unavailable =
                meta.target_unavailable || target_unavailable || preserve_target_unavailable;
            let target_unavailable = meta.target_unavailable;
            guard.failed_replacements.insert(
                session_id.to_string(),
                FailedReplacement {
                    meta,
                    incarnation: replacement_incarnation,
                    buffer: fallback_buffer,
                    persistence: failure_persistence,
                    created_at: std::time::Instant::now(),
                },
            );
            (replacement_incarnation, target_unavailable)
        };

        guard.finish_replacement(session_id, replacement_incarnation);
        (incarnation, target_unavailable, failed_session)
    };

    if let Some(session) = failed_session {
        session.terminate();
    }
    if let Some(old_incarnation) = replaced_incarnation_to_mark_dead {
        persist_session_dead(persist_tx, session_store, session_id, old_incarnation);
    }
    if target_unavailable {
        persist_target_unavailable(persist_tx, session_store, session_id, incarnation);
    } else {
        persist_session_dead(persist_tx, session_store, session_id, incarnation);
    }
}

/// Target-loss state must be enqueued without blocking the async supervisor or
/// a request handler. The shared FIFO preserves its order relative to create,
/// exit, and removal commands.
fn persist_target_unavailable_with_metadata(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    meta: &SessionMeta,
    incarnation: u64,
    persistence: &FailedReplacementPersistence,
) {
    let command = crate::persistence::PersistCmd::SessionTargetUnavailableUpsert {
        meta: meta.clone(),
        incarnation,
        env: HashMap::clone(&persistence.env),
        cols: persistence.cols,
        rows: persistence.rows,
        restart_max_retries: persistence.restart_max_retries,
    };
    if let Some(tx) = persist_tx {
        if let Err(error) = tx.send(command) {
            warn!(
                session_id = %meta.id,
                error = %error,
                "Failed to enqueue unavailable target session upsert"
            );
            if let Some(store) = session_store {
                if let Err(store_error) = store.save_session_target_unavailable_for_incarnation(
                    meta,
                    incarnation,
                    &persistence.env,
                    persistence.cols,
                    persistence.rows,
                    persistence.restart_max_retries,
                ) {
                    warn!(
                        session_id = %meta.id,
                        error = %store_error,
                        "Failed to persist unavailable target session through store fallback"
                    );
                }
            }
        }
    } else if let Some(store) = session_store {
        if let Err(error) = store.save_session_target_unavailable_for_incarnation(
            meta,
            incarnation,
            &persistence.env,
            persistence.cols,
            persistence.rows,
            persistence.restart_max_retries,
        ) {
            warn!(
                session_id = %meta.id,
                error = %error,
                "Failed to persist unavailable target session through store"
            );
        }
    }
}

fn persist_target_unavailable(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
) {
    if let Some(tx) = persist_tx {
        if let Err(error) = tx.send(crate::persistence::PersistCmd::SessionTargetUnavailable {
            session_id: session_id.to_string(),
            incarnation,
        }) {
            warn!(session_id, error = %error, "Failed to persist unavailable target session");
            if let Some(store) = session_store {
                if let Err(store_error) =
                    store.mark_session_target_unavailable_for_incarnation(session_id, incarnation)
                {
                    warn!(
                        session_id,
                        error = %store_error,
                        "Failed to persist unavailable target session through store fallback"
                    );
                }
            }
        }
    } else if let Some(store) = session_store {
        if let Err(error) =
            store.mark_session_target_unavailable_for_incarnation(session_id, incarnation)
        {
            warn!(
                session_id,
                error = %error,
                "Failed to persist unavailable target session through store"
            );
        }
    }
}

fn persist_session_dead(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
) {
    if let Some(tx) = persist_tx {
        if let Err(error) = tx.send(crate::persistence::PersistCmd::SessionDead {
            session_id: session_id.to_string(),
            incarnation,
        }) {
            warn!(session_id, error = %error, "Failed to persist dead terminal session");
            if let Some(store) = session_store {
                if let Err(store_error) =
                    store.mark_session_dead_for_incarnation(session_id, incarnation)
                {
                    warn!(
                        session_id,
                        error = %store_error,
                        "Failed to persist dead terminal session through store fallback"
                    );
                }
            }
        }
    } else if let Some(store) = session_store {
        if let Err(error) = store.mark_session_dead_for_incarnation(session_id, incarnation) {
            warn!(
                session_id,
                error = %error,
                "Failed to persist dead terminal session through store"
            );
        }
    }
}

fn persist_session_exited(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
) {
    if let Some(tx) = persist_tx {
        if let Err(error) = tx.send(crate::persistence::PersistCmd::SessionExited {
            session_id: session_id.to_string(),
            incarnation,
        }) {
            warn!(session_id, error = %error, "Failed to persist exited terminal session");
            if let Some(store) = session_store {
                if let Err(store_error) =
                    store.mark_session_dead_for_incarnation(session_id, incarnation)
                {
                    warn!(
                        session_id,
                        error = %store_error,
                        "Failed to persist exited terminal session through store fallback"
                    );
                }
            }
        }
    } else if let Some(store) = session_store {
        if let Err(error) = store.mark_session_dead_for_incarnation(session_id, incarnation) {
            warn!(
                session_id,
                error = %error,
                "Failed to persist exited terminal session through store"
            );
        }
    }
}

fn persist_session_created(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    meta: &SessionMeta,
    incarnation: u64,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    restart_max_retries: u32,
) {
    let persist_direct = |store: &SessionStore| {
        if let Err(error) = store.save_session_for_incarnation(
            meta,
            incarnation,
            env,
            cols,
            rows,
            restart_max_retries,
        ) {
            warn!(
                session_id = %meta.id,
                error = %error,
                "Failed to persist created terminal session through store"
            );
        }
    };

    if let Some(tx) = persist_tx {
        if let Err(error) = tx.send(crate::persistence::PersistCmd::SessionCreated {
            meta: meta.clone(),
            incarnation,
            env: env.clone(),
            cols,
            rows,
            restart_max_retries,
        }) {
            warn!(session_id = %meta.id, error = %error, "Failed to persist created terminal session");
            if let Some(store) = session_store {
                persist_direct(store);
            }
        }
    } else if let Some(store) = session_store {
        persist_direct(store);
    }
}

fn persist_buffer_direct(
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
    data: &[u8],
    total_written: u64,
) {
    if let Some(store) = session_store {
        if let Err(error) =
            store.save_buffer_for_incarnation(session_id, incarnation, data, total_written)
        {
            warn!(
                session_id,
                error = %error,
                "Failed to persist terminal buffer through store"
            );
        }
    }
}

fn try_persist_buffer_update(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
    data: Vec<u8>,
    total_written: u64,
) {
    let Some(tx) = persist_tx else {
        persist_buffer_direct(session_store, session_id, incarnation, &data, total_written);
        return;
    };

    match tx.try_send(crate::persistence::PersistCmd::BufferUpdate {
        session_id: session_id.to_string(),
        incarnation,
        data,
        total_written,
    }) {
        Ok(()) => {}
        Err(std::sync::mpsc::TrySendError::Full(_)) => {}
        Err(std::sync::mpsc::TrySendError::Disconnected(command)) => {
            if let crate::persistence::PersistCmd::BufferUpdate {
                data,
                total_written,
                ..
            } = command
            {
                persist_buffer_direct(session_store, session_id, incarnation, &data, total_written);
            }
        }
    }
}

fn persist_buffer_snapshot(
    persist_tx: &Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<&SessionStore>,
    session_id: &str,
    incarnation: u64,
    data: Vec<u8>,
    total_written: u64,
) {
    let Some(tx) = persist_tx else {
        persist_buffer_direct(session_store, session_id, incarnation, &data, total_written);
        return;
    };

    if let Err(error) = tx.send(crate::persistence::PersistCmd::BufferUpdate {
        session_id: session_id.to_string(),
        incarnation,
        data,
        total_written,
    }) {
        if let crate::persistence::PersistCmd::BufferUpdate {
            data,
            total_written,
            ..
        } = error.0
        {
            persist_buffer_direct(session_store, session_id, incarnation, &data, total_written);
        }
    }
}

/// Internal respawn logic — reuses the same session ID.
/// Called by supervisor task after backoff delay.
async fn respawn_internal(
    session_id: &str,
    cmd: RespawnCmd,
    inner: &Arc<Mutex<Inner>>,
    sink: &Arc<dyn EventSink>,
    respawn_tx: &mpsc::Sender<RespawnCmd>,
    persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    session_store: Option<Arc<SessionStore>>,
    port_forward_manager: Option<Arc<PortForwardManager>>,
    diag_store: Option<DiagnosticStore>,
    active_reader_count: Arc<AtomicUsize>,
    lifecycle_gate: Arc<LifecycleGate>,
    persistence_gate: Arc<Mutex<()>>,
    readers: Arc<ReaderRegistry>,
    #[cfg(test)] respawn_test_hook: Arc<RespawnTestHook>,
    #[cfg(test)] spawn_test_hook: Arc<SpawnTestHook>,
) -> Result<(), AppError> {
    let opts = &cmd.respawn_opts;
    let source_incarnation = cmd.incarnation;

    // Reserve before slow PTY setup so a newer request invalidates this one.
    let (replacement_incarnation, preserve_target_unavailable, source_buffer) = {
        let mut guard = inner.lock().unwrap();
        if !guard.respawn_source_is_current(session_id, source_incarnation) {
            return Err(AppError::PtyError(
                "PTY respawn was superseded by a newer request".into(),
            ));
        }
        let preserve_target_unavailable = guard
            .dead
            .get(session_id)
            .map(|session| session.meta.target_unavailable)
            .unwrap_or(false);
        let source_buffer = guard
            .dead
            .get(session_id)
            .and_then(|session| session.buffer.as_ref().map(Arc::clone));
        (
            guard.begin_replacement(session_id),
            preserve_target_unavailable,
            source_buffer,
        )
    };

    let Some(_lifecycle_permit) = lifecycle_gate.try_begin() else {
        info!(id = %session_id, "Respawn skipped while PTY manager is disposing");
        return Ok(());
    };

    // Check before opening a PTY, then repeat the check immediately before
    // publishing the new session. dispose() can race with either phase.
    {
        let inner_guard = inner.lock().unwrap();
        if lifecycle_gate.is_disposing()
            || inner_guard.generation != cmd.generation
            || inner_guard.killed.contains(session_id)
        {
            info!(id = %session_id, "Stale respawn request — skipping restart");
            return Ok(());
        }
    }

    #[cfg(test)]
    spawn_test_hook.wait_if_paused_async().await;

    // Build PTY with same config.
    let pty_system = NativePtySystem::default();
    let pair = match pty_system.openpty(PtySize {
        rows: opts.rows,
        cols: opts.cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(error) => {
            finish_failed_replacement(
                inner,
                &persist_tx,
                session_store.as_deref(),
                session_id,
                replacement_incarnation,
                false,
                preserve_target_unavailable,
                source_buffer.clone(),
                None,
                None,
            );
            return Err(AppError::PtyError(error.to_string()));
        }
    };

    let integration = ShellIntegration::prepare(&opts.command, &opts.env);
    let mut build_cmd = build_command(&opts.command, &opts.cwd, &opts.env);
    apply_child_env(&mut build_cmd, &opts.env);
    if let Some(integration) = &integration {
        integration.apply(&mut build_cmd);
    }

    let mut child = match pair.slave.spawn_command(build_cmd) {
        Ok(child) => child,
        Err(error) => {
            finish_failed_replacement(
                inner,
                &persist_tx,
                session_store.as_deref(),
                session_id,
                replacement_incarnation,
                false,
                preserve_target_unavailable,
                source_buffer.clone(),
                None,
                None,
            );
            return Err(AppError::PtyError(format!("spawn failed: {error}")));
        }
    };

    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            finish_failed_replacement(
                inner,
                &persist_tx,
                session_store.as_deref(),
                session_id,
                replacement_incarnation,
                false,
                preserve_target_unavailable,
                source_buffer.clone(),
                None,
                None,
            );
            return Err(AppError::PtyError(format!("clone_reader failed: {error}")));
        }
    };

    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            let _ = child.kill();
            finish_failed_replacement(
                inner,
                &persist_tx,
                session_store.as_deref(),
                session_id,
                replacement_incarnation,
                false,
                preserve_target_unavailable,
                source_buffer.clone(),
                None,
                None,
            );
            return Err(AppError::PtyError(format!("take_writer failed: {error}")));
        }
    };

    // Increment restart_count.
    let mut meta = SessionMeta::new_with_target(
        session_id.to_string(),
        opts.project.clone(),
        opts.command.clone(),
        opts.cwd.clone(),
        opts.worktree_path.clone(),
        opts.restart_policy,
    );
    meta.restart_count = cmd.restart_count + 1;
    meta.last_exit_at = Some(crate::pty::session::now_ms());
    meta.incarnation = replacement_incarnation;

    let child_killer = child.clone_killer();
    let lifecycle = integration.as_ref().map(ShellIntegration::lifecycle);
    let incarnation = replacement_incarnation;
    let session = LiveSession::new(
        meta.clone(),
        incarnation,
        pair.master,
        writer,
        child_killer,
        opts.clone(),
        lifecycle,
        integration,
    );
    let buffer = session.buffer_ref();
    let shutdown = session.shutdown_ref();
    let lifecycle = session.lifecycle.clone();
    let published_editing = session.published_editing_ref();

    // Publish only if the source tombstone and this replacement reservation
    // still belong to this respawn. A concurrent create/remove wins.
    #[cfg(test)]
    respawn_test_hook.wait_if_paused().await;

    // Serialize publication and its persistence metadata with reader
    // snapshots. The guard is acquired after the async test hook so this
    // future remains Send when spawned by Tokio.
    let _persistence_guard = persistence_gate.lock().unwrap();

    // Insert into live map — if session ID already exists (user called create
    // concurrently), this will replace it (same behavior as create()).
    {
        let mut inner_guard = inner.lock().unwrap();
        if !inner_guard.respawn_replacement_is_current(session_id, source_incarnation, incarnation)
        {
            drop(inner_guard);
            session.terminate();
            return Err(AppError::PtyError(
                "PTY respawn was superseded by a newer request".into(),
            ));
        }
        if lifecycle_gate.is_disposing()
            || inner_guard.generation != cmd.generation
            || inner_guard.killed.contains(session_id)
        {
            drop(inner_guard);
            session.terminate();
            info!(id = %session_id, "Respawn cancelled before publish");
            return Ok(());
        }
        // Remove from killed set (allow future restarts if user doesn't kill again).
        inner_guard.killed.remove(session_id);
        inner_guard.dead.remove(session_id);
        inner_guard.live.insert(session_id.to_string(), session);
    }

    if let Some(pfm) = &port_forward_manager {
        pfm.register_session(session_id, incarnation);
    }

    // Re-mark the session as alive in persistence. SessionExited flipped alive=0
    // when the previous run exited; without this, restore after a server restart
    // would skip the re-spawned session.
    let RespawnOpts {
        env: persisted_env,
        cols,
        rows,
        restart_max_retries,
        ..
    } = opts;
    persist_session_created(
        &persist_tx,
        session_store.as_deref(),
        &meta,
        incarnation,
        persisted_env,
        *cols,
        *rows,
        *restart_max_retries,
    );
    // Spawn reader thread for the restarted session.
    let id_clone = session_id.to_string();
    let inner_clone = Arc::clone(inner);
    let sink_clone: Arc<dyn EventSink> = Arc::new(IncarnationEventSink::new(
        Arc::clone(sink),
        Arc::clone(inner),
        id_clone.clone(),
        incarnation,
    ));
    let respawn_tx_clone = respawn_tx.clone();
    let persistence_gate_clone = Arc::clone(&persistence_gate);
    let project_name = opts.project.clone();
    let rt_handle = tokio::runtime::Handle::try_current().ok();
    let persist_tx_for_failure = persist_tx.clone();
    let session_store_for_reader = session_store.clone();
    let port_forward_manager_for_failure = port_forward_manager.clone();
    active_reader_count.fetch_add(1, Ordering::AcqRel);
    let active_reader_count_for_reader = Arc::clone(&active_reader_count);
    let reader_handle = std::thread::Builder::new()
        .name(format!("pty-reader:{id_clone}"))
        .spawn(move || {
            reader_thread(
                id_clone,
                incarnation,
                cmd.generation,
                reader,
                child,
                buffer,
                shutdown,
                sink_clone,
                inner_clone,
                respawn_tx_clone,
                persist_tx,
                session_store_for_reader,
                persistence_gate_clone,
                port_forward_manager,
                project_name,
                rt_handle,
                diag_store,
                lifecycle,
                published_editing,
                active_reader_count_for_reader,
            );
        })
        .map_err(|error| {
            active_reader_count.fetch_sub(1, Ordering::AcqRel);
            if let Some(pfm) = &port_forward_manager_for_failure {
                pfm.unregister_session(session_id, incarnation);
            }
            finish_failed_replacement(
                inner,
                &persist_tx_for_failure,
                session_store.as_deref(),
                session_id,
                incarnation,
                false,
                preserve_target_unavailable,
                source_buffer,
                None,
                None,
            );
            AppError::PtyError(format!("thread spawn failed: {error}"))
        })?;
    readers.register(reader_handle);

    inner
        .lock()
        .unwrap()
        .finish_replacement(session_id, incarnation);

    info!(id = %session_id, restart_count = meta.restart_count, "Session restarted");
    Ok(())
}

fn is_eof_error(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::UnexpectedEof
    )
}

fn lifecycle_name(state: LifecycleState) -> &'static str {
    match state {
        LifecycleState::Editing => "editing",
        LifecycleState::Submitted => "submitted",
        LifecycleState::Opaque => "opaque",
        LifecycleState::Unverified | LifecycleState::Prompt | LifecycleState::Finished => {
            "unverified"
        }
    }
}

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

/// Strip Windows UNC path prefix (\\?\) if present.
/// CMD.EXE doesn't support UNC paths, causing "UNC paths are not supported" error.
/// Converts `\\?\C:\path` to `C:\path`.
fn strip_unc_prefix(path: &str) -> String {
    if cfg!(target_os = "windows") && path.starts_with(r"\\?\UNC\") {
        // UNC network path: \\?\UNC\server\share -> \\server\share
        path.strip_prefix(r"\\?\UNC\")
            .map(|p| format!(r"\\{}", p))
            .unwrap_or_else(|| path.to_string())
    } else if cfg!(target_os = "windows") && path.starts_with(r"\\?\") {
        // UNC prefix for long paths: \\?\C:\path -> C:\path
        path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
    } else {
        path.to_string()
    }
}

fn normalized_command_cwd(path: &str) -> String {
    strip_unc_prefix(path)
}

fn build_command(command: &str, cwd: &str, env: &HashMap<String, String>) -> CommandBuilder {
    #[cfg(windows)]
    let _ = env;
    #[cfg(windows)]
    let (exe, args) = if command.is_empty() || command == "bash" {
        ("cmd.exe".to_string(), vec![])
    } else {
        (
            "cmd.exe".to_string(),
            vec!["/C".to_string(), command.to_string()],
        )
    };

    #[cfg(not(windows))]
    let (exe, args) = {
        let is_interactive = command.is_empty();
        if command == "bash" {
            (
                interactive_shell_executable(command, env)
                    .expect("explicit bash must resolve to an executable"),
                vec![],
            )
        } else if is_interactive {
            let shell = env
                .get("SHELL")
                .filter(|s| s.starts_with('/'))
                .cloned()
                .unwrap_or_else(|| "/bin/bash".to_string());
            (shell, vec![])
        } else {
            (
                "/bin/sh".to_string(),
                vec!["-c".to_string(), command.to_string()],
            )
        }
    };

    let mut cmd = CommandBuilder::new(&exe);
    for arg in args {
        cmd.arg(arg);
    }
    // Strip UNC prefix to avoid CMD.EXE "UNC paths are not supported" error
    let safe_cwd = normalized_command_cwd(cwd);
    cmd.cwd(safe_cwd);
    cmd
}

fn apply_child_env(cmd: &mut CommandBuilder, env: &HashMap<String, String>) {
    cmd.env_clear();
    for (key, value) in build_child_env(env) {
        cmd.env(key, value);
    }
}

fn build_child_env(env: &HashMap<String, String>) -> Vec<(String, OsString)> {
    let parent_env = std::env::vars_os()
        .filter_map(|(key, value)| key.into_string().ok().map(|key| (key, value)))
        .collect::<HashMap<_, _>>();
    build_child_env_from_parent_snapshot(&parent_env, env)
}

pub(crate) fn build_child_env_from_parent_snapshot(
    parent_env: &HashMap<String, OsString>,
    env: &HashMap<String, String>,
) -> Vec<(String, OsString)> {
    let mut child_env = safe_baseline_env_from(parent_env)
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect::<Vec<_>>();
    child_env.push(("TERM".to_string(), OsString::from("xterm-256color")));
    child_env.extend(
        env.iter()
            .map(|(key, value)| (key.clone(), OsString::from(value))),
    );
    child_env
}

fn safe_baseline_env_from(parent_env: &HashMap<String, OsString>) -> Vec<(&'static str, OsString)> {
    SAFE_BASELINE_ENV_VARS
        .iter()
        .filter_map(|key| {
            #[cfg(windows)]
            {
                parent_env
                    .get(*key)
                    .cloned()
                    .or_else(|| {
                        parent_env
                            .iter()
                            .find(|(parent_key, _)| parent_key.eq_ignore_ascii_case(key))
                            .map(|(_, value)| value.clone())
                    })
                    .map(|value| (*key, value))
            }
            #[cfg(not(windows))]
            {
                parent_env.get(*key).cloned().map(|value| (*key, value))
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn validate_session_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > SESSION_ID_MAX_LEN {
        return Err(AppError::InvalidInput(format!(
            "Session ID must be 1-{SESSION_ID_MAX_LEN} chars"
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ':' | '.' | '-' | '_'))
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid session id: \"{id}\" — only [a-zA-Z0-9:._-] allowed"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Restart decision logic (pure functions)
// ---------------------------------------------------------------------------

/// Calculate exponential backoff delay with 30s cap.
/// Formula: min(1000 * 2^restart_count, 30_000) ms
#[cfg(test)]
pub(crate) fn restart_delay_ms(restart_count: u32) -> u64 {
    let base_delay = 1000u64;
    let delay = base_delay.saturating_mul(2u64.saturating_pow(restart_count));
    delay.min(MAX_RESTART_DELAY_MS)
}

#[cfg(not(test))]
fn restart_delay_ms(restart_count: u32) -> u64 {
    let base_delay = 1000u64;
    let delay = base_delay.saturating_mul(2u64.saturating_pow(restart_count));
    delay.min(MAX_RESTART_DELAY_MS)
}

/// Decide whether to restart based on policy, exit code, and retry limits.
/// Returns Some(delay_ms) if should restart, None otherwise.
///
/// Decision matrix (from plan.md):
/// | Policy      | Exit=0 | Exit≠0 | Was Killed | Retries Left | Action          |
/// |-------------|--------|--------|------------|--------------|-----------------|
/// | never       | *      | *      | *          | *            | None            |
/// | on-failure  | *      | *      | yes        | *            | None            |
/// | on-failure  | 0      | no     | no         | *            | None (clean)    |
/// | on-failure  | ≠0     | no     | no         | yes          | Some(delay)     |
/// | on-failure  | ≠0     | no     | no         | no           | None (retries)  |
/// | always      | *      | *      | yes        | *            | None            |
/// | always      | *      | no     | no         | yes          | Some(delay)     |
/// | always      | *      | no     | no         | no           | None (retries)  |
#[cfg(test)]
pub(crate) fn decide_restart(
    policy: RestartPolicy,
    exit_code: i32,
    was_killed: bool,
    restart_count: u32,
    max_retries: u32,
) -> Option<u64> {
    // Never restart if manually killed.
    if was_killed {
        return None;
    }

    // Never policy — no restarts.
    if policy == RestartPolicy::Never {
        return None;
    }

    // Check retry limit.
    if restart_count >= max_retries {
        return None;
    }

    match policy {
        RestartPolicy::OnFailure => {
            // Only restart on non-zero exit codes.
            if exit_code == 0 {
                None
            } else {
                Some(restart_delay_ms(restart_count))
            }
        }
        RestartPolicy::Always => {
            // Restart regardless of exit code.
            Some(restart_delay_ms(restart_count))
        }
        RestartPolicy::Never => None, // Already handled above, but satisfy match.
    }
}

#[cfg(not(test))]
fn decide_restart(
    policy: RestartPolicy,
    exit_code: i32,
    was_killed: bool,
    restart_count: u32,
    max_retries: u32,
) -> Option<u64> {
    // Never restart if manually killed.
    if was_killed {
        return None;
    }

    // Never policy — no restarts.
    if policy == RestartPolicy::Never {
        return None;
    }

    // Check retry limit.
    if restart_count >= max_retries {
        return None;
    }

    match policy {
        RestartPolicy::OnFailure => {
            // Only restart on non-zero exit codes.
            if exit_code == 0 {
                None
            } else {
                Some(restart_delay_ms(restart_count))
            }
        }
        RestartPolicy::Always => {
            // Restart regardless of exit code.
            Some(restart_delay_ms(restart_count))
        }
        RestartPolicy::Never => None, // Already handled above, but satisfy match.
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod strip_unc_prefix_tests {
    use super::strip_unc_prefix;

    #[cfg(windows)]
    #[test]
    fn strips_unc_long_path_prefix() {
        assert_eq!(
            strip_unc_prefix(r"\\?\C:\Users\test\path"),
            r"C:\Users\test\path"
        );
    }

    #[cfg(windows)]
    #[test]
    fn strips_unc_network_path_prefix() {
        assert_eq!(
            strip_unc_prefix(r"\\?\UNC\server\share\path"),
            r"\\server\share\path"
        );
    }

    #[cfg(windows)]
    #[test]
    fn leaves_normal_windows_path_unchanged() {
        assert_eq!(
            strip_unc_prefix(r"C:\Users\test\path"),
            r"C:\Users\test\path"
        );
    }

    #[test]
    fn leaves_unix_path_unchanged() {
        assert_eq!(strip_unc_prefix("/home/user/path"), "/home/user/path");
    }
}

#[cfg(test)]
mod command_builder_tests {
    use super::build_command;
    use std::collections::HashMap;

    fn argv(command: &portable_pty::CommandBuilder) -> Vec<String> {
        command
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[cfg(windows)]
    #[test]
    fn windows_build_command_uses_native_cmd() {
        let cwd = r"\\?\C:\Users\test\path";
        let env = HashMap::new();

        for selector in ["", "bash"] {
            let command = build_command(selector, cwd, &env);
            assert_eq!(argv(&command), vec!["cmd.exe"]);
            assert_eq!(
                command.get_cwd().and_then(|path| path.to_str()),
                Some(r"C:\Users\test\path")
            );
        }

        let command = build_command("echo windows", cwd, &env);
        assert_eq!(argv(&command), vec!["cmd.exe", "/C", "echo windows"]);
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_build_command_preserves_shell_argv() {
        let cwd = "/tmp";
        let bash_env = HashMap::from([("SHELL".to_string(), "/usr/bin/bash".to_string())]);
        assert_eq!(
            argv(&build_command("bash", cwd, &bash_env)),
            vec!["/usr/bin/bash"]
        );

        let shell_env = HashMap::from([("SHELL".to_string(), "/bin/zsh".to_string())]);
        assert_eq!(argv(&build_command("", cwd, &shell_env)), vec!["/bin/zsh"]);

        assert_eq!(
            argv(&build_command("echo windows", cwd, &HashMap::new())),
            vec!["/bin/sh", "-c", "echo windows"]
        );
    }
}

#[cfg(test)]
mod attach_snapshot_tests {
    use super::{attach_editing_generation, ShellLifecycle};

    #[test]
    fn parsed_editing_is_not_attachable_until_prompt_boundary_is_published() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        lifecycle.feed(b"\x1b]633;A;nonce\x07\x1b]633;B;nonce\x07");

        assert!(lifecycle.is_editing());
        assert_eq!(attach_editing_generation(&lifecycle, false), None);
        assert_eq!(attach_editing_generation(&lifecycle, true), Some(7));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::event_sink::NoopEventSink;

    fn terminal_shutdown() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(true))
    }

    #[cfg(windows)]
    #[test]
    fn child_env_builder_preserves_case_insensitive_windows_path() {
        let parent_env =
            HashMap::from([("Path".to_string(), OsString::from(r"C:\Windows\System32"))]);

        let child_env = build_child_env_from_parent_snapshot(&parent_env, &HashMap::new())
            .into_iter()
            .collect::<HashMap<_, _>>();

        assert_eq!(
            child_env.get("PATH"),
            Some(&OsString::from(r"C:\Windows\System32"))
        );
    }

    #[test]
    fn stale_respawn_reservation_cannot_publish_after_newer_replacement() {
        let mut inner = Inner::new();
        let source_incarnation = 41;
        let meta = SessionMeta::new(
            "terminal:race".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Always,
        );
        inner.dead.insert(
            "terminal:race".to_string(),
            DeadSession::exited(meta, 1, source_incarnation, None, terminal_shutdown()),
        );

        let stale_replacement = inner.begin_replacement("terminal:race");
        let newer_replacement = inner.begin_replacement("terminal:race");

        assert!(!inner.respawn_replacement_is_current(
            "terminal:race",
            source_incarnation,
            stale_replacement,
        ));
        assert!(inner.respawn_replacement_is_current(
            "terminal:race",
            source_incarnation,
            newer_replacement,
        ));
    }

    #[test]
    fn incarnation_event_sink_drops_output_after_replacement_starts() {
        let (sink, mut receiver) = crate::pty::BroadcastEventSink::new(8);
        let sink: Arc<dyn EventSink> = Arc::new(sink);
        let inner = Arc::new(Mutex::new(Inner::new()));
        let id = "terminal:event-race";
        let meta = SessionMeta::new(
            id.to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        inner.lock().unwrap().dead.insert(
            id.to_string(),
            DeadSession::exited(meta, 0, 10, None, terminal_shutdown()),
        );
        let reader_sink =
            IncarnationEventSink::new(Arc::clone(&sink), Arc::clone(&inner), id.to_string(), 10);

        reader_sink.send_terminal_data(id, "before\n");
        assert!(receiver.try_recv().is_ok());

        inner
            .lock()
            .unwrap()
            .pending_replacements
            .insert(id.to_string(), 11);
        reader_sink.send_terminal_data(id, "stale\n");
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn incarnation_event_sink_drops_stale_target_loss_notifications() {
        let (sink, mut receiver) = crate::pty::BroadcastEventSink::new(8);
        let sink: Arc<dyn EventSink> = Arc::new(sink);
        let inner = Arc::new(Mutex::new(Inner::new()));
        let id = "terminal:target-event-race";
        let mut meta = SessionMeta::new(
            id.to_string(),
            Some("demo".to_string()),
            "cat".to_string(),
            "/tmp/demo-feature".to_string(),
            RestartPolicy::Always,
        );
        meta.worktree_path = Some("/tmp/demo-feature".to_string());
        inner
            .lock()
            .unwrap()
            .dead
            .insert(id.to_string(), DeadSession::target_unavailable(meta, 10));
        inner
            .lock()
            .unwrap()
            .pending_replacements
            .insert(id.to_string(), 11);

        let source_sink =
            IncarnationEventSink::new(Arc::clone(&sink), Arc::clone(&inner), id.to_string(), 10);
        source_sink.broadcast(
            "terminal:target-unavailable",
            serde_json::json!({ "sessionId": id }),
        );
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn source_respawn_failure_cannot_mutate_a_newer_pending_replacement() {
        let inner = Arc::new(Mutex::new(Inner::new()));
        let id = "terminal:source-failure-race";
        let meta = SessionMeta::new(
            id.to_string(),
            Some("demo".to_string()),
            "cat".to_string(),
            "/tmp/demo".to_string(),
            RestartPolicy::Always,
        );
        inner.lock().unwrap().dead.insert(
            id.to_string(),
            DeadSession::exited(meta, 1, 10, None, terminal_shutdown()),
        );
        inner
            .lock()
            .unwrap()
            .pending_replacements
            .insert(id.to_string(), 11);

        assert!(finish_respawn_source_failure(&inner, &None, None, id, 10, true).is_none());
        let guard = inner.lock().unwrap();
        let session = guard.dead.get(id).expect("source tombstone should remain");
        assert!(!session.meta.target_unavailable);
        assert_eq!(session.incarnation, 10);
    }

    #[tokio::test]
    async fn initial_target_loss_cannot_mark_a_newer_pending_replacement() {
        let (sink, mut receiver) = crate::pty::BroadcastEventSink::new(8);
        let manager = PtySessionManager::new(Arc::new(sink));
        let id = "terminal:create-target-race";
        let target = "/tmp/demo-feature";
        let mut meta = SessionMeta::new(
            id.to_string(),
            Some("demo".to_string()),
            "cat".to_string(),
            target.to_string(),
            RestartPolicy::Never,
        );
        meta.worktree_path = Some(target.to_string());
        meta.incarnation = 10;
        {
            let mut inner = manager.inner.lock().unwrap();
            inner.dead.insert(
                id.to_string(),
                DeadSession::exited(meta, 1, 10, None, terminal_shutdown()),
            );
            inner.pending_replacements.insert(id.to_string(), 11);
        }

        assert!(!manager.mark_target_unavailable(id, "demo", target));
        assert!(receiver.try_recv().is_err());
        assert!(
            !manager
                .list()
                .into_iter()
                .find(|session| session.id == id)
                .expect("source tombstone should remain")
                .target_unavailable
        );

        manager
            .inner
            .lock()
            .unwrap()
            .pending_replacements
            .remove(id);
        assert!(manager.mark_target_unavailable(id, "demo", target));
        let event = receiver
            .try_recv()
            .expect("guarded target-loss event should be emitted");
        assert!(event.contains("terminal:target-unavailable"));
        assert!(
            manager
                .list()
                .into_iter()
                .find(|session| session.id == id)
                .expect("target tombstone should remain")
                .target_unavailable
        );
    }

    #[tokio::test]
    async fn initial_target_loss_promotes_a_failed_create_marker() {
        let (sink, mut receiver) = crate::pty::BroadcastEventSink::new(8);
        let manager = PtySessionManager::new(Arc::new(sink));
        let id = "terminal:first-target-loss";
        let target = "/tmp/first-target";
        let mut meta = SessionMeta::new(
            id.to_string(),
            Some("demo".to_string()),
            "cat".to_string(),
            target.to_string(),
            RestartPolicy::Never,
        );
        meta.worktree_path = Some(target.to_string());
        meta.incarnation = 12;
        manager.inner.lock().unwrap().failed_replacements.insert(
            id.to_string(),
            FailedReplacement {
                meta,
                incarnation: 12,
                buffer: None,
                persistence: None,
                created_at: std::time::Instant::now(),
            },
        );

        assert!(manager.mark_target_unavailable(id, "demo", target));
        assert!(receiver
            .try_recv()
            .expect("target-loss event should be emitted")
            .contains("terminal:target-unavailable"));
        let session = manager
            .list()
            .into_iter()
            .find(|session| session.id == id)
            .expect("failed target create should become visible as an orphan");
        assert!(!session.alive);
        assert!(session.target_unavailable);
        assert_eq!(session.incarnation, 12);
    }

    #[tokio::test]
    async fn first_failed_target_create_is_persisted_for_restart_recovery() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(crate::persistence::SessionStore::open(temp.path()).unwrap());
        let manager =
            PtySessionManager::with_persist(Arc::new(NoopEventSink), None, Some(store.clone()));
        let id = "terminal:first-target-loss-persisted";
        let target = "/tmp/first-target-persisted";
        let opts = PtyCreateOpts {
            id: id.to_string(),
            command: "npm run dev".to_string(),
            cwd: target.to_string(),
            env: HashMap::from([("APP_MODE".to_string(), "worktree".to_string())]),
            cols: 132,
            rows: 40,
            project: Some("demo".to_string()),
            worktree_path: Some(target.to_string()),
            restart_policy: RestartPolicy::Always,
            restart_max_retries: 7,
        };
        let mut meta = SessionMeta::new_with_target(
            opts.id.clone(),
            opts.project.clone(),
            opts.command.clone(),
            opts.cwd.clone(),
            opts.worktree_path.clone(),
            opts.restart_policy,
        );
        meta.incarnation = 12;

        manager.inner.lock().unwrap().failed_replacements.insert(
            id.to_string(),
            FailedReplacement {
                meta,
                incarnation: 12,
                buffer: None,
                persistence: Some(FailedReplacementPersistence::from(&opts)),
                created_at: std::time::Instant::now(),
            },
        );

        assert!(manager.mark_target_unavailable(id, "demo", target));

        let persisted = store.load_sessions().unwrap();
        assert_eq!(persisted.len(), 1);
        assert!(persisted[0].meta.target_unavailable);
        assert_eq!(persisted[0].incarnation, 12);
        assert_eq!(persisted[0].meta.worktree_path.as_deref(), Some(target));
        assert_eq!(persisted[0].cols, 132);
        assert_eq!(persisted[0].rows, 40);
    }

    #[tokio::test]
    async fn failed_replacement_promotes_new_target_metadata_over_old_tombstone() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(crate::persistence::SessionStore::open(temp.path()).unwrap());
        let manager =
            PtySessionManager::with_persist(Arc::new(NoopEventSink), None, Some(store.clone()));
        let id = "terminal:replacement-target-failure";
        let old_target = "/tmp/old-target";
        let new_target = "/tmp/new-target";
        let old_meta = SessionMeta::new_with_target(
            id.to_string(),
            Some("demo".to_string()),
            "old".to_string(),
            old_target.to_string(),
            Some(old_target.to_string()),
            RestartPolicy::Never,
        );
        let opts = PtyCreateOpts {
            id: id.to_string(),
            command: "new".to_string(),
            cwd: new_target.to_string(),
            env: HashMap::from([("TARGET".to_string(), "new".to_string())]),
            cols: 100,
            rows: 30,
            project: Some("demo".to_string()),
            worktree_path: Some(new_target.to_string()),
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 4,
        };
        let new_meta = SessionMeta::new_with_target(
            opts.id.clone(),
            opts.project.clone(),
            opts.command.clone(),
            opts.cwd.clone(),
            opts.worktree_path.clone(),
            opts.restart_policy,
        );

        {
            let mut inner = manager.inner.lock().unwrap();
            inner.dead.insert(
                id.to_string(),
                DeadSession::exited(old_meta, 1, 10, None, terminal_shutdown()),
            );
            inner.pending_replacements.insert(id.to_string(), 11);
        }
        finish_failed_replacement(
            &manager.inner,
            &None,
            Some(&store),
            id,
            11,
            false,
            false,
            None,
            Some(new_meta),
            Some(FailedReplacementPersistence::from(&opts)),
        );

        assert!(manager.mark_target_unavailable(id, "demo", new_target));
        let session = manager
            .list()
            .into_iter()
            .find(|session| session.id == id)
            .expect("failed replacement should retain the new target");
        assert_eq!(session.worktree_path.as_deref(), Some(new_target));
        assert_eq!(session.incarnation, 11);

        let persisted = store.load_sessions().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].meta.worktree_path.as_deref(), Some(new_target));
        assert_eq!(persisted[0].incarnation, 11);
        assert!(persisted[0].meta.target_unavailable);
    }

    #[test]
    fn failed_replacement_retains_source_buffer_fallback() {
        let inner = Arc::new(Mutex::new(Inner::new()));
        let id = "terminal:respawn-buffer-fallback";
        let source_buffer = Arc::new(Mutex::new(crate::pty::buffer::ScrollbackBuffer::new(1024)));
        source_buffer.lock().unwrap().push(b"previous output\n");
        let meta = SessionMeta::new(
            id.to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Always,
        );
        {
            let mut guard = inner.lock().unwrap();
            guard.dead.insert(
                id.to_string(),
                DeadSession::exited(meta, 1, 10, None, terminal_shutdown()),
            );
            guard.pending_replacements.insert(id.to_string(), 11);
        }

        finish_failed_replacement(
            &inner,
            &None,
            None,
            id,
            11,
            false,
            false,
            Some(Arc::clone(&source_buffer)),
            None,
            None,
        );

        let guard = inner.lock().unwrap();
        let buffer = guard
            .dead
            .get(id)
            .and_then(|session| session.buffer.as_ref())
            .expect("failed replacement should retain the source buffer");
        assert_eq!(buffer.lock().unwrap().as_str_lossy(), "previous output\n");
    }

    #[test]
    fn target_unavailable_persistence_waits_for_full_queue() {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        tx.send(crate::persistence::PersistCmd::BufferUpdate {
            session_id: "terminal:queued".to_string(),
            incarnation: 1,
            data: Vec::new(),
            total_written: 0,
        })
        .unwrap();

        let persist_tx = Some(tx.clone());
        let sender = std::thread::spawn(move || {
            persist_target_unavailable(&persist_tx, None, "terminal:unavailable", 1);
        });

        let first = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("the queued command should be available");
        assert!(matches!(
            first,
            crate::persistence::PersistCmd::BufferUpdate { .. }
        ));
        let target_loss = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("target-loss persistence must not be dropped when the queue is full");
        assert!(matches!(
            target_loss,
            crate::persistence::PersistCmd::SessionTargetUnavailable { session_id, .. }
                if session_id == "terminal:unavailable"
        ));
        sender.join().unwrap();
    }

    #[test]
    fn periodic_snapshot_is_dropped_when_persistence_queue_is_full() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = crate::persistence::SessionStore::open(temp.path()).unwrap();
        let meta = SessionMeta::new(
            "terminal:periodic".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        store
            .save_session_for_incarnation(&meta, 2, &HashMap::new(), 80, 24, 0)
            .unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        tx.send(crate::persistence::PersistCmd::BufferUpdate {
            session_id: "terminal:queued".to_string(),
            incarnation: 1,
            data: Vec::new(),
            total_written: 0,
        })
        .unwrap();

        try_persist_buffer_update(
            &Some(tx),
            Some(&store),
            "terminal:periodic",
            2,
            b"snapshot".to_vec(),
            8,
        );

        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(1)),
            Ok(crate::persistence::PersistCmd::BufferUpdate { session_id, .. })
                if session_id == "terminal:queued"
        ));
        assert!(rx.try_recv().is_err());
        assert!(store.load_buffer("terminal:periodic").unwrap().is_none());
    }

    #[test]
    fn periodic_snapshot_falls_back_when_persistence_worker_is_disconnected() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = crate::persistence::SessionStore::open(temp.path()).unwrap();
        let meta = SessionMeta::new(
            "terminal:periodic-disconnected".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        store
            .save_session_for_incarnation(&meta, 3, &HashMap::new(), 80, 24, 0)
            .unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        drop(rx);

        try_persist_buffer_update(
            &Some(tx),
            Some(&store),
            "terminal:periodic-disconnected",
            3,
            b"snapshot".to_vec(),
            8,
        );

        assert_eq!(
            store.load_buffer("terminal:periodic-disconnected").unwrap(),
            Some((b"snapshot".to_vec(), 8)),
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn failed_retry_keeps_unavailable_tombstone_in_memory() {
        let manager = PtySessionManager::new(Arc::new(NoopEventSink));
        let id = "terminal:retry-unavailable";
        let mut meta = SessionMeta::new(
            id.to_string(),
            Some("test-project".to_string()),
            "cat".to_string(),
            "/missing/worktree".to_string(),
            RestartPolicy::Never,
        );
        meta.worktree_path = Some("/missing/worktree".to_string());
        meta.target_unavailable = true;

        {
            let mut inner = manager.inner.lock().unwrap();
            inner
                .dead
                .insert(id.to_string(), DeadSession::target_unavailable(meta, 10));
            inner.pending_replacements.insert(id.to_string(), 11);
        }

        manager.mark_replacement_failed(id, 11, false, true, None, None, None);

        let session = manager
            .list()
            .into_iter()
            .find(|session| session.id == id)
            .expect("failed retry should retain its tombstone");
        assert!(!session.alive);
        assert!(session.target_unavailable);
    }

    #[tokio::test]
    async fn session_removed_persistence_waits_for_full_queue() {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        tx.send(crate::persistence::PersistCmd::BufferUpdate {
            session_id: "terminal:queued".to_string(),
            incarnation: 1,
            data: Vec::new(),
            total_written: 0,
        })
        .unwrap();

        let manager = Arc::new(PtySessionManager::with_persist(
            Arc::new(NoopEventSink),
            Some(tx),
            None,
        ));
        let remover = Arc::clone(&manager);
        let sender = std::thread::spawn(move || remover.remove("terminal:removed").unwrap());

        let first = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("the queued command should be available");
        assert!(matches!(
            first,
            crate::persistence::PersistCmd::BufferUpdate { .. }
        ));
        let removed = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("session removal must not be dropped when the queue is full");
        assert!(matches!(
            removed,
            crate::persistence::PersistCmd::SessionRemoved {
                session_id,
            incarnation: _,
            } if session_id == "terminal:removed"
        ));
        sender.join().unwrap();
    }

    #[tokio::test]
    async fn remove_falls_back_to_store_when_persist_worker_is_disconnected() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(crate::persistence::SessionStore::open(temp.path()).unwrap());
        let meta = SessionMeta::new(
            "terminal:disconnected-remove".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        store
            .save_session_for_incarnation(&meta, 1, &HashMap::new(), 80, 24, 5)
            .unwrap();

        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        drop(rx);
        let manager =
            PtySessionManager::with_persist(Arc::new(NoopEventSink), Some(tx), Some(store.clone()));

        manager.remove(&meta.id).unwrap();
        assert!(store.load_sessions().unwrap().is_empty());
    }

    #[test]
    fn lifecycle_persistence_falls_back_when_worker_is_disconnected() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = crate::persistence::SessionStore::open(temp.path()).unwrap();
        let dead_meta = SessionMeta::new(
            "terminal:dead-fallback".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        store
            .save_session_for_incarnation(&dead_meta, 1, &HashMap::new(), 80, 24, 5)
            .unwrap();

        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        drop(rx);
        let persist_tx = Some(tx);
        persist_session_dead(&persist_tx, Some(&store), &dead_meta.id, 1);
        assert!(store.load_sessions().unwrap().is_empty());

        let unavailable_meta = SessionMeta::new(
            "terminal:unavailable-fallback".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        store
            .save_session_for_incarnation(&unavailable_meta, 2, &HashMap::new(), 80, 24, 5)
            .unwrap();
        persist_target_unavailable(&persist_tx, Some(&store), &unavailable_meta.id, 2);
        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].meta.target_unavailable);
        persist_session_dead(&persist_tx, Some(&store), &unavailable_meta.id, 2);
        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].meta.target_unavailable);

        let exited_meta = SessionMeta::new(
            "terminal:exited-fallback".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        store
            .save_session_for_incarnation(&exited_meta, 3, &HashMap::new(), 80, 24, 5)
            .unwrap();
        persist_buffer_snapshot(
            &persist_tx,
            Some(&store),
            &exited_meta.id,
            3,
            b"tail".to_vec(),
            4,
        );
        assert_eq!(
            store.load_buffer(&exited_meta.id).unwrap(),
            Some((b"tail".to_vec(), 4))
        );
        persist_session_exited(&persist_tx, Some(&store), &exited_meta.id, 3);
        assert!(store
            .load_sessions()
            .unwrap()
            .iter()
            .all(|session| session.meta.id != exited_meta.id));
    }

    #[tokio::test]
    async fn final_buffer_is_replayed_from_dead_tombstone_before_persistence() {
        let manager = PtySessionManager::new(Arc::new(NoopEventSink));
        let meta = SessionMeta::new(
            "terminal:dead-buffer".to_string(),
            None,
            "cat".to_string(),
            "/tmp".to_string(),
            RestartPolicy::Never,
        );
        let buffer = Arc::new(Mutex::new(crate::pty::buffer::ScrollbackBuffer::new(1024)));
        buffer.lock().unwrap().push(b"final output\n");
        manager.inner.lock().unwrap().dead.insert(
            meta.id.clone(),
            DeadSession::exited(
                meta.clone(),
                0,
                1,
                Some(Arc::clone(&buffer)),
                terminal_shutdown(),
            ),
        );

        let replay = manager.get_buffer_with_offset(&meta.id, None).unwrap();
        assert_eq!(replay.data, "final output\n");
        assert_eq!(replay.offset, 13);
    }

    #[tokio::test]
    async fn get_buffer_with_offset_session_not_found() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let err = mgr.get_buffer_with_offset("nonexistent", None).unwrap_err();
        assert!(
            matches!(err, AppError::SessionNotFound(_)),
            "Expected SessionNotFound error, got: {err:?}"
        );
    }

    #[tokio::test]
    async fn get_buffer_with_offset_with_some_offset_session_not_found() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let err = mgr.get_buffer_with_offset("ghost", Some(1024)).unwrap_err();
        assert!(
            matches!(err, AppError::SessionNotFound(_)),
            "Expected SessionNotFound error, got: {err:?}"
        );
    }
}
