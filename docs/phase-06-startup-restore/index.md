# Phase 06: Startup Restore - Quick Start

**Status**: ✅ COMPLETE  
**Date**: April 17, 2026  

Session persistence on server restart. When the server starts, it automatically restores PTY processes for sessions that were marked as restartable.

## Key Features

✅ **Automatic Session Restoration** — Respawn PTY processes for sessions with restart policies (`OnFailure`, `Always`)  
✅ **Smart Filtering** — Skip `Never` restart policies and sessions for removed projects  
✅ **Config-Based Retries** — Use `restart_max_retries` from project config (no hardcoding)  
✅ **Lazy Buffer Loading** — Terminal history loads on-demand via `terminal:attach`  
✅ **Graceful Error Handling** — Database errors logged as warnings; server continues normally  

## Architecture

```
Server starts
    ↓
Load sessions from SQLite (if enabled)
    ├─ Skip: restart_policy == Never
    ├─ Skip: project removed from config
    └─ Restore: spawn PTY with saved command/cwd/env
    ↓
Cleanup expired buffers (TTL-based)
    ↓
Broadcast terminal:changed event
    ↓
Server ready for requests
```

## Usage

### Enable Persistence

In `dam-hopper.toml`:
```toml
[server]
session_persistence = true
session_db_path = "~/.config/dam-hopper/sessions.db"
session_buffer_ttl_hours = 24
```

### CLI Arguments

```bash
# Server includes restore automatically if persistence enabled
cargo run -- --workspace /path/to/workspace
```

### Startup Logging

```
[INFO] Restored sessions from persistence (count: 3)
[INFO] Cleaned up expired session buffers (count: 1)
```

### Skipped Sessions (Always Logged)

```
[WARN] Skipping never-restart session (id: session-xyz)
[WARN] Skipping session for removed project (id: session-abc, project: old-api)
[WARN] Failed to restore session (id: session-def, error: ...)
```

## Supported Restart Policies

| Policy | Restored? | Reason |
|--------|-----------|--------|
| `Never` | ❌ | User doesn't want auto-restart |
| `OnFailure` | ✅ | Only if previously alive at persist time |
| `Always` | ✅ | Always restored on server start |

## Buffer Recovery

Terminal scrollback history is **not** eagerly loaded on startup. Instead:

1. **On Startup**: Session metadata restored, PTY process respawned
2. **On Client Connect**: Client calls `terminal:attach`
3. **Buffer Retrieval**: Live session → in-memory buffer; Dead session → lazy load from SQLite

```
Client reconnects
    ↓
Call terminal:attach
    ↓
Check in-memory buffer (live sessions)
    │ found → return (fast)
    │ not found ↓
Fallback to SQLite (dead sessions)
    ↓
Decompress, validate, return
```

This keeps startup fast (<1s) while preserving scrollback for inspection.

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| `server/src/persistence/restore.rs` | **283** | NEW: `restore_sessions()` function, tests |
| `server/src/persistence/mod.rs` | **4** | Export `restore_sessions` |
| `server/src/pty/manager.rs` | **6** | Add `session_store` field, lazy buffer fallback |
| `server/src/main.rs` | **11** | Call `restore_sessions()` after startup |
| `server/src/error.rs` | **1** | Already includes `PersistenceError` variant |

**Total Lines Added**: ~305 lines  
**Test Coverage**: 3 tests, all passing ✅

## See Also

- [Implementation Details](./implementation.md) — Codebase deep-dive
- [Phase 05 (Persist Worker)](../phase-05-persist-worker/index.md) — Prerequisite
- [System Architecture](../system-architecture.md) — Full persistence stack
