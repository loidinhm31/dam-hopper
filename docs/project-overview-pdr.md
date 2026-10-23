# Project Overview and Product Development Requirements

**Status date:** 2026-10-22. This PDR summarizes the current product contract. Source code and the linked subsystem references define implementation details; the roadmap records remaining qualification gates.

## Product vision

DamHopper is a multi-profile development workbench for developers operating projects and development services across one or more servers. A shared React 19 workspace runs in a Vite web host and a Tauri 2 desktop host; a Rust Axum/Tokio server owns remote project, filesystem, Git, PTY, workflow, and host operations.

The workbench must make ownership explicit: a browser profile and its current connection generation determine which remote server owns requests, query state, event handlers, media capabilities, and terminal state. A failure or reconnect of one profile must not silently route work through another profile.

## Product principles

1. **Owner-scoped operation:** Asynchronous requests capture `{ profileId, generation }`; results from retired generations cannot update current state.
2. **Safe defaults:** Authentication is the normal server mode (MongoDB by default, or environment-selected SQLite lite mode via `DAM_HOPPER_LITE_MODE=true` with no automatic backend fallback); new accounts registered via `POST /api/auth/register` start disabled (`user` role, `auth_version = 0`) and require local operator approval and explicit `admin` promotion. Development `--no-auth` is a separate loopback-only bypass.
3. **Conservative semantics:** A terminal going quiet or an agent turn ending is not proof that work succeeded. Unknown or stale state remains explicit.
4. **Bounded work and disclosure:** API work, uploads, histories, previews, and diagnostic output are bounded; secrets and user content are excluded from routine logs and agent-status reports.
5. **Explicit destructive intent:** History rewriting and publication are separate operations protected by snapshot checks and exact-OID leases.

## Product requirements and status
<a id="functional-requirements"></a>

