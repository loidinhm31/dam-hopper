use std::{
    collections::{HashMap, HashSet},
    io::Read as _,
    sync::{Arc, Mutex, atomic::Ordering},
    time::Duration,
};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem as _};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::{
    config::schema::RestartPolicy,
    error::AppError,
    pty::{
        event_sink::EventSink,
        session::{DeadSession, LiveSession, RespawnOpts, SessionMeta},
    },
};

const DEAD_SESSION_TTL: Duration = Duration::from_secs(60);
/// Validation regex equivalent: allow word chars, colons, dots, hyphens.
const SESSION_ID_MAX_LEN: usize = 128;
/// Maximum backoff delay for auto-restart: 30 seconds.
const MAX_RESTART_DELAY_MS: u64 = 30_000;

// ---------------------------------------------------------------------------
// Restart engine types
// ---------------------------------------------------------------------------

/// Command sent from reader_thread to the supervisor task to request a respawn.
#[derive(Debug, Clone)]
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

pub struct PtyCreateOpts {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub env: HashMap<String, String>,
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
}

struct Inner {
    live: HashMap<String, LiveSession>,
    dead: HashMap<String, DeadSession>,
    /// Track session IDs that were explicitly killed by user (kill/remove API).
    /// Reader thread checks this to prevent auto-restart after manual termination.
    killed: HashSet<String>,
}

impl Inner {
    fn new() -> Self {
        Self {
            live: HashMap::new(),
            dead: HashMap::new(),
            killed: HashSet::new(),
        }
    }
}

