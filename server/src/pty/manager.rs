use std::{
    collections::HashMap,
    io::Read as _,
    sync::{Arc, Mutex, atomic::Ordering},
    time::{Duration, Instant},
};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem as _};
use tracing::{debug, info, warn};

use crate::{
    error::AppError,
    pty::{
        event_sink::EventSink,
        session::{DeadSession, LiveSession, SessionMeta},
    },
};

const DEAD_SESSION_TTL: Duration = Duration::from_secs(60);
/// Validation regex equivalent: allow word chars, colons, dots, hyphens.
const SESSION_ID_MAX_LEN: usize = 128;

pub struct PtyCreateOpts {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    pub project: Option<String>,
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
}

struct Inner {
    live: HashMap<String, LiveSession>,
    dead: HashMap<String, DeadSession>,
}

impl Inner {
    fn new() -> Self {
        Self {
            live: HashMap::new(),
            dead: HashMap::new(),
        }
    }
}

impl PtySessionManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::new())),
            sink,
        }
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

        let meta = SessionMeta::new(
            opts.id.clone(),
            opts.project,
            opts.command,
            opts.cwd,
        );

        let session = LiveSession::new(meta.clone(), pair.master, writer);
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

        std::thread::Builder::new()
            .name(format!("pty-reader:{session_id}"))
            .spawn(move || {
                reader_thread(session_id, reader, buffer, shutdown, sink, inner_ref);
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
        if let Some(session) = inner.live.remove(id) {
            session.signal_shutdown();
            let dead = DeadSession {
                meta: {
                    let mut m = session.meta;
                    m.alive = false;
                    m.exit_code = None;
                    m
                },
                died_at: Instant::now(),
            };
            inner.dead.insert(id.to_string(), dead);
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
    // Known race: harvest_exit_code checks the live map without holding the
    // lock across both the check and the dead-insert below. If kill() is called
    // between EOF detection and here, the tombstone exit_code will be -1 (killed)
    // rather than 0 (clean). Acceptable approximation — portable-pty doesn't
    // expose child exit status through the master handle.
    let exit_code = harvest_exit_code(&session_id, &inner);
    info!(id = %session_id, exit_code, "PTY session exited");

    {
        let mut inner = inner.lock().unwrap();
        if let Some(session) = inner.live.remove(&session_id) {
            let dead = DeadSession {
                meta: {
                    let mut m = session.meta;
                    m.alive = false;
                    m.exit_code = Some(exit_code);
                    m
                },
                died_at: Instant::now(),
            };
            inner.dead.insert(session_id.clone(), dead);
        }
    }

    sink.send_terminal_exit(&session_id, Some(exit_code));
    sink.send_terminal_changed();
}

fn harvest_exit_code(id: &str, inner: &Arc<Mutex<Inner>>) -> i32 {
    // If the session is still in live map (kill() wasn't called), try to get
    // the exit code. portable-pty child status isn't accessible through
    // the master handle, so we default to 0 for clean EOF.
    let guard = inner.lock().unwrap();
    if guard.live.contains_key(id) {
        // Still live — clean exit (EOF from process)
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
