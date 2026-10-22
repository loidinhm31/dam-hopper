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
| `api/` | 50 | 19,159 | Axum route handlers, WebSocket protocol, middleware, and device session endpoints |
| `idle_suspend/` | 21 | 14,358 | Automatic suspend coordinator, Netlink TCP & procfs sampling |
| `pty/` | 10 | 9,051 | PTY lifecycle, scrollback buffers, OSC 633 shell tracking |
| `agent_status/` | 14 | 9,239 | In-process agent status runtime, OMP WS, Codex/Claude hooks |
| `git/` | 15 | 9,850 | libgit2 ODB commit rewrites, leased push, conflict resolution, operation lifecycle |
| `system/` | 17 | 6,431 | Linux host metrics, cgroups v2, PSI, SSE publisher |
| `fs/` | 16 | 6,000 | Sandboxed filesystem operations, secure paths, media sessions |
| `telemetry/` | 18 | 5,786 | Loopback OTLP collector, HMAC redaction, SQLite telemetry |
| `workflow/` | 17 | 3,888 | Workflow domain engine, PTY observation, SQLite persistence |
| `persistence/` | 13 | 2,844 | SQLite session persistence, migrations 001–010, restore worker |
| `config/` | 9 | 2,749 | Multi-stage config resolution, global config, schema |
| `auth/` | 12 | 3,070 | Authentication core: MongoDB & SQLite lite mode, V2 policy, AES-256-GCM TOTP, session inventory |
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
- **Authentication & SQLite Lite Mode:** MongoDB stays the default authentication store (`MONGODB_URI` / `MONGODB_DATABASE`). Setting `DAM_HOPPER_LITE_MODE=true` (or `1`, trim/case-insensitive) selects SQLite lite mode (`DAM_HOPPER_AUTH_SQLITE_PATH`, default `auth.db` in the global config directory; one server process per local auth file, no network/shared filesystems, fatal on startup failure, and no automatic backend detection or fallback). Production authenticated mode requires a dedicated 32-byte owner-only `DAM_HOPPER_MFA_KEY_FILE`. `POST /api/auth/register` creates disabled `user` accounts (`auth_version = 0`) without automatic first-user `admin` rights (`401 ACCOUNT_DISABLED` until local operator approval and explicit `admin` promotion); `--no-auth` is a separate loopback development bypass. See [Server Environment and Authentication](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook) and [Authentication API](./api/authentication.md).
- **Git Safety:** Commit message rewrites and squashing operate on active or inactive local branches via branch-qualified snapshots and ref compare-and-swap (CAS). Publication uses exact expected-OID leases bound to the target branch (`PublishSnapshot`).
- **Tunnel Lifetime & Reminder:** Cloudflared quick tunnels remain config-isolated (`--config ""`, `--no-autoupdate`) with localhost Host rewriting and single-authority supervisor exit. Explicit forwards survive origin/PTY loss and owner replacement, preserving PID/ID/URL/start time; Stop, connector exit, and server shutdown remain terminal. A server-owned monotonic three-hour deadline retains `reminderDue` in REST and emits one `tunnel:reminder`; profile/generation-scoped shared UI provides session Dismiss/Stop, no expiry. Untracked-origin rows stay visible; replacement services on the same port remain public.
- **Settings Default Collapsed:** Settings page sections (`SettingsSectionAccordion`) default to collapsed state (`defaultOpen = false`), leaving persistent server selectors uncollapsed.
- **Agent Status:** Correlates terminal ID with PTY incarnation. OMP reports over private loopback WebSocket; Codex and Claude use protected Unix-socket hook ingress with peer-credential checks. See [Agent Status Architecture](./architecture/agent-status.md).
- **Traditional Projects + Agents:** `TraditionalTerminalProjectsDisplay` supplies a pure exact-identity roster to wide/compact `TraditionalTerminalProjectsNavigator`, which collapses it with `traditional-terminal-agent-groups` into one `traditional-terminal-agent-group-row` item per project and primary status (label + reason) carrying an agent-count badge and color-coded micro-badges (`AgentHarnessBadge`, `ProjectBadge`, `ProfileBadge`); activating an item selects its next member terminal (wrapping), through the same fenced exact-session callback. Registered profile/current generation, canonical tab/mounted membership and live incarnation gate eligibility; exact agent activation reuses existing terminal/split selection. `WorkspacePage` keeps the sole `TerminalKeepAliveHost` stable above responsive shell switches. An accessible multi-select status filter dropdown (`TraditionalTerminalAgentFilter`) filters observed agents prior to grouping with sum-of-matching badges, collision-aware compact sheet positioning, and backward-compatible `localStorage` persistence (`dam-hopper:traditional-terminal-agents-status-filter`). The display projects qualified UI metadata IDs to the builder's raw server metadata boundary without altering PTYs. `agent-store-navigation` encodes Settings owner intent; `AgentStorePage` mounts remote queries only for a registered connected owner and remounts on generation replacement. Original sidebar baseline verified via full UI suite, 28 browser tests, 2 application journeys, and human visual review; multi-select filter enhancement qualified via 130 unit, 39 integration, and 42 Chromium browser tests.
- **Cognito Mode:** Ephemeral in-browser visual screen mask and 38-event input guard using event capture. CSS uses Heavy Blur `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)`.
- **Idle Suspend:** Server coordinator uses a privileged Unix-socket helper (`dam-hopper-idle-suspend-helper`), systemd integration, bounded policies (`empty-fleet`, `agent-activity`), and sysfs RTC wakealarm checks. See [Terminal Idle-Suspend Security](./terminal-idle-suspend-security.md).
- **Encrypted Uploads:** OPAQUE PAKE password exchange and chunked AES-256-GCM writes over WebSocket transport.
- **Git Blame Caching & Commit Reveal:** Native libgit2 blame attribution (`/api/git/{project}/blame`) mapped to Monaco gutter annotations with dual-layer caching (bounded 128-entry / 64 MiB server baseline LRU cache with zero-context in-memory projection and shallow bypass, paired with bounded 64-entry / 32 MiB client TanStack Query cache), plus typed `GitCommitRevealRequest` routing to `WorkspaceGitPanel` across IDE, terminal, and compact surfaces, displaying exact commit bodies and changed files via `CommitDetailsPanel` in read-only inspect mode.
- **Git Conflict Resolver & Operation Lifecycle (Phase 08 Workspace Integration & Cutover Completed; Phase 09 Automation & Documentation Delivered; Qualification Pending):** Development progresses under [Git conflict resolver plan](../plans/261019-1505-git-conflict-resolver/plan.md). Bounded discovery (`GET /api/git/{project}/conflicts`) and snapshots (`GET /api/git/{project}/conflicts/file`) provide unmerged index inventories with pre-allocation caps, lossless line tokenization, filter qualification, and coherence verification (`REFRESH_REQUIRED`, HTTP 409). Safe resolution and staging (`POST /api/git/{project}/resolve`) enforces process-local `GitMutationCoordinator` mutual exclusion, preconditions (`fullIndexFingerprint`, `snapshotVersion`), atomic sibling-file publication, post-staging index oracle verification, and typed `ResolveOutcome`. Phase 04 delivers authoritative operation lifecycle management (`GET` / `POST /api/git/{project}/operation`) with sequencer state detection (`merge`, `rebase`, `cherry-pick`, `revert`), role labels, and non-interactive editor sentinel execution. Phase 05 delivers frontend client DTO cutover and in-memory draft stores (`ConflictDraftRegistry`), owner-scoped draft key identity, measured capacity boundaries (10 MiB total / 2 MiB per draft / 10 dirty drafts), recovery import flow on snapshot drift, and Monaco 0.55.1 Delayer promise patch (`patches/monaco-editor@0.55.1.patch`). Phase 06 adds the frontend `ConflictMergeModel` with canonical BOM-less internal representation, lossless line tokenization, Git conflict marker parsing, conservative diff3 region mapping with manual edit review downgrade, region decision actions, draft store decision-aware history with identical-text accept undo/redo, and the standalone `JointHistoryAuthority` Monaco controller. Phase 07 delivers the floating cross-shell host (`ConflictResolverPanel`), unified floating panel stacking and z-index ordering across `WorkspacePage` and `TerminalWorkspaceShell` (`floatingPanelStack` extending `TerminalFloatingPanelId` to `"files" | "tool" | "resolver"`), scoped Escape key arbitration checking topmost panel ownership and Monaco widget consumption, responsive narrow layout (768px container breakpoint) with accessible tabbed pane switching (`Theirs`, `Result`, `Ours`, `Base`), exact `region.id`-keyed navigation and actions, and public Monaco delta decorations (`buildResultDecorations`, `buildSourceDecorations`). Phase 08 completes workspace integration and cutover: `ConflictResolverPanel` mounts in `WorkspacePage` above all shell branching (`IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`); Changed Files conflict row click emits typed `ConflictRevealIntent` (`{ nonce, filePath, root }`) via `buildConflictRevealIntent`, routing directly to the dedicated resolver and bypassing editor tabs (`openChangedFileDiff` returns early on `status === "conflicted"`); multi-root/aggregate views derive actual entry root (`selection.gitRootId !== "."`); active operation banner in `ChangedFilesList` and floating conflict pill provide direct resolver entry; all staging bypasses are closed (conflict row checkboxes disabled, popovers replace stage/discard with 'Resolve conflict…', bulk stage filters conflicts, backend `stage_files` rejects conflicted batches with HTTP 400 `INVALID_INPUT` under `GitMutationCoordinator` lock, and legacy resolve payloads fail closed with HTTP 400 `LEGACY_PAYLOAD_REJECTED`); legacy `packages/ui/src/lib/conflict-parser.ts` is deleted with `ConflictBlock` removed from all production code; prominent terminal handoff banner guides configured editor commit-message editing with post-return authoritative requery; and single-consumption nonce tracking (`lastConsumedNonceRef`) prevents selection snap-back. Phase 09 delivers automation and documentation: RAII process group termination (`ProcessGroupGuard` with `-pgid` SIGKILL on Unix, best-effort `taskkill /F /T` on Windows), `tokio::spawn` request-disconnect decoupling in `execute_operation`, `RollingSentinelScanner` streaming sentinel detection across chunk boundaries, fail-closed Git metadata inspection with `Unsupported` stopped reason distinction, index stage stat cache coherence (`symlink_metadata`), multi-panel responsive layout and TopNav z-order matrix tests, and the live daemon qualification harness (`scripts/qualify-git-conflict-resolver.mjs`) passing 54/54 assertions across primary and nested repositories (linked-worktree isolation verified by integration tests). Production release remains gated pending AC12 actual Linux Tauri desktop host launch, fresh local captures, human visual review, and authoritative disposition of Cycle 2 review items (W2/W5 layout test depth, W6 deferral recording); Windows-native client qualification remains separately pending and explicitly unqualified.
- **Device Login Management:** Account-wide session inventory (`GET /api/auth/sessions`) and revocation (`DELETE /api/auth/sessions/{id}`) spanning all projects on the selected server under `Cache-Control: no-store`. Protected listing uses 50-item keyset pagination (`(issuedAt DESC, id DESC)`) with stable opaque cursor; sessions with due MFA remain visible. Revocation strictly requires an explicit Bearer token (`CredentialMechanism::Bearer`), rejecting cookie credentials with 403 `BearerRequired` before storage mutation and never emitting `Set-Cookie`. Self-revocation ends the server-side session and clears only the owning profile's credentials locally, without erasing unrelated or replacement browser cookies. Revocation immediately invalidates session-bound media capabilities (`media_tickets.revoke_by_actor_or_session`) and live WebSockets terminate via background watcher (5s interval + 2s DB timeout, close code 4401 `SESSION_REVOKED`), while active sibling sessions survive intact. Client UI (`LoginDevicesSection` in `ServerSettingsDialog`) enforces HTTPS/loopback (`credentials: "omit"`) with a revoked-draft Save guard. Bounded `userAgent` hints (<= 512 UTF-8 bytes) are supported by SQLite migration `002-session-user-agent.sql` with zero IP or fingerprint tracking; `--no-auth` returns 409 `DEVICE_SESSIONS_UNAVAILABLE`.