impl PtySessionManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        // Bounded channel prevents DoS if supervisor hangs/panics.
        // 256 slots = ~5× typical max sessions (50). If full, supervisor is dead/slow.
        let (respawn_tx, respawn_rx) = mpsc::channel(256);
        
        // Clone respawn_tx before moving it into manager.
        let respawn_tx_clone = respawn_tx.clone();
        
        let manager = Self {
            inner: Arc::new(Mutex::new(Inner::new())),
            sink: Arc::clone(&sink),
            respawn_tx,
        };

        // Spawn the supervisor task that handles respawn requests.
        let inner_clone = Arc::clone(&manager.inner);
        let sink_clone = Arc::clone(&sink);
        tokio::spawn(supervisor_loop(
            respawn_rx,
            inner_clone,
            sink_clone,
            respawn_tx_clone,
        ));

        manager
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    pub fn create(&self, opts: PtyCreateOpts) -> Result<SessionMeta, AppError> {
        validate_session_id(&opts.id)?;

        // Kill any existing session with this ID before recreating.
        self.kill_internal(&opts.id);

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::PtyError(e.to_string()))?;

        let mut cmd = build_command(&opts);
        cmd.env("TERM", "xterm-256color");
        // Log env keys only — values may contain secrets (API keys, tokens).
        debug!(id = %opts.id, env_keys = ?opts.env.keys().collect::<Vec<_>>(), "Spawning PTY");
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::PtyError(format!("spawn failed: {e}")))?;

        // portable-pty requires clone_reader before take_writer
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::PtyError(format!("clone_reader failed: {e}")))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::PtyError(format!("take_writer failed: {e}")))?;

        let respawn_opts = opts.clone_for_respawn();
        let meta = SessionMeta::new(
            opts.id.clone(),
            opts.project,
            opts.command,
            opts.cwd,
            opts.restart_policy,
        );

        let session = LiveSession::new(meta.clone(), pair.master, writer, respawn_opts);
        let buffer = session.buffer_ref();
        let shutdown = session.shutdown_ref();

        {
            let mut inner = self.inner.lock().unwrap();
            inner.dead.remove(&opts.id);
            inner.live.insert(opts.id.clone(), session);
        }

        // Spawn dedicated reader thread — portable-pty reads are blocking.
        // Must NOT use tokio::spawn_blocking: it consumes a Tokio worker thread
        // for the entire session lifetime, causing starvation under load.
        let sink = Arc::clone(&self.sink);
        let inner_ref = Arc::clone(&self.inner);
        let session_id = opts.id.clone();
        let respawn_tx = self.respawn_tx.clone();

        std::thread::Builder::new()
            .name(format!("pty-reader:{session_id}"))
            .spawn(move || {
                reader_thread(session_id, reader, buffer, shutdown, sink, inner_ref, respawn_tx);
            })
            .map_err(|e| AppError::PtyError(format!("thread spawn failed: {e}")))?;

        self.sink.send_terminal_changed();
        info!(id = %opts.id, "PTY session created");

        Ok(meta)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner.live.get(id).ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        session.write(data).map_err(|e| AppError::PtyError(e.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner.live.get(id).ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        session.resize(cols, rows).map_err(|e| AppError::PtyError(e.to_string()))
    }

    pub fn get_buffer(&self, id: &str) -> Result<String, AppError> {
        let inner = self.inner.lock().unwrap();
        let session = inner.live.get(id).ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        let buf = session.buffer.lock().unwrap();
        Ok(buf.as_str_lossy().into_owned())
    }

    pub fn kill(&self, id: &str) -> Result<(), AppError> {
        self.kill_internal(id);
        Ok(())
    }

    /// Kill + immediately evict all metadata (no 60s TTL).
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let mut inner = self.inner.lock().unwrap();
        // Mark as killed so reader thread won't restart.
        inner.killed.insert(id.to_string());
        if let Some(session) = inner.live.remove(id) {
            session.signal_shutdown();
        }
        inner.dead.remove(id);
        drop(inner);
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
        inner
            .live
            .values()
            .map(|s| SessionDetail {
                meta: s.meta.clone(),
                buffer_bytes: s.buffer.lock().unwrap().len(),
            })
            .collect()
    }

    /// Dispose all sessions — call on graceful shutdown.
    pub fn dispose(&self) {
        let mut inner = self.inner.lock().unwrap();
        info!(count = inner.live.len(), "Disposing all PTY sessions");
        for session in inner.live.values() {
            session.signal_shutdown();
        }
        inner.live.clear();
        inner.dead.clear();
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
                guard.dead.retain(|_, d| d.died_at.elapsed() < DEAD_SESSION_TTL);
                let removed = before - guard.dead.len();
                if removed > 0 {
                    debug!(removed, "Dead session tombstones swept");
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    fn kill_internal(&self, id: &str) {
        let mut inner = self.inner.lock().unwrap();
        // Mark as killed BEFORE removing from live — reader thread checks this.
        inner.killed.insert(id.to_string());
        if let Some(session) = inner.live.remove(id) {
            session.signal_shutdown();
            inner.dead.insert(id.to_string(), DeadSession::killed(session.meta));
        }
    }
}

// ---------------------------------------------------------------------------
// Reader thread
// ---------------------------------------------------------------------------

fn reader_thread(
    session_id: String,
    mut reader: Box<dyn std::io::Read + Send>,
    buffer: Arc<Mutex<crate::pty::buffer::ScrollbackBuffer>>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    sink: Arc<dyn EventSink>,
    inner: Arc<Mutex<Inner>>,
    respawn_tx: mpsc::Sender<RespawnCmd>,
) {
    let mut chunk = vec![0u8; 4096];
    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        match reader.read(&mut chunk) {
            Ok(0) => {
                // EOF — process exited
                debug!(id = %session_id, "PTY reader: EOF");
                break;
            }
            Ok(n) => {
                let data = &chunk[..n];
                {
                    let mut buf = buffer.lock().unwrap();
                    buf.push(data);
                }
                let data_str = String::from_utf8_lossy(data).into_owned();
                sink.send_terminal_data(&session_id, &data_str);
            }
            Err(e) if is_eof_error(&e) => {
                debug!(id = %session_id, "PTY reader: connection closed");
                break;
            }
            Err(e) => {
                warn!(id = %session_id, error = %e, "PTY reader: read error");
                break;
            }
        }
    }

    // Transition to dead — store exit in tombstone, notify sink.
    //
    // Check if this was a manual kill (appeared in killed set) or natural exit.
    // If eligible for restart, send RespawnCmd to supervisor and mark tombstone.
    //
    // Note: Lock released before try_send. If user calls kill() here (TOCTOU
    // window), supervisor will detect killed flag and skip respawn.
    let exit_code = infer_exit_code(&session_id, &inner);
    info!(id = %session_id, exit_code, "PTY session exited");

    let (respawn_opts, restart_count, _was_killed, should_restart, _delay_ms) = {
        let mut inner_guard = inner.lock().unwrap();
        let was_killed = inner_guard.killed.contains(&session_id);

        if let Some(session) = inner_guard.live.remove(&session_id) {
            let restart_count = session.meta.restart_count;
            let policy = session.respawn_opts.restart_policy;
            let max_retries = session.respawn_opts.restart_max_retries;
            let respawn_opts = session.respawn_opts.clone();

            // Decide if we should restart.
            let restart_decision = decide_restart(policy, exit_code, was_killed, restart_count, max_retries);

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

            (
                respawn_opts,
                next_restart_count,
                was_killed,
                restart_decision,
                restart_in_ms.unwrap_or(0),
            )
        } else {
            // Session already removed (concurrent kill) — no restart.
            (RespawnOpts {
                id: session_id.clone(),
                command: String::new(),
                cwd: String::new(),
                env: HashMap::new(),
                cols: 80,
                rows: 24,
                project: None,
                restart_policy: RestartPolicy::Never,
                restart_max_retries: 0,
            }, 0, true, None, 0)
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

    sink.send_terminal_exit(&session_id, Some(exit_code));
    sink.send_terminal_changed();
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
) {
    while let Some(cmd) = respawn_rx.recv().await {
        let session_id = cmd.id.clone();

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

        if let Err(e) = respawn_internal(
            &session_id,
            cmd,
            &inner,
            &sink,
            &respawn_tx,
        ).await {
            warn!(id = %session_id, error = %e, "Respawn failed");
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

    let mut build_cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("cmd.exe")
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
    build_cmd.env("TERM", "xterm-256color");
    for (k, v) in &opts.env {
        build_cmd.env(k, v);
    }

    let _child = pair
        .slave
        .spawn_command(build_cmd)
        .map_err(|e| AppError::PtyError(format!("spawn failed: {e}")))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::PtyError(format!("clone_reader failed: {e}")))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::PtyError(format!("take_writer failed: {e}")))?;

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

    let session = LiveSession::new(meta.clone(), pair.master, writer, opts.clone());
    let buffer = session.buffer_ref();
    let shutdown = session.shutdown_ref();

    // Insert into live map — if session ID already exists (user called create
    // concurrently), this will replace it (same behavior as create()).
    {
        let mut inner_guard = inner.lock().unwrap();
        // Remove from killed set (allow future restarts if user doesn't kill again).
        inner_guard.killed.remove(session_id);
        inner_guard.dead.remove(session_id);
        inner_guard.live.insert(session_id.to_string(), session);
    }

    // Spawn reader thread for the restarted session.
    let inner_clone = Arc::clone(inner);
    let sink_clone = Arc::clone(sink);
    let id_clone = session_id.to_string();
    let respawn_tx_clone = respawn_tx.clone();

    std::thread::Builder::new()
        .name(format!("pty-reader:{id_clone}"))
        .spawn(move || {
            reader_thread(
                id_clone,
                reader,
                buffer,
                shutdown,
                sink_clone,
                inner_clone,
                respawn_tx_clone,
            );
        })
        .map_err(|e| AppError::PtyError(format!("thread spawn failed: {e}")))?;

    info!(id = %session_id, restart_count = meta.restart_count, "Session restarted");
    Ok(())
}
fn infer_exit_code(id: &str, inner: &Arc<Mutex<Inner>>) -> i32 {
    // LIMITATION: portable-pty doesn't expose child exit status (no waitpid() API).
    // We infer 0 (clean) vs -1 (killed) based on whether session was removed
    // by kill() before reader_thread observed EOF.
    //
    // This means we CANNOT distinguish between `exit 0` and `exit 1` in natural
    // exits. Current behavior:
    //   - EOF + session still in live map → assume exit 0
    //   - EOF + session already removed → manual kill, exit -1
    //
    // **Impact on restart policies:**
    //   - `OnFailure`: Cannot detect failures — treated same as `Always`
    //   - `Always`: Correct behavior
    //   - `Never`: Correct behavior (no restart regardless)
    //
    // **Workaround:** For real exit codes, wrap child in std::process::Command
    // and call wait() manually (requires architecture change).
    let guard = inner.lock().unwrap();
    if guard.live.contains_key(id) {
        // Still live — infer clean exit (EOF from process)
        0
    } else {
        // Already removed by kill() — treat as killed
        -1
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

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

fn build_command(opts: &PtyCreateOpts) -> CommandBuilder {
    let is_interactive = opts.command.is_empty();

    let (exe, args) = if cfg!(target_os = "windows") {
        ("cmd.exe".to_string(), vec![])
    } else if is_interactive {
        let shell = opts
            .env
            .get("SHELL")
            .filter(|s| s.starts_with('/'))
            .cloned()
            .unwrap_or_else(|| "/bin/bash".to_string());
        (shell, vec![])
    } else {
        ("/bin/sh".to_string(), vec!["-c".to_string(), opts.command.clone()])
    };

    let mut cmd = CommandBuilder::new(&exe);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.cwd(&opts.cwd);
    cmd
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
    if !id.chars().all(|c| c.is_alphanumeric() || matches!(c, ':' | '.' | '-' | '_')) {
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
