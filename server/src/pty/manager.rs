use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::OsString,
    io::Read as _,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use portable_pty::{Child as PtyChild, CommandBuilder, NativePtySystem, PtySize, PtySystem as _};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::{
    config::schema::RestartPolicy,
    diagnostics::{redact_diagnostic_text, DiagnosticStore, TerminalTail},
    error::AppError,
    port_forward::PortForwardManager,
    pty::{
        event_sink::EventSink,
        output_redactor::ExactValueRedactor,
        session::{DeadSession, LiveSession, RespawnOpts, SessionMeta, SessionType},
        shell_integration::{interactive_shell_executable, ShellIntegration},
        shell_lifecycle::{LifecycleEvent, LifecycleState, ShellLifecycle},
    },
    telemetry::{
        worker::TelemetryControl, CaptureQuality, CodexCorrelationRegistry, CommandClassifier,
        CommandEvent, CommandEventId, CommandOutcome, NoopTelemetrySink, NormalizedCommand,
        SafeIdentifier, ShellKind, TelemetryRuntime, TelemetrySink, TerminalRunEnd,
        TerminalRunEvent, TerminalRunId, TELEMETRY_SCHEMA_VERSION,
    },
};

const DEAD_SESSION_TTL: Duration = Duration::from_secs(60);
/// Validation regex equivalent: allow word chars, colons, dots, hyphens.
const SESSION_ID_MAX_LEN: usize = 128;
/// Maximum backoff delay for auto-restart: 30 seconds.
const MAX_RESTART_DELAY_MS: u64 = 30_000;
const SAFE_BASELINE_ENV_VARS: &[&str] = &[
    "PATH",
    // User-owned OTel attributes must survive unchanged. Correlation fails
    // closed when this exists and never merges a DamHopper marker into it.
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
    _prev_exit_code: i32,
    restart_count: u32,
    respawn_opts: RespawnOpts,
    delay_ms: u64,
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
    /// Safe process-local marker, intentionally excluded from persisted env.
    pub runtime_otlp_run_marker: Option<String>,
    /// Process-local owner registry, intentionally excluded from persistence.
    pub runtime_codex_correlation: Option<Arc<CodexCorrelationRegistry>>,
    pub cols: u16,
    pub rows: u16,
    pub project: Option<String>,
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
            runtime_otlp_run_marker: self.runtime_otlp_run_marker.clone(),
            runtime_codex_correlation: self.runtime_codex_correlation.clone(),
            cols: self.cols,
            rows: self.rows,
            project: self.project.clone(),
            restart_policy: self.restart_policy,
            restart_max_retries: self.restart_max_retries,
        }
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
    sink: Arc<dyn EventSink>,
    /// Bounded sender (256 slots) for respawn requests from reader threads.
    /// Consumed by supervisor_loop task. If queue full, supervisor is dead/slow.
    respawn_tx: mpsc::Sender<RespawnCmd>,
    /// Optional sender for persistence commands to worker thread.
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
    telemetry_sink: Arc<dyn TelemetrySink>,
    command_classifier: Option<Arc<CommandClassifier>>,
    telemetry_control: Option<Arc<TelemetryControl>>,
    telemetry_runtime: Option<TelemetryRuntime>,
}

struct Inner {
    live: HashMap<String, LiveSession>,
    dead: HashMap<String, DeadSession>,
    /// Track session IDs that were explicitly killed by user (kill/remove API).
    /// Reader thread checks this to prevent auto-restart after manual termination.
    killed: HashSet<String>,
    /// Count of replaced readers that must not emit exit events against reused
    /// public ids. Multiple rapid recreates can have multiple old readers.
    suppress_exit_counts: HashMap<String, usize>,
}

impl Inner {
    fn new() -> Self {
        Self {
            live: HashMap::new(),
            dead: HashMap::new(),
            killed: HashSet::new(),
            suppress_exit_counts: HashMap::new(),
        }
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
        // Phase 03 supplies the durable telemetry worker. Until then, the
        // default server path intentionally keeps telemetry disabled.
        Self::with_persist_and_telemetry(
            sink,
            persist_tx,
            session_store,
            Arc::new(NoopTelemetrySink::new()),
            None,
        )
    }

    pub fn with_telemetry(
        sink: Arc<dyn EventSink>,
        telemetry_sink: Arc<dyn TelemetrySink>,
        command_classifier: Arc<CommandClassifier>,
    ) -> Self {
        // This constructor is the Phase 02 integration seam for the Phase 03
        // durable worker, while keeping telemetry capture non-blocking.
        Self::with_persist_and_telemetry(sink, None, None, telemetry_sink, Some(command_classifier))
    }

    pub fn with_persist_and_telemetry(
        sink: Arc<dyn EventSink>,
        persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
        session_store: Option<std::sync::Arc<crate::persistence::SessionStore>>,
        telemetry_sink: Arc<dyn TelemetrySink>,
        command_classifier: Option<Arc<CommandClassifier>>,
    ) -> Self {
        Self::with_persist_and_telemetry_control(
            sink,
            persist_tx,
            session_store,
            telemetry_sink,
            command_classifier,
            Some(Arc::new(TelemetryControl::new(true, Vec::new()))),
        )
    }

