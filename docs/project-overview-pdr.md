# Project Overview and Product Development Requirements

**Status date:** 2026-10-05. This PDR summarizes the current product contract. Source code and the linked subsystem references define implementation details; the roadmap records remaining qualification gates.

## Product vision

DamHopper is a multi-profile development workbench for developers operating projects and development services across one or more servers. A shared React 19 workspace runs in a Vite web host and a Tauri 2 desktop host; a Rust Axum/Tokio server owns remote project, filesystem, Git, PTY, workflow, and host operations. An Android-native client (`native-app/`) using Kotlin Multiplatform and Jetpack Compose is planned to connect to the same remote Rust server.

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
| PR-028 | Cognito Mode in-app privacy mask | Delivered. Ephemeral activation, configurable shortcut/style, overlay, and input isolation; it is not authentication, redaction, or OS-wide privacy. |
| PR-029 | Android Native Client (`native-app`) | Kotlin Multiplatform + Jetpack Compose client connecting to existing Rust backend; strictly TERMINAL Traditional shell with top panel row (12 panels) and zero floating buttons; native Markdown, media, and binary files included, with embedded interactive HTML preview and rendered Mermaid diagrams as sole deferred preview exceptions. Phases 01–04 delivered foundation, live transport, profiles, and Keystore vault. Phase 05 established GATE-B contract/host prototypes (Android runtime feasibility and hardware execution unproven). Phases 06–08 delivered shell navigation, remote config, terminal sessions, replay gate, agent status, and filesystem watchers/search/replace. Phase 09 delivered file tier policies, safe saves with CAS mtime protection, and multi-tab state. Phase 10 delivered native diff review, 3-way merge conflict resolution, and Git blame LRU caching. Phase 11 delivered encrypted transfer state machines, OPAQUE crypto session/envelope scaffolding, Android SAF storage interfaces, and media player components with documented limitations. Phase 12 implementation baseline recorded (score 6/10, changes requested / not accepted; user approved baseline with documented open limitations: branch checkout scope sync, details dialog file-action invalidation, query parameter full encoding, disposable repo evidence open). Phase 13 delivered workflow tracking and 64 KiB bounded project plans. Phase 14 delivered Agent Store, imports, and memory management (score 7/10). Phase 15 delivered host resources fleet streaming and aggregate usage analytics (score 7/10). Phase 16 delivered ports, Cloudflared tunnels, idle consent, remote SSH, and diagnostics (score 7/10, changes required / qualification open). Phase 17 implementation baseline recorded for preferences synchronization, 3-layer ephemeral privacy input gating, notification sink with lock-screen redaction, lifecycle coordination, and Settings panel UI (score 6/10, changes requested / qualification open; documented limitations: inert preferences, test-only notification producer, partial streaming pause, clipboard import/export; live qualification deferred to Phase 18). See [Acceptance Ledger](./android-native-acceptance.md) and [Native Client Architecture](./architecture/android-native-client.md). |

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

### Agent status and privacy

- Terminal ID and PTY incarnation identify the reported lifecycle; reporter epochs and leases fence stale reporters.
- OMP uses a private loopback WebSocket. Codex/Claude hooks enter through a protected Unix socket with peer credential verification.
- No completion or success is inferred from silence, disconnect, or turn end; reports do not carry prompt text or transcripts.
- Traditional terminal navigation retains Projects and exposes a separate Agents list only for exact live open-terminal observations. Primary Working/Idle never becomes a success claim; secondary `Done (turn ended)` requires explicit fresh ended evidence and no current turn. Reconnect/retired owners remain unavailable. Agent activation selects the existing exact terminal, not the project's remembered sibling; compact dismissal restores the opener. Status filtering supports accessible multi-selection across seven presentation statuses plus an `"all"` sentinel with sum-of-matching tallies, collision-aware compact sheet positioning, and backward-compatible `localStorage` persistence (qualified via 130 unit, 39 integration, and 42 Chromium browser tests; see `plans/reports/tester-261014-0125-multi-select-agent-status-filter.md`). Agent Settings carries selected-owner intent and denies disconnected/removed/invalid targets without ambient fallback. `WorkspacePage` keeps the sole `TerminalKeepAliveHost` stable across responsive shell switches. Original sidebar baseline verified via 28 Chromium browser tests, 2 authenticated application journeys, and full-viewport human visual review accepted in [review.md](../packages/ui/e2e/traditional-terminal-agents/review.md).
- Cognito activation is ephemeral. The app overlays the rendered UI and isolates input; content remains in the app and operating-system captures are outside this feature's guarantee.
- Current Heavy Blur CSS is `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)` where supported; unsupported and reduced-transparency cases use opaque black. See `packages/ui/src/index.css` for the checked-in implementation.


