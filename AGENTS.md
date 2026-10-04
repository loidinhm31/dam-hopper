# Repository Guidelines (AGENTS.md)

This file provides comprehensive guidance to coding agents (Claude Code, OpenCode, OMP, Codex, and subagents) when working with code in this repository.

---

## 1. Project Structure

DamHopper is a monorepo consisting of a Rust server backend, a shared React 19 UI package, web and desktop host applications, and helper packages:

- **`server/`** — Rust binary and library (Axum + Tokio). All backend business logic:
  - `api/` — Axum REST routes (`/api/*`) and WebSocket server (`/ws`).
  - `config/` — TOML configuration parsing, workspace and project discovery, global registry.
  - `fs/` — Sandboxed filesystem operations, ticketed media access, and OPAQUE encrypted upload handlers.
  - `git/` — Git operations via libgit2 and porcelain fallback, CAS commit rewriting, safe squash, history search.
  - `pty/` — `portable-pty` session management, terminal output broadcast, process lifecycle.
  - `advisor/` — Native Evcrate Advisor service, policy management, model catalog discovery, history scanner.
  - `agent_status/` — Multi-agent observation engine, status reducers (OMP, Codex, Claude hook ingress).
  - `idle_suspend/` — Server-authoritative terminal idle sleep coordinator and diagnostics.
  - `linux_release/` — Release manager, daemon state, systemd service templates, and updater.
  - `persistence/` — SQLite session and workflow persistence with bounded async writer worker.
  - `tunnel/` & `port_forward/` — Cloudflared tunnel sessions and procfs/PTY-based port discovery.
  - `agent_store/` — Symlink-based distribution of agent items across projects.
  - `tests/` — Rust integration tests using real temporary filesystems.
- **`apps/web/`** — React 19 / Vite SPA entry application. Thin host rendering `@dam-hopper/ui`.
- **`apps/native/`** — Tauri 2 desktop entry application sharing `@dam-hopper/ui`, backed by `src-tauri/` Rust layer.
- **`packages/ui/`** (`@dam-hopper/ui`) — Shared React 19 UI package:
  - `components/` — UI organism, molecule, and atom components (IdeShell, TerminalPanel, GitPage, FileTree, Advisor, HostResources, PortsPanel, CognitoOverlay).
  - `lib/` — Frontend utilities (terminal buffer, crypto, git helpers, suggestion controller).
  - `api/` — Frontend API client and `WsTransport` implementation.
  - `hooks/` & `stores/` — React hooks and Zustand stores with strict profile/generation scoping.
- **`packages/shared/`** (`@dam-hopper/shared`) — Shared utilities, including redactable logging.
- **`packages/browser-bridge/`** (`@dam-hopper/browser-bridge`) — Browser debug runtime and protocol.
- **`docs/`** — Architecture, API reference, configuration, and engineering standards.
- **`deploy/`** & **`scripts/`** — Deployment descriptors, systemd units, release packaging, and verification tools.

---

## 2. Build, Test, and Development Commands

### Web & UI Development

```bash
# Install workspace dependencies
pnpm install

# Run web app in Vite dev mode (loopback proxy to backend)
pnpm dev

# Build web application
pnpm build

# Lint packages
pnpm lint

# Format code with Prettier
pnpm format

# Type check
pnpm check
```

### Rust Server Development

```bash
# Run server in dev mode (requires a config file or default fallback)
pnpm dev:server
# Or directly via cargo:
cd server && cargo run -- --config /path/to/dam-hopper.toml --host 127.0.0.1 --port 4801

# Watch mode (requires cargo-watch):
pnpm dev:server:watch
# Or directly:
cd server && cargo watch -x 'run -- --host 127.0.0.1 --port 4801'

# Build release binary:
pnpm build:server
# Or directly:
cd server && cargo build --release

# Inspect local server authentication token:
cat ~/.config/dam-hopper/server-token

# Regenerate local server token:
cd server && cargo run -- --new-token --config /path/to/dam-hopper.toml
```

### Testing Commands