    pub fn with_persist_and_telemetry_control(
        sink: Arc<dyn EventSink>,
        persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
        session_store: Option<std::sync::Arc<crate::persistence::SessionStore>>,
        telemetry_sink: Arc<dyn TelemetrySink>,
        command_classifier: Option<Arc<CommandClassifier>>,
        telemetry_control: Option<Arc<TelemetryControl>>,
    ) -> Self {
        Self::with_persist_and_telemetry_runtime_inner(
            sink,
            persist_tx,
            session_store,
            telemetry_sink,
            command_classifier,
            telemetry_control,
            None,
        )
    }

    fn with_persist_and_telemetry_runtime_inner(
        sink: Arc<dyn EventSink>,
        persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
        session_store: Option<std::sync::Arc<crate::persistence::SessionStore>>,
        telemetry_sink: Arc<dyn TelemetrySink>,
        command_classifier: Option<Arc<CommandClassifier>>,
        telemetry_control: Option<Arc<TelemetryControl>>,
        telemetry_runtime: Option<TelemetryRuntime>,
    ) -> Self {
        // Bounded channel prevents DoS if supervisor hangs/panics.
        // 256 slots = ~5× typical max sessions (50). If full, supervisor is dead/slow.
        let (respawn_tx, respawn_rx) = mpsc::channel(256);

        // Clone respawn_tx before moving it into manager.
        let respawn_tx_clone = respawn_tx.clone();

        // Clone persist_tx before moving it into manager.
        let persist_tx_clone = persist_tx.clone();

        let manager = Self {
            inner: Arc::new(Mutex::new(Inner::new())),
            sink: Arc::clone(&sink),
            respawn_tx,
            persist_tx,
            session_store,
            port_forward_manager: Arc::new(std::sync::RwLock::new(None)),
            diagnostics: Arc::new(std::sync::RwLock::new(None)),
            telemetry_sink,
            command_classifier,
            telemetry_control,
            telemetry_runtime,
        };

        // Spawn the supervisor task that handles respawn requests.
        let inner_clone = Arc::clone(&manager.inner);
        let sink_clone = Arc::clone(&sink);
        let pfm_cell = Arc::clone(&manager.port_forward_manager);
        let diag_cell = Arc::clone(&manager.diagnostics);
        let telemetry_sink = Arc::clone(&manager.telemetry_sink);
        let command_classifier = manager.command_classifier.clone();
        let telemetry_control = manager.telemetry_control.clone();
        let telemetry_runtime = manager.telemetry_runtime.clone();
        tokio::spawn(supervisor_loop(
            respawn_rx,
            inner_clone,
            sink_clone,
            respawn_tx_clone,
            persist_tx_clone,
            pfm_cell,
            diag_cell,
            telemetry_sink,
            command_classifier,
            telemetry_control,
            telemetry_runtime,
        ));

        manager
    }

    /// New PTYs take a telemetry snapshot at their run boundary. The runtime
    /// itself stays stable, letting Settings enable or disable later sessions
    /// without replacing this manager or touching existing reader threads.
    pub fn with_persist_and_telemetry_runtime(
        sink: Arc<dyn EventSink>,
        persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
        session_store: Option<std::sync::Arc<crate::persistence::SessionStore>>,
        telemetry_runtime: TelemetryRuntime,
    ) -> Self {
        Self::with_persist_and_telemetry_runtime_inner(
            sink,
            persist_tx,
            session_store,
            Arc::new(NoopTelemetrySink::new()),
            None,
            None,
            Some(telemetry_runtime),
        )
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
        validate_session_id(&opts.id)?;

        // Kill any existing session with this ID before recreating.
        self.kill_internal_for_replace(&opts.id);

        // Release lock before slow I/O operations (openpty, spawn_command).
        // Reacquire after spawn to update state atomically.
        // SAFETY: kill_internal marks session as killed, so supervisor won't
        // restart it even if we're preempted here.

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::PtyError(e.to_string()))?;

