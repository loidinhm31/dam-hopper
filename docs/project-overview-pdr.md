# Project Overview and Product Development Requirements

**Status date:** 2026-10-05. This PDR summarizes the current product contract. Source code and the linked subsystem references define implementation details; the roadmap records remaining qualification gates.

## Product vision

DamHopper is a multi-profile development workbench for developers operating projects and development services across one or more servers. A shared React 19 workspace runs in a Vite web host and a Tauri 2 desktop host; a Rust Axum/Tokio server owns remote project, filesystem, Git, PTY, workflow, and host operations.

The workbench must make ownership explicit: a browser profile and its current connection generation determine which remote server owns requests, query state, event handlers, media capabilities, and terminal state. A failure or reconnect of one profile must not silently route work through another profile.

## Product principles

1. **Owner-scoped operation:** Asynchronous requests capture `{ profileId, generation }`; results from retired generations cannot update current state.
2. **Safe defaults:** Authentication is the normal server mode (MongoDB by default, or environment-selected SQLite lite mode via `DAM_HOPPER_LITE_MODE=true` with no automatic backend fallback); new accounts registered via `POST /api/auth/register` start disabled (`user` role, `auth_version = 0`) and require local operator approval and explicit `admin` promotion. Native Advisor is off by default and administrator-only. Development `--no-auth` is a separate loopback-only bypass and does not unlock Advisor.
3. **Conservative semantics:** A terminal going quiet or an agent turn ending is not proof that work succeeded. Unknown or stale state remains explicit.
4. **Bounded work and disclosure:** API work, uploads, histories, previews, and diagnostic output are bounded; secrets and user content are excluded from routine logs and agent-status reports.
5. **Explicit destructive intent:** History rewriting and publication are separate operations protected by snapshot checks and exact-OID leases.

## Product requirements and status
<a id="functional-requirements"></a>

| ID | Requirement area | Current status |
| --- | --- | --- |
| PR-001 | TOML project/workspace registry, path handling, and switching | Implemented; see [configuration guide](./configuration-guide.md). |
| PR-002 | PTY lifecycle, output, restart, and terminal workspace | Implemented; process lifecycle remains distinct from agent/workflow status. |
| PR-003 | Git operations, history edits, search, squash, and publication | Implemented. Rewrites and contiguous squashes operate on active and inactive local branches via captured branch/HEAD CAS; leased publication is separate, exact-OID-bound, and supports inactive target branches. |
| PR-004 | Sandboxed file explorer and IDE file operations | Implemented with bounded reads and target-aware operations. |
| PR-005 | Agent Store distribution and import | Current product functionality; not the retired plugin platform. |
| PR-006 | REST authentication, MFA, sessions, and authorization | Implemented across default MongoDB and environment-selected SQLite lite mode (`DAM_HOPPER_LITE_MODE`, `DAM_HOPPER_AUTH_SQLITE_PATH`), with mandatory production `DAM_HOPPER_MFA_KEY_FILE`, disabled-by-default registration (`401 ACCOUNT_DISABLED` until local operator approval), and operator-only `admin` promotion. See [Authentication API](./api/authentication.md), [Server Environment & Authentication](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook), and [Authentication State & Cryptography](./architecture/authentication-state-and-cryptography.md). |
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
| PR-027 | Native Evcrate Advisor | Complete native replacement. Rust/Axum service, shared React UI, admin-only access, history/policy APIs, and plugin-platform retirement are delivered. |
| PR-028 | Cognito Mode in-app privacy mask | Delivered. Ephemeral activation, configurable shortcut/style, overlay, and input isolation; it is not authentication, redaction, or OS-wide privacy. |

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

See [Git history architecture](./architecture/git-history-search.md) and [Git API reference](./api-reference.md#git-operations).

### Native Advisor

- Advisor is a native Rust service and React subtree, not a plugin, iframe, worker, or MessagePort host.
- Server setting is per-server and defaults off. Data routes require normal session authentication plus current administrator role; `--no-auth` is denied.
- History reads `$HOME/.evcrate/advisor-history`; routing policy is stored at `$HOME/.evcrate/advisor-routing.json` with revision-checked atomic update semantics.
- UI requests and caches are bound to the current profile/generation owner. Bounds, credential-field rejection, and safe model-catalog fallback remain enforced.

See [Native Advisor architecture](./architecture/native-advisor.md) and [Advisor configuration](./configuration/advisor.md).

### Agent status and privacy

- Terminal ID and PTY incarnation identify the reported lifecycle; reporter epochs and leases fence stale reporters.
- OMP uses a private loopback WebSocket. Codex/Claude hooks enter through a protected Unix socket with peer credential verification.
- No completion or success is inferred from silence, disconnect, or turn end; reports do not carry prompt text or transcripts.
- Traditional terminal navigation retains Projects and exposes a separate Agents list only for exact live open-terminal observations. Primary Working/Idle never becomes a success claim; secondary `Done (turn ended)` requires explicit fresh ended evidence and no current turn. Reconnect/retired owners remain unavailable. Agent activation selects the existing exact terminal, not the project's remembered sibling; compact dismissal restores the opener. Agent Settings carries selected-owner intent and denies disconnected/removed/invalid targets without ambient fallback. `WorkspacePage` keeps the sole `TerminalKeepAliveHost` stable across responsive shell switches. 28 Chromium browser tests and 2 authenticated application journeys passed; full-viewport human visual review accepted in [review.md](../packages/ui/e2e/traditional-terminal-agents/review.md).
- Cognito activation is ephemeral. The app overlays the rendered UI and isolates input; content remains in the app and operating-system captures are outside this feature's guarantee.
- Current Heavy Blur CSS is `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)` where supported; unsupported and reduced-transparency cases use opaque black. See `packages/ui/src/index.css` for the checked-in implementation.


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
- **Advisor access:** No-auth and non-administrator requests cannot read or
  mutate Advisor data. When disabled, history, policy, and evaluation routes
  are blocked; the documented status/settings endpoints remain available to
  authenticated administrators. Enabled data routes require that same role.
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