### Android native client invariants

- **Terminal input isolation:** Active panel alone receives input. Hidden terminal surfaces and sessions undergoing UTF-8 replay drop/fence keystrokes and IME composition (`AndroidTerminalSurface`, `TerminalSessionController`).
- **Editor safety:** Monotonic `modelVersion`, edit epochs, and server mtime checks reject stale saves. Sora Editor AAR LGPL-2.1 license obligations identified; compliance and user relinking validation pending (`AndroidEditorSurface`).
- **Language services:** Offline JSON AST diagnostics and symbol hierarchy verified (`JsonLanguageService`). Non-browser TypeScript semantic analysis is hard-blocked pending architectural decision on embedded JS runtime vs server LSP (`TypeScriptLanguageServiceAudit`).
- **Fail-closed crypto:** `OpaqueClientBridge` and `native-app/crypto-bridge/` strictly throw `OpaqueCryptoException` when native libraries are unavailable (no pseudo-crypto fallback). Exact suite parity with `server/src/crypto/opaque.rs` (`DamHopperOpaqueSuite`) verified in host Rust tests (live server interop pending).
- **Target-qualified filesystem requests:** File, directory, stat, read, and mutation operations forward the specified `ProjectTargetRef` without ambient profile fallbacks; chunked write operations enforce expected mtime compare-and-swap (CAS) checks (`FileRepository`, `FsWriteCoordinator`).
- **Watcher lifecycle and early-event buffering:** Live tree subscriptions buffer incoming `fs:event` and `fs:overflow` messages via an unlimited channel before the subscribe request completes, filtering events by `subId` and protecting unsubscriptions with generation fencing (`TreeSubscriptionManager`, `FileTreeState`). Live watching is currently bounded to the root directory without automatic per-subfolder subscription.
- **Bounded federated search:** Search queries across connected profile targets enforce an aggregate 500-match cap, isolate partial profile failures, and map workspace matches to their originating project targets (`SearchRepository`, `FederatedSearchCoordinator`).
- **Conservative replacement execution:** Search-and-replace executes literal non-regex replacements using frozen search specifications; preview aggregates match counts per file; batch execution re-verifies match presence and applies read-to-write CAS; authoritative dirty-buffer checking (`ReplaceCoordinator.isDirtyFile`) was wired in Phase 09 via `EditorTabsState` to skip in-memory modified buffers.
- **Encrypted transfer & session safety:** Required: Cryptographic envelope wire parity (`CryptoEnvelope` with 12-byte IV, 16-byte tag, 4096-byte metadata JSON, 0x00 delimiter matching server `decrypt_blob`); auto-closeable session zeroization (`CryptoSession`); fail-closed encrypted save without plaintext downgrade. Current status: Scaffolding delivered; production wiring from OPAQUE login, editor UI toggle, and full-operation generation fencing across asynchronous boundaries remain open blocking security defects.
- **Chunked binary transfer limits:** Required: Bounded WebSocket chunk streaming using atomic frame pairs (`sendAtomicPair`), default 64 KiB chunks, and 100 MiB enforced envelope/document limit where applicable; `UnknownOutcome` on in-flight commit timeout. Current status: Delivered in `TransferCoordinator`.
- **SAF document storage scoping:** Required: Scoped content URIs without broad storage permissions; 100 MiB size cap and filename sanitization (`AndroidDocumentStorage`). Current status: Storage interface and adapter implemented; production SAF picker/download integration unwired.
- **Media client origin & cookie isolation:** Required: Canonical UUIDv4 `mediaClientId`, namespaced session cookies (`damhopper-media-session-<uuidv4>`), redirect rejection, same-origin validation, and purpose-scoped ticket capabilities (`AndroidMediaClient`). Current status: Partial scaffolding delivered; permissive cookie extraction (non-fail-closed), unbounded `readRangeSync` memory buffering, and unwired UI playback block production enablement.
- **Git workflows & safe history invariants:** Required: Target-qualified Git facade (`GitRepository`), changes/staging controller (`GitChangesController`), worktree removal prechecks guarding against active terminals and dirty editor tabs (`WorktreeMutationController`, `EditorTabsState.isDirtyTarget`), safe history rewrite on inactive local branches (`isViewingLocalBranch`) vs checked-out active branch requirements (`isViewingActiveBranch`), leased push publication safety gate (`LeasedPublishController`) with exact expected remote OID and stale-remote detection (zero blind `--force` push fallback), and zero-FAB presentation (`GitPanelScreen`, `GitModalsHost`). Current status: Implementation baseline delivered; cycle 3 review recorded score 6/10 (not accepted) with documented open limitations (branch checkout scope sync, repeat failure suppression, details dialog file-variant mutation invalidation, premature discard invalidation, and query parameter encoding corruption; live qualification deferred to Phase 18).
- **Host resources fleet streaming & safe usage insights:** Required: Demand-driven authenticated SSE streaming with 256 KiB cap and OkHttp client (`HostResourceSseClient`), centralized per-owner coordinator (`ResourceStreamCoordinator`) with 5s REST fallback and atomic snapshot/metrics pairing with monotonic decimal-string revision checking and epoch restart tracking (`ResourceFrameCommitter`), fail-closed error latching (`ResourceFailureHandler`), aggregate-only usage queries without raw prompt telemetry (`UsageRepository`), opaque cursor pagination omitting `from/to` on continuation pages, UTC midnight floored date-range and all usage deletion with generation fencing (`UsageController`), and single-panel host under `WorkbenchPanel.RESOURCES` with top segmented switcher between Fleet and Usage (`ResourcesUnifiedPanelScreen`) with zero FABs, zero WebViews, and honest null rendering (`--`). Current status: Implementation baseline delivered; cycle 3 review recorded score 7/10 with documented open limitations (range-delete today exclusion semantics, dialog epoch-ms display formatting, partial settings controls, derived model filters; live device, SSE proxy buffering, and 32/4 admission limit qualification deferred to Phase 18).
- **Ports, tunnels, idle consent & host controls:** Required: Monotonic port/tunnel WebSocket discovery and lifecycle (`PortRepository`, `TunnelRepository`), live WebSocket capability receipt fencing for idle-suspend consent (`IdleConsentController`), 409 conflict exception mappings, ticking countdown banner with 0s lockout (`WorkbenchSleepConsentBanner`), SSH key passphrase redaction (`SshRepository`), and diagnostics export defaulting to excluded terminal output (`DiagnosticsRepository`). Current status: Implementation baseline delivered; cycle 2 review recorded score 7/10 (changes required / qualification open) with documented limitations (action error clearing, reconnect reconciliation, unverified credential forget; live hardware and keystore binding deferred to Phase 18).
- **Preferences, privacy gating, notifications & lifecycle coordination:** Required: Local and debounced remote preference synchronization (`SettingsRepository`, `PreferencesStore`, `AndroidPreferencesStore`) with font (10..32) and scroll (1..20) clamping; client-side stale-owner fencing; 1 MiB TOML import/export; 3-tier ephemeral privacy input gating across overlay, session/controller, and platform surface (`PrivacyController`, `CognitoOverlay`, `TerminalInputController`, `TerminalSessionController`, `EditorSession`, `AndroidEditorSurface`) with soft keyboard suppression and focus clearance; notification sink (`NotificationSink`, `AndroidNotificationSink`) with `Notification.VISIBILITY_PRIVATE` channels, public lockscreen redaction, profile retirement cancellation, and exact-target deep linking; lifecycle coordinator (`LifecycleCoordinator`, `AndroidLifecycleCoordinator`) distinguishing temporary background demand-pause from destructive profile retirement teardown; authoritative Settings panel (`SettingsScreens`) with 5 sub-sections, zero FABs, and zero WebViews. Current status: Implementation baseline delivered; cycle 2 review recorded score 6/10 (changes requested / qualification open) with documented limitations: inert preferences (values persist and sync remotely but lack downstream wiring in native components), test-only notification producer without runtime permission request launcher, partial streaming pause (host-resource coordinator only), and clipboard/paste-based import/export without Android SAF file picker; physical hardware execution deferred to Phase 18 release qualification.

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
