# DamHopper

DamHopper is a multi-profile development workbench for web and desktop. An Axum/Tokio Rust server provides project, Git, filesystem, PTY, workflow, and host services; a shared React 19 UI is hosted by Vite on the web or by a Tauri 2 desktop app.

## What it Provides

- Independent server profiles and profile/generation-scoped connections, queries, terminals, files, and settings.
- Workspace IDE surfaces for project files, Monaco editor, federated search, Git history, and terminal panes.
- Safe Git workflows, including compare-and-swap commit rewriting, inactive local branch editing/squash, and explicitly leased publication.
- In-process Native Evcrate Advisor in the Rust server and shared UI; disabled by default, requires an authenticated administrator, and is denied in `--no-auth` mode.
- Real-time agent status (OMP loopback WebSocket; Codex and Claude protected Unix sockets), workflow tracking, Agent Store distribution, browser debugging, and host-resource monitoring.
- Optional Linux terminal idle suspend with privileged RTC wake helper, and encrypted file uploads via OPAQUE PAKE. Cognito Mode is an in-browser visual privacy mask, not authentication or content redaction.
- Native desktop local SSH port forwarding (supported strictly on Windows desktop; non-Windows native desktop enforces exact same-origin profile URLs).

## Repository Map

| Path | Responsibility |
| --- | --- |
| `server/` | Rust Axum/Tokio API, PTYs, Git, filesystem, auth, Advisor, workflow, telemetry, and host services |
| `packages/ui/` | Shared React UI, state, API/transport clients, and browser tests (canonical entry `src/embed/dam-hopper-app.tsx`) |
| `apps/web/` | Vite browser host |
| `apps/native/` | Tauri 2 desktop host and Windows-native SSH port forwarding |
| `packages/shared/` | Shared utilities, including sensitive-metadata logging redaction |
| `packages/browser-bridge/` | Browser debugging runtime and version 1 protocol |
| `deploy/release/` | Linux systemd and Windows release packaging, installers, and service templates |

## Requirements

- Node.js 20 or newer and pnpm 10 or newer.
- Current stable Rust toolchain (container builder pinned to 1.97.1) for server and native builds; platform development headers (`libwebkit2gtk-4.1-dev` on Linux) are needed for native desktop builds.

## Port & Network Topology

| Surface | Default Port | Host Address | Environment / Details |
| --- | --- | --- | --- |
| **Standalone Server** (`dam-hopper-server`) | `4800` | `0.0.0.0` | Direct binary startup (`DAM_HOPPER_PORT=4800`). |
| **Systemd API Service** (`dam-hopper-api`) | `4801` | `0.0.0.0` | Production managed daemon. |
| **Systemd Dedicated Web** (`dam-hopper-web`) | `4802` | `0.0.0.0` | Production static SPA host. |
| **Development API** | `4803` | `127.0.0.1` | Local development target for Vite proxy. |
| **Development Web (Vite)** | `5173` | `127.0.0.1` | Local development frontend. |

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

Vite proxies `/api` and `/ws` to `http://127.0.0.1:4803`. Add `--config /path/to/dam-hopper.toml` to the server command when you need a specific project registry.

> **Security:** `--no-auth` bypasses authentication and is strictly for isolated local development. Never expose it to a LAN, the public Internet, or an untrusted network. The server binary defaults to `--host 0.0.0.0`; always pass `--host 127.0.0.1` for local development. The convenience scripts `pnpm dev:server` and `pnpm dev:server:no-auth` bind `0.0.0.0:4803` with `--no-auth`; do not execute them on public or untrusted networks. Native Advisor endpoints are unavailable in `--no-auth` mode.

### Authenticated Local Development (SQLite Lite Mode)

MongoDB is the default authentication store, while setting `DAM_HOPPER_LITE_MODE=true` (or `1`, case-insensitive) selects SQLite lite mode (`DAM_HOPPER_AUTH_SQLITE_PATH` defaults to `~/.config/dam-hopper/auth.db`; exactly one server process may use one local SQLite auth file, and `--no-auth` is a separate loopback bypass, never lite mode).

To provision a first account under the **Development profile**:
1. Start `dam-hopper-server` on loopback (for example `--host 127.0.0.1 --port 4801` with `DAM_HOPPER_LITE_MODE=true`).
2. Register via `POST http://127.0.0.1:4801/api/auth/register` with JSON `{ "username", "password" }`. It returns `{ "ok": true }` and creates a disabled `user` account (`auth_version = 0`) without automatic first-user `admin` rights; login returns `401 ACCOUNT_DISABLED` until approved.
3. Follow the canonical **Development profile** SQLite inspection, approval, and `admin` promotion sequence in [Server Environment and Authentication](./docs/configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook), then log in to receive `enrollmentRequired` and complete TOTP MFA via the [Authentication API](./docs/api/authentication.md).

## Common Commands

| Command | Action |
| --- | --- |
| `pnpm dev:native` | Run the Tauri desktop development host |
| `pnpm build` | Build the web application (`apps/web`) |
| `pnpm build:native` | Build native desktop package (Linux deb/rpm) |
| `pnpm build:server` | Build the Rust server in release mode |
| `pnpm test` | Run Rust server unit and integration tests |
| `pnpm test:all` | Run the repository test runner script across all packages |
| `pnpm lint` | Lint code across `apps/` and `packages/` |
| `pnpm check` | Run web build, native build, lint, and server tests |

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
