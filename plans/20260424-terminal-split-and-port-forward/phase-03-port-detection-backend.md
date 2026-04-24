# Phase 03 — Port Detection Backend (PortForwardManager + WS Events)

## Context Links

- Parent plan: `plans/20260424-terminal-split-and-port-forward/plan.md`
- Scout: `scout/scout-01-codebase-touchpoints.md` §F-15
- Research: `research/researcher-02-proxy-portdetect.md` §1, §7
- Pattern refs: `server/src/tunnel/manager.rs`, `server/src/state.rs`, `server/src/api/ws_protocol.rs`
- Tap point: `server/src/pty/manager.rs:501-523`

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Description | Rust `port_forward/` module — hybrid port detection (PTY stdout regex + `/proc/net/tcp` polling), `PortForwardManager`, WS push events, `GET /api/ports` REST endpoint. Linux-only MVP. |
| Priority | P2 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~8h |

## Key Insights

- Hybrid detection: PTY stdout regex → immediate provisional hit; `/proc/net/tcp` poll every 2s → authoritative confirmation + loss detection (researcher-02 §1).
- Tap point is `server/src/pty/manager.rs:501-523`: `reader_thread()` calls `sink.send_terminal_data(...)` for every 4KB chunk. Insert regex scan **after** `buf.push(data)` (line 501), **before** `sink.send_terminal_data` (line 523). `session_id` is in scope (scout §PTY output tap points).
- `procfs` crate wraps `/proc/net/tcp` cleanly — `TcpState::Listen` enum, `TcpEntry::local_address`, inode-to-PID join (researcher-02 §1). Gate entire module with `#[cfg(target_os = "linux")]`.
- Follow `TunnelSessionManager` pattern: `Arc<RwLock<HashMap>>` for sessions, broadcast via existing `BroadcastEventSink` (scout §AppState + WS protocol).
- New `ServerMsg` variants use existing `#[serde(tag = "kind")]` enum in `server/src/api/ws_protocol.rs:~175-205` (scout §AppState + WS protocol).

## Requirements

### Functional
1. `PortForwardManager` in `server/src/port_forward/manager.rs` — tracks `DetectedPort` entries in memory.
2. PTY stdout scanner: ANSI-strip, apply regex bank, emit provisional `PortDiscovered` on first match.
3. `/proc/net/tcp` poller: runs every 2s; for each PTY session's PID, checks LISTEN ports; confirms provisional hits; emits `PortLost` on disappearance.
4. `GET /api/ports` returns all currently detected ports with `proxy_url`, `session_id`, `project`, `detected_via`, `state`.
5. WS events: `port:discovered` on new port, `port:lost` on port disappearance.
6. Linux-only: `cfg(target_os = "linux")` gate on proc scanner; emit `warn!` on other OS, `GET /api/ports` returns empty list.

### Non-Functional
- Regex bank compiled once (`once_cell::sync::Lazy<Vec<Regex>>`).
- ANSI escape stripping before regex (strip `\x1b\[[0-9;]*m` and OSC sequences).
- Port range guard: ignore ports < 1024 and ports in danger list `{22, 25, 110, 143, 3306, 5432, 6379, 27017}`.
- No subprocess calls (`ss`/`netstat`) — `/proc` only.
- `PortForwardManager` must be `Clone` (wraps `Arc`).

## Architecture

### Module Layout

```
server/src/port_forward/
├── mod.rs         — pub re-exports
├── manager.rs     — PortForwardManager (Arc<RwLock<HashMap<u16, DetectedPort>>>)
├── detector.rs    — stdout regex scanner + /proc/net/tcp poller
├── session.rs     — DetectedPort struct + PortState enum
└── error.rs       — PortForwardError (thiserror)
```

### Core Types

```rust
// session.rs
#[derive(Clone, Serialize)]
pub struct DetectedPort {
    pub port: u16,
    pub session_id: Uuid,
    pub project: Option<String>,
    pub detected_via: DetectedVia,   // "stdout_regex" | "proc_net"
    pub state: PortState,
    pub proxy_url: String,           // "/proxy/{port}/"
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectedVia { StdoutRegex, ProcNet }

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PortState { Provisional, Listening, Lost }
```

```rust
// manager.rs
#[derive(Clone)]
pub struct PortForwardManager {
    ports: Arc<RwLock<HashMap<u16, DetectedPort>>>,
    sink: Arc<dyn EventSink>,
}

impl PortForwardManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self;
    pub fn report_stdout_hit(&self, port: u16, session_id: Uuid, project: Option<String>);
    pub fn confirm_listen(&self, port: u16);
    pub fn report_lost(&self, port: u16);
    pub fn list(&self) -> Vec<DetectedPort>;
}
```

