# DamHopper

DamHopper is a multi-profile development workbench for web and desktop. A Rust server provides project, Git, filesystem, PTY, workflow, and host services; a shared React 19 UI is hosted by Vite on the web or by a Tauri 2 desktop app.

## What it provides

- Independent server profiles and profile/generation-scoped connections, queries, terminals, files, and settings.
- Workspace IDE surfaces for project files, editor, federated search, Git history, and terminals.
- Safe Git workflows, including compare-and-swap commit rewriting and explicitly leased publication.
- Native Evcrate Advisor in the Rust server and shared UI; it is off by default, requires an authenticated administrator, and is denied in `--no-auth` mode.
- Agent status, workflow tracking, Agent Store distribution, browser debugging, and host-resource monitoring.
- Optional Linux idle suspend and encrypted file uploads. Cognito Mode is an in-app visual privacy mask, not authentication or content redaction.

## Repository map

| Path | Responsibility |
| --- | --- |
| `server/` | Rust Axum/Tokio API, PTYs, Git, filesystem, auth, Advisor, workflow, telemetry, and host services |
| `packages/ui/` | Shared React UI, state, API/transport clients, and browser tests |
| `apps/web/` | Vite browser host |
| `apps/native/` | Tauri 2 desktop host and native Rust integration |
| `packages/shared/` | Shared utilities, including sensitive-metadata redaction |
| `packages/browser-bridge/` | Browser debugging runtime and version 1 protocol |
| `deploy/release/` | Release packaging, installer, and service templates |

## Requirements

- Node.js 20 or newer and pnpm 10 or newer.
- Rust toolchain for the server and native builds; Tauri platform prerequisites are needed for desktop packaging.

## Local web development

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

> **Security:** `--no-auth` bypasses authentication and is for isolated local development only. Never expose it to a LAN, the public Internet, or an untrusted network. The server defaults to `0.0.0.0`; always pass `--host 127.0.0.1` for this workflow. The root `pnpm dev:server` and `pnpm dev:server:no-auth` scripts currently bind `0.0.0.0:4803` with `--no-auth`; do not use them on an untrusted network. Native Advisor endpoints are unavailable in this mode.

## Common commands

| Command | Action |
| --- | --- |
| `pnpm dev:native` | Run the Tauri desktop development host |
| `pnpm build` | Build the web app |
| `pnpm build:native` | Build the native desktop package |
| `pnpm build:server` | Build the Rust server in release mode |
| `pnpm test` | Run Rust server tests |
| `pnpm test:all` | Run the repository test suite script |
| `pnpm lint` | Lint `apps/` and `packages/` |
| `pnpm check` | Run the root build, native build, lint, and server test sequence |

## Documentation

Start at [the documentation index](./docs/README.md). Key references: [project requirements](./docs/project-overview-pdr.md), [system architecture](./docs/system-architecture.md), [code standards](./docs/code-standards.md), [configuration](./docs/configuration/index.md), and [API reference](./docs/api-reference.md). Deployment guides are indexed there for [Linux](./docs/linux-systemd.md) and [Windows](./docs/windows-release-packaging.md).