| ID | Requirement area | Current status |
| --- | --- | --- |
| PR-001 | TOML project/workspace registry, path handling, and switching | Implemented; see [configuration guide](./configuration-guide.md). |
| PR-002 | PTY lifecycle, output, restart, and terminal workspace | Implemented; process lifecycle remains distinct from agent/workflow status. |
| PR-003 | Git operations, history edits, search, squash, publication, and conflict discovery | Implemented. Rewrites and contiguous squashes operate on active and inactive local branches via captured branch/HEAD CAS; leased publication is separate and exact-OID-bound; conflict discovery provides bounded unmerged index summaries and on-demand snapshots with before/after state coherence checks and fail-closed legacy resolution guards; floating Monaco resolution surface delivered with responsive narrow mode, unified stacking, and scoped Escape arbitration. Workspace integration and cutover (Phase 08) delivered with reveal intent routing, aggregate root derivation, and stage bypass closures. Production qualification (Phase 09) remains open. |
| PR-004 | Sandboxed file explorer and IDE file operations | Implemented with bounded reads and target-aware operations. |
| PR-005 | Agent Store distribution and import | Current product functionality; not the retired plugin platform. |
| PR-006 | REST authentication, MFA, sessions, and authorization | Implemented across default MongoDB and environment-selected SQLite lite mode (`DAM_HOPPER_LITE_MODE`, `DAM_HOPPER_AUTH_SQLITE_PATH`), with mandatory production `DAM_HOPPER_MFA_KEY_FILE`, disabled-by-default registration (`401 ACCOUNT_DISABLED` until local operator approval), and operator-only `admin` promotion. Includes session inventory and device login management (`GET /api/auth/sessions` with cookie or bearer auth, `DELETE /api/auth/sessions/{id}` with Bearer-only mutation, zero `Set-Cookie` on revocation responses, and exact-session media capability invalidation), bounded user-agent hints, and saved-profile UI with self-revocation draft protection. Automated test suites and live runtime cutoffs qualified; human visual review pending in `packages/ui/e2e/device-login-management/review.md`. See [Authentication API](./api/authentication.md), [Server Environment & Authentication](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook), and [Authentication State & Cryptography](./architecture/authentication-state-and-cryptography.md). |
| PR-007 | Multi-server profile workbench | Implemented. Each connection and client state is profile/generation scoped. |
| PR-007A | Profile-qualified files, editor, search, and Git | Implemented; [Workbench Files, Editor, Search, and Git Architecture](./architecture/workbench-files-editor-and-git.md). |
| PR-007B | Native profile scope and platform integration | Linux-focused implementation complete; Windows native S13 runtime qualification remains separate. |
| PR-007C | Unified-profile integration qualification | Web/Linux shared qualification recorded; platform-specific native qualification is tracked separately. |
| PR-008 | Shared runtime logging utilities | Implemented; sensitive metadata redaction is required. |
| PR-009 | Host-resource monitoring and presentation | Core monitoring/presentation delivered. SSE target-host, deployed-proxy, browser, and soak qualification remain open; see [SSE architecture](./architecture/host-resource-sse.md). |
| PR-010 | Browser debugging and native child WebView | Platform-qualified only where documented; Linux child/relay runtime remains unverified. See [Browser Debug guide](./native-browser-debug-support.md). |
| PR-011–014 | <a id="workflow-persistence-service-correlation"></a><a id="pr-013-terminal-lifecycle-correlation-and-agent-adapter"></a>Workflow persistence, service/API, lifecycle correlation, and UI state | Implemented; see [Workflow API](./workflow-api.md) and [client state](./workflow-client-state.md). |
| PR-015–018 | Idle suspend, manual force sleep, agent-activity policy, and diagnostics | Implemented with bounded helper and fail-closed checks; real-host operational rollout remains an operator gate. |
| PR-019–021 | Multi-profile terminal, Agent/port/Browser, preferences/settings/usage/host features | Implemented; owner scoping and native platform qualifications apply. |
| PR-022–025 | Former trusted plugin platform and plugin runner/API/management | **Retired.** Do not implement or depend on the old SDK, runner, plugin APIs, or host bridges. See [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md). |
| PR-026 | Agent Status and notification ownership | Implemented and Linux-qualified for the documented OMP/Codex/Claude versions; other versions/platforms remain unqualified. |
| PR-028 | Cognito Mode in-app privacy mask | Delivered. Ephemeral activation, configurable shortcut/style, overlay, and input isolation; it is not authentication, redaction, or OS-wide privacy. |
| PR-029 | TypeScript/JavaScript LSP Semantic Navigation | Feasibility spike (Phase 01), stdio child owner and framing (Phase 02), pinned tool provisioning with resource controls (Phase 03), semantic session supervisor (Phase 04), authenticated WebSocket gateway (Phase 05), and admin-only global hot toggle with config protection (Phase 06) administratively complete under approved exceptions; release qualification pending. Implemented: immutable bundled layout (`lib/semantic-engine`), passive zero-child integrity verification, centralized `ResourcePolicy` constants, Linux child-only cgroups attachment in pre-exec with honest `PortableOnly` degradation, SPDX 2.3 SBOM generation, AppState-owned supervisor, isolated per-connection session actors, authoritative SessionOverlayMap with UTF-16 offset translation and 64 KiB adaptive threshold, bounded crash restart with document replay, process group tree reaping, dedicated `/ws/semantic/v1` gateway with cancellation-first live auth, server-global hot toggle (`GET`/`PATCH /api/semantic/settings`) requiring fresh current-admin authorization and rejecting `--no-auth`, passive zero-child ON vs cancellation-first complete-tree OFF teardown, raw config mutation protection, and shared React Settings UI. Monaco client integration (Phase 07) and G8 web provider coexistence qualification (Phase 10) follow. See [LSP Plan](../plans/260901-1000-lsp-server-integration/plan.md). |

## Acceptance criteria for critical behavior

### Profiles and ownership

- A profile owns an independent connection runtime; operations carry the captured connection generation.
- Equal project, terminal, or resource identifiers on different profiles remain distinct.
- Disconnected, unsupported, missing, or stale owners fail closed; code does not silently fall back to an ambient or first-connected transport.
- Queries, subscriptions, cleanup, and late asynchronous results are isolated by owner and generation.

### Git safety

