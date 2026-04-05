# Phase 02 Completion Report: PTY Session Management

**Date**: 2026-04-06 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Implemented full PTY session lifecycle: spawn, read/write, broadcast, shutdown. Built event sink abstraction for plugging WebSocket into phase-05 API layer. Ring buffer handles arbitrary scrollback without unbounded growth.

## Files Created

| File | Purpose |
|------|---------|
| `server/src/pty/mod.rs` | Module root; exports all session types and manager |
| `server/src/pty/event_sink.rs` | `EventSink` trait + `NoopEventSink` + `BroadcastEventSink` (tokio broadcast) |
| `server/src/pty/buffer.rs` | `ScrollbackBuffer` — 256KB ring buffer with byte-level eviction |
| `server/src/pty/session.rs` | `LiveSession`, `SessionMeta`, `SessionType`, `DeadSession` |
| `server/src/pty/manager.rs` | `PtySessionManager` (HashMap + dead tombstones, 60s retention) |
| `server/src/pty/tests.rs` | 19 integration tests (spawn, read/write, shutdown, buffer edge cases) |

## Files Modified

| File | Change |
|------|--------|
| `server/src/lib.rs` | Added `pub mod pty` |
| `server/src/error.rs` | Added `PtyError`, `SessionNotFound`, `InvalidInput` variants |
| `server/Cargo.toml` | Added `portable-pty 0.8`, `tokio-stream 0.1` |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| std::thread per session (not spawn_blocking) | Blocks on portable-pty reads; avoids Tokio work-stealing starvation |
| Arc<Mutex<Inner>> for manager | Cloneable across axum handlers; single lock per operation |
| DeadSession tombstones (60s) | Matches Node.js cleanup delay; prevents zombie lookup errors |
| BroadcastEventSink wrapper | Wraps tokio::broadcast; phase-05 adds WebSocket receivers directly |
| Ordering::Relaxed shutdown flag | Single bool flag; SeqCst unnecessary; matches Rust best practices |
| Session ID validation | `[a-zA-Z0-9:._-]`, max 128 chars; prevents injection |

## Tests: 45/45 Passing

- 22 config tests (existing)
- 4 buffer tests (ring eviction, overflow, partial reads)
- 19 PTY tests (spawn/kill, read/write loop, broadcast fan-out, buffer limits, exit code harvest, invalid session, envvar passthrough)

## Code Review Findings Fixed

- `SeqCst` → `Relaxed` on shutdown AtomicBool reads/writes
- Race window in harvest_exit_code (exit before read pending) — documented in comment
- Env logging sanitized: log keys only, not values (security)
- Flaky sleep-based tests → polling `wait_for()` helper with 2s timeout

## Next Step

→ Phase 03: Git operations (libgit2 + CLI fallback for push)