## Test and Deployment Boundaries

DamHopper enforces a **4-tier testing architecture** (see [Testing Guide](./testing.md)):
1. **Rust Backend Tests (`cargo test` / `pnpm test`):** Real temporary filesystems, Git ODB rewrites, CAS updates, PTYs, and API routes without synthetic mocks.
2. **Frontend Unit Tests (Vitest jsdom):** Headless unit tests under `packages/ui/src/**/*.test.{ts,tsx}`.
3. **Browser Component Regressions (Vitest Browser Mode):** Headless Chromium tests under `packages/ui/browser-tests/**/*.browser.{ts,tsx}` on ports 15173/15174.
4. **Application E2E Journeys (`@playwright/test`):** Full end-to-end browser journeys under `packages/ui/e2e/**/*.spec.ts` testing built web SPAs against production server containers (default MongoDB container or `authBackend: "sqlite"` without a MongoDB container) with deterministic auth seeding (`application_e2e_seed`).

Deployment artifacts are located in `deploy/release/` and documented in the [Installation and Deployment Guide](./deployment-guide.md).

## Codebase Compaction Snapshot

Repomix compaction artifact generated at `./repomix-output.xml` (3,080 files, 7,638,442 tokens packed, excluding dot-folders, build artifacts, lockfiles, and 6 security-flagged test/config assets; filtered packaging statistics as of 2026-10-21, distinct from the historical 2026-10-05 repository text inventory).