        let integration = ShellIntegration::prepare(&opts.command, &opts.env);
        let mut cmd = build_command(&opts);
        apply_child_env(&mut cmd, &opts.env, opts.runtime_otlp_run_marker.as_deref());
        if let Some(integration) = &integration {
            integration.apply(&mut cmd);
        }
        // Log env keys only — values may contain secrets (API keys, tokens).
        debug!(id = %opts.id, env_keys = ?opts.env.keys().collect::<Vec<_>>(), "Spawning PTY");
        let session_id_for_diag = opts.id.clone();
        let run_id = TerminalRunId(Uuid::new_v4());
        let registered_marker = opts
            .runtime_otlp_run_marker
            .as_deref()
            .zip(opts.runtime_codex_correlation.as_ref())
            .map(|(marker, registry)| {
                let marker = SafeIdentifier::new(marker).expect("runtime marker must remain safe");
                registry.register(marker.clone(), run_id, utc_now_ms());
                (marker, Arc::clone(registry))
            });
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
            if let Some((marker, registry)) = &registered_marker {
                registry.unregister(marker, run_id);
            }
            let error = format!("spawn failed: {e}");
            let mut fields = BTreeMap::new();
            fields.insert("sessionId".into(), session_id_for_diag.clone());
            fields.insert("error".into(), error.clone());
            if let Some(project) = &opts.project {
                fields.insert("project".into(), project.clone());
            }
            self.record_diag("pty", "terminal.spawn_failed", fields);
            AppError::PtyError(error)
        })?;

        // portable-pty requires clone_reader before take_writer
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let _ = child.kill();
                unregister_marker(&registered_marker, run_id);
                return Err(AppError::PtyError(format!("clone_reader failed: {error}")));
            }
        };

        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let _ = child.kill();
                unregister_marker(&registered_marker, run_id);
                return Err(AppError::PtyError(format!("take_writer failed: {error}")));
            }
        };

        let child_killer = child.clone_killer();
        let respawn_opts = opts.clone_for_respawn();
        let RespawnOpts {
            env: persisted_env, ..
        } = respawn_opts.clone();
        let project_name = opts.project.clone();
        let meta = SessionMeta::new(
            opts.id.clone(),
            opts.project.clone(),
            opts.command.clone(),
            opts.cwd.clone(),
            opts.restart_policy,
        );

        let lifecycle = integration.as_ref().map(ShellIntegration::lifecycle);
        let telemetry_shell = integration
            .as_ref()
            .and_then(|integration| shell_kind(integration.capabilities().name));
        let session = LiveSession::new(
            meta.clone(),
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

        {
            let mut inner = self.inner.lock().unwrap();
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
        if let Some(tx) = &self.persist_tx {
            if let Err(e) = tx.send(crate::persistence::PersistCmd::SessionCreated {
                meta: meta.clone(),
                env: persisted_env,
                cols: opts.cols,
                rows: opts.rows,
                restart_max_retries: opts.restart_max_retries,
            }) {
                warn!("Failed to persist SessionCreated: {}", e);
            }
        }

        // Spawn dedicated reader thread — portable-pty reads are blocking.
        // Must NOT use tokio::spawn_blocking: it consumes a Tokio worker thread
        // for the entire session lifetime, causing starvation under load.
        let sink = Arc::clone(&self.sink);
        let inner_ref = Arc::clone(&self.inner);
        let session_id = opts.id.clone();
        let respawn_tx = self.respawn_tx.clone();
        let persist_tx = self.persist_tx.clone();
        let port_forward_manager = self.port_forward_manager.read().unwrap().clone();
        let rt_handle = tokio::runtime::Handle::try_current().ok();
        let diag_store = self.diagnostics.read().unwrap().clone();
        let capture = self
            .telemetry_runtime
            .as_ref()
            .map(TelemetryRuntime::capture);
        let telemetry_sink = capture
            .as_ref()
            .map(|capture| capture.sink.clone())
            .unwrap_or_else(|| Arc::clone(&self.telemetry_sink));
        let command_classifier = capture
            .as_ref()
            .map(|capture| capture.classifier.clone())
            .unwrap_or_else(|| self.command_classifier.clone());
        let telemetry_control = capture
            .as_ref()
            .map(|capture| capture.control.clone())
            .unwrap_or_else(|| self.telemetry_control.clone());

        let thread_registration = registered_marker.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader:{session_id}"))
            .spawn(move || {
                reader_thread(
                    session_id,
                    reader,
                    child,
                    buffer,
                    shutdown,
                    sink,
                    inner_ref,
                    respawn_tx,
                    persist_tx,
                    port_forward_manager,
                    project_name,
                    rt_handle,
                    diag_store,
                    lifecycle,
                    published_editing,
                    run_id,
                    telemetry_sink,
                    command_classifier,
                    telemetry_control,
                    telemetry_shell,
                    opts.runtime_otlp_run_marker.clone(),
                );
            })
            .map_err(|e| {
                self.kill_internal_for_replace(&opts.id);
                unregister_marker(&thread_registration, run_id);
                AppError::PtyError(format!("thread spawn failed: {e}"))
            })?;

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
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let mut inner = self.inner.lock().unwrap();
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
            if let Err(e) = tx.try_send(crate::persistence::PersistCmd::SessionRemoved {
                session_id: id.to_string(),
            }) {
                warn!("Persist queue full, dropping SessionRemoved: {}", e);
            }
        }

        self.sink.send_terminal_changed();
        Ok(())
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

    /// Dispose all sessions — call on graceful shutdown.
    pub fn dispose(&self) {
        let mut inner = self.inner.lock().unwrap();
        info!(count = inner.live.len(), "Disposing all PTY sessions");
        for session in inner.live.values() {
            session.terminate();
        }
        inner.live.clear();
        inner.dead.clear();
    }

    /// Persist full snapshots for all live sessions before graceful shutdown.
    pub fn snapshot_live_buffers(&self) {
        let snapshots = {
            let inner = self.inner.lock().unwrap();
            inner
                .live
                .iter()
                .map(|(id, session)| {
                    let (data, total_written) = session.buffer.lock().unwrap().snapshot();
                    (id.clone(), data, total_written)
                })
                .collect::<Vec<_>>()
        };

        if snapshots.is_empty() {
            return;
        }

        if let Some(tx) = &self.persist_tx {
            for (session_id, data, total_written) in snapshots {
                if let Err(e) = tx.send(crate::persistence::PersistCmd::BufferUpdate {
                    session_id: session_id.clone(),
                    data,
                    total_written,
                }) {
                    warn!(session_id, "Failed to persist shutdown snapshot: {}", e);
                    break;
                }
            }
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
        self.kill_internal_impl(id, false);
    }

    fn kill_internal_for_replace(&self, id: &str) {
        self.kill_internal_impl(id, true);
    }

    fn kill_internal_impl(&self, id: &str, suppress_exit: bool) {
        let mut inner = self.inner.lock().unwrap();
        // Mark as killed BEFORE removing from live — reader thread checks this.
        inner.killed.insert(id.to_string());
        if let Some(session) = inner.live.remove(id) {
            if suppress_exit {
                *inner
                    .suppress_exit_counts
                    .entry(id.to_string())
                    .or_insert(0) += 1;
            }
            session.terminate();
            inner
                .dead
                .insert(id.to_string(), DeadSession::killed(session.meta));
        }
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

struct PendingTelemetryCommand {
    normalized: NormalizedCommand,
    sequence: u64,
    occurred_at_utc_ms: i64,
    submitted_at: Instant,
    execution_started: bool,
}

struct TelemetryContext {
    run_id: TerminalRunId,
    next_sequence: u64,
    editing_seen: bool,
    pending: Option<PendingTelemetryCommand>,
    sink: Arc<dyn TelemetrySink>,
    classifier: Option<Arc<CommandClassifier>>,
}

impl TelemetryContext {
    fn new(
        run_id: TerminalRunId,
        sink: Arc<dyn TelemetrySink>,
        classifier: Option<Arc<CommandClassifier>>,
    ) -> Self {
        Self {
            run_id,
            next_sequence: 1,
            editing_seen: false,
            pending: None,
            sink,
            classifier,
        }
    }

    fn observe(&mut self, event: &LifecycleEvent) {
        match event.state {
            LifecycleState::Submitted => {
                let Some(command) = event.command.as_deref() else {
                    return;
                };
                let Some(classifier) = &self.classifier else {
                    return;
                };
                let normalized = classifier.normalize(command);
                self.finish_pending(CommandOutcome::Unknown, None, CaptureQuality::Partial);
                let sequence = self.next_sequence;
                self.next_sequence = self.next_sequence.saturating_add(1);
                self.pending = Some(PendingTelemetryCommand {
                    normalized,
                    sequence,
                    occurred_at_utc_ms: utc_now_ms(),
                    submitted_at: Instant::now(),
                    execution_started: false,
                });
            }
            LifecycleState::Opaque => {
                if let Some(pending) = &mut self.pending {
                    pending.execution_started = true;
                }
            }
            LifecycleState::Finished => {
                let quality = event
                    .exit_code
                    .map(|_| CaptureQuality::Rich)
                    .unwrap_or(CaptureQuality::Partial);
                let outcome = match event.exit_code {
                    Some(0) => CommandOutcome::Succeeded,
                    Some(_) => CommandOutcome::Failed,
                    None => CommandOutcome::Unknown,
                };
                self.finish_pending(outcome, event.exit_code, quality);
                self.editing_seen = false;
            }
            LifecycleState::Unverified => {
                if self.pending.is_none() && self.editing_seen {
                    self.record_unavailable();
                }
                self.finish_pending(CommandOutcome::Unknown, None, CaptureQuality::Partial);
                self.editing_seen = false;
            }
            LifecycleState::Prompt => {}
            LifecycleState::Editing => self.editing_seen = true,
        }
    }

    fn finish_interrupted(&mut self) {
        self.finish_pending(CommandOutcome::Interrupted, None, CaptureQuality::Partial);
    }

    fn finish_pending(
        &mut self,
        outcome: CommandOutcome,
        exit_code: Option<i32>,
        quality: CaptureQuality,
    ) {
        let Some(pending) = self.pending.take() else {
            return;
        };
        let duration_ms = pending
            .submitted_at
            .elapsed()
            .as_millis()
            .min(u64::MAX as u128) as u64;
        self.sink.try_record(CommandEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: CommandEventId {
                run_id: self.run_id,
                sequence: pending.sequence,
            },
            occurred_at_utc_ms: pending.occurred_at_utc_ms,
            duration_ms: Some(duration_ms),
            exit_code,
            outcome,
            category: pending.normalized.category,
            executable: pending.normalized.executable,
            argument_count: pending.normalized.argument_count,
            fingerprint: pending.normalized.fingerprint,
            capture_quality: if pending.execution_started {
                combine_capture_quality(pending.normalized.capture_quality, quality)
            } else {
                CaptureQuality::Partial
            },
        });
    }

    fn record_unavailable(&mut self) {
        let Some(classifier) = &self.classifier else {
            return;
        };
        let normalized = classifier.normalize("");
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.sink.try_record(CommandEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: CommandEventId {
                run_id: self.run_id,
                sequence,
            },
            occurred_at_utc_ms: utc_now_ms(),
            duration_ms: None,
            exit_code: None,
            outcome: CommandOutcome::Unknown,
            category: normalized.category,
            executable: normalized.executable,
            argument_count: normalized.argument_count,
            fingerprint: normalized.fingerprint,
            capture_quality: CaptureQuality::Unavailable,
        });
    }
}

fn utc_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn combine_capture_quality(
    normalized: CaptureQuality,
    lifecycle: CaptureQuality,
) -> CaptureQuality {
    match (normalized, lifecycle) {
        (CaptureQuality::Rich, CaptureQuality::Rich) => CaptureQuality::Rich,
        (CaptureQuality::Unavailable, _) => CaptureQuality::Unavailable,
        _ => CaptureQuality::Partial,
    }
}

fn shell_kind(name: &str) -> Option<ShellKind> {
    match name {
        "bash" => Some(ShellKind::Bash),
        "zsh" => Some(ShellKind::Zsh),
        "fish" => Some(ShellKind::Fish),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Reader thread
// ---------------------------------------------------------------------------

fn reader_thread(
    session_id: String,
    mut reader: Box<dyn std::io::Read + Send>,
    mut child: Box<dyn PtyChild + Send + Sync>,
    buffer: Arc<Mutex<crate::pty::buffer::ScrollbackBuffer>>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    sink: Arc<dyn EventSink>,
    inner: Arc<Mutex<Inner>>,
    respawn_tx: mpsc::Sender<RespawnCmd>,
    persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    port_forward_manager: Option<Arc<PortForwardManager>>,
    project: Option<String>,
    rt_handle: Option<tokio::runtime::Handle>,
    diag_store: Option<DiagnosticStore>,
    lifecycle: Option<Arc<Mutex<ShellLifecycle>>>,
    published_editing: Arc<std::sync::atomic::AtomicBool>,
    run_id: TerminalRunId,
    telemetry_sink: Arc<dyn TelemetrySink>,
    command_classifier: Option<Arc<CommandClassifier>>,
    telemetry_control: Option<Arc<TelemetryControl>>,
    telemetry_shell: Option<ShellKind>,
    runtime_otlp_run_marker: Option<String>,
) {
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
    let mut output_redactor = ExactValueRedactor::new(runtime_otlp_run_marker);
    // Throttle buffer snapshots: only send to persist worker every 16KB to reduce memory churn.
    // Performance: reduces snapshot frequency from ~100/sec to ~6/sec on fast terminals (16x improvement).
    // Trade-off: Sessions with < 16KB output won't persist to SQLite (acceptable: WS reconnect still works,
    // only server restart loses buffer for short sessions like quick commands or failed builds).
    let mut bytes_since_snapshot = 0usize;
    const SNAPSHOT_THRESHOLD: usize = 16 * 1024; // 16KB
                                                 // Marker-only chunks must not announce editing before prompt bytes exist.
    let mut pending_lifecycle_events: Vec<(u64, LifecycleEvent)> = Vec::new();
    let mut visible_output_since_boundary = false;
    let telemetry_enabled = telemetry_control
        .as_ref()
        .is_some_and(|control| control.allows_project(project.as_deref()));
    let mut telemetry = TelemetryContext::new(
        run_id,
        Arc::clone(&telemetry_sink),
        telemetry_enabled.then_some(command_classifier).flatten(),
    );
    if telemetry_enabled {
        if let Some(shell) = telemetry_shell {
            telemetry_sink.try_record_run(TerminalRunEvent {
                schema_version: TELEMETRY_SCHEMA_VERSION,
                run_id,
                project: project
                    .as_deref()
                    .and_then(|project| crate::telemetry::SafeIdentifier::new(project).ok()),
                shell,
                started_at_utc_ms: utc_now_ms(),
                ended_at_utc_ms: None,
                capture_quality: CaptureQuality::Rich,
            });
        }
    }

    let mut process_redacted_chunk = |data: &[u8]| {
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
                telemetry.observe(&event);
                pending_lifecycle_events.push((generation, event));
            }
            visible_data
        } else {
            data.to_vec()
        };
        {
            let mut buf = buffer.lock().unwrap();
            buf.push(&visible_data);
            bytes_since_snapshot += visible_data.len();
            if bytes_since_snapshot >= SNAPSHOT_THRESHOLD {
                if let Some(tx) = &persist_tx {
                    let (snapshot_data, total_written) = buf.snapshot();
                    let _ = tx.try_send(crate::persistence::PersistCmd::BufferUpdate {
                        session_id: session_id.clone(),
                        data: snapshot_data,
                        total_written,
                    });
                    bytes_since_snapshot = 0;
                }
            }
        }
        let data_str = String::from_utf8_lossy(&visible_data).into_owned();
        if let (Some(pfm), Some(handle)) = (&port_forward_manager, &rt_handle) {
            crate::port_forward::scan_chunk(
                &visible_data,
                &session_id,
                project.as_deref(),
                pfm,
                handle,
            );
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
                let redacted = output_redactor.redact(&chunk[..n]);
                process_redacted_chunk(&redacted);
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

    // Preserve ordinary output that happened to end with a marker prefix.
    // A complete marker has already been replaced, including ANSI-interleaved
    // forms, before any terminal-facing or durable sink sees it.
    let redaction_tail = output_redactor.finish();
    if !redaction_tail.is_empty() {
        process_redacted_chunk(&redaction_tail);
    }
    drop(process_redacted_chunk);

    telemetry.finish_interrupted();
    if telemetry_enabled {
        telemetry_sink.try_finish_run(TerminalRunEnd {
            run_id,
            ended_at_utc_ms: utc_now_ms(),
            capture_quality: CaptureQuality::Rich,
        });
    }

    // Collect real exit code from child. By the time the PTY reader sees EOF the
    // child has exited (slave-side fd closed), so wait() returns immediately.
    // Falls back to 0 on error (treated as clean exit).
    let exit_code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(0);
    info!(id = %session_id, exit_code, "PTY session exited");

    // Send a final full snapshot before SessionExited so short-output sessions
    // (<16KB) survive server restart.
    if let Some(tx) = &persist_tx {
        let (data, total_written) = buffer.lock().unwrap().snapshot();
        if let Err(e) = tx.send(crate::persistence::PersistCmd::BufferUpdate {
            session_id: session_id.clone(),
            data,
            total_written,
        }) {
            warn!(session_id = %session_id, "Failed to send final buffer snapshot: {}", e);
        }
        if let Err(e) = tx.send(crate::persistence::PersistCmd::SessionExited {
            session_id: session_id.clone(),
        }) {
            warn!(session_id = %session_id, "Persist queue full, dropping SessionExited: {}", e);
        }
    }

    let (respawn_opts, restart_count, _was_killed, should_restart, _delay_ms, emit_exit) = {
        let mut inner_guard = inner.lock().unwrap();
        let was_killed = inner_guard.killed.contains(&session_id);

        let owns_live_session = inner_guard
            .live
            .get(&session_id)
            .map(|session| Arc::ptr_eq(&session.shutdown_ref(), &shutdown))
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
            let mut tombstone = DeadSession::exited(session.meta, exit_code);
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
                    runtime_otlp_run_marker: None,
                    runtime_codex_correlation: None,
                    cols: 80,
                    rows: 24,
                    project: None,
                    restart_policy: RestartPolicy::Never,
                    restart_max_retries: 0,
                },
                0,
                true,
                None,
                0,
                false,
            )
        } else {
            let suppress_exit = consume_suppressed_exit(&mut inner_guard, &session_id);
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
                    runtime_otlp_run_marker: None,
                    runtime_codex_correlation: None,
                    cols: 80,
                    rows: 24,
                    project: None,
                    restart_policy: RestartPolicy::Never,
                    restart_max_retries: 0,
                },
                0,
                true,
                None,
                0,
                !suppress_exit,
            )
        }
    };

    // Send respawn command if needed.
    // try_send (non-blocking) because queue is bounded. If full, supervisor is
    // dead/slow — dropping this respawn is correct (session already in dead map).
    if let Some(delay) = should_restart {
        let cmd = RespawnCmd {
            id: session_id.clone(),
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
    pfm_cell: Arc<std::sync::RwLock<Option<Arc<PortForwardManager>>>>,
    diag_cell: Arc<std::sync::RwLock<Option<DiagnosticStore>>>,
    telemetry_sink: Arc<dyn TelemetrySink>,
    command_classifier: Option<Arc<CommandClassifier>>,
    telemetry_control: Option<Arc<TelemetryControl>>,
    telemetry_runtime: Option<TelemetryRuntime>,
) {
    while let Some(cmd) = respawn_rx.recv().await {
        let session_id = cmd.id.clone();
        let restart_attempt = cmd.restart_count + 1;
        let restart_policy = format!("{:?}", cmd.respawn_opts.restart_policy);
        let project = cmd.respawn_opts.project.clone();

        // Wait for backoff delay.
        if cmd.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(cmd.delay_ms)).await;
        }

        // Check if session was killed during backoff.
        {
            let inner_guard = inner.lock().unwrap();
            if inner_guard.killed.contains(&session_id) {
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
        if let Err(e) = respawn_internal(
            &session_id,
            cmd,
            &inner,
            &sink,
            &respawn_tx,
            persist_tx.clone(),
            pfm,
            diag_store.clone(),
            Arc::clone(&telemetry_sink),
            command_classifier.clone(),
            telemetry_control.clone(),
            telemetry_runtime.clone(),
        )
        .await
        {
            warn!(id = %session_id, error = %e, "Respawn failed");
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

/// Internal respawn logic — reuses the same session ID.
/// Called by supervisor task after backoff delay.
async fn respawn_internal(
    session_id: &str,
    cmd: RespawnCmd,
    inner: &Arc<Mutex<Inner>>,
    sink: &Arc<dyn EventSink>,
    respawn_tx: &mpsc::Sender<RespawnCmd>,
    persist_tx: Option<std::sync::mpsc::SyncSender<crate::persistence::PersistCmd>>,
    port_forward_manager: Option<Arc<PortForwardManager>>,
    diag_store: Option<DiagnosticStore>,
    telemetry_sink: Arc<dyn TelemetrySink>,
    command_classifier: Option<Arc<CommandClassifier>>,
    telemetry_control: Option<Arc<TelemetryControl>>,
    telemetry_runtime: Option<TelemetryRuntime>,
) -> Result<(), AppError> {
    let opts = &cmd.respawn_opts;

    // Build PTY with same config.
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: opts.rows,
            cols: opts.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::PtyError(e.to_string()))?;

    let integration = ShellIntegration::prepare(&opts.command, &opts.env);
    let mut build_cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("cmd.exe")
    } else if opts.command == "bash" {
        CommandBuilder::new(
            interactive_shell_executable(&opts.command, &opts.env)
                .expect("explicit bash must resolve to an executable"),
        )
    } else if opts.command.is_empty() {
        let shell = opts
            .env
            .get("SHELL")
            .filter(|s| s.starts_with('/'))
            .cloned()
            .unwrap_or_else(|| "/bin/bash".to_string());
        CommandBuilder::new(&shell)
    } else {
        let mut c = CommandBuilder::new("/bin/sh");
        c.arg("-c");
        c.arg(&opts.command);
        c
    };

    build_cmd.cwd(&opts.cwd);
    let runtime_marker = opts
        .runtime_codex_correlation
        .as_ref()
        .map(|_| Uuid::new_v4().to_string());
    apply_child_env(&mut build_cmd, &opts.env, runtime_marker.as_deref());
    if let Some(integration) = &integration {
        integration.apply(&mut build_cmd);
    }

    let run_id = TerminalRunId(Uuid::new_v4());
    let registered_marker = runtime_marker
        .as_deref()
        .zip(opts.runtime_codex_correlation.as_ref())
        .map(|(marker, registry)| {
            let marker = SafeIdentifier::new(marker).expect("runtime marker must remain safe");
            registry.register(marker.clone(), run_id, utc_now_ms());
            (marker, Arc::clone(registry))
        });
    let mut child = pair
        .slave
        .spawn_command(build_cmd)
        .map_err(|e| {
            if let Some((marker, registry)) = &registered_marker {
                registry.unregister(marker, run_id);
            }
            AppError::PtyError(format!("spawn failed: {e}"))
        })?;

    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            unregister_marker(&registered_marker, run_id);
            return Err(AppError::PtyError(format!("clone_reader failed: {error}")));
        }
    };

    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            let _ = child.kill();
            unregister_marker(&registered_marker, run_id);
            return Err(AppError::PtyError(format!("take_writer failed: {error}")));
        }
    };

    // Increment restart_count.
    let mut meta = SessionMeta::new(
        session_id.to_string(),
        opts.project.clone(),
        opts.command.clone(),
        opts.cwd.clone(),
        opts.restart_policy,
    );
    meta.restart_count = cmd.restart_count + 1;
    meta.last_exit_at = Some(crate::pty::session::now_ms());

    let child_killer = child.clone_killer();
    let lifecycle = integration.as_ref().map(ShellIntegration::lifecycle);
    let telemetry_shell = integration
        .as_ref()
        .and_then(|integration| shell_kind(integration.capabilities().name));
    let session = LiveSession::new(
        meta.clone(),
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

    // Insert into live map — if session ID already exists (user called create
    // concurrently), this will replace it (same behavior as create()).
    {
        let mut inner_guard = inner.lock().unwrap();
        // Remove from killed set (allow future restarts if user doesn't kill again).
        inner_guard.killed.remove(session_id);
        inner_guard.dead.remove(session_id);
        if let Some(existing) = inner_guard.live.remove(session_id) {
            warn!(id = %session_id, "Concurrent session detected during respawn, replacing");
            existing.terminate();
        }
        inner_guard.live.insert(session_id.to_string(), session);
    }

    // Re-mark the session as alive in persistence. SessionExited flipped alive=0
    // when the previous run exited; without this, restore after a server restart
    // would skip the re-spawned session.
    if let Some(tx) = &persist_tx {
        if let Err(e) = tx.send(crate::persistence::PersistCmd::SessionCreated {
            meta: meta.clone(),
            env: opts.env.clone(),
            cols: opts.cols,
            rows: opts.rows,
            restart_max_retries: opts.restart_max_retries,
        }) {
            warn!("Failed to persist SessionCreated (respawn): {}", e);
        }
    }

    // Spawn reader thread for the restarted session.
    let inner_clone = Arc::clone(inner);
    let sink_clone = Arc::clone(sink);
    let id_clone = session_id.to_string();
    let respawn_tx_clone = respawn_tx.clone();
    let project_name = opts.project.clone();
    let rt_handle = tokio::runtime::Handle::try_current().ok();
    // Auto-restart is a new run boundary too. Resolve the runtime immediately
    // before its reader begins so an intervening Settings change is respected.
    let capture = telemetry_runtime.as_ref().map(TelemetryRuntime::capture);
    let telemetry_sink = capture
        .as_ref()
        .map(|capture| capture.sink.clone())
        .unwrap_or(telemetry_sink);
    let command_classifier = capture
        .as_ref()
        .map(|capture| capture.classifier.clone())
        .unwrap_or(command_classifier);
    let telemetry_control = capture
        .as_ref()
        .map(|capture| capture.control.clone())
        .unwrap_or(telemetry_control);

    let thread_registration = registered_marker.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader:{id_clone}"))
        .spawn(move || {
            reader_thread(
                id_clone,
                reader,
                child,
                buffer,
                shutdown,
                sink_clone,
                inner_clone,
                respawn_tx_clone,
                persist_tx,
                port_forward_manager,
                project_name,
                rt_handle,
                diag_store,
                lifecycle,
                published_editing,
                run_id,
                telemetry_sink,
                command_classifier,
                telemetry_control,
                telemetry_shell,
                runtime_marker,
            );
        })
        .map_err(|e| {
            let session = inner.lock().unwrap().live.remove(session_id);
            if let Some(session) = session {
                session.terminate();
            }
            unregister_marker(&thread_registration, run_id);
            AppError::PtyError(format!("thread spawn failed: {e}"))
        })?;

    info!(id = %session_id, restart_count = meta.restart_count, "Session restarted");
    Ok(())
}

