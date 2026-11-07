# DamHopper

DamHopper is an AI-centered development OS web workbench (React 19 / Rust Axum). An Axum/Tokio Rust server provides project, Git, filesystem, PTY, workflow, and host services; a shared React 19 UI is hosted by Vite on the web (`apps/web`), with a companion Android client (`native/android-app`).

Both root `/` and `/os` route directly to `OsShell` via `AuthenticatedOsRoute`. Early P0 removals shipped in their own independent release (Tauri 2 desktop host `apps/native` and desktop SSH forwarding in Phase 02; usage analytics, telemetry runtime, and OTLP collector in Phase 03), and the legacy web shells (`WorkspacePage`, `DashboardPage`, `IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`, `TopNav`, `AppLayout`) were permanently removed in Phase 08 root cutover.

## What it Provides

- **AI Dev OS Web Shell (`OsShell`):** Windowed desktop operating environment with 17 registered applications (`Terminals`, `Editor`, `Browser`, `Git`, `Changes`, `Files`, `Search`, `ConflictResolver`, `SessionChanges`, `SystemMonitor`, `AgentHub`, `Recipes`, `PortsTunnels`, `AgentStore`, `Settings`, `ProjectInfo`, `WorkflowPlans`).
- **Window Management & Chrome:** Tiling + float hybrid desktop canvas (`TileTree<T>`), 4-way configurable Dock (`Dock.tsx`), TopBar with desktop switcher and context selector, WindowList popover, CommandPalette (`Ctrl+Alt+K`), MonitorTray with live CPU/memory/battery telemetry, NotificationCenter with reactive Cognito redaction, and client-side walkaway PIN lock screen (`LockScreenOverlay.tsx`).
- **Root Resource Keep-Alives & Parked Terminals:** Window transitions (tile, float, max, min, restore, desktop moves) preserve underlying DOM nodes without remounting or re-attaching via root keep-alive hosts (`TerminalKeepAliveHost`, `MonacoKeepAliveHost`, `OsBrowserKeepAliveHost`). Terminals park in the root host with zero-placement attach/replay/reset (F2 invariant). Monaco editor instances preserve dirty buffers and undo stacks.
- **Fail-Closed Terminal Lifecycle:** Terminals fail closed without ambient fallback; closing terminates root shell processes immediately. Manager-lifetime UUID epoch (`X-DamHopper-PTY-Epoch`) and atomic `POST /api/terminal/{id}/terminate` guard process termination.
- **Save Subset & Launch Recipes:** Declarative launch recipes (`RecipeV1`) with chosen server/project subset save, pre-save excluded-window preview, binary topology pruning, and Web Locks synchronization.
- **Safe Git Workflows:** Low-level Git object-database operations with compare-and-swap (CAS) commit rewriting, inactive local branch editing/squash, and explicitly leased publication.
- **Real-Time Agent Status:** Multi-agent observation engine (OMP loopback WebSocket; Codex and Claude protected Unix domain sockets with 15s evidence lease expiry), unified Agent Hub urgency classification, workflow tracking, and Agent Store distribution.
- **Independent Server Profiles & Deep Links:** State, transports, subscriptions, and TanStack Query caches explicitly scoped by `profileId` and connection `generation`. Legacy routes (`/workspace`, `/terminals`, `/ide`, `/git`, `/settings`, `/devices`, `/agent-store`) translate into qualified OS deep links via `translateLegacyRoute`.
- **Privacy & Security:** Ephemeral visual Cognito Privacy Mode, client-side PBKDF2-SHA256 PIN screen lock, encrypted file uploads via OPAQUE PAKE, and Linux terminal idle suspend with privileged RTC wake helper.
## Repository Map

| Path                       | Responsibility                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `server/`                  | Rust Axum/Tokio API, PTYs, Git, filesystem, auth, workflow, and host services                                     |
| `packages/ui/`             | Shared React UI, OS subsystem (`src/os/`), state, API/transport clients, and browser tests (canonical entry `src/embed/dam-hopper-app.tsx`) |
| `apps/web/`                | Vite browser host for `OsShell`                                                                                   |
| `apps/native/` *(retired)* | Former Tauri 2 desktop host and local SSH forwarding (removed in Phase 02)                                        |
| `packages/shared/`         | Shared utilities, including sensitive-metadata logging redaction                                                  |
| `packages/browser-bridge/` | Browser debugging runtime and version 1 protocol                                                                  |
| `deploy/release/`          | Linux systemd and Windows release packaging, installers, and service templates                                    |
## Requirements

- Node.js 22.13.0 or newer (Node.js 24 recommended) and pnpm 10 or newer for development workflows (release installations use self-contained native binaries without Node.js).
- Current stable Rust toolchain (container builder pinned to 1.97.1) for server builds.

## Port & Network Topology

| Surface                                      | Default Port | Host Address | Environment / Details                           |
| -------------------------------------------- | ------------ | ------------ | ----------------------------------------------- |
| **Standalone Server** (`dam-hopper-server`)  | `4800`       | `0.0.0.0`    | Direct binary startup (`DAM_HOPPER_PORT=4800`). |
| **Systemd API Service** (`dam-hopper-api`)   | `4801`       | `0.0.0.0`    | Production managed daemon.                      |
| **Systemd Dedicated Web** (`dam-hopper-web`) | `4802`       | `0.0.0.0`    | Production static SPA host.                     |
| **Development API**                          | `4803`       | `127.0.0.1`  | Local development target for Vite proxy.        |
| **Development Web (Vite)**                   | `5173`       | `127.0.0.1`  | Local development frontend.                     |