### WS Protocol Additions (`server/src/api/ws_protocol.rs`)

```rust
// Add to ServerMsg enum:
PortDiscovered {
    session_id: Uuid,
    port: u16,
    project: Option<String>,
    detected_via: String,
    proxy_url: String,
},
PortLost {
    port: u16,
    session_id: Uuid,
},
```

Serialized as `{ "kind": "port:discovered", ... }` and `{ "kind": "port:lost", ... }`.

### Regex Bank (ANSI-stripped stdout)

```rust
static PORT_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| vec![
    Regex::new(r"(?i)listening on.*:(\d{4,5})").unwrap(),
    Regex::new(r"localhost:(\d{4,5})").unwrap(),
    Regex::new(r"http://(?:localhost|127\.0\.0\.1):(\d{4,5})").unwrap(),
    Regex::new(r"Local:\s+http://localhost:(\d{4,5})").unwrap(),  // Vite
    Regex::new(r"server listening on.*:(\d{4,5})").unwrap(),
    Regex::new(r"bound to.*:(\d{4,5})").unwrap(),
    Regex::new(r"0\.0\.0\.0:(\d{4,5})").unwrap(),
]);
```

### `/proc/net/tcp` Poller Flow

```
tokio::time::interval(2s):
  for each (session_id, pid) in pty_manager.session_pids():
    #[cfg(target_os = "linux")]
    let entries = procfs::net::tcp() + procfs::net::tcp6()
    let listen_ports: HashSet<u16> = entries
      .filter(|e| e.state == TcpState::Listen && e.inode owned by pid)
      .map(|e| e.local_address.port())
      .collect();
    for port in listen_ports - known_ports: manager.confirm_listen(port)
    for port in known_ports - listen_ports: manager.report_lost(port)
```

### stdout Tap in `reader_thread`

In `server/src/pty/manager.rs` after line 501 (`buf.push(data)`):

```rust
// Inline call — pass bytes + session_id to detector:
if let Some(ref pfm) = state.port_forward_manager {
    detector::scan_chunk(&data[..n], session_id, project.as_deref(), pfm);
}
```

`scan_chunk` ANSI-strips, runs regex bank, calls `pfm.report_stdout_hit(port, ...)` on first match. Non-blocking (synchronous regex on 4KB chunk is ~µs).

### File-level Changes

| File | Action |
|------|--------|
| `server/src/port_forward/mod.rs` | Create |
| `server/src/port_forward/manager.rs` | Create |
| `server/src/port_forward/detector.rs` | Create (regex + proc poller) |
| `server/src/port_forward/session.rs` | Create |
| `server/src/port_forward/error.rs` | Create |
| `server/src/lib.rs` | Add `pub mod port_forward;` |
| `server/src/state.rs:18-40` | Add `port_forward_manager: Option<PortForwardManager>` |
| `server/src/api/ws_protocol.rs:~175` | Add `PortDiscovered`, `PortLost` variants |
| `server/src/api/router.rs` | Add `GET /api/ports` handler |
| `server/src/pty/manager.rs:501-523` | Add stdout scan call |
| `server/Cargo.toml` | Add `procfs = "0.17"` (linux-only), `once_cell`, `strip-ansi-escapes` or manual ANSI strip |

## Related Code Files

- `server/src/pty/manager.rs:468-523` — `reader_thread()`; insert scan after line 501
- `server/src/pty/manager.rs:501` — `buf.push(data)` — tap point
- `server/src/pty/manager.rs:523` — `sink.send_terminal_data(...)` — scan before this
- `server/src/state.rs:18-40` — `AppState` struct; add `port_forward_manager` field
- `server/src/api/ws_protocol.rs:~175-205` — `ServerMsg` enum; add 2 variants
- `server/src/api/router.rs:1` — `build_router()`; add ports route to protected branch
- `server/src/tunnel/manager.rs` — reference pattern for `Arc<RwLock<HashMap>>`

## Implementation Steps

1. Add `pub mod port_forward;` to `server/src/lib.rs`.
2. Create `error.rs` with `PortForwardError` (thiserror).
3. Create `session.rs` with `DetectedPort`, `DetectedVia`, `PortState`.
4. Create `manager.rs` with `PortForwardManager`. `report_stdout_hit` inserts `Provisional` entry + broadcasts `port:discovered`. `confirm_listen` upgrades to `Listening`. `report_lost` sets `Lost` + broadcasts `port:lost` + removes from map.
5. Create `detector.rs`:
   a. `PORT_REGEXES` static (`once_cell::Lazy`).
   b. `fn strip_ansi(s: &str) -> String` — strip `\x1b\[[0-9;]*[a-zA-Z]` and OSC `\x1b][^\x07]*\x07`.
   c. `fn scan_chunk(data: &[u8], session_id: Uuid, project: Option<&str>, mgr: &PortForwardManager)` — utf8-lossy, strip ANSI, apply regexes, parse port, validate range, call `mgr.report_stdout_hit`.
   d. `fn port_is_safe(port: u16) -> bool` — reject <1024 + danger list.
   e. `#[cfg(target_os = "linux")] async fn proc_poll_loop(pty_mgr, pfm, interval=2s)` — poller task. `#[cfg(not(target_os = "linux"))] async fn proc_poll_loop(...)` — logs warning, returns.
