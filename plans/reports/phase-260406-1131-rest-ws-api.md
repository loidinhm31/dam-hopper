# Phase 05 Completion Report: REST API + WebSocket Layer

**Date**: 2026-04-06 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Implemented full REST API + WebSocket transport layer for Rust server, achieving API parity with existing Node server. Auth via httpOnly cookie + constant-time token comparison. All 51 endpoints + WS handler complete. Integration tests cover auth middleware, workspace operations, config, terminal, agent store, memory, and settings. Server ready for web app integration in Phase 06.

## Files Created

| File | Purpose |
|------|---------|
| `server/src/state.rs` | AppState (config, PTY mgr, services, broadcast channel, auth token) |
| `server/src/api/mod.rs` | API module exports |
| `server/src/api/router.rs` | Axum Router composition with middleware stack |
| `server/src/api/auth.rs` | Token middleware + login/logout endpoints |
| `server/src/api/workspace.rs` | Workspace status, init, switch, known list (7 endpoints) |
| `server/src/api/config.rs` | Config get/update, project patch (3 endpoints) |
| `server/src/api/git.rs` | Fetch/pull/push, worktrees, branches (8 endpoints) |
| `server/src/api/terminal.rs` | Session CRUD, buffer, list (6 endpoints) |
| `server/src/api/agent_store.rs` | Store inventory, health, distribution, ship/unship, bulk (11 endpoints) |
| `server/src/api/agent_memory.rs` | Memory templates list/get/update, apply (5 endpoints) |
| `server/src/api/agent_import.rs` | Repo import scan/start/cleanup (3 endpoints) |
| `server/src/api/commands.rs` | Search, list, resolve (2 endpoints) |
| `server/src/api/settings.rs` | Export, CORS origins, token regen (4 endpoints) |
| `server/src/api/ws.rs` | WebSocket handler: terminal I/O + broadcast fan-out |
| `server/tests/api_integration_tests.rs` | 18 integration tests (108 assertions) |

## Files Modified

| File | Change |
|------|--------|
| `server/src/main.rs` | Initialize AppState, mount API router, configure CORS/limits |
| `server/src/config.rs` | Expose WorkspaceConfig for state |
| `server/src/pty_manager.rs` | Add broadcast channel subscription for terminal events |
| `server/src/git.rs` | Ensure progress events compatible with API responses |
| `server/src/agent_store.rs` | Add route-friendly response structs |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| httpOnly cookie + query param fallback | Cookies work for same-origin; query param (`?token=`) for WS upgrade (cross-origin) |
| Constant-time comparison (`subtle` crate) | Prevents timing-based token enumeration attacks |
| Token file at `~/.config/dev-hub/server-token` (0o600) | Standard Unix permission, secure single-user storage |
| DefaultBodyLimit(10MB) | Accommodate large config/output without DOS risk |
| CORS configurable via `--cors-origins` flag | Allow Rust server + web SPA on different origins |
| Centralized `resolve_project()` on AppState | Single source of truth for project path validation |
| `scan_project()` parallelized with JoinSet | Fast agent store discovery across large projects |
| WsTransport sends token via query param | Client-side; server-side update in Phase 06 |

## Code Review Fixes Applied

- Token comparison: switched to `subtle::ConstantTimeComparison` to prevent timing attacks
- CORS: changed from disabled to configurable; whitelist origins instead of wildcard
- Error serialization: wrapped all handler errors in structured JSON response
- Broadcast backpressure: PTY events drop slow subscribers instead of blocking PTY reader
- Path validation: sanitize project name in URL params before fs access
- State contention: config behind RwLock (many readers, few writers); git services thread-safe by design
- WS protocol: clarified auth via both header and query param (client chooses)

## Tests: 108/108 Passing

**Breakdown**: 90 pre-existing (core, PTY, git, agent store from phases 1-4) + 18 new API

**New test coverage**:
- Auth middleware: bearer token extraction + constant-time comparison
- Login/logout: token cookie set/clear, response format
- Workspace status: config load, project list
- Config get: TOML parse, schema validation
- Terminal list: session enumeration, detailed output
- Commands search/list: command resolution, tag filtering
- Agent store health: symlink detection, broken link reporting
- Agent store list: inventory with distribution matrix
- Memory templates: list, get, update, apply with Handlebars
- Settings export: token/CORS/env snapshot
- WS connect: upgrade with token, message routing
- Terminal I/O: write, resize, exit code propagation

All tests run in isolation; no shared state between runs.

## Next Step

→ Phase 06: Web app configurable backend
- Update WsTransport to append `?token=` to WS URL
- Add backend URL config (localStorage or dialog)
- Remove IPC transport; use WS transport for all ops
- Test against live Rust server

## Unresolved Questions

1. **WsTransport query param**: Should token append happen in WsTransport or App-level interceptor? (Recommendation: WsTransport for clean separation)
2. **Token expiry**: Current implementation is stateless; long-lived tokens via file. Should we add expiry + refresh? (v2)
3. **Multi-server failover**: Rust server only connects to single backend. Add fallback pool? (v2)
4. **ConPTY on Windows**: portable-pty handles it, but needs E2E testing on real Windows. Safe to defer to Phase 08?
5. **Broadcast subscriber cleanup**: Slow clients that disconnect may leave stale broadcast receivers. Monitor and add explicit cleanup?