```bash
# Run all backend tests:
pnpm test
# Or directly in server crate:
cd server && cargo test

# On Windows (avoid rlib mmap exhaustion from page file limits):
cd server && cargo test -j 1

# Run specific Rust test:
cd server && cargo test test_name

# Run UI package unit tests (Vitest):
pnpm --filter @dam-hopper/ui test

# Run UI browser component tests (Chromium / Playwright via Vitest):
pnpm --filter @dam-hopper/ui test:browser
```

---

## 3. Development Mode (`--no-auth`)

For local development without MongoDB or authentication configuration, run the server with `--no-auth`:

```bash
# Via npm script
pnpm dev:server -- --no-auth --config /path/to/dam-hopper.toml

# Via cargo directly
cd server && cargo run -- --no-auth --config /path/to/dam-hopper.toml --host 127.0.0.1 --port 4801

# Via environment variable
DAM_HOPPER_NO_AUTH=1 cargo run -- --config /path/to/dam-hopper.toml
```

### Behavior & Safety Constraints
- Bypasses Bearer/cookie token validation; `/api/auth/login` returns a 30-day dev token immediately.
- `/api/auth/status` reports `{ authenticated: true, dev_mode: true, user: "dev-user" }`.
- **Failsafe**: Server refuses to boot with `--no-auth` if `MONGODB_URI` is set, or if `RUST_ENV=production` or `ENVIRONMENT=production`.
- Use `--no-auth` only on trusted development loopback networks; never expose publicly.

---

## 4. Architecture & Data Flow

```
dam-hopper-server (Rust, Axum on Tokio; default port 4801)
├── config/       — TOML parsing, global workspace registry
├── pty/          — portable-pty session manager (incarnation-fenced UUIDs)
├── git/          — libgit2 + git CLI (CAS rewrites, safe squash, history search)
├── fs/           — sandboxed filesystem, media tickets, encrypted chunk upload
├── advisor/      — native Evcrate Advisor service, policy CAS, model catalogs
├── agent_status/ — OMP loopback WS, Codex/Claude hook ingress, PTY correlation
├── idle_suspend/ — helper socket IPC coordinator, systemd integration
├── persistence/  — SQLite persistence with bounded background writer
└── api/          — Axum REST routes (/api/*) + WebSocket (/ws)

Browser / Tauri Host (React 19 SPA)
├── apps/web or apps/native host wrappers
├── WsTransport:
│   ├── REST fetch (/api/*) for queries and commands
│   └── WebSocket (/ws) with strict {"kind": "..."} envelope (no legacy "type")
├── Multi-Server Profile Store (Zustand + localStorage)
│   ├── QueryClient scoped by ['profile', profileId, generation, ...]
│   └── Independent server targets, active projects, and settings
├── xterm.js TerminalPanel (per-session input, stream replay, activity indicators)
├── Cognito Privacy Overlay (ephemeral blur, input & keyboard isolation)
└── Native Advisor UI (model routing editor, history review, evaluation inspector)
```

---

## 5. Key Design Decisions & Subsystem Invariants

1. **Authentication & Multi-Profile Scoping**:
   - Bearer token stored in `~/.config/dam-hopper/server-token`; constant-time check via `subtle` crate.
   - Cross-origin browser access requires an explicit `DAM_HOPPER_CORS_ORIGINS` allowlist.
   - Multi-server profiles exist on the client side: state, transports, subscriptions, and TanStack Query caches MUST remain explicitly scoped to `profileId` and connection `generation`. Disconnecting a secondary profile must never replace ambient transport state.

2. **PTY Session Lifecycle**:
   - Sessions run in `portable-pty`, tracked by UUID and monotonically increasing `incarnation`.
   - Reader threads broadcast stdout via `tokio::sync::broadcast` channels with bounded replay buffers.
   - Session reuse assigns a new incarnation to prevent stale hooks/reports from polluting live sessions.

3. **Workspace Resolution Precedence**:
   1. `--config` CLI flag or `DAM_HOPPER_CONFIG` env var.
   2. `--workspace` CLI flag or `DAM_HOPPER_WORKSPACE` env var.
   3. `~/.config/dam-hopper/dam-hopper.toml` global registry path.
   4. Global config default workspace (`~/.config/dam-hopper/config.toml` `defaults.workspace`).
   5. Current working directory via upward `dam-hopper.toml` discovery.
   6. Empty config fallback.