6. Create `mod.rs` re-exports.
7. Add `procfs` to `server/Cargo.toml` under `[target.'cfg(target_os = "linux")'.dependencies]`.
8. Modify `server/src/state.rs`: add `port_forward_manager: Option<Arc<PortForwardManager>>`. Update `AppState::new()`.
9. Modify `server/src/api/ws_protocol.rs`: add `PortDiscovered`, `PortLost` variants to `ServerMsg`.
10. Modify `server/src/pty/manager.rs:~501`: add `scan_chunk` call (guarded by `if let Some(pfm) = &state.port_forward_manager`).
11. Add `GET /api/ports` handler to `router.rs` (protected branch): reads `state.port_forward_manager.list()`, serializes as `{ "ports": [...] }`.
12. Spawn `proc_poll_loop` in server startup (alongside tunnel watcher).
13. Write unit tests: `scan_chunk` hits known patterns; `port_is_safe` rejects 22, 3306; `DetectedPort` serializes correctly.
14. `cargo test port_forward` green; `cargo build` compiles on Linux.

## Todo List

- [ ] `pub mod port_forward;` in `lib.rs`
- [ ] Create `error.rs`
- [ ] Create `session.rs` (DetectedPort, DetectedVia, PortState)
- [ ] Create `manager.rs` (PortForwardManager, report/confirm/lost/list)
- [ ] Create `detector.rs` (regex bank, ANSI strip, scan_chunk, proc poller)
- [ ] Create `mod.rs`
- [ ] Add `procfs` to `Cargo.toml` (linux target only)
- [ ] Modify `state.rs` (add port_forward_manager field)
- [ ] Modify `ws_protocol.rs` (add PortDiscovered, PortLost)
- [ ] Modify `pty/manager.rs` (scan_chunk tap)
- [ ] Add `GET /api/ports` to `router.rs`
- [ ] Spawn `proc_poll_loop` at startup
- [ ] Unit tests (regex, safety check, serialization)
- [ ] `cargo test port_forward` green

## Success Criteria

- Start Vite dev server in a PTY session → `port:discovered` WS event arrives in <2s
- `GET /api/ports` returns `{ ports: [{ port: 5173, detected_via: "stdout_regex", state: "listening", ... }] }`
- Kill the Vite process → `port:lost` event arrives within 4s (one poll cycle)
- `scan_chunk` rejects port 3306 (danger list); rejects port 80 (<1024)
- On non-Linux OS: `GET /api/ports` returns `{ ports: [] }`; startup warning logged

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `procfs` crate API changes between versions | Compile error | Pin to `0.17.*`; wrap in thin adapter |
| ANSI strip regex misses vendor-specific escape codes | Missed port detect | Fallback to raw byte scan if UTF-8 decode fails; `/proc` poll catches remainder |
| `scan_chunk` called per 4KB chunk, many sessions | CPU spike | Regex on 4KB is ~µs; acceptable. Profile if >20 concurrent sessions |
| PID→inode join in `/proc` requires read permissions | Detection gap | DamHopper server runs as same user as PTY — no privilege escalation needed |
| Port re-reported multiple times from stdout (log replay) | Spurious events | `report_stdout_hit` no-ops if port already in map |

## Security Considerations

- Port safety filter (`port_is_safe`) applied in `scan_chunk` and `confirm_listen` — dual check.
- Only PIDs from active PTY sessions are scanned in proc poller — no global port sniffing.
- `proxy_url` generated server-side as `/proxy/{port}/` — client cannot inject arbitrary paths.

## Next Steps

Phase 03 merged → Phase 04 can wire `/proxy/:port/*path` using `port_forward_manager.list()` for allowlist validation.

## Unresolved Questions

1. `procfs` crate: inode-to-PID join requires iterating `/proc/<pid>/fd/` — performance with many processes? May need to cache PID→listen-ports mapping.
2. Should provisional (stdout-only, not yet `/proc`-confirmed) ports be included in `GET /api/ports` response or hidden until confirmed?
3. Port disappearance: keep `Lost` state in map for N seconds before removing (allows UI to show "stopped") or remove immediately?
