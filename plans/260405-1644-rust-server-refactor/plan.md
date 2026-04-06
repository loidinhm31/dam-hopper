---
title: "Drop Electron, Rust Server, Separate Web App"
description: "Replace Node.js core+server with Rust backend; keep React web as standalone SPA with configurable backend URL"
status: in_progress
priority: P1
effort: 80h
branch: main
tags: [refactor, backend, rust, architecture]
created: 2026-04-05
---

# Drop Electron, Rust Server, Separate Web App

## Overview

Replace `@dev-hub/core` + `@dev-hub/server` + `@dev-hub/electron` with a single Rust binary server. Keep `@dev-hub/web` as standalone SPA running independently, connecting to configurable backend (local or remote).

**Current**: 4 Node packages (core ~24K LoC, server ~5K, electron ~3K, web ~8K)
**Target**: 1 Rust binary + 1 React SPA (web package stays, everything else goes)

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Web framework | Axum | Tower ecosystem, first-class WS, Tokio-native |
| PTY | portable-pty | Proven in wezterm, cross-platform |
| Git | git2 + CLI fallback | Battle-tested; gix lacks push |
| Config | toml + serde | Direct compat with existing dev-hub.toml |
| Auth | Bearer token in header | Cross-origin friendly, no cookie hassles |
| Server location | `server/` (root level) | Clean separation from Node ecosystem |
| Config format | Keep existing TOML as-is | Zero migration effort |
| Platforms | Linux x86_64 + Windows | User's target platforms |

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Rust project scaffold + config parsing | Done ✓ | 8h | [phase-01](./phase-01-rust-scaffold-config.md) |
| 2 | PTY session management | Done ✓ | 12h | [phase-02-pty-session-management.md](./phase-02-pty-session-management.md) |
| 3 | Git operations | Done ✓ | 12h | [phase-03-git-operations.md](./phase-03-git-operations.md) |
| 4 | Agent store + commands | Done ✓ | 10h | [phase-04-agent-store-commands.md](./phase-04-agent-store-commands.md) |
| 5 | REST API + WebSocket layer | Done ✓ | 12h | [phase-05-rest-ws-api.md](./phase-05-rest-ws-api.md) |
| 6 | Web app: configurable backend | Done ✓ | 6h | [phase-06-web-configurable-backend.md](./phase-06-web-configurable-backend.md) |
| 7 | Web app: remove Electron deps | Done ✓ | 4h | [phase-07-web-remove-electron.md](./phase-07-web-remove-electron.md) |
| 8 | Integration testing + migration | Done ✓ | 8h | [phase-08-integration-testing.md](./phase-08-integration-testing.md) |
| 9 | Cleanup: remove Node packages | Done ✓ | 4h | [phase-09-cleanup.md](./phase-09-cleanup.md) |
| 10 | CI/CD + distribution | Pending | 4h | [phase-10-ci-cd.md](./phase-10-ci-cd.md) |

## Dependencies

- Phases 1-4 are backend-only, can be developed independently
- Phase 5 depends on 1-4 (API layer wraps all services)
- Phases 6-7 are web-only, can start after phase 5 API contract is defined (not implemented)
- Phase 8 requires both backend (5) and web (6-7)
- Phase 9-10 after everything passes integration tests

## Migration Strategy

**Incremental, not big-bang.** Rust server implements the same REST+WS API as current Node server. Web app's `WsTransport` works unchanged against new backend. Switch is transparent.

1. Build Rust server alongside existing Node packages
2. Validate API parity via integration tests
3. Update web app for configurable backend
4. Run both servers side-by-side during validation
5. Remove Node packages once stable

## Resolved Decisions

1. **Config format**: Keep existing TOML as-is — zero migration
2. **Auth**: Bearer token in `Authorization` header — cross-origin friendly, sessionStorage for token
3. **Server location**: `server/` at repo root
4. **Platforms**: Linux x86_64 + Windows (ConPTY via portable-pty)
5. **Multi-connection**: Single server connection for v1

## Remaining Questions

1. Windows PTY (ConPTY) — portable-pty supports it but needs testing. Any specific Windows terminal requirements?
2. Multiple simultaneous server connections from web? → Single for v1, revisit if needed
