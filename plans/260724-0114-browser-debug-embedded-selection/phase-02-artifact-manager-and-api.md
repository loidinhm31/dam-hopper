# Phase 02 — Ephemeral Artifact Manager and API

## Context links

- Parent: [plan.md](./plan.md)
- Scout: [server artifact/tunnel surface](./scout/scout-02-server-artifact-tunnel-surface.md)
- Research: [artifact handoff](./research/researcher-02-artifact-terminal-handoff.md)
- Architecture: [planned browser-debug section](../../docs/system-architecture.md)

## Overview

- Date: 2026-07-24
- Description: Store approved selection JSON and optional PNG outside projects,
  with authenticated create/upload/delete and deterministic expiry.
- Priority: P1
- Implementation status: Completed (2026-07-24 15:46 +07)
- Review status: Completed (2026-07-24 15:46 +07)

## Key Insights

- Existing server already uses `tempfile`, atomic rename, body limits, SHA-256,
  and mode `0600` patterns.
- PTY sessions are server-local; paths can be inserted after server validation.
- Existing auth is server-wide; V1 inherits that trust model and adds no user
  ownership model.

## Requirements

- Per-server temporary root and in-memory metadata map.
- Random UUID artifact IDs and filenames; JSON max 64 KiB; PNG max 4 MiB.
- Default TTL 10 minutes; sweep every 60 seconds; explicit delete; shutdown
  cleanup.
- JSON create validates live terminal ID and selection schema.
- Optional binary PNG PUT validates MIME/size/hash and writes atomically.
- Response returns generated JSON/PNG paths only after each file is committed.
- No list/read endpoint, client filesystem path input, project-tree write, or
  diagnostics export.

## Architecture

`BrowserDebugArtifactManager` owns `RwLock<HashMap<Uuid, Metadata>>` and a
server-instance `TempDir`. API handlers clone paths/metadata before awaits,
write sibling temp files, sync, rename, and update metadata. A Tokio sweep
removes expired files. `main.rs` disposes the manager beside tunnel cleanup.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/server/src/browser_debug/mod.rs`.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/browser_debug/store.rs`.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/browser_debug/error.rs`.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/api/browser_debug.rs`.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/lib.rs` to export module.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/state.rs` to own manager.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs` with
  protected create/PNG PUT/delete routes.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/main.rs` for construction,
  sweep task, and shutdown disposal.
- Create `/mnt/data/ws/sharing/dam-hopper/server/tests/browser_debug_artifacts.rs`.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` only for
  shared auth/router setup if needed.

## Implementation Steps

1. Define `BrowserSelectionV1`, artifact metadata, error codes, caps, and TTL.
2. Implement create-new files in a private temporary directory with `0600`.
3. Add atomic JSON write and binary PNG write with size enforcement while reading.
4. Validate terminal ID using existing PTY manager `is_alive`/session lookup.
5. Add protected REST handlers and route them before generic parameter routes.
6. Add periodic sweep and explicit `dispose_all`.
7. Return opaque artifact ID, expiry, size/hash, and server-generated paths.
8. Add metadata-only tracing events (`created`, `uploaded`, `expired`, `deleted`).

## Todo list

- [x] Test malformed JSON, oversized JSON/PNG, wrong MIME, and path traversal (generated opaque paths; project-root escape asserted).
- [x] Test expired/unknown/delete-race and concurrent upload/delete.
- [x] Test dead terminal and invalid session ID.
- [x] Test shutdown removes temporary root.
- [x] Confirm `DefaultBodyLimit` covers binary PUT (route `RequestBodyLimitLayer`).

## Validation

- 2026-07-24 15:46 +07 (Asia/Ho_Chi_Minh): `cd server && cargo test` — 492 passed, 0 failed.
- Coverage includes unit, API integration, malformed/oversized payloads, MIME/PNG validation, auth, expiry, cleanup, races, and private-file permissions.

## Success Criteria

- Authenticated create + binary PUT produce readable mode-0600 files.
- Unauthenticated, expired, unknown, or mismatched IDs return safe errors.
- No file is created under project roots, `.claude`, persistence, or diagnostics.
- Cleanup is idempotent and does not hold locks across await.

## Risk Assessment

- Absolute paths in terminal text are host-specific; future MCP handoff may be
  needed for remote/containerized agents.
- Server crash may leave OS temp residue until system cleanup; use per-instance
  random root and startup stale sweep where practical.
- Current auth discards JWT subject; multi-user ownership is deferred.

## Security Considerations

- Never trust client path, MIME, size, hash, or terminal liveness claims.
- Use `create_new`, random IDs, atomic rename, `0600`, `nosniff` where served.
- Log only opaque ID, size, hash, and outcome; never raw page data.

## Next steps

Expose typed client methods after endpoint tests pass. Keep screenshot upload
optional so DOM-only attachment remains available.

## Unresolved questions

- Exact startup stale-root cleanup behavior on Windows.
- Whether a future authenticated artifact read endpoint is needed for MCP.