- Normal push remains fast-forward-only. Rewriting local commits does not publish automatically.
- Message rewrites and contiguous squashes compare the captured branch and HEAD before updating refs.
- Inactive branch rewrites lock the target branch ref while ensuring active HEAD, worktree, index, and untracked files remain untouched.
- Squash accepts a unique, contiguous, oldest-first parent chain reaching the captured branch tip; unsafe merges/ranges and stale snapshots are rejected.
- Publication after a rewrite is explicit and leased against the exact expected remote OID with target branch support. Preserve the final tree and require consent when signatures are invalidated.
- History search uses literal matching and does not alter repository state.
- Conflict discovery returns bounded unmerged index summaries without reading blob content; snapshots enforce pre-allocation byte bounds before allocating blob memory (5 MiB per stage, 15 MiB aggregate across stages 1/2/3) and worktree read bounds (5 MiB), enforce bounded line tokenization (50,000 lines, 100,000 bytes line length), and verify before/after coherence (failing with HTTP 409 REFRESH_REQUIRED on detected state drift). Legacy resolve payloads fail closed with HTTP 400. Floating conflict resolver surface mounts above workspace shells with unified panel stacking, Monaco widgets consuming Escape before panel dismissal, responsive narrow tabbed mode, and draft text/decisions retained in memory by DraftKey across show/hide. Workspace integration delivers reveal intent routing from Changed Files without opening editor tabs, derived worktree roots in aggregate views, active operation banner entry, closed staging bypasses across checkboxes/menus/bulk/backend (CUT1), retired legacy parser (CUT2), configured-editor terminal handoff guidance, and selection nonce stability during component mount (Phase 09 qualification gates remain pending).

