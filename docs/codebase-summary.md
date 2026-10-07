# DamHopper Codebase Summary

**Inventory snapshot:** 2026-10-05 (Version 0.10.2), before documentation restructuring. Counts represent physical lines of eligible text; tests, caches, generated schemas, and lockfiles are excluded.

## Repository Inventory at a Glance

The initial scan counted **2,046 eligible text files and 411,852 physical lines of code/text**:
- **Implementation & Tooling:** 985 files, 286,268 physical LOC across `server/`, `packages/`, `apps/`, `deploy/`, `scripts/`, and `.github/workflows/`.
- **Documentation at scan time:** 78 files, 20,267 physical LOC.
- **Historical research and audit artifacts:** 964 files, 104,621 physical LOC; not current implementation evidence.

| Directory | Role | Files | Direct LOC | Recursive Files | Recursive LOC |
| --- | --- | ---: | ---: | ---: | ---: |
| `server/` | Rust Axum/Tokio API, Git, PTYs, workflow, and host services | 2 | 195 | 352 | 128,698 |
| `packages/ui/` | React 19 application, state, API/transports, components | 5 | 205 | 500 | 117,398 |
| `apps/native/` | Tauri 2 desktop host, Windows SSH forwarding, and IPC | 4 | 146 | 71 | 29,460 |
| `apps/web/` | Vite single-page browser host | 4 | 155 | 7 | 561 |
| `packages/shared/` | Runtime utilities and sensitive logging redaction | 2 | 30 | 5 | 533 |
| `packages/browser-bridge/` | Browser debugging runtime and version 1 protocol | 3 | 52 | 9 | 1,171 |
| `apps/browser-extension/` | Injected browser debug extension | 3 | 63 | 6 | 119 |
| `deploy/` | Release packaging, systemd units, and installers | 4 | 877 | 22 | 5,224 |
| `scripts/` | Test runners, qualification harnesses, and tooling | 9 | 2,154 | 9 | 2,154 |
| `.github/workflows/` | CI/CD pipelines, release publishing, quality gates | 4 | 950 | 4 | 950 |

## Backend Map

`server/src/lib.rs` exports the backend domains; `server/src/api/` registers HTTP, WebSocket, and REST-backed operations. `server/src/state.rs` owns shared `AppState`. Major backend source areas:

| Backend Subsystem | Recursive Files | Approximate LOC | Responsibility |
| --- | ---: | ---: | --- |
| `linux_release/` | 64 | 19,185 | Systemd release management, transactions, format-2 migration |
| `api/` | 50 | 19,159 | Axum route handlers, WebSocket protocol, and middleware |
| `idle_suspend/` | 21 | 14,358 | Automatic suspend coordinator, Netlink TCP & procfs sampling |
| `pty/` | 10 | 9,051 | PTY lifecycle, scrollback buffers, OSC 633 shell tracking |
| `agent_status/` | 14 | 9,239 | In-process agent status runtime, OMP WS, Codex/Claude hooks |
| `git/` | 13 | 7,984 | libgit2 ODB commit message rewrites, squashing, leased push |
| `advisor/` | 12 | 6,536 | In-process Evcrate Advisor, model introspection, CAS routing |
| `system/` | 17 | 6,431 | Linux host metrics, cgroups v2, PSI, SSE publisher |
| `fs/` | 16 | 6,000 | Sandboxed filesystem operations, secure paths, media sessions |
| `telemetry/` | 18 | 5,786 | Loopback OTLP collector, HMAC redaction, SQLite telemetry |
| `workflow/` | 17 | 3,888 | Workflow domain engine, PTY observation, SQLite persistence |
| `persistence/` | 13 | 2,844 | SQLite session persistence, migrations 001–010, restore worker |
| `config/` | 9 | 2,749 | Multi-stage config resolution, global config, schema |
| `auth/` | 12 | 3,070 | Authentication core: MongoDB & SQLite lite mode, V2 policy, AES-256-GCM TOTP |
| `port_forward/` | 5 | 1,206 | Linux `/proc/net/tcp` scanner, stdout port sniffing |
| `host_actions/` | 6 | 1,090 | Host remediation actions (currently `helperNotEnrolled`) |
| `tunnel/` | 7 | 847 | Cloudflared quick tunnels with Host rewrite |
| `web_host/` | 5 | 842 | Dedicated static SPA server (`dam-hopper-web` binary) |
| `browser_debug/` | 3 | 674 | Ephemeral debug artifact manager |

*Note:* The former DamHopper plugin platform (`dam-hopper-plugin-runner`) has been completely removed from `server/`.

## Shared UI Map