## Installation

DamHopper provides official pre-built release packages for Linux and Windows, as well as a standard build from source. See the comprehensive [Installation and Deployment Guide](./docs/deployment-guide.md).

- **[Linux Release Installer (x86_64 systemd)](./docs/deployment-guide.md#1-linux-release-installer-x86_64-systemd)** — Immutable release bundles with the `dam-hopper-install.sh` bootstrap installer, role-based staging (`server`, `web`, `both`), dedicated MFA key handling, and transactional activation with health stability gates.
- **[Windows Release Installer (x86_64 Direct Server)](./docs/deployment-guide.md#2-windows-release-installer-x86_64-direct-server)** — Non-admin PowerShell installer `dam-hopper-install.ps1` targeting `%LOCALAPPDATA%\Programs\dam-hopper` with User PATH integration and attestation verification.
- **[Build from Source](./docs/deployment-guide.md#3-build-from-source)** — Compile backend server and web assets using `pnpm` and `cargo`.

## Local Web Development

Install workspace dependencies:

```bash
pnpm install
```

Run the server in unauthenticated development mode on **loopback only**, then start Vite in another terminal:

```bash
cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- \
  --host 127.0.0.1 --port 4803 --no-auth \
  --cors-origins http://127.0.0.1:5173,http://localhost:5173

pnpm --filter @dam-hopper/web stage:browser-extension
pnpm --filter @dam-hopper/web exec vite --host 127.0.0.1
```

Vite proxies `/api` and `/ws` to `http://127.0.0.1:4803`. Add `--config /path/to/config.toml` to the server command when you need a specific configuration file (defaults to `~/.config/dam-hopper/config.toml`).

> **Security:** `--no-auth` bypasses authentication and is strictly for isolated local development. Never expose it to a LAN, the public Internet, or an untrusted network. The server binary defaults to `--host 0.0.0.0`; always pass `--host 127.0.0.1` for local development. The convenience scripts `pnpm dev:server` and `pnpm dev:server:no-auth` bind `0.0.0.0:4803` with `--no-auth`; do not execute them on public or untrusted networks.

### Authenticated Local Development (SQLite Default)

SQLite is the default authentication store for zero-config startup (`DAM_HOPPER_AUTH_SQLITE_PATH` defaults to `~/.config/dam-hopper/auth.db`; exactly one server process may use one local SQLite auth file, and `--no-auth` is a separate loopback bypass). MongoDB is selected automatically when both `MONGODB_URI` and `MONGODB_DATABASE` are set, or SQLite can be forced explicitly via `DAM_HOPPER_LITE_MODE=true`.

To run with authentication enabled under the **Development profile** (see [Server Environment and Authentication](docs/configuration/server-environment-auth.md#development-profile)):

1. Generate a local 32-byte MFA encryption key:
   ```bash
   mkdir -p ~/.config/dam-hopper && chmod 700 ~/.config/dam-hopper
   [ ! -f ~/.config/dam-hopper/mfa-encryption.key ] && (umask 077 && openssl rand -hex 32 > ~/.config/dam-hopper/mfa-encryption.key)
   export DAM_HOPPER_MFA_KEY_FILE=~/.config/dam-hopper/mfa-encryption.key
   ```
2. Provision the administrator account offline (prompts securely for password without echo):
   ```bash
   pnpm create-admin
   # or using the native Rust CLI:
   cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- create-admin --username admin
   ```
3. Start `dam-hopper-server` on loopback:
   ```bash
   cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port 4801
   ```
4. Log in at `http://127.0.0.1:4801/api/auth/login` or via the web UI. On first login, scan the TOTP QR code into your authenticator app and enter the 6-digit confirmation code to complete MFA setup.

## Common Commands

| Command             | Action                                                    |
| ------------------- | --------------------------------------------------------- |
| `pnpm build`        | Build the web application (`apps/web`)                    |
| `pnpm build:server` | Build the Rust server in release mode                     |
| `pnpm test`         | Run Rust server unit and integration tests                |
| `pnpm test:all`     | Run the repository test runner script across all packages |
| `pnpm lint`         | Lint code across `apps/` and `packages/`                  |
| `pnpm --filter @dam-hopper/ui build` | Run TypeScript compiler on UI package (`tsc`)             |
| `pnpm check`        | Run web build, lint, and server tests                     |

## Documentation

Start at [the documentation index](./docs/README.md). Key references:

- [Installation and Deployment Guide](./docs/deployment-guide.md)
- [Project Requirements & PDR](./docs/project-overview-pdr.md)
- [System Architecture](./docs/system-architecture.md)
- [Codebase Summary](./docs/codebase-summary.md)
- [Code Standards](./docs/code-standards.md)
- [Project Roadmap](./docs/project-roadmap.md)
- [Configuration Guide](./docs/configuration/index.md)
- [API Reference](./docs/api-reference.md)
- [Server Environment and Authentication](./docs/configuration/server-environment-auth.md)
- [Authentication API](./docs/api/authentication.md)
- [Linux Systemd Operations](./docs/linux-systemd.md)
- [Windows Release Packaging](./docs/windows-release-packaging.md)
