# Phase 01 — Backend Core & Driver Trait

## Context Links

- Parent plan: `plans/20260422-tunnel-exposer/plan.md`
- Dependencies: none (first phase)
- Research: `research/researcher-01-cloudflared-subprocess.md`
- Pattern refs: `server/src/pty/mod.rs`, `manager.rs`, `session.rs`, `event_sink.rs`
- State pattern: `server/src/state.rs`

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-22 |
| Description | Rust `tunnel/` module — TunnelDriver trait, CloudflaredDriver, TunnelSessionManager, cloudflared installer. Testable without API layer. |
| Priority | P2 |
| Status | completed |
| Effort | ~10h |

## Key Insights

- Mirror `server/src/pty/` structure exactly: `mod.rs`, `driver.rs`, `manager.rs`, `session.rs`, `installer.rs`, `error.rs`.
- `TunnelSessionManager` uses `Arc<RwLock<HashMap<Uuid, TunnelSession>>>` — same cheap-clone pattern as `PtySessionManager`'s `Arc<Mutex<Inner>>`.
- Events fan-out via existing `BroadcastEventSink.broadcast()` — zero new broadcast infrastructure.
- Child process: `tokio::process::Command` (not `portable-pty`). `kill_on_drop(true)` is safety net; graceful stop sends SIGTERM → 2s wait → SIGKILL.
- URL parse task runs as `tokio::spawn` reading stderr lines; 30s timeout → `Failed`.
- Installer writes to `~/.dam-hopper/bin/cloudflared`; resolve order: `$PATH` → that path → `TunnelError::BinaryMissing`.

## Requirements

1. `TunnelDriver` trait with `start(port, label) -> Result<DriverHandle>`.
2. `CloudflaredDriver` impl — spawns child, parses URL from stderr, returns `DriverHandle` with `stop()`.
3. `TunnelSession` — holds id, port, label, driver name, status, url, pid, started_at.
4. `TunnelSessionManager` — create, stop, list, dispose_all. Thread-safe clone.
5. `TunnelInstaller` — resolve binary, download to `~/.dam-hopper/bin/`, atomic rename, chmod 0o755.
6. WS events emitted via `EventSink::broadcast`: `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`.
7. All public types unit-testable without network.

## Architecture

### Module Layout

```
server/src/tunnel/
├── mod.rs          — pub re-exports + TunnelDriver trait
├── driver.rs       — TunnelDriver trait + DriverHandle
├── cloudflared.rs  — CloudflaredDriver impl
├── manager.rs      — TunnelSessionManager
├── session.rs      — TunnelSession + TunnelStatus
├── installer.rs    — TunnelInstaller (binary resolve + download)
└── error.rs        — TunnelError (thiserror)
```

### Core Types (signatures only — not implementation)

```rust
// driver.rs
pub struct DriverHandle {
    pub pid: Option<u32>,
    pub stop_tx: tokio::sync::oneshot::Sender<()>,
}

#[async_trait]
pub trait TunnelDriver: Send + Sync {
    fn name(&self) -> &'static str;
    async fn start(
        &self,
        port: u16,
        label: &str,
        event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
    ) -> Result<DriverHandle, TunnelError>;
}

pub enum TunnelDriverEvent {
    UrlReady(String),
    Failed(String),
    Exited,
}
```

```rust
// session.rs
#[derive(Clone, Serialize)]
pub struct TunnelSession {
    pub id: Uuid,
    pub port: u16,
    pub label: String,
    pub driver: String,
    pub status: TunnelStatus,
    pub url: Option<String>,
    pub error: Option<String>,
    pub started_at: i64,   // unix ms
    pub pid: Option<u32>,
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus { Starting, Ready, Failed, Stopped }
```

