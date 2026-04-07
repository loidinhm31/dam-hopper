# Codebase Summary

Dev-Hub is a monorepo workspace manager with IDE integration. Rust backend (Axum) handles business logic; React SPA frontend connects via WebSocket.

## Architecture Overview

### Backend (server/)
**Language:** Rust | **Runtime:** Tokio async | **API:** Axum + WebSocket

Core modules:
- **config/** — TOML workspace/project parsing, feature flags
- **fs/** — Filesystem sandbox for IDE explorer (Phase 01), validation & ops
- **pty/** — Portable terminal sessions (portable-pty), broadcast events
- **git/** — Git operations (git2 + CLI fallback), clone/push/pull
- **agent_store/** — `.claude/` item distribution via symlinks
- **api/** — REST routes, WebSocket handlers, error mapping
- **state.rs** — AppState: shared config, PTY manager, FS subsystem, auth
- **main.rs** — Axum router setup, middleware, port binding

### Frontend (packages/web/)
**Language:** TypeScript/React 19 | **Build:** Vite | **Styling:** Tailwind v4

Key components:
- **api/** — WsTransport, REST/WebSocket client
- **components/pages/** — TerminalsPage, ProjectsPage
- **components/organisms/** — TerminalTreeView, TerminalTabBar

Data flow: Browser → fetch(/api/*) + WebSocket(/ws) → Axum routes → state + services.

## Feature Flags

| Flag | Config | Env | Purpose |
|------|--------|-----|---------|
| ide_explorer | `[features] ide_explorer = true` | `DEV_HUB_IDE=1` | File explorer + Monaco read/list/stat |

## Key Services & Patterns

**PtySessionManager** — Arc<Mutex<Inner>> pattern. Sessions identified by UUID, broadcast output to WebSocket clients.

**FsSubsystem** — Workspace-scoped, Arc<Mutex<WorkspaceSandbox>>. Lazy init; returns Unavailable if workspace root doesn't exist.

**AgentStoreService** — Symlink distribution. `ship()` creates links, `absorb()` copies, health check detects broken symlinks.

**Authentication** — Bearer token (hex UUID) in Authorization header. Stored `~/.config/dev-hub/server-token`, constant-time comparison.

## Config Structure (dev-hub.toml)

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "api-server"
path = "./api-server"
type = "cargo"
build_command = "cargo build --release"
run_command = "cargo run"

[features]
ide_explorer = true
```

## Testing

**Rust:** 121 integration tests under `server/tests/`. Real temp filesystems & git repos, no mocking.

**Web:** Manual verification against running server.

## Error Handling

Module-scoped `thiserror` types (FsError, AppError, etc). API layer maps to HTTP status codes.

## Performance Notes

- PTY output buffered only during live sessions
- Workspace-scoped sandbox avoids traversal outside project boundaries
- Cheap clones: Arc<PtySessionManager>, Arc<FsSubsystem>, Arc<AgentStoreService>
