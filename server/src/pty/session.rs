use std::{
    collections::HashMap,
    io::Write as _,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

#[cfg(unix)]
use nix::{
    sys::signal::{killpg, Signal},
    unistd::Pid,
};
use portable_pty::{ChildKiller, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::config::schema::RestartPolicy;
use crate::pty::buffer::ScrollbackBuffer;
use crate::pty::shell_integration::ShellIntegration;
use crate::pty::shell_lifecycle::ShellLifecycle;

pub const SCROLLBACK_CAPACITY: usize = 1024 * 1024;

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
        if id.starts_with("build:") {
            return Self::Build;
        }
        if id.starts_with("run:") {
            return Self::Run;
        }
        if id.starts_with("custom:") {
            return Self::Custom;
        }
        if id.starts_with("shell:") {
            return Self::Shell;
        }
        if id.starts_with("terminal:") {
            return Self::Terminal;
        }
        if id.starts_with("free:") {
            return Self::Free;
        }
        Self::Unknown
    }
}

// ---------------------------------------------------------------------------
// Respawn template (subset of PtyCreateOpts; Clone-safe, no raw FDs)
// ---------------------------------------------------------------------------

/// Cloneable snapshot of the opts needed to re-launch a session after exit.
/// Stored in `LiveSession`; consumed by the restart engine in Phase 4.
#[derive(Clone)]
pub struct RespawnOpts {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    pub project: Option<String>,
    /// Server-validated canonical worktree path for this session.
    pub worktree_path: Option<String>,
    pub restart_policy: RestartPolicy,
    pub restart_max_retries: u32,
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    /// Opaque identity for this concrete PTY incarnation. Public session IDs
    /// can be reused, so clients must not apply events from an older value.
    #[serde(default)]
    pub incarnation: u64,
    pub project: Option<String>,
    pub command: String,
    pub cwd: String,
    /// Immutable server-validated target ownership, if this is a worktree
    /// session. This survives shell `cd` changes and reconnects.
    #[serde(
        rename = "worktreePath",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub worktree_path: Option<String>,
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
    /// The process stopped because its registered worktree target disappeared.
    /// The metadata remains visible for buffer replay, close, or retry with the
    /// same session ID once the target is available again.
    #[serde(
        rename = "targetUnavailable",
        default,
        skip_serializing_if = "is_false"
    )]
    pub target_unavailable: bool,
}

impl SessionMeta {
    pub fn new(
        id: String,
        project: Option<String>,
        command: String,
        cwd: String,
        restart_policy: RestartPolicy,
    ) -> Self {
        Self::new_with_target(id, project, command, cwd, None, restart_policy)
    }