See [Git history architecture](./architecture/git-history-search.md) and [Git API reference](./api-reference.md#git-operations).

### Agent status and privacy

- Terminal ID and PTY incarnation identify the reported lifecycle; reporter epochs and leases fence stale reporters.
- OMP uses a private loopback WebSocket. Codex/Claude hooks enter through a protected Unix socket with peer credential verification.
- No completion or success is inferred from silence, disconnect, or turn end; reports do not carry prompt text or transcripts.
- Traditional terminal navigation retains Projects and exposes a separate Agents list only for exact live open-terminal observations. Primary Working/Idle never becomes a success claim; secondary `Done (turn ended)` requires explicit fresh ended evidence and no current turn. Reconnect/retired owners remain unavailable. Agent activation selects the existing exact terminal, not the project's remembered sibling; compact dismissal restores the opener. Status filtering supports accessible multi-selection across seven presentation statuses plus an `"all"` sentinel with sum-of-matching tallies, collision-aware compact sheet positioning, and backward-compatible `localStorage` persistence (qualified via 130 unit, 39 integration, and 42 Chromium browser tests; see `plans/reports/tester-261014-0125-multi-select-agent-status-filter.md`). Agent Settings carries selected-owner intent and denies disconnected/removed/invalid targets without ambient fallback. `WorkspacePage` keeps the sole `TerminalKeepAliveHost` stable across responsive shell switches. Original sidebar baseline verified via 28 Chromium browser tests, 2 authenticated application journeys, and full-viewport human visual review accepted in [review.md](../packages/ui/e2e/traditional-terminal-agents/review.md).
- Cognito activation is ephemeral. The app overlays the rendered UI and isolates input; content remains in the app and operating-system captures are outside this feature's guarantee.
- Current Heavy Blur CSS is `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)` where supported; unsupported and reduced-transparency cases use opaque black. See `packages/ui/src/index.css` for the checked-in implementation.


### Semantic code navigation

- **Engine provenance and immutability:** Pinned offline tuple (Node.js v24.16.0, TypeScript 5.9.3, TSLS 6.0.2 under `/opt/dam-hopper/lib/semantic-engine/`). Absolutely no `PATH` lookup or project-local `node_modules` fallback.
- **Transport and lazy boundary:** Transport-only client pairing (`vscode-ws-jsonrpc@3.5.0` + `vscode-jsonrpc@8.2.1`). Initial application bundle delta must be 0 bytes; Monaco lazy chunk impact must remain below the 50 KiB gzip delta ceiling (baseline measured at +14.2 KiB gzip).
- **Synchronization and fresh coordinates:** Single negotiated `Incremental = 2` sync kind; range-less full update below 64 KiB, ranged edits at/above 64 KiB. UTF-16 character coordinate alignment preserved across non-BMP astral characters on the same line.
- **Freshness fencing:** Gateway version fence (`damHopperDocumentVersion`, `damHopperModelGeneration`) discards stale responses; FIFO stdio ordering preserves sequence.
- **Hostile loading suppression:** Pinned supervisor settings force `plugins: []` and `disableAutomaticTypingAcquisition: true` with stripped `NODE_OPTIONS`/`NODE_PATH` and absolute `--tsserver-path`, suppressing repository tsconfig plugins, local decoys, and ATA queries.
- **Process tree lifecycle and reaping:** Child process group isolation (`Command::process_group(0)`); two-phase termination (graceful RPC then `SIGTERM` -> `SIGKILL` to PGID); dedicated child reaper task (`Child::wait`) reaps the direct child process group leader, preventing zombie `<defunct>` accumulation.
- **Passive zero-child integrity verification:** Spawns zero child processes (`node`, `npm`, shell never invoked). Inspects regular-file status via `symlink_metadata`, strictly rejects symlinks, validates permission bits (mode 0755 for Node, no group/world-writable files), and verifies SHA-256 digests against hardcoded `PinnedDigests`. Passive integrity check is strictly decoupled from executable protocol qualification.
- **Centralized resource policy constants:** Finite production constants centralized in `ResourcePolicy` (version 1.0.0): 8 KiB header cap, 4 MiB frame/body cap, 32 queued messages, 4 MiB queue bytes, 64 KiB stderr buffer, 64 KiB adaptive sync boundary, 1 MiB document cap, 16 open documents, 4 MiB session / 8 MiB global overlay caps, 2 global trees, 8 processes per tree, 40 msg/s (burst 80), 30s startup / 10s nav / 60s idle timeouts, and 2s graceful / 3s forced reap (5s total) teardown budget.
- **Linux child-only cgroups attachment & honest degradation:** Configures cgroups v2 (`memory.max = 768 MiB`, `cpu.max = 50000 100000`, `pids.max = 64`) strictly for the child subcgroup (`dam-hopper-semantic-<session_id>`); attaches child via `cgroup.procs` in `pre_exec` before TSLS executes. Never alters API daemon cgroup. If cgroup v2, delegation, or controllers are absent, cleans partial directories and degrades honestly to `PortableOnly` (`degraded: true`, V8 256 MiB hint, 8-process tree limit) without panic or false RSS containment assertions.
- **SPDX 2.3 SBOM and provenance:** Linux release packaging generates `dam-hopper-<tag>.spdx.json` describing `dam-hopper`, `typescript`, `typescript-language-server`, and `nodejs` with `CONTAINS` relationships, SHA-256 digests, and per-file licenses (`Apache-2.0` / `MIT`) backed by `provenance.json`.
- **Session supervision and authoritative overlays:** AppState-owned `SemanticSupervisor` (default-OFF, off-thread cached SHA-256 integrity verification, 2 global trees / 1 per-connection / 8 MiB global overlay admission limits); isolated `SemanticSessionActor` per connection and target; in-memory authoritative `SessionOverlayMap` with UTF-16 code unit offset translation, speculative atomic multi-change batch editing, 64 KiB adaptive wire sync (full replacement below threshold, original change batch at or above), sliding-window crash restart (2 in 60s) with best-effort document replay, and process group teardown with SIGTERM->SIGKILL escalation (shutdown init bounds and reap-error status surfacing tracked for Phase 05 hardening).
- **Authenticated WebSocket gateway isolation (Phase 05):** Dedicated `/ws/semantic/v1` route requiring subprotocol `dam-hopper.semantic.lsp.v1`, Origin allowlist parity, cancellation-first live auth watcher (5s poll, 2s DB bound) terminating admission and reaping child trees before socket close, token-bucket rate limiting (40/80 msg/s), 4 MiB frame bounds, filtered JSON-RPC 2.0 lifecycle profile, bidirectional virtual URI grammar (`dam-hopper://semantic/<target-id>/<encoded-path>`), canonical containment, and `outsideTarget: true` filtering.
- **Admin-only server-global hot toggle & config protection (Phase 06):**
  - Dedicated endpoints: `GET /api/semantic/settings` (safe inspection of configured intent, runtime admission, integrity status, tuple ID, resource capability, and caller authority) and `PATCH /api/semantic/settings` (`{ enabled: bool }` hot toggle without daemon restart).
  - Strict global schema: `GlobalConfig.semantic.enabled` (default `false`) with `deny_unknown_fields`. Rejection of custom executables, command args, environment, paths, or shadow workspace/project configurations.
  - Fresh current-admin authorization: `evaluate_current_admin` evaluates `AuthService.evaluate_claims` within a bounded 2s store timeout immediately preceding mutation and re-checks before commit. `--no-auth` and non-admin dev/user accounts are strictly rejected with stable 403; demotions fail closed.
  - Passive zero-child ON vs cancellation-first complete-tree cleanup on OFF: ON validates toolchain integrity passively with zero child processes; OFF drains sessions and reaps process groups under teardown budgets. If teardown fails, failed handles are retained, safe-disabled state is recorded with transition error, and durable false intent is withheld.
  - Canonical config file protection: guarded against direct modification/upload/rename/delete across raw FS mutation sinks (`fs::ops::atomic_write_with_check`, `atomic_persist_with_check`, `fs::secure_path::persist_temp`, `persist_temp_sync`, `write_bytes`, `fs::mutate::assert_safe_mutation`, and WebSocket chunked upload) and workspace import/replace.
  - Settings UI presentation: `SettingsSemanticNavigationSection` under `SettingsPage` with an actionable toggle and pending lockout for admins, read-only status for non-admin/dev sessions, advisory portable mode warning when Linux cgroup v2 controllers are missing, and a prominent configuration/runtime mismatch alert.
- **Model-scoped provider coexistence (G8):** Coexistence between Monaco's built-in TypeScript service and DamHopper's LSP provider must be proven in a live browser DOM environment during Phase 07 and qualified in Phase 10 without global disabling collateral.

### Testing architecture

- Quality gates enforce a **4-tier testing architecture** with strict execution boundaries:
  1. Rust backend unit and integration tests (`cargo test`).
  2. Frontend unit tests under jsdom (Vitest).
  3. Real-browser component regression suites under Chromium (Vitest Browser Mode, ports 15173/15174).
  4. Application E2E user journeys (`@playwright/test`) testing built SPAs against containerized production servers with default MongoDB containers or isolated SQLite lite mode (`authBackend: "sqlite"`, starting no MongoDB container).
- Application E2E journeys enforce deterministic auth seeding via `application_e2e_seed` (for both MongoDB and SQLite) and browser context `storageState`.
- Visual evidence capture is governed by `capture-policy.ts` (full-viewport captures, PNG IHDR validation, colocated metadata, and human review governance in `review.md`).

See the [Testing guide](./testing.md).
## Success measures

These are pass/fail acceptance measures, not a claim that the release is
qualified on every platform:

- **Owner isolation:** Two-server scenarios produce no cross-profile query,
  transport, event, or cleanup effects; stale connection generations cannot
  publish results into a replacement runtime.
- **Git safety:** A stale branch/HEAD snapshot cannot update local refs, and a
  remote update after preview cannot pass the exact expected-OID lease.
- **Disclosure control:** Agent-status reports and routine logs contain no
  prompts, transcript content, or authentication material.
- **Qualification claims:** A release claim is limited to recorded OS, browser,
  proxy, and provider evidence; unqualified combinations remain identified as
  open gates.

## Non-functional requirements

- **Security:** Validate identities and authorization on the server; never trust a client profile ID as server authority. Protect credentials, auth/session secrets, and file capabilities. Use exact-origin CORS and deployment TLS/trusted-network controls.
- **Reliability:** Retire or replace profile-scoped resources with their owner runtime; stale callbacks and responses must not overwrite a newer generation.
- **Performance:** Apply explicit limits to request bodies, pages, scans, previews, queues, and retained diagnostics. Keep blocking filesystem/process work outside hot locks and UI input paths.
- **Compatibility:** Preserve the existing REST/WebSocket contracts and serialized casing unless an intentional API change is documented.
- **Accessibility:** Interactive UI must preserve keyboard access, focus behavior, and explicit unavailable/unknown states.
- **Qualification:** Distinguish unit/integration evidence from live browser, deployment, and platform qualification. Do not claim a host or platform is qualified without recorded evidence.

## Maintenance references

- [System architecture](./system-architecture.md)
- [Code standards](./code-standards.md)
- [Testing guide](./testing.md)
- [Project roadmap](./project-roadmap.md)
- [Changelog](./CHANGELOG.md)
