# DamHopper Codebase Summary

**Generated:** 2026-10-05. The repository compaction was generated with `repomix --output ./repomix-output.xml --quiet`; this summary uses that compaction and a source-tree inventory. Counts below describe application code, not every document, generated asset, or dependency file; source files are authoritative when a summary differs.

## Repository at a glance

The inventory covers approximately **1,349 code files and 416,000 lines of code**. The largest areas are the Rust server and shared React UI.

| Directory | Role and approximate inventory |
| --- | --- |
| `server/` | Rust/Axum/Tokio backend; 348 files, ~157k LOC |
| `packages/ui/` | React 19 shared application; 859 files, ~204k LOC |
| `apps/web/` | Vite single-page browser host |
| `apps/native/` | Tauri 2 host; `src-tauri` ~25.8k Rust LOC and `src` ~4.2k LOC |
| `packages/shared/` | Shared runtime utilities and sensitive-metadata-redacting logger |
| `packages/browser-bridge/` | Browser debugging runtime and version 1 protocol |
| `apps/browser-extension/` | Optional browser extension host |
| `deploy/release/` | Release archives, installers, service templates, and packaging |
| `docs/`, `plans/` | Maintained guides and historical/active planning records; not included in code LOC |

## Backend map

`server/src/lib.rs` exports the backend domains; `server/src/api/` registers HTTP, WebSocket, and REST-backed operations. `server/src/state.rs` owns shared `AppState`. Current major source areas:

| Backend subsystem | Approximate LOC |
| --- | ---: |
| `api/` | 27k |
| `linux_release/` | 20k |
| `idle_suspend/` | 19k |
| `pty/` | 12.6k |
| `git/` | 12k |
| `agent_status/` | 11.4k |
| `advisor/` | 6.5k |
| `telemetry/` | 6.3k |
| `fs/` | 6k |
| `workflow/` | 5.5k |
| `config/` | 5k |
| `auth/` | 1.4k |
| `port_forward/` | 1.2k |
| `tunnel/` | 1k |

Other backend modules cover Agent Store distribution, browser debugging, host actions, persistence, SSH, system monitoring, workspace-target resolution, and HTTP shutdown. The legacy DamHopper plugin runtime, SDK, and plugin API are retired; `server/src/plugins/` is not a current subsystem.

## Shared UI map

`packages/ui/src/` contains components, API clients and transports, profile-scoped query construction, hooks, stores, contexts, and feature domains. Approximate LOC: components 79k; `lib/` 31k; `api/` 28k; hooks 21k; Advisor 10k; stores 7.4k; contexts 2k. `apps/web/` and `apps/native/` mount this shared UI rather than maintaining separate product component trees.

## Current architecture and invariants

- **Multi-profile workbench:** Profile management is client-side; connections, transports, QueryClients, and state are scoped to `profileId` and connection generation. Server-owned project, PTY, workflow, and filesystem data remain on the owning server.
- **Git:** Ordinary publication is separate from history rewriting. Commit message rewrites and squash operate on active or inactive local branches via branch-qualified snapshots and ref compare-and-swap (CAS); active checkout, index, and untracked files are preserved during inactive rewrites. Publication uses exact expected-OID leases bound to the target or squash-receipt branch. Squash accepts only a contiguous oldest-first parent chain and preserves the final tree.
- **Native Advisor:** Rust/Axum service under `server/src/advisor/`, API under `server/src/api/advisor.rs`, and React UI under `packages/ui/src/advisor/`. `/api/advisor/*` requires a current authenticated administrator; no-auth is denied. It is per-server, default-off, reads `$HOME/.evcrate/advisor-history`, and CAS-updates routing policy at `$HOME/.evcrate/advisor-routing.json`. The legacy plugin platform is retired. See [Native Advisor architecture](./architecture/native-advisor.md).
- **Agent Status:** The in-process runtime correlates a terminal ID with PTY incarnation. OMP reports over a private loopback WebSocket with a 5-second heartbeat and 15-second lease; Codex and Claude use protected Unix-socket hook ingress with peer-credential checks. Silence and turn end do not prove task completion. See [Agent Status architecture](./architecture/agent-status.md).
- **Cognito Mode:** An ephemeral in-app mask and capture-phase input guard, not authentication, content redaction, or OS-level privacy. Current `packages/ui/src/index.css` uses a heavy-blur rule of `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)` when backdrop-filter is supported; unsupported/reduced-transparency cases use opaque black. This current source differs from the styling values recorded in the 2026-10-03 changelog entry; source is authoritative for the checked-in behavior.
- **Idle suspend:** A server coordinator uses a Unix-socket helper, systemd integration, bounded policies, and fail-closed execution checks. See [idle-suspend security](./terminal-idle-suspend-security.md).
- **Encrypted uploads:** OPAQUE PAKE password exchange and chunked AES-256-GCM writes over the WebSocket transport, bound to a captured profile/generation owner.

## Test and deployment boundaries

Rust tests live with modules and under `server/tests/`. Shared UI tests live beside modules and in `packages/ui/browser-tests/`; app-specific harnesses are in their host packages. Deployment and release code is under `deploy/release/`, with operator contracts in the [release documentation](./README.md#operations-and-release).

The top-level scripts in `package.json` define supported build, test, and check entry points. The frontend test-restructuring plan is **pending and plan-only**: Playwright application E2E restructuring is not implemented. See the [roadmap](./project-roadmap.md) for current qualification gaps.