    pub fn new_with_target(
        id: String,
        project: Option<String>,
        command: String,
        cwd: String,
        worktree_path: Option<String>,
        restart_policy: RestartPolicy,
    ) -> Self {
        Self {
            session_type: SessionType::from_id(&id),
            id,
            incarnation: 0,
            project,
            command,
            cwd,
            worktree_path,
            alive: true,
            exit_code: None,
            started_at: now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy,
            target_unavailable: false,
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
    /// Monotonic identity for this concrete PTY incarnation. Public session
    /// IDs can be reused, so persistence and reader cleanup must also carry
    /// this discriminator.
    pub incarnation: u64,
    pub buffer: Arc<Mutex<ScrollbackBuffer>>,

    /// Kept for `resize_pty` — clone_reader already extracted by the time we store this.
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,

    /// Write end of the PTY (stdin of child process).
    writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,

    /// Dedicated killer handle for terminating the PTY child while the reader
    /// thread is blocked in `wait()`.
    child_killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,

    /// Set to `true` to signal the reader thread to exit cleanly.
    pub shutdown: Arc<AtomicBool>,

    /// Snapshot of creation opts used to re-launch this session on restart (Phase 4).
    pub respawn_opts: RespawnOpts,
    /// Ephemeral and intentionally excluded from serializable session metadata.
    pub lifecycle: Option<Arc<Mutex<ShellLifecycle>>>,
    /// True only after the reader publishes Editing behind visible prompt bytes.
    pub published_editing: Arc<AtomicBool>,
    /// Keeps the temporary adapter files alive for the child process lifetime.
    pub shell_integration: Option<ShellIntegration>,
}

impl LiveSession {
    pub fn new(
        meta: SessionMeta,
        incarnation: u64,
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn std::io::Write + Send>,
        child_killer: Box<dyn ChildKiller + Send + Sync>,
        respawn_opts: RespawnOpts,
        lifecycle: Option<Arc<Mutex<ShellLifecycle>>>,
        shell_integration: Option<ShellIntegration>,
    ) -> Self {
        Self {
            buffer: Arc::new(Mutex::new(ScrollbackBuffer::new(SCROLLBACK_CAPACITY))),
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            child_killer: Arc::new(Mutex::new(child_killer)),
            shutdown: Arc::new(AtomicBool::new(false)),
            meta,
            incarnation,
            respawn_opts,
            lifecycle,
            published_editing: Arc::new(AtomicBool::new(false)),
            shell_integration,
        }
    }

    pub fn write(&self, data: &[u8]) -> std::io::Result<()> {
        self.writer.lock().unwrap().write_all(data)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> anyhow::Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow::anyhow!("PTY resize failed: {e}"))
    }

    pub fn signal_shutdown(&self) {
        // Relaxed is sufficient — reader thread polls this flag independently,
        // no other memory ordering guarantee is needed.
        self.shutdown.store(true, Ordering::Relaxed);
    }

    /// Best-effort forced termination for explicit user/session manager kills.
    /// On Unix we target the full PTY process group first so backgrounded
    /// children do not survive after the terminal is closed.
    pub fn terminate(&self) {
        self.signal_shutdown();

        #[cfg(unix)]
        {
            let pgid = self.master.lock().unwrap().process_group_leader();
            if let Some(pgid) = pgid {
                if let Err(error) = killpg(Pid::from_raw(pgid), Signal::SIGKILL) {
                    warn!(
                        session_id = %self.meta.id,
                        pgid,
                        %error,
                        "Failed to kill PTY process group"
                    );
                } else {
                    return;
                }
            }
        }

        if let Err(error) = self.child_killer.lock().unwrap().kill() {
            warn!(
                session_id = %self.meta.id,
                %error,
                "Failed to kill PTY child process"
            );
        }
    }

    /// Shared buffer reference — reader thread writes here.
    pub fn buffer_ref(&self) -> Arc<Mutex<ScrollbackBuffer>> {
        Arc::clone(&self.buffer)
    }

    /// Shutdown flag reference — reader thread polls this.
    pub fn shutdown_ref(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.shutdown)
    }

    pub fn published_editing_ref(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.published_editing)
    }
}

// ---------------------------------------------------------------------------
// Dead-session tombstone (retained for 60s TTL)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct DeadSession {
    pub meta: SessionMeta,
    /// Incarnation that produced this tombstone.
    pub incarnation: u64,
    /// Retain the final in-memory buffer while the tombstone is live. This
    /// makes attach/retry observe output before an asynchronous persistence
    /// worker has applied its final snapshot.
    pub buffer: Option<Arc<Mutex<ScrollbackBuffer>>>,
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
    pub(crate) fn killed(
        mut meta: SessionMeta,
        incarnation: u64,
        buffer: Option<Arc<Mutex<ScrollbackBuffer>>>,
    ) -> Self {
        meta.alive = false;
        meta.exit_code = Some(-1);
        meta.last_exit_at = Some(now_ms());
        Self {
            meta,
            incarnation,
            buffer,
            died_at: Instant::now(),
            will_restart: false,
            restart_in_ms: None,
        }
    }

    /// Construct a tombstone for a process that exited naturally.
    pub(crate) fn exited(
        mut meta: SessionMeta,
        exit_code: i32,
        incarnation: u64,
        buffer: Option<Arc<Mutex<ScrollbackBuffer>>>,
    ) -> Self {
        meta.alive = false;
        meta.exit_code = Some(exit_code);
        meta.last_exit_at = Some(now_ms());
        Self {
            meta,
            incarnation,
            buffer,
            died_at: Instant::now(),
            will_restart: false,
            restart_in_ms: None,
        }
    }

    /// Construct a non-restarting tombstone for a session whose target is gone.
    pub(crate) fn target_unavailable(mut meta: SessionMeta, incarnation: u64) -> Self {
        meta.alive = false;
        meta.target_unavailable = true;
        meta.last_exit_at.get_or_insert_with(now_ms);
        Self {
            meta,
            incarnation,
            buffer: None,
            died_at: Instant::now(),
            will_restart: false,
            restart_in_ms: None,
        }
    }
}

fn is_false(value: &bool) -> bool {
    !*value
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