fn unregister_marker(
    registration: &Option<(SafeIdentifier, Arc<CodexCorrelationRegistry>)>,
    run_id: TerminalRunId,
) {
    if let Some((marker, registry)) = registration {
        registry.unregister(marker, run_id);
    }
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

fn build_command(opts: &PtyCreateOpts) -> CommandBuilder {
    let is_interactive = opts.command.is_empty();

    let (exe, args) = if cfg!(target_os = "windows") {
        ("cmd.exe".to_string(), vec![])
    } else if opts.command == "bash" {
        (
            interactive_shell_executable(&opts.command, &opts.env)
                .expect("explicit bash must resolve to an executable"),
            vec![],
        )
    } else if is_interactive {
        let shell = opts
            .env
            .get("SHELL")
            .filter(|s| s.starts_with('/'))
            .cloned()
            .unwrap_or_else(|| "/bin/bash".to_string());
        (shell, vec![])
    } else {
        (
            "/bin/sh".to_string(),
            vec!["-c".to_string(), opts.command.clone()],
        )
    };

    let mut cmd = CommandBuilder::new(&exe);
    for arg in args {
        cmd.arg(arg);
    }
    // Strip UNC prefix to avoid CMD.EXE "UNC paths are not supported" error
    let safe_cwd = strip_unc_prefix(&opts.cwd);
    cmd.cwd(safe_cwd);
    cmd
}

fn apply_child_env(
    cmd: &mut CommandBuilder,
    env: &HashMap<String, String>,
    runtime_otlp_run_marker: Option<&str>,
) {
    cmd.env_clear();
    for (key, value) in build_child_env(env) {
        cmd.env(key, value);
    }
    if let Some(marker) = runtime_otlp_run_marker {
        cmd.env(
            "OTEL_RESOURCE_ATTRIBUTES",
            runtime_otlp_resource_attributes(marker),
        );
    }
}

fn runtime_otlp_resource_attributes(marker: &str) -> String {
    format!("dam_hopper.run_id={marker}")
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
        .filter_map(|key| parent_env.get(*key).cloned().map(|value| (*key, value)))
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

#[cfg(test)]
mod telemetry_context_tests {
    use super::*;
    use crate::telemetry::{
        ChannelTelemetrySink, CommandClassifier, TelemetryCmd, TelemetryKeyRing,
    };
    use std::sync::Arc;

    fn event(
        state: LifecycleState,
        command: Option<&str>,
        exit_code: Option<i32>,
    ) -> LifecycleEvent {
        LifecycleEvent {
            state,
            command: command.map(str::to_string),
            exit_code,
        }
    }

    fn command(command: TelemetryCmd) -> CommandEvent {
        match command {
            TelemetryCmd::Command(command) => command,
            other => panic!("expected command telemetry, got {other:?}"),
        }
    }

    #[test]
    fn records_normalized_completion_with_monotonic_duration() {
        let directory = tempfile::tempdir().unwrap();
        let key = Arc::new(TelemetryKeyRing::load_or_create(directory.path().join("key")).unwrap());
        let classifier = Arc::new(CommandClassifier::new(key));
        let (sink, receiver) = ChannelTelemetrySink::channel(2);
        let run_id = TerminalRunId(Uuid::new_v4());
        let mut context = TelemetryContext::new(run_id, Arc::new(sink), Some(classifier));

        context.observe(&event(
            LifecycleState::Submitted,
            Some("git status fixture-secret"),
            None,
        ));
        context.observe(&event(LifecycleState::Opaque, None, None));
        context.observe(&event(LifecycleState::Finished, None, Some(0)));

        let recorded = command(receiver.try_recv().unwrap());
        assert_eq!(recorded.id.run_id, run_id);
        assert_eq!(recorded.id.sequence, 1);
        assert_eq!(recorded.outcome, CommandOutcome::Succeeded);
        assert!(recorded.duration_ms.is_some());
        assert!(!format!("{recorded:?}").contains("fixture-secret"));
    }

    #[test]
    fn incomplete_lifecycle_is_unknown_and_sequence_is_deterministic() {
        let directory = tempfile::tempdir().unwrap();
        let key = Arc::new(TelemetryKeyRing::load_or_create(directory.path().join("key")).unwrap());
        let classifier = Arc::new(CommandClassifier::new(key));
        let (sink, receiver) = ChannelTelemetrySink::channel(4);
        let run_id = TerminalRunId(Uuid::new_v4());
        let mut context = TelemetryContext::new(run_id, Arc::new(sink), Some(classifier));

        context.observe(&event(LifecycleState::Submitted, Some("false"), None));
        context.observe(&event(LifecycleState::Unverified, None, None));
        context.observe(&event(LifecycleState::Submitted, Some("true"), None));
        context.finish_interrupted();

        let first = command(receiver.try_recv().unwrap());
        let second = command(receiver.try_recv().unwrap());
        assert_eq!(first.id.sequence, 1);
        assert_eq!(first.outcome, CommandOutcome::Unknown);
        assert_eq!(second.id.sequence, 2);
        assert_eq!(second.outcome, CommandOutcome::Interrupted);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn ambiguous_edit_is_recorded_as_unavailable_without_command_content() {
        let directory = tempfile::tempdir().unwrap();
        let key = Arc::new(TelemetryKeyRing::load_or_create(directory.path().join("key")).unwrap());
        let classifier = Arc::new(CommandClassifier::new(key));
        let (sink, receiver) = ChannelTelemetrySink::channel(2);
        let run_id = TerminalRunId(Uuid::new_v4());
        let mut context = TelemetryContext::new(run_id, Arc::new(sink), Some(classifier));

        context.observe(&event(LifecycleState::Editing, None, None));
        context.observe(&event(LifecycleState::Unverified, None, None));

        let recorded = command(receiver.try_recv().unwrap());
        assert_eq!(recorded.capture_quality, CaptureQuality::Unavailable);
        assert_eq!(recorded.outcome, CommandOutcome::Unknown);
        assert_eq!(recorded.id.sequence, 1);
    }
}