```rust
// manager.rs
#[derive(Clone)]
pub struct TunnelSessionManager {
    sessions: Arc<RwLock<HashMap<Uuid, TunnelSession>>>,
    sink: Arc<dyn EventSink>,
    driver: Arc<dyn TunnelDriver>,
}

impl TunnelSessionManager {
    pub async fn create(&self, port: u16, label: String) -> Result<TunnelSession, TunnelError>;
    pub async fn stop(&self, id: Uuid) -> Result<(), TunnelError>;
    pub fn list(&self) -> Vec<TunnelSession>;
    pub async fn dispose_all(&self);  // call on server shutdown
}
```

```rust
// installer.rs
pub struct TunnelInstaller;
impl TunnelInstaller {
    /// Returns path to usable binary or TunnelError::BinaryMissing.
    pub async fn resolve() -> Result<PathBuf, TunnelError>;
    /// Download to ~/.dam-hopper/bin/cloudflared atomically.
    pub async fn install(on_progress: impl Fn(u64, u64) + Send) -> Result<PathBuf, TunnelError>;
}
```

```rust
// error.rs
#[derive(Error, Debug)]
pub enum TunnelError {
    #[error("cloudflared binary not found")]
    BinaryMissing,
    #[error("tunnel not found: {0}")]
    NotFound(Uuid),
    #[error("spawn failed: {0}")]
    SpawnFailed(String),
    #[error("install failed: {0}")]
    InstallFailed(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
```

### Event Fan-out

Use existing `EventSink::broadcast(event_type, payload)` from `server/src/pty/event_sink.rs`:

```rust
sink.broadcast("tunnel:created", serde_json::to_value(&session).unwrap());
sink.broadcast("tunnel:ready",   json!({ "id": id, "url": url }));
sink.broadcast("tunnel:failed",  json!({ "id": id, "error": msg }));
sink.broadcast("tunnel:stopped", json!({ "id": id }));
```

### Shutdown Sequence in `dispose_all()`

```
for each session:
  SIGTERM (nix::sys::signal::kill, unix only)
  tokio::time::timeout(2s, child.wait())
  child.kill()       // SIGKILL
  child.wait()       // reap zombie
```

### URL Parse Task (per tunnel)

```
tokio::spawn:
  BufReader::lines(child.stderr)
  for each line:
    if CF_URL regex matches → send UrlReady → break
  tokio::time::timeout(30s) wraps entire loop → send Failed on expiry
```

## Related Code Files

**Create:**
- `server/src/tunnel/mod.rs`
- `server/src/tunnel/driver.rs`
- `server/src/tunnel/cloudflared.rs`
- `server/src/tunnel/manager.rs`
- `server/src/tunnel/session.rs`
- `server/src/tunnel/installer.rs`
- `server/src/tunnel/error.rs`

**Modify:**
- `server/src/lib.rs` — add `pub mod tunnel;`
- `server/Cargo.toml` — add `once_cell`, `regex`, `nix` (unix) if not present; verify `tokio` features include `process`

## Implementation Steps

1. Add `pub mod tunnel;` to `server/src/lib.rs`.
2. Create `error.rs` — `TunnelError` with variants above. Add `AppError::Tunnel(TunnelError)` to `server/src/error.rs`.
3. Create `session.rs` — `TunnelSession` + `TunnelStatus` structs with `serde::Serialize`, `Clone`.
4. Create `driver.rs` — `TunnelDriverEvent` enum, `DriverHandle` struct, `TunnelDriver` trait (`async_trait`).
5. Create `installer.rs`:
   a. `resolve()` — check `which cloudflared` in PATH, then `~/.dam-hopper/bin/cloudflared`, else `BinaryMissing`.
   b. `install()` — build asset filename from `std::env::consts::{OS, ARCH}`, download via `reqwest`, stream to `<path>.download`, `rename` to final path, `set_permissions(0o755)`.
