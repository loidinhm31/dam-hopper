use std::{
    collections::HashMap,
    io::Write as _,
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}},
    time::Instant,
};

use portable_pty::{MasterPty, PtySize};
use serde::{Deserialize, Serialize};

use crate::config::schema::RestartPolicy;
use crate::pty::buffer::ScrollbackBuffer;

pub const SCROLLBACK_CAPACITY: usize = 256 * 1024;

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionType {
    Build,
    Run,
    Custom,
    Shell,
    Terminal,
    Free,
    Unknown,
}

impl SessionType {
    pub fn from_id(id: &str) -> Self {
        if id.starts_with("build:") { return Self::Build; }
        if id.starts_with("run:") { return Self::Run; }
        if id.starts_with("custom:") { return Self::Custom; }
        if id.starts_with("shell:") { return Self::Shell; }
        if id.starts_with("terminal:") { return Self::Terminal; }
        if id.starts_with("free:") { return Self::Free; }
        Self::Unknown
    }
}

// ---------------------------------------------------------------------------
// Respawn template (subset of PtyCreateOpts; Clone-safe, no raw FDs)
// ---------------------------------------------------------------------------

/// Cloneable snapshot of the opts needed to re-launch a session after exit.
/// Stored in `LiveSession`; consumed by the restart engine in Phase 4.
#[derive(Debug, Clone)]
pub struct RespawnOpts {
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

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub project: Option<String>,
    pub command: String,
    pub cwd: String,
    #[serde(rename = "type")]
    pub session_type: SessionType,
    pub alive: bool,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    /// Incremented by the restart engine on each respawn (Phase 4).
    pub restart_count: u32,
    /// Set by the restart engine when the process exits (Phase 4).
    pub last_exit_at: Option<u64>,
    pub restart_policy: RestartPolicy,
}

impl SessionMeta {
    pub fn new(
        id: String,
        project: Option<String>,
        command: String,
        cwd: String,
        restart_policy: RestartPolicy,
    ) -> Self {
        Self {
            session_type: SessionType::from_id(&id),
            id,
            project,
            command,
            cwd,
            alive: true,
            exit_code: None,
            started_at: now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy,
        }
    }
}

// ---------------------------------------------------------------------------
// Live session
// ---------------------------------------------------------------------------

/// Owns the master PTY handle and writer for a running process.
///
/// Reader thread is spawned externally (in PtySessionManager) and writes into
/// `buffer`. `shutdown` signals the reader thread to stop.
pub struct LiveSession {
    pub meta: SessionMeta,
    pub buffer: Arc<Mutex<ScrollbackBuffer>>,

    /// Kept for `resize_pty` — clone_reader already extracted by the time we store this.
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,

    /// Write end of the PTY (stdin of child process).
    writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,

    /// Set to `true` to signal the reader thread to exit cleanly.
    pub shutdown: Arc<AtomicBool>,

    /// Snapshot of creation opts used to re-launch this session on restart (Phase 4).
    pub respawn_opts: RespawnOpts,
}

impl LiveSession {
    pub fn new(
        meta: SessionMeta,
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn std::io::Write + Send>,
        respawn_opts: RespawnOpts,
    ) -> Self {
        Self {
            buffer: Arc::new(Mutex::new(ScrollbackBuffer::new(SCROLLBACK_CAPACITY))),
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            shutdown: Arc::new(AtomicBool::new(false)),
            meta,
            respawn_opts,
        }
    }

    pub fn write(&self, data: &[u8]) -> std::io::Result<()> {
        self.writer.lock().unwrap().write_all(data)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> anyhow::Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| anyhow::anyhow!("PTY resize failed: {e}"))
    }

    pub fn signal_shutdown(&self) {
        // Relaxed is sufficient — reader thread polls this flag independently,
        // no other memory ordering guarantee is needed.
        self.shutdown.store(true, Ordering::Relaxed);
    }

    /// Shared buffer reference — reader thread writes here.
    pub fn buffer_ref(&self) -> Arc<Mutex<ScrollbackBuffer>> {
        Arc::clone(&self.buffer)
    }

    /// Shutdown flag reference — reader thread polls this.
    pub fn shutdown_ref(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.shutdown)
    }
}

// ---------------------------------------------------------------------------
// Dead-session tombstone (retained for 60s TTL)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct DeadSession {
    pub meta: SessionMeta,
    pub died_at: Instant,
    /// Set by the restart engine (Phase 4) before re-spawning.
    pub will_restart: bool,
    /// Milliseconds until the next restart attempt; `None` if not restarting.
    pub restart_in_ms: Option<u64>,
}

impl DeadSession {
    /// Construct a tombstone for a forcibly-killed session (exit_code = -1).
    /// Centralises the `will_restart`/`restart_in_ms` defaults so all kill
    /// paths stay consistent.
    pub(crate) fn killed(mut meta: SessionMeta) -> Self {
        meta.alive = false;
        meta.exit_code = Some(-1);
        meta.last_exit_at = Some(now_ms());
        Self {
            meta,
            died_at: Instant::now(),
            will_restart: false,
            restart_in_ms: None,
        }
    }

    /// Construct a tombstone for a process that exited naturally.
    pub(crate) fn exited(mut meta: SessionMeta, exit_code: i32) -> Self {
        meta.alive = false;
        meta.exit_code = Some(exit_code);
        meta.last_exit_at = Some(now_ms());
        Self {
            meta,
            died_at: Instant::now(),
            will_restart: false,
            restart_in_ms: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Current time as Unix milliseconds.
/// `pub(crate)` so manager.rs can import this rather than duplicate it.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