4. **Git Operations & History Integrity**:
   - History search is literal and case-insensitive server-side (`--fixed-strings`, `--regexp-ignore-case`).
   - Commit rewrites use Git object-database operations with compare-and-swap (CAS) ref publication and leased publication tied to exact expected OIDs. Never use force-push where safe rewrites are expected.
   - Squash operations require a contiguous parent chain and preserve author/tree semantics.

5. **Native Advisor**:
   - Advisor is native functionality in the Rust server; legacy plugin platform/runner is retired.
   - Admin-gated via `/api/advisor/*`. Reads `.evcrate/advisor-history` from HOME; history cursors are signed and short-lived.
   - Model selection is catalog discovery (`POST /api/advisor/models`), and routing policy is persisted atomically with SHA-256 CAS at `~/.evcrate/advisor-routing.json`.

6. **Agent Status Engine**:
   - In-memory status registry correlates PTY sessions with agent lifecycle.
   - OMP uses a local loopback WebSocket reporter with 5s heartbeat.
   - Codex and Claude use native hook ingress via protected Unix domain socket with peer-credential verification. Hook payloads admit identifiers and event metadata, never model prompts or sensitive user text.

7. **Cognito Privacy Mode**:
   - Ephemeral privacy mode (cleared on reload) activated via configured keyboard shortcut.
   - Overlays a frosted backdrop (`blur(20px) saturate(140%)`, rgba(13, 17, 23, 0.52)) with opaque fallback.
   - Implements capture-phase input isolation to guarantee key events and clicks do not leak into live terminals or editors while active.

8. **Zero-Knowledge Encrypted Uploads**:
   - Client and server negotiate via OPAQUE PAKE (`@serenity-kit/opaque`); passphrase is never transmitted.
   - Derives AES-256-GCM key; uploaded in chunks via `fs:put_*` WebSocket protocol.

---

## 6. Coding Style and Conventions

- **Formatting & Linting**: Use repository Prettier and ESLint configs (`pnpm format`, `pnpm lint`). Rust code must adhere to `cargo fmt` and `cargo clippy`.
- **TypeScript**: Strict mode enabled (`strict: true`, `verbatimModuleSyntax: true`).
- **File Naming**:
  - React components: PascalCase (e.g. `TerminalPanel.tsx`, `GitLogTree.tsx`).
  - Hooks, stores, and modules: kebab-case (e.g. `use-ports.ts`, `terminal-store.ts`).
  - Rust modules: snake_case (e.g. `fs_subsystem.rs`, `advisor_service.rs`).
- **Case Conventions**: API JSON wire payloads use `camelCase`; on-disk TOML configuration uses `snake_case`.
- **Patches Invariant**: Do not remove `patches/@radix-ui__react-compose-refs@1.1.2.patch` without proving upstream React 19 ref-identity loop resolution.

---

## 7. Testing Guidelines

- **Rust Backend**:
  - Add tests alongside modules or under `server/tests/`.
  - Use real temporary filesystems (`tempfile`) and git repositories; avoid mocks.
  - Test observable behaviors (e.g. `test_list_dir`, `test_git_squash_contiguous`).
- **UI Unit Tests**:
  - Vitest in `packages/ui` (`pnpm --filter @dam-hopper/ui test`).
  - Mock external network calls cleanly; use `QueryClientProvider` with generation-fenced fixtures.
- **Browser Regression Tests**:
  - Vitest Browser Mode with Playwright (`pnpm --filter @dam-hopper/ui test:browser`).
  - Test real browser rendering, backdrop filters, focus traps, and keyboard capture.

---

## 8. Commits, Pull Requests & Security

- **Conventional Commits**: Use conventional commits (e.g., `feat(advisor): add model selector routing`, `fix(git): protect squash ref update with cas`).
- **Pull Requests**: Detail behavioral changes, include reproducible validation commands, link associated plans, and include visual screenshots/recordings for UI changes.
- **Security**: Never commit tokens, private keys, or `.env` files. Keep production secrets out of version control.