6. Create `cloudflared.rs` — `CloudflaredDriver`:
   a. `start()`: call `installer::resolve()`, spawn `tokio::process::Command` with `stdout(null)`, `stderr(piped)`, `kill_on_drop(true)`.
   b. Spawn stderr-reader task: `BufReader::lines`, regex match `https://[a-z0-9-]+\.trycloudflare\.com`, send `UrlReady` via `event_tx`.
   c. Wrap entire stderr read in `tokio::time::timeout(30s)`; on timeout send `TunnelDriverEvent::Failed`.
   d. `stop_tx` oneshot channel: receiver in background task calls graceful shutdown sequence.
7. Create `manager.rs` — `TunnelSessionManager`:
   a. `new(sink, driver)` — wrap in `Arc<RwLock<HashMap>>`.
   b. `create()`: gen UUID, insert `TunnelSession{status:Starting}`, call `driver.start()`, spawn watcher task that processes `TunnelDriverEvent` and mutates session + broadcasts events via `sink`.
   c. `stop()`: look up session, call `DriverHandle::stop_tx.send(())`, broadcast `tunnel:stopped`.
   d. `dispose_all()`: iterate sessions, stop each, clear map.
8. Create `mod.rs` — re-export public types.
9. Write unit tests (no network):
   - `TunnelStatus` serializes to lowercase strings.
   - `installer::resolve()` returns `BinaryMissing` when PATH and `~/.dam-hopper/bin/` both absent.
   - `TunnelError` display messages.
   - `TunnelSessionManager::list()` returns empty on new manager.
10. Run `cargo test tunnel` — all pass, zero warnings.

## Todo List

- [x] Add `pub mod tunnel;` to `lib.rs`
- [x] Add `AppError::Tunnel` variant to `error.rs`
- [x] Create `error.rs` — TunnelError
- [x] Create `session.rs` — TunnelSession, TunnelStatus
- [x] Create `driver.rs` — trait + DriverHandle
- [x] Create `installer.rs` — resolve + download
- [x] Create `cloudflared.rs` — CloudflaredDriver with stderr parser
- [x] Create `manager.rs` — TunnelSessionManager
- [x] Create `mod.rs` — re-exports
- [x] Add Cargo.toml deps: `reqwest` (rustls-tls+stream), `nix` (unix target), `tokio/process` verified
- [x] Write unit tests (5 cases)
- [x] `cargo test tunnel` green (5/5 pass)
- [x] Code review completed — minor issues filed below

## Success Criteria

- `cargo test` passes with tunnel tests included
- `TunnelSessionManager::create()` compiles without WS/API layers wired
- `CloudflaredDriver::start()` panics-safe: no unwrap in production paths
- `dispose_all()` called after create; no zombie processes remain (manual smoke test)
- `TunnelInstaller::resolve()` returns `BinaryMissing` when neither PATH nor `~/.dam-hopper/bin/` has the binary

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `nix` crate SIGTERM not available on Windows | Build failure | `#[cfg(unix)]` gate; `child.kill()` only on Windows |
| Regex compile fails at runtime | Panic | `Lazy<Regex>` with `unwrap()` at init — fails fast at startup, not per-request |
| `reqwest` not in Cargo.toml | Compile error | Check existing deps; `reqwest` with `rustls-tls` feature |
| Stderr reader dropped while child alive → SIGPIPE | Child dies prematurely | Keep reader task alive for session lifetime via join handle stored in DriverHandle |

## Security Considerations

- Always pass `http://127.0.0.1:{port}` (not `localhost`) to cloudflared — avoids DNS rebinding surprises.
- Binary download via HTTPS only; no redirect to HTTP accepted.
- Write downloaded binary to tempfile first, rename atomically — prevents partial binary execution.
- Permissions `0o755` (not `0o777`).

## Next Steps

After Phase 01 merges: Phase 02 wires `TunnelSessionManager` into `AppState` and exposes REST + WS surface.

## Unresolved Questions

- `reqwest` version + TLS feature already in `Cargo.toml`? Verify before step 5.
- macOS: extracted `.tgz` binary may need `xattr -d com.apple.quarantine` — decide if installer should run this automatically.