`packages/ui/` exports the shared application via `packages/ui/src/embed/dam-hopper-app.tsx` (`packages/ui/src/index.ts` does not exist).
- **Components (`packages/ui/src/components/`):** 238 files, ~53k LOC across atoms, molecules, organisms, templates, and pages.
- **API & Transports (`packages/ui/src/api/`):** 26 files, ~18.4k LOC managing ownership tuples, connection registry, WebSocket transport, React Query hooks, and SSE parser.
- **Hooks (`packages/ui/src/hooks/`):** 51 files, ~13k LOC covering Git operations, terminal managers, cognitive privacy guards, and SSE streams.
- **Core Library (`packages/ui/src/lib/`):** 120 files, ~16k LOC implementing OPAQUE PAKE, AES-256-GCM crypto, terminal registries, and diagnostics.
- **Advisor Panel (`packages/ui/src/advisor/`):** 36 files, ~9.9k LOC providing native React UI for routing policies, history, and evaluations.
- **State Stores (`packages/ui/src/stores/`):** 11 files, ~4k LOC managing editor tabs, explorer expansion, Git history selection, and privacy mode.
- **Design Guidelines:** Defined in `packages/ui/src/index.css` and `docs/frontend-components/platform-integrations.md` (JetBrains Mono, dark slate palette, Radix UI primitives with `@radix-ui/react-compose-refs` React 19 patch).

## Workflow Tracking

The workflow tracking subsystem (`server/src/workflow/` and `docs/workflow-api.md`) provides durable task tracking across development sessions:
- **Persistence:** Backed by SQLite (`~/.config/dam-hopper/sessions.db`) via migration `010_workflow_tracking.sql`.
- **Hierarchy:** 3-tier structure: Plan -> Phase -> Task.
- **PTY Lifecycle Correlation:** Non-blocking PTY session observation via bounded channel (`sync_channel(256)`).
- **Retention:** Events expire after a fixed 90 days (`DEFAULT_EVENT_RETENTION_DAYS = 90`); the validated event-retention setting is not wired into insertion. Soft-deleted note retention is configurable through `server.workflow_deleted_note_retention_days`, defaulting to 7 days.

## Current Architecture and Invariants

- **Multi-Profile Workbench:** Profile management is client-side; connections, transports, QueryClients, and state are scoped to `profileId` and connection generation. Server-owned project, PTY, workflow, and filesystem data remain on the owning server.
- **Git Safety:** Commit message rewrites and squashing operate on active or inactive local branches via branch-qualified snapshots and ref compare-and-swap (CAS). Publication uses exact expected-OID leases bound to the target branch (`PublishSnapshot`).
- **Tunnel Isolation & Supervisor Exit:** Ephemeral Cloudflared quick tunnels are isolated via `--config ""` and `--no-autoupdate`, rewrite forwarded dev-server host headers (`--http-host-header localhost`), and enforce a single-authority supervisor exit lifecycle where `child.wait()` is the sole authority for exit notifications.
- **Settings Default Collapsed:** Settings page sections (`SettingsSectionAccordion`) default to collapsed state (`defaultOpen = false`), leaving persistent server selectors uncollapsed.
- **Native Advisor:** In-process Rust/Axum service under `server/src/advisor/` and native React UI under `packages/ui/src/advisor/`. Requires authenticated administrator; `--no-auth` is denied. Atomic CAS updates to `$HOME/.evcrate/advisor-routing.json`. See [Native Advisor Architecture](./architecture/native-advisor.md).
- **Agent Status:** Correlates terminal ID with PTY incarnation. OMP reports over private loopback WebSocket; Codex and Claude use protected Unix-socket hook ingress with peer-credential checks. See [Agent Status Architecture](./architecture/agent-status.md).
- **Cognito Mode:** Ephemeral in-browser visual screen mask and 38-event input guard using event capture. CSS uses Heavy Blur `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)`.
- **Idle Suspend:** Server coordinator uses a privileged Unix-socket helper (`dam-hopper-idle-suspend-helper`), systemd integration, bounded policies (`empty-fleet`, `agent-activity`), and sysfs RTC wakealarm checks. See [Terminal Idle-Suspend Security](./terminal-idle-suspend-security.md).
- **Encrypted Uploads:** OPAQUE PAKE password exchange and chunked AES-256-GCM writes over WebSocket transport.
- **Git Blame & Commit Reveal:** Native libgit2 blame attribution (`/api/git/{project}/blame`) mapped to Monaco gutter annotations, with typed `GitCommitRevealRequest` routing to `WorkspaceGitPanel` across IDE, terminal, and compact surfaces, displaying exact commit bodies and changed files via `CommitDetailsPanel` in read-only inspect mode.

## Test and Deployment Boundaries

DamHopper enforces a **4-tier testing architecture** (see [Testing Guide](./testing.md)):
1. **Rust Backend Tests (`cargo test` / `pnpm test`):** Real temporary filesystems, Git ODB rewrites, CAS updates, PTYs, and API routes without synthetic mocks.
2. **Frontend Unit Tests (Vitest jsdom):** Headless unit tests under `packages/ui/src/**/*.test.{ts,tsx}`.
3. **Browser Component Regressions (Vitest Browser Mode):** Headless Chromium tests under `packages/ui/browser-tests/**/*.browser.{ts,tsx}` on ports 15173/15174.
4. **Application E2E Journeys (`@playwright/test`):** Full end-to-end browser journeys under `packages/ui/e2e/**/*.spec.ts` testing built web SPAs against production server containers with deterministic auth seeding (`application_e2e_seed`).

Deployment artifacts are located in `deploy/release/` and documented in the [Installation and Deployment Guide](./deployment-guide.md).
