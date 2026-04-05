# Phase 02: PTY Session Management

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-rust-scaffold-config.md)

## Overview
- **Priority**: P1 — terminal interaction is core value prop
- **Status**: Pending
- **Effort**: 12h

Implement PTY session manager using `portable-pty`. This is the heart of the application — spawning terminal processes, managing their lifecycle, streaming I/O.

## Key Insights

- Current Node impl: `Map<id, IPty>`, 256KB scrollback buffer per session, SessionMeta with 60s TTL for dead sessions
- Session ID prefix determines type: `build:`, `run:`, `custom:`, `shell:`, `terminal:`, `free:`
- EventSink abstraction decouples PTY from transport (good pattern to keep)
- portable-pty is sync — need tokio::spawn_blocking or dedicated threads for read loops

## Requirements

- Spawn PTY sessions with configurable shell, cwd, env, dimensions
- Write stdin to session
- Resize session (cols, rows)
- Kill session (SIGTERM → SIGKILL after timeout)
- Remove session (cleanup after kill)
- Scrollback buffer (256KB ring buffer per session)
- Session metadata: id, type, status, pid, created_at
- Dead session TTL (60s auto-cleanup)
- List active/detailed sessions
- Get session buffer content

## Architecture

```
src/pty/
├── mod.rs
├── session.rs          # Single PTY session wrapper
├── manager.rs          # PtySessionManager (HashMap<String, Session>)
├── buffer.rs           # Ring buffer for scrollback
└── event_sink.rs       # EventSink trait
```

**Threading model**:
```
Main tokio runtime
├── Axum handlers (async)
├── PTY read threads (std::thread per session)
│   └── Reads from PTY → pushes to broadcast channel
├── Session cleanup task (tokio interval, checks TTL)
└── EventSink forwards PTY events to WebSocket clients
```

## Related Code Files (current Node)

| File | Action | Notes |
|------|--------|-------|
| `packages/server/src/pty/session-manager-impl.ts` | Port to Rust | Primary reference |
| `packages/server/src/ws/ws-event-sink.ts` | Port to Rust | WebSocket event sink |
| `packages/electron/src/main/pty/session-manager.ts` | Reference | Original impl |

## Implementation Steps

1. Define `EventSink` trait: `send_terminal_data(id, data)`, `send_terminal_exit(id, code)`, `send_terminal_changed()`
2. Implement `ScrollbackBuffer` — fixed-size ring buffer storing raw bytes
3. Define `Session` struct: pty handle, metadata, buffer, broadcast channel
4. Implement `PtySessionManager`:
   - `create(id, shell, cwd, env, cols, rows) → Result<SessionMeta>`
   - `write(id, data) → Result<()>`
   - `resize(id, cols, rows) → Result<()>`
   - `kill(id) → Result<()>`
   - `remove(id) → Result<()>`
   - `list() → Vec<SessionMeta>`
   - `list_detailed() → Vec<SessionDetail>`
   - `get_buffer(id) → Result<String>`
5. Spawn dedicated reader thread per PTY session (portable-pty read is blocking)
6. Reader thread: read → append to scrollback → send via EventSink
7. Implement TTL cleanup: tokio interval task, removes sessions dead > 60s
8. Handle SIGTERM gracefully — kill all sessions on shutdown
9. Integration tests with real shell spawning

## Todo

- [ ] EventSink trait defined
- [ ] ScrollbackBuffer implemented
- [ ] Session struct with metadata
- [ ] PtySessionManager CRUD ops
- [ ] Reader thread per session
- [ ] TTL cleanup task
- [ ] Graceful shutdown
- [ ] Integration tests

## Success Criteria

- Can spawn `bash`/`zsh`, send commands, receive output
- Resize works (verified with `tput cols`/`tput rows` in spawned shell)
- Kill terminates process and reader thread
- Buffer stores last 256KB of output
- Dead sessions cleaned up after 60s

## Risk Assessment

- **portable-pty blocking reads**: Must use dedicated threads, not tokio tasks. Blocking in tokio runtime = starvation.
- **Thread cleanup**: Reader thread must exit when PTY closes. Use shared AtomicBool or channel signal.
- **Cross-platform**: portable-pty handles Linux/macOS, but test on both.
- **Resource leaks**: If reader thread panics, session becomes zombie. Need panic handler.

## Security Considerations

- Shell command injection: validate shell path, don't interpolate user input into commands
- Env vars: don't log sensitive env values
- Process isolation: PTY runs as server user — no privilege escalation

## Next Steps

→ Phase 03: Git operations (independent from PTY, can be parallel)
