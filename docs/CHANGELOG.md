# 2026-10-06

- **Explorer editor Git blame annotations and Workspace Git commit reveal.** Implemented line-by-line native Git blame annotations within the Monaco editor gutter and exact commit inspection within Workspace Git panels:
  - **Native backend blame and read-only commit details (`server/src/git/`):** Implemented native `git2` blame execution (`execute_native_blame`) against in-memory buffer snapshots and HEAD baseline without filesystem/index mutations; bounded 5 MiB content size and 32 MiB JSON request ceiling; protected by a 2-permit global worker semaphore. Added `get_commit_details` for direct Git object database (ODB) commit inspection by exact 40- or 64-hex OID, reading detached, unmerged, and arbitrary old commits (>200 commits deep) with multiline commit bodies, author/committer timestamps, and file lists.
  - **Owner-bound client and buffer lifecycle (`packages/ui/src/`):** Implemented `useEditorGitBlame` hook with profile-qualified owner gating, 250ms keystroke debouncing, single-flight request aborting, immediate dirty-buffer invalidation, and event-driven invalidation on window focus, visibility restoration, and Git query cache invalidations (with zero feature-added periodic polling). Ephemeral session toggle (`Tab.blameEnabled`) is excluded from persistence and hydration.
  - **Monaco gutter and responsive layout:** Created `EditorGitBlameGutter`, `EditorGitBlameContextMenu`, and `EditorGitBlameRow` components. Responsive width switches between full author/date (220px at ≥640px) and compact author-only (`min(120px, wrapperWidth / 3)` at <640px). Full hover and keyboard focus metadata tooltips surface author, email, timestamp, timezone offset, hash, and subject.
  - **Workspace Git commit reveal:** Wired committed-row gutter and context menu clicks to reveal exact commits in Workspace Git panels across IDE bottom tools, floating terminal panels, and compact layouts. Rendered `CommitDetailsPanel` in read-only inspection mode (`mode: "inspect"`) with outside-history-view notification, multiline commit body, author metadata, and file lists, disabling mutation controls while preserving open dirty editor tabs.
  - **Host integration and tier safety:** Threaded `sourceActive` lifecycle across Monaco, Markdown, and HTML hosts (pausing requests and clearing debounces when backgrounded or in Preview mode). Excluded binary, diff, large (≥5 MiB), image, and video files from blame requests.
  - **Comprehensive qualification:** 100% test pass rate across native Rust blame suites (25 tests), server blame API integration suites, UI unit/hook suites (170 tests), real Monaco component browser tests (3 tests), and full-application containerized Playwright E2E journey (`editor-git-blame.spec.ts`).

# 2026-10-05

- **Documentation reorganization and architecture consolidation.** Restructured repository documentation following source code audit:
  - Restructured seven historical execution documents into purpose-based architectural specifications under `docs/architecture/`: `authentication-state-and-cryptography.md`, `workbench-files-editor-and-git.md`, `terminal-continuity-and-workflow.md`, `agent-store-ports-and-browser.md`, `preferences-settings-and-host-resources.md`, `media-isolation-and-encryption.md`, and `native-ssh-forwarding.md`. Removed superseded files without redirect stubs.
  - Consolidated retired plugin-platform design specifications (`plugin-platform-linux.md`, `plugin-platform-d00.md`, `architecture/plugin-platform-d01.md`, `d02.md`, `d03.md`, `d05.md`) into a single historical retirement record at `docs/archive/retired-plugin-platform.md`, removing superseded individual files while preserving design provenance and host cleanup runbooks (`deploy/remove-plugin-platform.sh`).
  - Consolidated authentication REST API specification into `docs/api/authentication.md`, removing redundant `docs/authentication-api.md`. Accurately documented dual credential admission for step-up challenges (Bearer header or `damhopper-auth` cookie fallback).
  - Consolidated component index into `docs/frontend-components.md`, removing redundant `docs/frontend-components/index.md`.
  - Purged retired plugin configuration variables and runner RPC claims from active configuration and release management guides (`docs/configuration/server-environment-auth.md`, `docs/linux-release-manager.md`, `docs/user-guide-multi-server-profiles.md`).
  - Repaired all 19 baseline heading-link defects identified across maintained documentation.
  - Standardized port and platform boundaries: standalone server default port 4800 (`0.0.0.0`), systemd API 4801 / web 4802, development API 4803 / Vite 5173; native SSH forwarding is Windows-only (`cfg(windows)`).

- **Git inactive local branch commit-message edit, squash, and UI accessibility qualification.** Extended history rewriting capabilities across the compact Workspace Git Panel and standalone Git Page to support inactive local branches without active checkout restrictions:
  - **Inactive local branch rewrites & working-tree isolation:** Commit-message editing and parent-contiguous squashing operate on raw object plumbing and compare-and-swap (CAS) ref transactions. The active branch checkout, index, staged, unstaged, and untracked files remain completely untouched. Operations fail closed on worktree conflicts (`checked-out-branch`) or active rebase/merge states (`active-operation`).
  - **UI surface parity & branch banner synchronization:** `WorkspaceGitPanel` and `GitPage` enable message editing and squash when viewing any local branch (`isViewingLocalBranch`), while strictly gating checkout-sensitive operations (`reset`, `drop`, `undoLastCommit`) to `isViewingActiveBranch`. The non-active branch banner is updated to `Viewing {branchLabel}. Cherry-pick and revert apply to checked-out branch {activeBranch}.`
  - **Context menu accessibility (`GitLogTree`):** Disabled "Edit Commit Message" menu items link to an explanatory description ID via `aria-describedby` (using `useId()`), title tooltip fallback, and non-interactive `<p>` description text (`Edit Commit Message is only available for local branches`), ensuring screen reader and keyboard accessibility in Radix context menus.
  - **Receipt-bound leased push:** Post-squash publication uses exact-OID leased push preparation and publishing tied strictly to `receipt.branch` without ambient `HEAD` drift, protected by user confirmation and cancellation handling.
  - **Comprehensive qualification:** 349 total tests passing with 100% pass rate across backend Axum suites (165 tests), UI jsdom suites (175 tests), and Playwright Chromium browser accessibility suites (9 tests).
- **Frontend testing restructure — CI, docs, and qualification complete (2026-10-05).** Completed the restructuring of frontend test runners, evidence governance, and CI quality gates:
  - **Runner separation:** Dedicated `@playwright/test` 1.61.1 runner targeting `packages/ui/e2e/**/*.spec.ts` under Chromium; disjoint Vitest unit discovery excluding `e2e/**` and `browser-tests/**`; preserved 53 Vitest browser component suites.
  - **Isolated application services:** Containerized test runtime (`dam-hopper:production-test`) pairing production Rust server and web SPA with real isolated MongoDB (`mongo:8.2`) instances; canonical Rust auth-seed runner (`application_e2e_seed`) with V2 signed claims and `localStorage` session state; effective `$HOME` containment (`/e2e/home/.evcrate/advisor-history`) preventing host state leakage; zero-orphan resource cleanup across passing, failure, and cancellation paths.
  - **Application user journeys:** Three real-application E2E user journeys replacing component harnesses: Privacy Mode Heavy Blur input isolation (`privacy-heavy-blur.spec.ts`), Advisor model selection and dark-theme routing persistence (`advisor-model-dropdown-theme.spec.ts`), and native dock narrow 320px responsive Evaluations inspection (`counsel-evaluations-responsive.spec.ts`).
  - **Visual evidence governance & capture policy:** Unified Node-side capture policy (`capture-policy.ts`) across Playwright and Vitest (`screenshotFailures: shouldCaptureE2E()`); full viewport screenshots (1440x900 default, 320px dock width) colocated in `packages/ui/e2e/<case>/`; atomic publication via `.e2e-staging/<runId>`; zero-dependency PNG magic byte and IHDR dimension validator; mandatory human visual review governance (`review.md`) with explicit `ACCEPTED`/`REJECTED` decisions.
  - **CI quality gate & aggregate scripts:** Integrated `application_e2e` into `.github/workflows/pr-quality-gate.yml` with pre-cached images, typecheck, failure artifact retention, and `quality_gate.needs` enforcement; wired `scripts/run-all-tests.sh` with process-group cleanup; proven capture-disabled parity (`CI=true E2E_CAPTURE=0`) executing full functional assertions with zero image generation and preserved evidence bytes/mtimes.
  - **Documentation & guidelines:** Comprehensive architecture, runner classification, and workflow gap reference in `docs/testing.md`; updated test commands and E2E guidelines in root `AGENTS.md`.

# 2026-10-04

- **Host-resource SSE recovery after background/BFCache restoration.** Handled rejected reader cancellation during intentional stream shutdown and made coordinators observe connection readiness without confusing a temporarily connecting owner with a replaced generation. Streams resume when the restored page becomes eligible, including when WS readiness follows `pageshow`; auth latches and owner fencing remain intact. Verified 90 focused tests, all 2,287 UI tests, UI TypeScript build, and a loopback Chromium smoke with delayed connection readiness and real Back navigation (`pageshow.persisted === true`) delivering new resource samples without uncaught cancellation errors.

- **Advisor routing editor and harness model selector — verification and quality gates complete (2026-10-04).** Fully qualified end-to-end advisor routing persistence and model selection across backend Rust domain/API and frontend React UI:
  - **Backend domain & filesystem safety:** real temporary HOME and `.evcrate/advisor-routing.json` atomic replacement via owner-only temporary file (`0600`) and `O_NOFOLLOW` rename; preservation of non-route keys (`wait`, `history`); recursive rejection of credential keys in policy contents or updates (`ROUTE_CREDENTIAL_FIELD`); byte-size boundaries (16 KiB limit); symlink target and parent directory rejection (`POLICY_FILE_UNSAFE`).
  - **Harness model discovery:** `POST /api/advisor/models` CLI execution bounded by timeouts and output limits; fallback catalogs for `claude`, `codex`, `omp`, and `pi`; strict provider prefix requirement for OMP/Pi models (`provider/model`).
  - **Authentication & Authorization:** both `PATCH /api/advisor/policy` and `POST /api/advisor/models` deny unauthenticated requests (401), non-admin users (403 `AdminRoleRequired`), `--no-auth` mode (403 `NoAuthForbidden`), and disabled feature state (403 `ADVISOR_DISABLED`); admin Bearer and cookie sessions succeed. Routing capabilities remain operational and advertised when history directory is absent.
  - **Frontend UI & validation:** `PolicySummaryCard` inline routing editor with dual `RouteFieldset` components, live duplicate route triple rejection (`ROUTE_BACKUP_IDENTICAL`), differing effort allowance, custom model input mode, and cancellation restoring pristine state.
  - **Cross-layer Vitest Browser Mode qualification:** dedicated loopback Axum fixture (`advisor_routing_browser_fixture`) exercising real `WsTransport`, `ApiClient`, and `NativeAdvisorProvider` over REST in Playwright-backed Chromium (5/5 browser interaction tests passing).
- **Documentation refresh (2026-10-04).** Updated repository navigation, product requirements and pass/fail success measures, code standards, architecture, codebase inventory, roadmap, and Native Advisor status against the current checkout and generated Repomix compaction. Large API, frontend, systemd, and server-configuration references were split into linked subtopic guides. Every Markdown page remains below the 800-line limit. The checked-in Cognito CSS currently uses `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)`; this differs from the style values recorded in the historical 2026-10-03 entry. The current Native Advisor completion status supersedes the 2026-10-02 changelog snapshots. No product code changed in this documentation update.

# 2026-10-03

- **Cognito Privacy Mode Heavy Blur appearance restored.** Fixed issue where Heavy Blur appeared as solid black identical to Black Screen. Updated `.cognito-mode-overlay--heavy-blur` in `packages/ui/src/index.css` to use `blur(20px) saturate(140%)` with `rgba(13, 17, 23, 0.52)` and a subtle inset highlight, rendering an authentic frosted glass visual mask while preserving opaque black fallbacks for unsupported engines and supported reduced-transparency preferences. Added real-browser computed style regressions in `packages/ui/browser-tests/cognito-mode.browser.tsx`.
- **Squash commits in both Git surfaces.** Added independent checkbox selection in Workspace Git panels and the Git page, full-body oldest-first editable drafts, root/older linear ranges, pushed-history warnings, explicit signature-removal consent, and separate history-root-bound leased publication. The raw-object rewrite preserves the final tree, index and dirty files; merges, invalid ranges and stale snapshots fail closed. Concurrent full-message reads no longer acquire Git ref write locks. Live Chromium/Axum smoke verified both surfaces, nested-root isolation, real bare-remote publication and stale-lease no-overwrite.

# 2026-10-02

- **Native Advisor migration — qualification evidence and documentation reconciliation (2026-10-02).** Recorded the native-only cutover qualification and retired the Dam-Hopper plugin platform across backend, UI, and release; durable completion receipt publication remains parent-coordinated. Backend suites passed 34/34 Advisor integration tests and 14/14 native release/migration tests; UI passed 2,206 unit/component tests and 2 Playwright Chromium browser tests; web build passed; documentation synchronized.
- **Native Advisor migration — reusable UI/provider implementation and finalization settled (2026-10-02).** Added a native React `AdvisorPanel` with Overview, History Records, Configuration, and Evaluations views. `NativeAdvisorProvider` uses the captured owner-bound `ApiClient.advisor` for eight abortable history/policy/evaluation operations and rejects late results. Tabs are panel-local; scoped `.native-advisor` CSS and the `0 iframe / 0 MessagePort or plugin-sdk` constraint are enforced. Scoped validation passed 13/13 tests, clean typecheck, and 9.4/10 review.
- **Native Advisor migration — policy/evaluation domain implementation and finalization settled (2026-10-02).** Added read-only current account policy inspection at `POST /api/advisor/policy/current` and evaluation discovery, revision-checked read, and comparison at `POST /api/advisor/evaluations/list`, `POST /api/advisor/evaluations/read`, and `POST /api/advisor/evaluations/compare`. Policy reads `$HOME/.evcrate/advisor-routing.json`; evaluations are discovered from the three canonical directory trees. Targeted validation passed 14/14 tests; review approved 9.4/10.
- **Native Advisor migration — history/status/API implementation and finalization settled (2026-10-02).** Added the native Rust history service and per-authenticated-user bounded snapshots for summary, page, and detail. `GET /api/advisor/status` inspects `$HOME/.evcrate/advisor-history` with `symlink_metadata` and marks a final-root symlink unavailable; `PATCH /api/advisor/settings` persists the default-off server toggle; `POST /api/advisor/history/refresh` invalidates user snapshots; `POST /api/advisor/history/page` and `detail` return scrubbed DTOs. Targeted validation passed 15/15 tests; review approved 9.3/10.
- **Native Advisor migration — contract and parity baseline implementation/finalization settled (2026-10-02).** Froze the native contract and synthetic parity baseline. The reviewer reports 16/16 parity checks, review 9.5/10, and no critical findings. Permanent Rust parity coverage replaced the plugin-backend dependency before it was retired.

- **Git history search and selection persistence — end-to-end qualification and docs complete (2026-10-02; 100%).** Fully qualified Git history search and selection persistence across live Axum backend and React 19 UI. Verified scenarios: older-than-200 body match returns correct subject-only DTO (`chore: initial baseline`), matching pagination across distinct matches (offsets 0, 1, and empty offset 2), literal `--flag` CLI argument immunity, literal `.*` regex immunity (no wildcards), literal single and double quote handling, single-character no-match safety, and clear-filter restoration to full history. Fixed empty-result and clear-filter UI race conditions where `historyState.searchQuery` could desynchronize from the active query client. Code review approved 9.5/10 with no critical issues.
- **Cognito Mode — qualification (2026-10-02; 100%; 28/28h).** All three build gates passed (`cargo check`, UI build, web build; 0 errors). The 191 focused tests passed: 39 Rust, 143 Vitest, and 9 Playwright Chromium. Live interactive Linux Chromium app smoke verified `Mod+Alt+KeyB` activation, focus trapping, complete click/key suppression, same-key dismissal, and the app/platform boundary. Code review approved 10/10 with no issues; the advisor reported 0 must-fix items.
- **Cognito Mode — state and overlay milestone (2026-10-02).** Delivered nonpersisted activation with a frozen shortcut, accessible Heavy Blur/Black Screen body-portal mask, input/focus isolation, active-toast layering, and Browser Debug visibility. Its scoped UI tests passed 28/28, targeted typecheck passed, and review scored 9/10 with integration risks recorded for later stages. Those concerns were carried into and closed by the completed qualification.
- **Git history search and persistence — shared history view (2026-10-02 00:16 +07:00; 100%).** Added a shared owner/scope-fenced history controller, accessible IME-aware search/paging/refresh controls, canonical-ref view-only branch selection, and filtered rows without ancestry graph work. Scoped Cycle 2 validation passed **66/66** tests, UI build, and web typecheck; the post-review refresh-state fix passed the hook suite **8/8** and `tsc --noEmit` (**0 diagnostics**). Review scored **9.4/10**.
- **Git history search and persistence — Workspace Git panel integration implementation/finalization settled (2026-10-02).** Integrated persisted root/branch selections and shared search, paging, selection, and refresh into the Workspace desktop IDE, terminal floating, and compact Git surfaces. Each mount supplies project-target availability; details, diffs, and history actions stay target/root scoped, rewrite actions remain disabled on non-active branches, and root-scoped selections persist independently. Scoped validation passed **15/15** tests; code review approved **9.2/10**.
- **Git history search and persistence — Git-page integration implementation/finalization settled (2026-10-02).** The standalone Git page now persists its qualified project checkbox set independently from Workspace focus, fails closed for unavailable selections, and reuses the shared root/branch/search/paging history view for one available project. Multi-select and Clear preserve Workspace focus; explicit `[]` stays all projects; history branches remain view-only and root-relative diff paths use the shared helper. Scoped validation passed **9/9**; review approved **9.5/10**.

# 2026-10-01

- **Git history selection persistence — complete (2026-10-01 22:59:53 +07:00).** Added versioned Git-page/root/branch preferences with qualified scopes, corruption recovery, safe in-memory storage fallback, profile-deletion isolation, and canonical local/remote branch resolution. The current-tree focused store run passed **26/26**; the earlier UI package run passed **2,102/2,102** before follow-up fixes.
- **Git commit-message edit input freeze fixed.** Pinned ContextMenu `2.3.3`, Dialog `1.1.19`, and Select `2.3.3` to share Radix's modal pointer/focus registries. Previously, opening the edit dialog from a history context menu could leave `body` with `pointer-events: none` after save or cancel. Modal behavior and Git rewrite/publication safety are unchanged. Verified real saves on the TERMINAL floating Git panel and Git page with a disposable repository, cancel preserving HEAD, ordinary controls and live terminals unaffected, and focus returning cleanly. Review approved 9.7/10.
- **Server-side Git commit-message search — implementation and review complete (2026-10-01).** `GET /api/git/{project}/log` accepts optional `messageQuery`, filters full messages with literal ASCII-case-insensitive matching before pagination, and preserves the existing response shape. Embedded CR/LF and NUL are rejected; edge CR/LF is trimmed before validation and can turn a control-only query into an unfiltered request.
- **Git history search — transport and owned queries complete (2026-10-01).** Added the optional `messageQuery` argument to the owner-bound API client, retained the existing `git:log` REST mapping with encoded query parameters, and centralized normalization and owner/generation-aware cache identity. Exposed shared query options and prefix helpers for later refresh and invalidation consumers. Scoped validation passed **22/22** tests; review approved **9.3/10**.
- **Host-resource SSE CORS preflight fix — completed (2026-10-01 Asia/Saigon).** Added `CACHE_CONTROL` and `PRAGMA` to `build_cors` allowed request headers in `server/src/api/router.rs`. Resolves browser CORS preflight blocking of `GET /api/system/resources/v1/events` from cross-origin web hosts sending `Cache-Control: no-store` or DevTools cache-disabled requests. Verified with regression test in `server/tests/host_resource_events.rs` (13/13 tests passed, code review 9.8/10).
- **Host-resource SSE delivery — documentation and rollout (2026-10-01 02:53:43 +07:00; 100%; review 9.8/10).** Published the bearer-Fetch API contract, client delivery/UI arbitration, proxy requirements, and versioned artifact rollout/rollback runbooks for the intended Linux-web-first scope.
- **Host-resource SSE delivery — scoped closeout (2026-10-01; user approved).** Added test-only instrumentation, mandatory-Mongo qualification fixtures, and partial harness modes; the focused server suite passed 11/11.

# 2026-09-30

- **Host-resource SSE delivery — owner-fenced resource query and UI cutover (2026-09-30; 100%).** Connected the profile/QueryClient-owned stream to fleet and detail snapshot/metrics arbitration while preserving REST fallback and WebSocket alert/history behavior. Scoped validation passed **136 unit tests across 8 files and 4 Chromium browser tests (140/140 total)**; the UI TypeScript build passed; Cycle 2 review approved **9.9/10** with no critical or high findings.
- **Host-resource SSE delivery — profile-owned stream client (2026-09-30; 100%).** Implemented owner-bound cancellable authenticated streaming, bounded SSE parsing, strict DTO/revision/freshness decoding, retry/state coordination, owner/QueryClient fencing, and token-rotation handling. Scoped validation passed **96/96 tests across 6 files**; `pnpm --filter @dam-hopper/ui build` passed; review approved **9.8/10**.
- **Host-resource SSE delivery — shared snapshot publisher (2026-09-30; 100%).** Added atomic monitor snapshot/metrics publication and demand-driven bounded shared-frame encoding. Targeted monitor tests passed **13/13** and publisher tests **6/6**; review scored **9.0/10** with no critical/high findings.
- **Host-resource SSE delivery — authenticated SSE endpoint (2026-09-30; 100%).** Added authenticated `GET /api/system/resources/v1/events` with bounded global/per-subject stream admission, independent auth supervision, and pre-drain stream shutdown. Scoped validation passed **9/9 integration tests** and **6/6 unit tests**; code review scored **9.2/10**.
- **Terminal replay and PTY rendering repair.** Historical replay no longer sends terminal-query replies to the live shell. Full replay resets emulator state; incarnation-scoped byte offsets deduplicate snapshot/live overlap, recover gaps and broadcast lag, and distinguish same-ID process replacements. Retained UTF-8 history has scalar-safe boundaries. Hidden/parked terminals preserve geometry, visible fits select their renderer first, and unchanged opaque suggestion state no longer republishes on every cursor position change. Focused suite passed 23/23; terminal component suite passed 18/18; broad browser passed 183/187.
- **Plugin host page removal and main branch merge (2026-09-30).** Completely removed standalone `PluginHostPage.tsx`, its route `/plugins/:installationId`, and dedicated test suite. EVCrate Advisor is exclusively accessed via the integrated Workspace Advisor. Direct navigation or bookmarked URLs to `/plugins/:installationId` fail closed without displaying an unavailable stub.
- **Workspace-integrated Advisor — paired qualification, docs, and release handoff (2026-09-30; 100%).** Executed consolidated checks V-D1, V-D2, V-D3, V-D4 (48 cargo plugin tests, 45 SDK tests, 65 UI unit/component tests, 13 Chromium browser tests, UI build succeeded, and `pnpm lint` exited 0 with 132 warnings and 0 errors). Ran live Playwright browser qualification client against authenticated fixture server: 11/11 scenarios passed, 4 screenshots captured (overview, history detail, configuration edit, comparable evaluations), and review scored 9.8/10 with zero critical findings.
- **Codex and Claude native-hook status — (2026-09-30 Asia/Saigon; 100%).** Linux end-to-end qualification passed all 32 acceptance scenarios (N01–N32) with live Codex CLI 0.158.0 and Claude Code 2.1.250 on Linux x86_64. Verified private UDS ingress, 15-second evidence lease expiry to Unknown, zero Codex OSC9 notifications, Claude attention-only alerts, subagent rejection, managed installation/uninstallation lifecycle, and profile isolation. Automated suite validation reconciled across 1,385 unit and integration tests (21 integration, 1,223 UI unit, 141 library).
- **Object-only commit-message rewrite and leased publication — (2026-09-30 Asia/Saigon; 100%).** Scoped qualification passed **121/121** tests (21 rewrite + 6 leased-push unit, 3 commit-message API, 5 leased-publish API, and 86 UI tests). Real HTTP route tests cover paired GET/POST CAS, worktree/root addressing, dirty-worktree preservation, leased prepare/publish against disposable local bare remotes, exact-OID single-ref verification, stale-remote and stale-local rejection, and legacy `isPushed` deprecation. Review approved **9.8/10**.
- **Object-only commit-message rewrite — (2026-09-30 00:44:16 +07:00; 100%).** Implemented the raw-commit DAG/ODB rewrite and checked local branch publication, paired GET snapshot (`message`, `branch`, `headOid`), and POST stale-snapshot contract.
- Targeted validation passed **17/17** (16 engine scenarios and one in-process API integration test); `cargo check` and focused rustfmt passed; Cycle 2 review approved **9.8/10**.

# 2026-09-29

- **Codex and Claude native-hook status — (2026-09-29 Asia/Saigon; 100%).** Delivered profile-owned native settings, distinct installation/readiness badges, honest Codex status-only and Claude attention-only gating, semantic notification dispatch, and complete Codex OSC9/TUI-sync removal. Validation passed **2,383 tests** (139 config, 80 agent_status, 1,944 UI unit, 220 browser); review approved **9.2/10** and advisor completion recorded.
- **Supersedes the 2026-09-28 Codex notification gate:** The `config.toml` requirement in that historical Agent Store entry is not the current alert-eligibility rule; native-hook settings make Codex status-only and keep alert enablement disabled.
- **Codex and Claude native-hook status — (2026-09-29 Asia/Saigon; 100%).** Delivered concrete native-event adapters with root/turn/session fencing, correlated blocker resolution, privacy-safe normalization, and no false turn-completion alerts. Overall checkpoint: all **3,606 tests passed**; focused validation covered **74 unit + 7 integration tests**. Cycle 1 review approved **9.5/10**.
- **Codex and Claude native-hook status — (2026-09-29 Asia/Saigon; 100%).** Delivered managed install/status/update/uninstall with config-preserving registration changes, ownership-fenced assets, readiness distinctions, and restart-aware cleanup. Cycle 2 review approved **9.5/10** with no critical issues; focused validation passed **87/87** (15 integration, 59 library, 8 runtime, 5 hook tests).

# 2026-09-28

- **Agent Store settings and notification path gate (2026-09-28).** The Agent Store now has an **Agent Settings** tab in place of the former Integrations tab, with agent notification controls removed from Appearance. Its per-server-profile enable controls require exact configured/runtime path equality after server-side `~/` expansion: OMP also requires the managed extension to be current, while Codex requires `config.toml` to exist. `GET /api/agent-status/paths` returns resolved paths and eligibility; it evaluates only paths beneath configured project roots or allowed agents and redacts other paths.
- **Agent Status — (2026-09-28; 100%).** Passed Linux x86_64 end-to-end and release qualification with OMP 18.4.1; all C01–C19 qualified. Validation: 1,976 focused executions (17 status, 6 runtime, 6 installer integration, 17 Bun adapter, 1,930 UI unit), 1,168 server regression tests (1 ignored), 220 Chromium browser tests, and standalone release build. Verified live OMP lifecycle, PTY-scoped credentials, 15s lease/socket-drop unknown transitions, cross-profile isolation, and packaged CLI integration. Review approved 9.7/10.
- **Agent Status — (2026-09-28; 100%).** Delivered profile-safe badges across three surfaces (main terminal tabs, split tabs, Fleet runtime navigator rows), unified settings preferences (`terminalAgentNotifications`), notification toast viewport and history center, sound/browser notifications, and connection generation fences. Focused validation passed 1,930/1,930 UI unit tests and 220/220 browser tests in Chromium.
- **Agent Status — (2026-09-28; 100%).** Added the standalone embedded OMP adapter and `dam-hopper-server integration omp {install|status|uninstall} --agent-dir <absolute-path>` commands with guarded profile install/update/removal. Focused proof: 17/17 adapter tests and 6/6 installer/CLI integration tests.
- **Agent Status — (2026-09-28; 100%).** Added the private loopback reporter collector, shared runtime and incarnation-scoped PTY credentials, protected snapshot endpoint, and semantic WebSocket push/invalidation. Review-recorded validation: 5/5 specific suites, 1,563/1,563 Cargo tests, and 1,923/1,923 UI tests passed; TypeScript build clean, no warnings in new code.
- **Fix multi-profile Git and EVCrate Advisor endpoint routing — completed (2026-09-28).** Corrected multi-profile page endpoint resolution: (1) `GitPage` now aggregates repositories across all profiles with `useAggregatedProjects()`, maintains tuple-keyed selection, synchronizes single selections to `useWorkspaceStore`, routes Git operations (`useGitLog`, `useGitRoots`, `useProjectStatus`, `useGitHistoryActions`, `openDiff`) through qualified `ProjectTargetInput` with `profileId`, partitions bulk fetch/pull per profile with sequential execution, and updates URL parameters cleanly; (2) Advisor routes to the profile owning the active workspace project, with prominent profile badges in the UI, and returns a graceful disabled state when the selected profile disables Advisor. Verified with 13 focused integration tests.

# 2026-09-27

- **Plugin admin profile binding and Linux installer identity conflict — completed (2026-09-27).** Settings defaults plugin-admin auth to the active profile and classifies typed API auth failures; Linux owner checks give a distinct-UID remedy, the installer warns about likely identity collisions, and the operator guide documents identity checks and activation. Code review reports **1,902/1,902** full UI tests, **8/8** Linux runner tests, clean TypeScript/Cargo checks, shell syntax, and no critical issues.
- **Mandatory MFA and token lifecycle — (2026-09-27; 100%).** Cycle 2 review approved **9.9/10**. The qualification ledger reconciles **120/120** automated auth tests: **39 backend + 81 frontend** (13 `auth_mfa`, 26 related auth/API/transport, eight UI suites). The integration suite covers selected acceptance cases A04–A12, A14, A17, A20–A22 and a real loopback REST/WebSocket deadline + MongoDB-reset smoke. The live-socket watcher checks persisted user/session versions; reset invalidation was proven on live sockets.
- **Mandatory MFA and token lifecycle — (2026-09-27; 100%).** Delivered profile-owned enrollment/login/step-up UI, MFA-required state, token replacement and transport recreation, cross-tab synchronization, and Android Chrome authentication input. Cycle 2 review approved **9.6/10** with no critical issues or warnings; 8 scoped UI test files passed **81/81**, TypeScript check and UI build passed.
- **Mandatory MFA and token lifecycle — (2026-09-27; 100%).** Enforced shared session policy at REST/WS admission; inbound WS operations check the local auth deadline before dispatch/commit, while a bounded 5-second watcher revalidates persisted account/session state. Media tickets are session-bound; ongoing WS/media output is guarded by deadline/revocation checks.
- **Mandatory MFA and token lifecycle — (2026-09-27; 100%).** Delivered challenge-driven enrollment, login verification, step-up, and persisted session issuance after successful MFA. Scoped authentication tests passed **28/28**; the initial review approved **8.5/10 with findings**.

# 2026-09-26

- **Linux release plugin runner packaging fix — implementation complete, publication pending.** Linux archives and the asset gate now require the runner binary (`0755`), service unit, and tmpfiles config (`0644`); package preflight and CI artifact wiring fail closed. Validation reports **19/19** passed, including deterministic package-twice and **5/5** negative boundaries; deployment tests **9/9** passed, review **10/10**. Metadata remains `0.5.0`; publish `v0.5.1` and post the v0.5.0 `server`/`both` advisory.

# 2026-09-23

- **Trusted plugin platform — Linux release integration and LAN qualification (2026-09-23; 100%).** Integrated owner-runner release assets, explicit owner/admin identity validation, tmpfiles/systemd runtime provisioning, schema migration, independent host/plugin rollback, recovery, deployment scenarios, and the LAN qualification harness. Validation passed **173/173** Linux-release tests, `pnpm release:verify`, **9/9** deployment scripts, owner/rollback smokes, and **5/5** synthetic LAN budget evaluations over a 10,000-record workload; review approved **9.3/10** with no critical issues.

# 2026-09-22

- **Trusted plugin platform — management API and transactional lifecycle (2026-09-22; 100%).** Added root-seeded admin allowlist loading (`--admin-config`, `DAM_HOPPER_PLUGIN_ADMINS_FILE`, `/etc/dam-hopper/plugin-admins.json`), bearer-only plugin management guard, streamed package staging/approval, installation/rollback/enable/disable/remove/grant/binding endpoints, redacted admin audit records, and the runner-side `LifecycleCoordinator` with durable transaction journals, candidate health-before-publish, revision fences, rollback intent preservation, and crash recovery. Settings now exposes owner-bound plugin management controls. Review approved **9.8/10**; see the [D05 architecture (archived)](./archive/retired-plugin-platform.md).
- **Trusted plugin platform — authorized API and connection-bound contexts (2026-09-22; 100%).** Delivered actor/epoch-bound authorization, explicit grants and target resolution, invoke-time revision checks, selective context revocation, bounded sanitized errors, owner-bound UI transport mappings, and the real API → owner runner → worker G1 slice. Re-review approved **9.2/10** with all four critical findings resolved; scoped validation passed **7/7** authorization, **6/6** supervision, **3/3** API integration, **1,845/1,845** UI tests, and a clean UI build.

# 2026-09-21

- **Trusted plugin platform — runner-owned package registry and trust staging complete (2026-09-21; 100%).** Delivered bounded streamed package intake, adversarial archive/path/link validation, immutable extraction and publication, independent SHA-256 review/approval bound to admin/security revisions, strict registry/journal durability and crash recovery, revision-tagged reads/CAS updates, and early E02 candidate staging for G1.
- Targeted `plugin_package_archive`, `plugin_package_registry`, and `plugin_contract_fixtures` validation passed **24/24** with no failures; Cycle 2 review approved **9.0/10** with no critical issues.
- **Trusted plugin platform — owner-account runner and worker supervision complete (2026-09-21; 100%).** Delivered strict framed JSON-RPC and EOF-safe authenticated Unix transport, exact handshake and peer validation, fixed Node worker launch, one worker per installation, multiplexed cancellation, deadline escalation and process-group teardown, generation-fenced context routing, durable restart exhaustion, and the hardened systemd owner boundary.
- Scoped protocol/supervision validation passed **13/13**; full plugin subsystem validation passed **37/37 tests across five suites**; test-targeted `cargo check` completed with **0 errors, 0 warnings**. Cycle 2 review approved **9.0/10** with no critical issues.
- **Windows PowerShell bootstrap installer — (2026-09-21).** Added the non-admin `dam-hopper-install.ps1` with `-Version`/`-Latest`, `-InstallDir`, `-AddToPath`, `-VerifyAttestation`, and `-DryRun`; digest/size verification; safe four-member ZIP extraction; config preservation; User PATH updates; and a loopback fixture-backed harness. The focused installer integration coverage passed **14/14 scenarios**.
- **Windows Release CI and guidance — (2026-09-21).** Extended the stable publisher with the Windows MSVC build/package path, explicit Linux/Windows profile gates, six-subject attestation, and the final `--profile all` local/remote publication gate. README, configuration, publisher, and Manifest v2 boundary guidance now describe direct-server installation, digest/attestation sources, and Linux-only runtime ownership.
- **Windows release asset and bootstrap installer — (2026-09-21).** Added profile-aware Linux/Windows/all release gates, the exact two-asset Windows contract, bounded four-member ZIP inspection, SHA-256 asset verification, and `release-manifest.json` schema-v2 synchronization. Focused validation passed with **14/14** installer assertions, clean AST inspection, and **2/2** packaged archive runs; code review approved **9.5/10** with no critical issues.
- **Fix search input focus loss during global search typing (2026-09-21).** Resolved focus-loss regression caused by re-rendering `SearchPanel` on every keystroke. Wrapped search inputs in stable state and added debounced query dispatch, preserving cursor position and IME composition across Chromium browser tests and UI test suites.

# 2026-09-20

- **Windows path and configuration normalization — (2026-09-20).** Replaced custom canonicalization with `dunce::canonicalize` on Windows, normalized UNC/verbatim paths, stripped trailing separators, and verified workspace root containment across 36 focused scenarios. The [Configuration Guide](./configuration-guide.md) records the lexical validation, containment, symlink, and fallback rules.
- **Windows server test harness and platform gating — (2026-09-20).** Added the `dam-hopper-server` Windows test suite with fake platform helpers and `#[cfg(windows)]` isolation. Validation passed **160/160**, **90/90**, and **36/36**. Code review approved **9.5/10** with no critical issues.
- **Windows server build, verification, and documentation — (2026-09-20 18:40:00 +07:00).** Added `default-run = "dam-hopper-server"`, verified Windows MSVC check/build/release gates, confirmed Linux-only binaries fail closed, and passed the serial suite with **978 tests, 0 failures, 3 ignored**. A loopback-only no-auth server smoke returned HTTP 200 from `/api/health` with valid schema/status and cleaned up its process/config artifacts. Windows runbook guidance now covers commands, paths, PTY shell semantics, unsupported Linux features, and evidence boundaries. Code review approved **9.6/10** with no critical issues.
- **Trusted plugin platform — candidate freeze (2026-09-20).** Added the versioned `@dam-hopper/plugin-sdk` contract candidate, Rust DTO and framing mirror, opaque UI bridge/cancellation feasibility evidence, resource budgets, and G0 artifact checklist. This is not a production loader or runtime release; see the [D00 contract reference (archived)](./archive/retired-plugin-platform.md).
- **Transport-safe FS subscription follow-up — (2026-09-20).** Documented profile-owned transport resolution, originating-watch cleanup and cache retirement, fail-closed `IdleTransport` filesystem methods, ambient ownership checks on disconnect, and local Explorer `ErrorBoundary` scope. See [Workbench Files, Editor, Search, and Git Architecture](./architecture/workbench-files-editor-and-git.md), and [system architecture](./system-architecture.md).
- **Multi-profile Host Resources watch — verification and testing complete (100%; 2026-09-20).** Focused unit/component and Chromium validation passed **102/102** tests (83 unit/component; 19 browser), and the UI TypeScript check passed with 0 errors. Coverage proves watch scope, owner/generation isolation, tiered polling, unread partitioning, single-profile compatibility, accessibility, responsive layout, and security negatives.
- **Multi-profile Host Resources watch — fleet deck and cards complete (100%; 2026-09-20).** Added ordered semantic `HostResourceFleetDeck` composition and profile-scoped `HostResourceFleetCard` summaries with connected-only inspection, empty/partial states, last-known offline qualifiers, finite memory/battery facts, safe long-text wrapping, and display-only sample-age formatting. The deck/cards remain read-only presentation over the owner/generation view model: no connection actions, metric averaging, host mutations, or per-card polling.
- **Multi-profile Host Resources watch — multi-profile state and hooks complete (100%; 2026-09-20).** Added owner-safe automatic watch scope, generation-qualified resource-snapshot `useQueries`, per-profile alert presentation, deterministic fleet aggregation, stale-generation fencing, and offline auto-connect last-known handling without connection or host-action side effects. Focused UI validation passed **58/58 tests** across the pure host-resource state and multi-profile hook suites; `pnpm --filter @dam-hopper/ui build` passed with no TypeScript errors.

# 2026-09-17

- **Unified multi-profile workbench — integration and qualification complete; release cutover closed (2026-09-17; 100%).** All deliverables completed. Release cutover is qualified for web and Linux, with explicit `Profile → Project` ownership, independent connection state, matched frontend/backend protocol contracts, media-v2 isolation, and incarnation-bound Browser artifacts. Windows S13 runtime evidence remains a separately tracked native-platform follow-up, not a web release blocker.
- **Unified multi-profile workbench — native scope concurrency and platform integration complete (100%; 2026-09-17).** Delivered concurrent admitted SSH scopes with scope-keyed runtime state, scoped teardown and secret cleanup, true client-epoch global teardown, atomic Tauri IPC/permission cutover, explicit per-scope TypeScript/UI adapters, and one Browser lease. Focused validation passed **135/135** on Linux: shared Vitest 15/15, native Vitest 48/48, UI focused Vitest 25/25, and native Cargo 47/47; scoped TypeScript checks passed. Post-fix code review approved **9.6/10**. Windows-only S13 live traffic, DPAPI and WebView2 proof remains unverified and is tracked as a native-platform follow-up; it does not block the qualified web cutover.
- **Unified multi-profile workbench — media isolation and encryption complete (100%).** Added required UUIDv4 `mediaClientId` bindings, namespaced v2 media cookies, ticket-selected cookie authorization, fail-closed duplicate parsing, and actor/client-scoped logout and revocation. Added bounded `RemoteCleanupHandle` lifecycle for native image/video capabilities and owner-qualified, memory-only encryption state with queued prompts, collision-resistant OPAQUE identifiers, zeroed stale keys, and single-transport encrypted writes without plaintext fallback. See [Media Isolation and Encryption Architecture](./architecture/media-isolation-and-encryption.md), [API Reference](./api-reference.md), and [Project Roadmap](./project-roadmap.md).
- **Unified multi-profile workbench — preferences, Settings, usage, and host resources complete (100%).** Added independent preference-source and Settings-target selectors, captured owner/generation fences for debounced saves and delayed imports, profile-qualified Usage queries/deep links, owner-local host snapshots/alerts/pinned mounts, and revision-fenced Force Machine to Sleep confirmation. Validation passed **87/87 targeted tests** and **1,760/1,760 full Vitest tests**; TypeScript and modified-file ESLint checks were clean, with a **9.5/10** code review. See [Preferences, Settings, and Host Resources Architecture](./architecture/preferences-settings-and-host-resources.md) and [Project Roadmap](./project-roadmap.md).
- **Unified multi-profile workbench — terminals, workflow, and owner-directed navigation complete (100%).** Delivered shared keep-alive PTY continuity across shell/project focus changes, owner-qualified terminal layouts/history/pins/incarnations, owner-bound workflow links and notification navigation, profile-isolated diagnostics exports, and fresh-state reset. Scoped UI suites passed **42/42 tests** and the UI TypeScript build completed cleanly; Cycle 3 code review approved **8.8/10** with no critical issues. See [Terminal Continuity and Workflow Architecture](./architecture/terminal-continuity-and-workflow.md).
- **Unified multi-profile workbench — agents, ports and Browser complete (100%).** Delivered owner-qualified agent catalogs/imports/memory drafts and same-owner distribution; qualified port/tunnel rows; explicit Browser target revision, lease and trust invalidation; owner-local capability availability; and same-owner terminal artifact capture with server-enforced incarnation-safe PTY handoff. Targeted validation passed **44/44 tests**; UI TypeScript build and Rust `cargo check` completed successfully; Cycle 2 review approved **9.5/10** with no critical issues.
- **Unified multi-profile workbench — complete (100%).** Delivered independent profile connections and controls, endpoint-bound credentials, auto-connect, the unified multi-profile header with status badges, and the fresh-state reset eviction logic. Validation: 65/65 unit/component tests passed; full UI suite passed 1,702/1,702 tests across 240 files; code review approved 9.8/10.
- **Unified multi-profile workbench — files, editor, search, and Git.** Added profile/worktree-qualified filesystem CRUD, watchers, uploads, previews, editor models, federated search, target-captured Replace Next/All, and inactive local branch commit message editing and contiguous squash. Monaco models are scoped to avoid cross-server collision; dirty tabs are not overwritten by watcher or Git reloads; federated search warns when its 500-match aggregate is truncated. See [Workbench Files, Editor, Search, and Git Architecture](./architecture/workbench-files-editor-and-git.md), [API Reference](./api-reference.md), and [System Architecture](./system-architecture.md).

# 2026-09-16

- **System daemon state configuration — complete (2026-09-14).** Checked in unit templates, rendered configuration, sysusers/tmpfiles policies, and verification fixtures. API lifecycle hooks, and restart behavior remain unchanged.
- **System daemon state configuration — complete (2026-09-14).** Preflight now performs server-role-only, read-only canonical/legacy SQLite holder inspection before daemon startup and aborts if an active lock is detected.
- **System daemon state configuration — merge reconciliation complete (2026-09-14).** Reconciled main branch state across daemon configurations.

# 2026-09-13

- **Production idle-suspend diagnostics — bundle/correlation engine complete (2026-09-13).** Delivered the pure bundle-v1 model, bounded no-follow JSONL readers, strict privacy projection, source completeness/status, exact UUID correlation, gap/restart/orphan analysis, and deterministic 8-MiB whole-record reduction. Validation passed: **202/202 tests** (**16 diagnostics + 186 `idle_suspend`**); Cycle 2 code review approved **9.5/10**; canonical advisor lifecycle completed.
- **Production idle-suspend diagnostics — coordinator integration complete (2026-09-13).** `AppState` now owns one optional canonical event writer; the coordinator emits authoritative automatic/manual lifecycle events, preserves exact UUID correlation through helper dispatch, audit, accepted responses, outcome, and reconciliation, and keeps event emission silent for scheduled samples. Validation passed: focused coordinator event tests **7/7**, full `idle_suspend::tests::` unit filter **84/84**, and `server/tests/idle_suspend` integration tests **19/19**; code review approved **9.3/10** with no critical findings.
- **Production idle-suspend diagnostics — helper audit milestone enrichment complete (2026-09-13).** Evolved the existing root helper audit in place to schema v2 with producer identity/sequence, typed rejection/capability/preflight/RTC/invocation/outcome milestones, exact UUID propagation, durable intent ordering, secure bounded pruning, and legacy protocol/action compatibility. Validation passed: focused helper tests **23/23**, full `idle_suspend` module **172/172**, and helper binary build; Cycle 2 code review approved **9.8/10** with no critical or high findings.
- **Production idle-suspend diagnostics — canonical event foundation complete (2026-09-13).** Added the closed canonical event model, boot/producer identity, checked sequence and UUID correlation primitives, plus a bounded mode-0600 no-follow synced JSONL writer. Existing untagged server-audit behavior remains unchanged. Validation passed: canonical event tests **11/11**, server-audit compatibility **1/1**, and full `idle_suspend::` module **143/143**; code review approved **9.5/10** with no critical findings.

# 2026-09-12

- **Explorer Context Menu Integration and Test Coverage.** Added "Preview" action with `Eye` icon to `TreeContextMenu.tsx` for HTML files. Integrated preview handler in `FileTree.tsx` guarded by a 5MB size safety threshold (`node.size < 5 * 1024 * 1024`), setting view mode to `"preview"` before triggering `onFileOpen`. Introduced `HTML_VIEW_MODE_CHANGED_EVENT` (`dam-hopper:html-view-mode-changed`) dispatched by `saveHtmlViewMode` and observed by `HtmlHost.tsx` to ensure mounted tabs immediately switch to preview mode when launched from Explorer.
- Validation: Vitest unit tests **55/55 passed** across context menu consumers, TreeContextMenu, HtmlHost, HtmlPreview, html-file, and html-view-mode-persistence test suites. Chromium browser tests **10/10 passed** in `consumer-context-menu.browser.tsx` verifying context menu preview rendering, file opening, preference persistence, and non-HTML filtering. UI build (`tsc -p tsconfig.json`) passed cleanly.
- **HtmlHost Editor Component and EditorTabs Routing.** Added `HtmlHost.tsx` containing Edit | Split | Preview mode toggle controls, lazy-loaded MonacoHost editor integration, and `HtmlPreview` pane. Implemented Edit mode (100% Monaco), Split mode (50/50 Monaco and sandboxed preview with divider), and Preview mode (100% sandboxed preview), with preferences persisted to `dam-hopper:html-view-mode:v1` and support for `initialMode` overrides. Integrated lazy-loaded `HtmlHost` routing with Suspense in `EditorTabs.tsx` for HTML files matching `isHtmlFile(activeTab.name)`.
- Validation: Vitest unit tests **6/6 passed** in `HtmlHost.test.tsx` (default mode rendering, initialMode override, mode toggling, preference persistence, readOnly propagation). Full suite across HTML preview helpers and components **28/28 passed**. TypeScript compilation passed.
- **HTML File Helper, Mode Persistence, and Sandboxed HtmlPreview.** Added `html-file.ts` with case-insensitive `.html`/`.htm`/`.xhtml` detection and MIME resolution, `html-view-mode-persistence.ts` storing `"edit" | "split" | "preview"` mode under `dam-hopper:html-view-mode:v1` (defaulting to `"edit"`), and the sandboxed `HtmlPreview.tsx` iframe component with `sandbox="allow-scripts allow-modals"` (opaque origin isolation), 200ms debounce, and reload button. Also resolved timer typing in `use-clipboard.ts`.
- Validation: Vitest unit and component tests **22/22 passed** across `html-file.test.ts`, `html-view-mode-persistence.test.ts`, and `HtmlPreview.test.tsx`. TypeScript build (`tsc -p tsconfig.json`) passed cleanly.

# 2026-09-11

- **Configured-agent activity idle suspend — documentation, runbooks, and controlled rollout complete (2026-09-11).** Integrated operator documentation, operations runbooks, controlled rollout stages, and rollback procedures across all system guides.
- Delivered across: `system-architecture.md` (implemented dataflow & heuristic boundaries), `api-reference.md` (v1 status DTO, all enums, nullable counts, privacy boundaries), `configuration-guide.md` (exact paths, startup immutability, TOML examples, rollout stages, two-level rollback), `terminal-idle-suspend-security.md` (unprivileged procfs/netlink boundaries, fail-closed policy, warning exclusions, final race caveat, canary prerequisites), `linux-systemd.md` (observer qualification, operator reason guide, observation soak, bounded canary, stop criteria, rollback runbooks), `linux-release-manager.md`, `code-standards.md`, `codebase-summary.md`, `project-overview-pdr.md`, `project-roadmap.md`, `docs/README.md`, `README.md`, and `scripts/run-uat.sh`.
- Validation passed: boundary checks **14/14**; idle-suspend integration exercised **20/20** scenarios (**19/19** default tests plus **1/1** ignored live Linux smoke in **0.74s**, with 2 other tests ignored); Chromium browser tests **16/16**; full UI suite **1606/1606** across 233 files (1,642 qualified tests plus 14 boundary checks); code review approved **9.6/10**. 
- Rollout status: Real-host automatic suspend canary remains an explicit Operations-supervised deployment gate with host qualification, exclusive RTC ownership, and bounded wake.

- **Configured-agent activity idle suspend — integrated qualification complete (2026-09-11).** Qualified managed PTY output/input, attributable TCP traffic, protected status/API warnings, Chromium rendering, fake suspend admission, recovery, and shutdown.
- Validation passed: backend/PTY/API/integration **323 passed**, security boundary **14/14**, Chromium **16/16**, and the ignored live Linux PTY/TCP smoke **1/1 in 0.72s**; code review approved **9.4/10**. Automated evidence used fake suspend outcomes and did not invoke host suspend, RTC programming, helper execution, sudo, or root installation.
- **Configured-agent activity idle suspend — complete.** Added a
 strict `unknown`-to-`IdleSuspendStatusV1` decoder with exact two-field
 old-server normalization and fail-closed malformed/partial response
 handling. The protected status remains version 1, authenticated, and
 `Cache-Control: no-store`.
- Extended `HostIdleSuspendStatus` with policy, aggregate measurement state and
 reason, nullable/unknown counts, TCP4/TCP6 coverage, persistent heuristic
 limits, bounded measurement-warning duration and PID/safe identity examples,
 and the sole `armDeadlineMs` countdown. Manual force confirmation still uses
 actual fleet counts and existing handoff/409/no-retry behavior.
- Validation passed: protected API **9/9**, frontend unit **41/41**, Chromium
 **13/13**; code review approved **9.7/10**. Warning serialization tests
 reject command arguments, matcher data, socket details, terminal/session
 identities, and tokens. Integrated real-observer qualification remains integrated
 verification work.

- **Configured-agent activity idle suspend — complete.** Added the
 dedicated joinable transactional sampler worker, sequential process/TCP
 prepare with raw-output and manager invalidation fences, one-deep
 retryable-close-race retry, back-to-back baseline commit, and opaque final
 admission tickets.
- Added manager-locked automatic admission for policy, request/activity/epoch/
 timing revisions, quiet deadline, observation age, input/generation/root/
 output fences, and PTY lifecycle blockers. Public status now requires
 `automaticPolicy`, reports nullable `activity`, and projects bounded
 `measurementWarning` process identities (maximum 32, no args or socket
 details). Coordinator recovery latches spent epochs and joins the sampler
 before PTY teardown.

- **Configured-agent activity idle suspend — complete.** PTY sessions now capture qualified root `(pid, start_ticks)` identity per incarnation, count raw PTY reads with a saturating counter, fence accepted input before writer dispatch, reject writes during handoff, and expose bounded private observation snapshots without leaking terminal content.
- Validation passed: focused PTY activity tests **8/8**; PTY module suite **159 passed, 1 ignored** (pre-existing performance gate). Code review scored **9.5/10** with no critical issues.
- **Configured-agent activity idle suspend — complete.** Added private bounded `ProcessDiscovery<S>` over `ProcessSource`/`LinuxProcSource`, exact identity-safe root/retained descendant attribution, finite executable matching, same-namespace socket ownership, and transactional prepared samples.
- Enforced caps for 256 roots, 8,192 scanned processes, 1,024 relevant processes, 4,096 FDs per process, 8,192 socket inodes, and 16 KiB command lines; incomplete, stale, and ambiguous observations fail closed.
- Validation passed: latest focused process discovery validation **18/18**, idle-suspend **100/100**, and PTY **187/187** (one pre-existing performance test ignored). Code review approved **9.0/10** with no critical issues.
- **Configured-agent activity idle suspend — complete.** Added direct unprivileged `NETLINK_SOCK_DIAG` TCP4/TCP6 byte observation, bounded multipart framing and `TCP_INFO` parsing, persistent cookie/family/namespace identity, per-socket differential activity, transactional prepare/commit, and fail-closed transport/privacy handling.
- Validation passed: TCP observer netlink focus **40/40**, latest activity suite **59/59**, full idle-suspend library **128/128**, and crate-wide **142/142**; all reported runs passed. Cycle-2 code review approved **9.8/10** with no critical issues.

# 2026-09-10

- **Production CLI Deployment Setup for Idle Suspend Helper & Socket — complete.** Helper execution verification closes staged-unit, rendered-policy, role-isolation, boundary, and CLI status verification; release-manager activation starts the helper before the API with non-fatal fallback, and rollback/recovery retain helper ownership.
- Validation passed: `linux_release_staging` **9/9**, `linux_release_unit_policy` **10/10**, `idle_suspend` library **69/69**, `idle_suspend` integration **14/14** (**102/102** focused Rust tests); `verify-idle-suspend-boundary.sh` **14/14** checks; `dam-hopper status --json` reports API and helper under `server`.
- Boundary checks 13 and 14 assert API `PIDFile`/`ExecStartPost`/`ExecStopPost` hooks and helper release-manager registration, staging, activation, and status inspection. Automated tests use temporary files/fakes and do not invoke host suspend or real RTC hardware.

# 2026-09-09

- **Production CLI Deployment Setup for Idle Suspend Helper & Socket — complete.** Systemd API/helper units now create and remove `/run/dam-hopper/server.pid`, share a group-writable runtime directory, and expose the helper socket to the authorized API service group.
- Validation passed: systemd unit verification, release/unit-policy tests, idle-suspend tests, and boundary checks **102/102**; cycle-2 review approved **10/10**.

# 2026-09-07

- **Plan item notes and editing.** Restored selected Plan item note rendering with multiline bodies, semantic timestamps, and per-note deletion. Added inline title/summary editing across desktop Deck and compact Sheet, reusing existing workflow PATCH/delete-note mutations with fresh request IDs and exact CAS timestamps.
- Validation: focused workflow Vitest suites **27/27 passed** across action hooks, selected-item UI, responsive Surface, Deck, and Sheet. Changed-file TypeScript checks passed; coverage provider unavailable and an unrelated `use-clipboard.ts` type error remains. Code review 8.5/10, no critical issues; asynchronous edit rejection retention remains a non-blocking follow-up.

- **Cross-Origin Port Transport Guard Fix.**
 Aligned privileged mutation CSRF guards on idle-suspend (`force-suspend`, `timing`) and host actions (`intents`, `approve`, `executions`) with validated Bearer authentication and the server's exact CORS origin allowlist (`AppState::origin_is_allowed`).
 Resolved `403 invalidOrigin` failure on split-port architectures (e.g. UAT web `:4804` / API `:4803`; production `:4802` / `:4801`) where browsers send `credentials: "include"`.
 Applied zero-allocation iterator checks to header cardinality validation; strict foreign, duplicate-Origin, and userinfo rejection preserved.

# 2026-09-06

- **Authenticated Manual Force Sleep — protocol/helper complete.**
 Extended the version-1 enrolled helper execution domain to accept
 `wakeAfterSeconds: 0` as an indefinite-sleep sentinel while keeping persisted
 automatic timing at `60.=86400`.
- Zero converts to clear-only RTC behavior: write and verify `0`, with no
 target-epoch arithmetic or write. Timed values clear and verify, calculate a
 checked target, write it, and verify the readback.
- Added fail-closed RTC ownership preflight (`RtcAlarmBusy`), explicit
 zero-valued helper intent/completion audit records, and no-suspend behavior
 for RTC, audit, capability, inhibitor, or preflight failures.
- Added protocol, backend, preflight, helper IPC, audit, and automatic timing
 regression coverage using temporary files and fake backends only; tests never
 invoke host suspend, logind, or real RTC hardware.

- **Authenticated Manual Force Sleep — coordinator/fleet complete.**
 Added generation-fenced forced fleet admission that bypasses only active-fleet
 quiescence, preserves audit/capability/inhibitor/RTC/peer gates, serializes
 manual work with automatic timing, and releases the handoff on every outcome.
- **Authenticated Manual Force Sleep — REST API complete (2026-09-06 12:00:21 +07:00).**
 Added the protected `POST /api/system/idle-suspend/v1/force-suspend` endpoint
 with strict DTOs and wake bounds, cookie same-origin and enabled-actor
 enforcement, a 16 KiB body cap, coordinator-only dispatch, audited `202`
 admission, typed fleet/handoff conflicts, sanitized closed errors, and
 `Cache-Control: no-store` responses.
- **Authenticated Manual Force Sleep — host popover UI and confirmation dialog complete (2026-09-06 12:20:00 +07:00).**
 Added the destructive "Force Machine to Sleep" action within
 HostIdleSuspendStatus and HostResourcePopover with clean modal handoff to
 Radix ForceSleepDialog, indefinite default (`wakeAfterSeconds: 0`), optional
 bounded RTC wake duration input, active managed session warning and
 confirmation checkbox, authoritative 409 conflict refresh, disabled
 controls during pending mutation, live regions, and 44px touch targets.
- **Authenticated Manual Force Sleep — integration, qualification, and documentation complete (2026-09-06 15:45:00 +07:00).**
 Closed the requirements-to-evidence matrix, protocol/coordinator/REST/UI integration gates, non-privileged boundary verifier, rollback review, and synchronized architecture, API, configuration, security, operations, product, and codebase documentation.
- Validation passed: 81/81 Rust idle-suspend tests, 3/3 UI Vitest tests, 10/10 Chromium browser tests, 12/12 boundary checks, and `cargo check`. Automated evidence uses fakes and temporary files only; the indefinite real-host canary remains explicitly deferred pending Operations approval and verified physical/out-of-band recovery.

# 2026-09-02

- **Workflow tracking domain and relational persistence.** Added the
 additive `010_workflow_tracking.sql` migration for workspace identities,
 Plan/Phase/Task items, manual sessions, terminal/agent resource links,
 durable notes, and append-only activity events. Existing terminal-session
 tables remain unchanged and all workflow tables share the configured
 `sessions.db`.
- Added serializable workflow models and closed enums for item kind/status,
 session lifecycle, resource observations, provenance, and event types.
 Validation enforces bounded titles/bodies/identifiers/payloads, timestamps,
 transitions, and the Plan-first hierarchy (Plan root → Phase → Task, with
 standalone or Plan-level tasks).
- Added `WorkflowStore` repositories for workspace/item/session/resource/note/
 event CRUD, bounded overview aggregation, keyset history, and retention.
 Mutations use SQLite transactions; optional audit events commit atomically,
 event IDs are retry-idempotent, and resource observations never rewrite
 session lifecycle state.
- `server/src/workflow/tests.rs` covers model rules, migration preservation,
 hierarchy/scope checks, idempotency, overlapping sessions, note retention,
 overview progress, pagination, and purge. Workflow HTTP/WebSocket routes
 remain outside this scope.
- **Workflow service and REST API.** Added the profile/workspace-
 scoped `WorkflowService` and protected `/api/workflow/*` routes for bounded
 overview/history, Plan-first item CRUD, manual session lifecycle,
 terminal/agent links, durable notes, and explicit history purge.
- REST mutations use strict camelCase DTOs, UUID request replay keys,
 optimistic `updatedAt` CAS for item/note/link updates, typed sanitized
 workflow errors, and a focused 32 KiB body limit. Events use opaque keyset
 cursors; automatic retention purges in bounded batches.
- Added API integration coverage in `server/tests/workflow_api.rs` for auth,
 hierarchy, overview, replay/CAS, sessions, links, notes, pagination, limits,
 invalid transitions, and purge. [See workflow API reference](./workflow-api.md).
- **Terminal lifecycle correlation and agent adapter.** Added the
 closed `WorkflowObservation` contract and clone-cheap PTY recorder. A bounded
 `sync_channel(256)` worker keeps workflow SQLite off PTY input/output/restart
 hot paths; queue-full and storage failures are counted/logged without
 blocking terminal operation.
- Lifecycle payloads are strictly allowlisted (terminal ID, incarnation,
 configured project, validated worktree target, server time, exit/restart
 metadata, and action). Command lines, arguments, CWD, environment, prompts,
 output, and arbitrary adapter payloads are excluded.
- Terminal links transition through `attached`, `stale`, `exited`, `crashed`,
 and `detached` with incarnation ordering and deterministic replay
 suppression. Final exit/removal may suggest an end time but never changes
 manual session status or `startedAt`/`endedAt`.
- Startup restores PTYs before reconciling persisted terminal links against
 live `(sessionId, incarnation)` identities. Agent links remain bounded manual
 `harnessLabel`/`runId` metadata; no automatic harness producer or generic
 observation endpoint was added. Direct Plan sessions do not synthesize
 Phase/Task children.
- Workflow service review reports 28 workflow tests and 907 full-server tests passing;
 review approved 9.8/10.
- **Client types, transport, and query state.** Added strict shared-UI workflow DTOs and domain helpers, all 13 protected REST operation mappings, profile/transport-generation-isolated React Query hooks, mutation invalidation and request-ID replay handling, and manual timestamp/resource-observation helpers. Existing terminal navigation and localStorage state remain unchanged.
- Validation: Targeted workflow client UI tests 51/51, full UI suite 1,452/1,452, and Rust server 907/907 executed tests passed (2 ignored); code review approved 10/10. Formal source coverage was not generated because the UI coverage provider is unavailable, and the existing React `act(..)` warning is non-blocking.
- **Responsive workflow context surface.** Added the Plan-first ambient context ribbon, responsive desktop deck, mobile segmented safe-area sheet, optional Phase/Task capture, direct notes/sessions/execution links, manual timestamp/**Now** controls, observed terminal suggestions, focus-safe shortcut ownership, and loading/error/empty states.
- Validation: targeted workflow surface UI tests passed 62/62 (100%), full UI suite passed 1,493/1,493 (100%), and Rust server executed tests passed 907/907 (2 ignored). Review approved 9.8/10. Responsive browser geometry, safe-area, and terminal/editor continuity remain subsequent integration validation work.
- **WorkspacePage and shell integration.** Complete / 
 2026-09-02. Mounted one `WorkflowContextSurface` through the existing
 `toolbarActions` companion row in `IdeShell`, `TerminalWorkspaceShell`, and
 `MobileWorkspaceShell`; no route, activity-bar tool, mobile surface, TopNav
 item, or duplicate PTY lifecycle.
- Added pure `packages/ui/src/lib/workflow-workspace-integration.ts` decisions:
 `deriveWorkflowTerminalCandidates` merges mounted/session-map observations
 with target-unavailable state without command, CWD, or output;
 `resolveWorkflowTerminalReveal` rejects missing/profile-mismatched/stale IDs,
 reuses `handleSelectTerminal`, and requests the compact Terminal surface only
 in compact mode; `resolveWorkflowTargetSelection` validates configured
 project/worktree availability before using existing workspace and
 project-target stores.
- Wired `onOpenTerminal` through `WorkflowContextSurface`,
 `WorkflowContextDeck`, `WorkflowContextSheet`, `WorkflowExecutionList`, and
 `WorkflowSessionCard`; wired `onSelectTarget` through the surface,
 deck/sheet, and `WorkflowProjectList`. Keyed the surface by
 `activeProfileId` so profile changes reset workflow presentation state while
 terminal/editor/Browser keep-alive state remains mounted.
- Validation: targeted UI 62/62, full UI 1,515/1,515, relevant Chromium
 smoke 8/8, Rust 907/907 executed (2 ignored), and UI TypeScript compilation
 passed; review approved 9.8/10.
- **Verification, rollout, observability, and docs.** Completed the additive migration/restart/rollback rehearsal, privacy-safe workflow diagnostics, old-server compatibility, responsive accessibility contracts, real-terminal continuity, and documentation gates. Migration 010 remains additive; rollback retains workflow tables/data, and older binaries ignore them.
- Added fixed-cardinality workflow diagnostics in `DiagnosticStore`: `workflow_operation_duration_seconds` (duration capped at 60 seconds), `workflow_queue_dropped_total` (non-blocking 256-entry observation queue drops), `workflow_reconciliation_total` (attached/detached counts capped at 1,000), and `workflow_storage_errors_total` (bounded store-failure outcomes). Operation/result dimensions are enums; duration, row, event, and count fields are bounded. No IDs, projects, paths, notes, external runs, commands, CWD, environment, prompts, or output are recorded.
- Older servers that return HTTP 404 for `GET /api/workflow/overview` now produce a profile-scoped feature-unavailable state, suppress query retries, close/hide workflow controls, and announce the unavailable state. Authentication and 5xx failures remain explicit errors with retry behavior; other workflow 404s retain their API semantics.
- Keyboard/focus contracts preserve editor and xterm ownership, return focus to the workflow trigger on Escape, expose named regions and status text, enforce 44px touch targets, bound the desktop deck and mobile 35/90dvh sheet, honor safe-area and reduced-motion behavior, and prevent horizontal overflow.
- Validation: focused Rust gates **134/134 passed**, focused UI Vitest **122/122 passed** across 13 files, and real-server Chromium browser **4/4 passed** against the actual no-auth backend, covering workflow state/actions, responsive keyboard/focus behavior, unavailable fallback, and terminal continuity.
- **Workflow note and summary multiline Textarea improvement.** Added the shared `Textarea` atom primitive (`packages/ui/src/components/ui/Textarea.tsx`) matching the `glass-input` design tokens and focus ring styling. Updated `WorkflowSelectedItemBar` to use `Textarea` for note drafting with multiline input, autoFocus, explicit `aria-label="Note content"`, Ctrl+Enter / Meta+Enter submission, and Escape cancellation. Updated `WorkflowQuickCapture` summary region to use `Textarea` for multiline item summary descriptions.

# 2026-08-31

- **Preserve Explorer Tree Expansion & Editor View Scroll Position.**
  - **Explorer Tree Expansion Store:** Added persistent Zustand store `useExplorerTreeStore` to preserve directory open/closed states across sidebar tool switching, shell layout changes (IDE vs. Terminal workspace modes), sidebar collapsing/reopening, and browser page reloads. Scoped per project and worktree target (`dam-hopper:explorer-tree-state`). Includes cascading auto-hydration on remount and pruning/renaming synchronization.
  - **Editor ViewState Persistence:** Added Monaco editor `viewState` (cursor position, column, scroll offsets, and code folds) persistence across tab switches, unmounts, and browser page reloads under `dam-hopper:editor-state`. Implemented race-safe view state capture via `prevTabKeyRef` and originating `targetKey` attribution.
  - **Integration & Verification:** Verified end-to-end tree expansion preservation across all three shell surfaces (main IDE sidebar, compact mobile surface, and floating terminal files panel) and editor scroll/cursor retention across tab switches and page reloads. Full test suite passing (213 files / 1,422 unit tests, UI build, browser tests, and zero ESLint errors).
- **Runtime terminal custom-name persistence.** Added nullable runtime `name` independent of configured profile names, SQLite migration 009, and persistence-first acknowledgements for rename, removal, and reusable `dispose`; replacement/restore cleanup is race-safe.
- Create and authenticated `PATCH` rename trim/validate names (≤64 Unicode scalars, no control characters) and blank/`null` clear overrides. Names flow through respawn/restore, API/WebSocket, and frontend terminal labels; rename UX is durable and cleared names return to existing fallback labels.
- Validation: backend full `cargo test` **874 tests, 2 ignored**; UI full **212 files / 1,411 tests**; production build and focused browser smoke passed. Broad browser remains **183/187**, with four failures in unchanged baseline areas: `app-zoom` (320×180 expected, 352×198 received), `ssh-forward-multi-connection` (switches expected disabled, enabled), and `terminal-panel-replay-notifications` (activity expected inactive, active). No restart-persistence manual claim: graceful stop removes sessions by design.
- **Traditional-mode Global Search focus retention.** Callback-only pane
 rerenders no longer move focus from Global Search to xterm while typing;
 semantic pane/session focus and native-input suppression remain intact.
- **Traditional active-pane floating scroll controls.** Enabled
 `TerminalScrollButtons` now render only for the active Traditional pane above
 `MobileTerminalAccessoryBar` with the Runtime-compatible accessory-rail
 contract; inactive panes and Browser remain excluded. Runtime source and
 behavior remain unchanged.
- Focused validation passed: UI TypeScript build, focused unit tests (2 files/5
 tests), focused Chromium tests (2 files/8 tests), and actual-app smoke
 confirming three-character search focus retention, scroll trigger/group
 placement above keyboard controls, no xterm focus on scroll activation, and
 Runtime contrast. Final code review found no issues; no broad repository-suite
 or production/cross-platform release validation is claimed.
- **Traditional terminal close selection fix.** Closing a Traditional terminal now
 keeps the selected terminal within the same project instead of selecting one
 from another project; Runtime behavior is preserved. Focused validation passed:
 23 unit tests, 9 Traditional Chromium tests, and the UI TypeScript build.
 Production-like callback integration coverage remains a follow-up.

# 2026-08-30

- **Browser Debug/native support documentation refresh.** Recorded the Windows
 WebView2 v1 gate, Linux runtime-unverified status, macOS deferral, Android
 iframe fallback, profile-scoped storage, generation/nonce/request validation,
 raw bounds plus mirrored app zoom, relay capabilities, and popup/download/
 permission/console boundaries. See [Native Browser Debug Support](./native-browser-debug-support.md).

# 2026-08-15

- **Native SSH port-forwarding Windows gate (complete for Windows-only scope).** Added Windows CI and release pre-bundle checks for Rust formatting/lint/unit coverage, the real temporary OpenSSH remote-loopback forwarding gate, deterministic smoke/evidence validation, WebView2/OpenSSH preflight, no-bundle Tauri compilation, protected same-commit evidence binding, and the unsigned NSIS package profile. Protected packaged-runtime evidence remains a production-release prerequisite; cross-platform support and signed updater artifacts are deferred to a separate scope.

## 2026-08-11

- **Host-resource restoration alerts.** Added additive snapshot
 `currentAlerts` for concurrent thermal/disk incidents without changing the
 legacy memory alert, newest-first mixed incident history, and compatible
 `host:alertChanged` resource payloads. The client validates event shape and
 nested evidence before cache updates, preserves active incidents if an older
 server omits the additive field, and removes only the recovered target. Known
 accepted UI caveat: after acknowledgement, a resource-only critical badge can
 render info-colored while its active count and incident state remain correct.

## 2026-08-05

- **Codex OTel-only Usage refactor.** Removed terminal Usage work from PTY production paths and
 made bounded Codex `response.completed` OTLP events the sole usage write source. The fresh
 Codex-only `telemetry.db` schema, aggregate/session API, Usage page, and Settings exporter flow
 now document retention-bounded (not permanent) session summaries, WAL/SHM reset boundaries, and
 privacy-safe data contracts. `sessions.db` remains protected from telemetry resets. Automated Rust, UI, web,
 and browser gates pass; manual PTY benchmarking, signing, and target-environment release checks
 remain follow-ups.

## 2026-07-30

- **Native embedded browser controller.** Added the Tauri desktop child-WebView controller, build-time bridge injection, loopback/HTTPS tunnel navigation policy, bounded native relay validation, profile-isolated browser storage, lifecycle/geometry commands, and fail-closed popup, download, redirect, external-scheme, and permission handling. Windows WebView2 is the verified implementation target; Linux now has a WebKitGTK relay implementation but remains runtime-unverified, and macOS is deferred. See [Native Browser Debug Support](./native-browser-debug-support.md).

## 2026-08-01

- **Stale lazy-chunk recovery.** The shared `ErrorBoundary` now
 recognizes only known browser module-load signatures (`ChunkLoadError`, failed
 Vite chunk loads, and dynamic-import/module-script fetch failures). It writes
 the namespaced `dam-hopper:stale-chunk-reload-attempted` key to
 `sessionStorage` before one reload per tab session. Storage read/write errors
 fail closed and retain the existing fallback; second stale failures and
 unrelated render errors also retain the existing fallback and diagnostics.
 Focused `ErrorBoundary` tests cover classifier boundaries, first/second
 failures, unrelated errors, and unavailable storage.

## 2026-07-25

- **Controlled browser debug preview and terminal handoff.** Added an
 extension-assisted iframe Browser tool with bundled client extension setup,
 bounded DOM/ARIA
 selection, optional user-mediated tab capture, manual-image fallback, and
 short-lived authenticated JSON/PNG artifacts. Explicit confirmation inserts
 only generated artifact paths into a selected live terminal, without page
 text, terminal controls, or auto-submit. Target reloads invalidate prior
 selection state; CSP/framing failures, capture denial, stale tunnels, and
 closed terminals fail closed.
 Automated hardening covers malformed/nested bridge messages,
 capture cleanup and JPEG conversion, tunnel invalidation, private artifact
 boundaries, and the no-read artifact contract. Chromium permission chooser,
 HiDPI crop, live tunnel, and real-xterm checks remain manual release gates.

## 2026-07-16

- **Configurable terminal panel shortcuts.** Added settings-backed shortcuts for
 Git (`Ctrl+Shift+G`), Ports (`Ctrl+Shift+P`), and Fleet Terminal
 (`Ctrl+Shift+M`). Each shortcut toggles its target and closes the other two;
 xterm input suppresses the bindings so they never reach the PTY.

## 2026-07-14

- **Explorer: Copy Path context menu.** Complete ✓ 2026-07-14. Added "Copy Absolute Path" and "Copy Relative Path" items to the Explorer (file-tree) right-click menu for both files and folders. Absolute path joins the server-resolved absolute project root (`useProject(name).data.path`) with the node's project-relative path using the native separator (backslash on Windows, forward slash elsewhere); relative path is always forward-slash POSIX. Path computation and the menu item list are extracted into pure `buildTreeCopyPaths` / `getTreeContextMenuItems` helpers for SSR unit testing, mirroring the `getEditorTabContextMenuItems` pattern. The absolute item disables when the project root is unknown; a transient "Copied to clipboard" toast reuses the existing `useCopyToClipboard` hook. Frontend-only; no backend/API changes. Validation: `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/ui test` (422 passing), changed files lint-clean.

## 2026-07-08

- **Bottom Panel Maximize Toggle.** Complete ✓ 2026-07-08. Added an IntelliJ-style maximize/restore toggle to the IDE bottom tool panel header. Maximizing hides the top area (explorer/editor/right panels) and expands the bottom panel to fill the workspace body; activity bars stay visible so tools remain switchable. State is session-only (not persisted), closing the maximized bottom tool resets it, and the terminal keep-alive element stays in the same React tree position so no PTY is remounted or duplicated on toggle. Layout decisions were extracted into a pure `resolveBottomPanelLayout` helper for SSR unit testing (toggle/restore/reset-on-close), plus an `IdeShell` SSR contract test for button presence/absence. ESLint config now ignores Rust/Tauri `target/` build artifacts that previously produced ~200 false parsing errors.

- **Bottom panel maximize: auto-restore on top tool selection.** Enhanced the maximize toggle so clicking maximize also unselects any active top tools on both sides (the activity bar no longer highlights them while the bottom panel covers the top area). Selecting a top tool from the activity bar again — or triggering a reveal-active-file request — automatically restores the normal (non-maximized) layout. Maximize/top-tool state transitions are extracted into pure `resolveMaximizeToggle` / `resolveTopToolToggle` helpers for SSR unit testing.

## 2026-05-31

- **Diagnostic Log Capture.** Complete ✓ 2026-07-07. Added Settings > Maintenance `Export Diagnostics` in the UI and a protected `POST /api/diagnostics/export` flow that sends the canonical `frontend` snapshot payload plus default 60-minute and terminal-tail settings. Downloads use `dam-hopper-diagnostics-{timestamp}.json`. Exported terminal tails are included by default and should be reviewed before sharing because they can still contain sensitive local/dev output.

- **PTY And WebSocket Instrumentation.** Complete ✓ 2026-07-07. Added backend terminal diagnostics events for PTY create/spawn failure/EOF/read error/exit/kill/remove/restart decisions, WS terminal control tracing, frontend transport lifecycle tracing, TerminalPanel attach/create/replay diagnostics, renderer-mode instrumentation, and capped terminal-tail export. Export scopes `terminals.sessions` and `terminals.tails` to requested terminal ids and keeps input data redacted as byte counts only.

- **Shared terminal rendering and resize smoothing.** Added WebGL2-backed xterm rendering across browser, desktop Tauri, and Android WebView hosts with quiet DOM-renderer fallback when unsupported, initialization fails, or the WebGL context is lost. Centralized animation-frame terminal fitting and host attachment to coalesce live-resize work while preserving split-pane docking, tab keep-alive behavior, and mobile native-keyboard focus suppression.

- **Terminal mode switching buffer readability fix.** Kept xterm instances mounted across Traditional ↔ Runtime terminal view switches so historical output is not replayed and rewrapped at a different width during Runtime navigator resizing.

## 2026-05-25

- **Responsive Companion Layout.** Complete ✓ 2026-05-25. Added the compact responsive workspace shell with shared media-query helpers, safe-area/dynamic-height CSS primitives, mobile/tablet surface switching, and terminal refit handling for hidden-panel transitions. Reused the existing editor, terminal, fleet, ports, Git, and project surfaces without duplicating business logic. Hardened `MobileWorkspaceShell` for empty-surface fallback, improved TopNav selector layering and compact/tablet behavior, and aligned compact navigation behavior with zoomed and iPad-sized layouts. Validation passed for `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, and `pnpm dev` startup verification.

- **Tauri Native Shell.** Implemented 2026-05-25. Added `@dam-hopper/native` as a thin Tauri v2 host that mounts the shared `@dam-hopper/ui` app, configures the shared logger and TanStack Query, uses an idle transport until a server profile exists, and keeps the native shell remote-client-only with `core:default` permission. Added native Vite config on port 1420 with HMR port 1421, minimal `src-tauri` Rust entrypoint/config/capability, restrictive CSP, root native scripts, native build coverage in `pnpm check`, CORS documentation for Tauri origins, and a committed native Cargo lockfile. Validation passed for native TypeScript and Vite build; full desktop Tauri runtime validation is blocked locally by missing Linux prerequisites (`webkit2gtk-4.1`, `rsvg2`, `dbus-1.pc` / `libdbus-1-dev`, `pkg-config`).

- **Shared Logger And Runtime Utilities.** Complete ✓ 2026-05-25. Added the dependency-free `@dam-hopper/shared` logger API (`configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`) with recursive sensitive-metadata redaction before the sink, wired web bootstrap log level selection to Vite env with dev-debug / prod-warn fallback, and replaced direct `console` usage in high-value transport/auth/terminal/dashboard/error-boundary/fs paths. `packages/ui` keeps `cn` as-is. Verification passed for shared tests/build, ui tests/build, and web build.

## 2026-05-23

- **Root-Aware Git Push and SSH Retry Flow.** Complete ✓ 2026-05-23. Rebuilt push on top of libgit2 so `POST /api/git/push` keeps the root-aware UI/API contract while the backend now uses `Remote::push(..)` with the same credential callback order as fetch/pull: loaded key, SSH agent, credential helper, then default credentials. `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` all preserve the selected VCS root in the push payload, the shared SSH retry hook still normalizes single-result versus array Git responses before auth detection, and successful pushes still invalidate the broader Git cache set. Focused Rust coverage now includes successful local bare-remote push, missing-upstream failure, nested-root isolation, and callback-level remote rejection reporting.

## 2026-05-20

- **Backend VCS Root Discovery.** Complete ✓ 2026-05-20. Added backend discovery for git roots under a project: the server now resolves the primary repo, nested repos, and submodule gitlinks, exposes them through `GET /api/git/{project}/roots`, and reports mapping state plus submodule metadata for client-side root selection. Invalid `.gitmodules` files are tolerated with warnings on the primary root. Tests cover mapped, unmapped, missing, uninitialized, and traversal-blocked roots.

- **Tests Docs Validation.** Complete ✓ 2026-05-20. Validated the multi-root Git work with real repo tests and web Vitest coverage, then updated the API, system architecture, and frontend component docs for root discovery and root-scoped Git behavior. Full Rust and web suites passed; no critical review issues remained.

- **Terminal Workspace Verification and Docs.** Complete ✓ 2026-05-20. Verified terminal workspace behavior through web tests, web build, focused Rust `ui_config` tests, and real-browser checks. Real-browser verification exposed a swapped split-action mapping in the terminal tab bar; `Split Right` and `Split Down` are now wired to the correct pane directions, and the UI mapping is covered by a focused regression test. Terminal mode now keeps the existing Ports panel in the right rail below Fleet Terminal for development port and tunnel access. Frontend docs now also record the terminal workspace persistence keys and runtime verification boundaries.
- **Terminal Workspace Advanced Docking.** Complete ✓ 2026-05-20. Terminal workspace drag and drop now uses explicit docking intents: pane center moves, edge splits, tab insertion targets, same-pane tab reorder, empty-pane insertion, labeled docking previews, and a richer drag overlay. The layout state was refactored into pure tree/docking helpers so docking updates are atomic and persisted without touching PTY lifecycle. Focused docking tests and `pnpm --filter @dam-hopper/web build` passed.
- **Terminal Workspace Layout.** Complete ✓ 2026-05-20. Workspace Terminal now renders a full-height shell below the top nav, Fleet Terminal stays available as a persisted right rail in terminal mode, the existing terminal manager state is reused across mode switches, and terminal panes refit when mode or rail layout changes.

# Changelog

- **Git-unavailable production state.** Complete ✓ 2026-08-01.
 Git-uninitialized projects now return HTTP 409 with error code
 `GIT_NOT_INITIALIZED`; the typed client exposes `ApiRequestError` and the
 `GitDiffResult` unavailable variant. Root/branch/history surfaces and
 `GitLocalChanges`/Changes panels render actionable `git init` guidance,
 while discovered usable nested roots remain root-scoped for branch and diff
 operations.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## 2026-08-14

- **Native SSH Port-Forwarding Control — (Windows desktop scope).** Completed the host-gated `/ssh-forwarding` route and navigation, explicit reviewed profile form, lifecycle controls, agent/opaque-key inventory selection, unknown-host approval, changed-key stopped-app remediation presentation, bounded reconnect/auto-start states, and exact local-process/loopback security copy. Browser and native-mobile hosts expose no matching route and make zero forwarding calls. Validation: UI 181 files/1,050 tests, Chromium 28 files/121 tests, Rust 140 passed/1 ignored; build, lint, `cargo check`, `cargo fmt`, and diff checks passed. Cross-platform, packaged-runtime, security, product, and manual release verification gates remain deferred; release readiness is not claimed.

## 2026-07-26

- **Terminal usage analytics persistence.** Added opt-in telemetry startup/shutdown with a
 dedicated bounded worker, private `telemetry.db` SQLite/WAL storage, idempotent command and token
 writes, UTC daily rollups before detail purge, configurable retention and project exclusions, and
 HMAC-key/file permission hardening. Database failures remain isolated from PTY flow; aggregate API
 routes remain scheduled for subsequent API milestones.

- **Validated shell lifecycle capture.** Bash, Zsh, and Fish now report
 bounded completion status through versioned OSC 633 adapters. PTY lifecycle events
 carry terminal-run/sequence identity and privacy-safe normalized command metadata
 through a bounded non-blocking telemetry sink. The default path is no-op and
 non-durable; `ChannelTelemetrySink` is reserved as the durable-worker telemetry
 boundary.
 and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- IntelliJ-style **Edit Commit Message** for any unpushed commit reachable from
 the checked-out branch. Added full-message read and guarded message-rewrite
 REST APIs, root-commit and descendant replay support, shared Git history UI
 wiring, multiline editing, and pushed/non-active-branch availability guards.

- **Workspace Split.** Complete ✓ 2026-05-24. Split the web frontend into a thin `apps/web` Vite host plus a shared `packages/ui` React package, preserving current browser behavior while moving shared components, hooks, styles, tests, assets, and transport-facing UI code behind explicit UI package exports. No native behavior was added yet in this initial layout.

- Root-aware force-push support on the actual push flow. `POST /api/git/push` now accepts `force: true`, and the Push entrypoints in `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` expose a confirmed `Force Push` action that reuses the same libgit2 credential callback path as normal push. This stays separate from the guarded history-rewrite endpoints: pushed/shared-history drop and undo flows still recommend revert instead of silently overriding safety checks.
- Shared Git push feedback in the web UI. The SSH retry status banner now also confirms successful push completion, so regular push, force push, and passphrase-retry push all report a visible result after the request finishes.

- **Terminal Workspace Shortcut Routing.** Complete ✓ 2026-05-19. Added configurable terminal workspace switching: `UiConfig` now carries `terminalWorkspaceShortcut` with default `Mod+Shift+Backquote`, the settings UI exposes a Terminal workspace row, `WorkspacePage` toggles IDE/Terminal mode from the configured shortcut, and `TerminalPanel` plus `PaneContainer` suppress that shortcut from xterm input so the binding stays global.

- **Workspace Mode Shell.** Complete ✓ 2026-05-19. Added persisted workspace mode for the main shell: `WorkspacePage` now owns `ide`/`terminal` mode state in `localStorage` key `dam-hopper:workspace-mode`, `IdeShell` accepts optional mode props and forwards them to `TopNav`, and `TopNav` shows a compact IDE/Terminal toggle only when those props are present. IDE mode behavior stays unchanged when mode props are omitted.

- **IntelliJ Real Git Semantics Verification and Docs.** Complete ✓ 2026-05-19. Expanded verification coverage for the real Git semantics refactor: backend tests now cover active-operation rewrite blocking and recovery metadata, frontend tests cover targeted Git invalidation, selected-history refresh, pushed rewrite availability, and recovery banner copy, and the API/architecture docs now define the safe-vs-rewrite history contract plus manual browser verification checklist.

- **IntelliJ-Compatible Actions.** Complete ✓ 2026-05-19. Added the remaining IntelliJ-style Git action split so safe history preservation and rewrite actions are separate: revert commit for pushed/shared history, revert selected changes as a non-history-rewriting path, undo last commit to move changes back into the worktree, explicit confirmation copy for destructive actions, and backend/web API surface updates for the new action routing.

- **IntelliJ-Style Git Workspace Semantics.** Complete ✓ 2026-05-19. Updated the web Git workspace to use a shared commit-action status model and tighter workspace refresh behavior: `GitHistoryActions` now maps Git mutation results into explicit `success`/`blocked`/`conflict`/`dirty`/`error` states, local commit drops are blocked for pushed commits with a shared revert recommendation, `WorkspaceGitPanel` refreshes branches, project status, history, and selected commit files in one flow, `GitPage` reuses the same history-action hook for the standalone Git view, and editor tab reconciliation was aligned with Git-side file updates through the shared query helpers.

- **Backend Real Git Semantics.** Complete ✓ 2026-05-19. Refactored Git history mutations around real `git` porcelain contracts: (1) new repo-state helpers detect clean worktree, current branch, reachability, pushed commits, and active merge/rebase/cherry-pick operations; (2) `GitActionResult` now carries `recovery`, `blockedReason`, and `recommendation`; (3) full commit drop uses reset for local `HEAD` and `rebase --onto` for non-HEAD local commits; (4) pushed/shared history drop is blocked by default with revert recommendation; (5) whole-commit and selected-file revert primitives are exposed through REST and the web API client; (6) regression tests cover HEAD drop, non-HEAD drop with descendants, root/pushed blocking, active rebase blocking, selected-file revert, and active-operation detection.

- **PTY Env Leakage Verification And Documentation.** Complete ✓ 2026-05-16. Added regression coverage proving PTY children do not inherit non-allowlisted parent env, safe baseline vars remain available for shell execution, project terminal sessions load project environment-file values, request `env` overrides win deterministically, and malformed project environment files fail terminal creation with a clear error. Updated `docs/configuration-guide.md` to document terminal env precedence.

- **Backend PTY Env Isolation.** Complete ✓ 2026-05-16. PTY child sessions now start from a safe baseline instead of inheriting the DamHopper server process env, and project terminal sessions load `env_file` values before request overrides. Validation passed with targeted PTY and terminal tests plus full `cargo test`.

- **Git Management Verification And Documentation.** Complete ✓ 2026-05-16. Documented the completed Git management public surface in `docs/api-reference.md` and `docs/frontend-components.md`: branch listing/create/checkout/update, cherry-pick, reset modes, commit amend, shared action result flags, Explorer branch controls, dirty checkout choices, and history actions.

- **Frontend Git Management.** Complete ✓ 2026-05-16. Added the Git workspace UI in `packages/web/src/components/pages/GitPage.tsx` and related organism components for branch control, history browsing, and working tree review: `WorkspaceGitPanel`, `GitBranchControl`, `GitBranchControlDialogs`, `GitHistoryActions`, `GitLogTree`, `GitLocalChanges`, and `ChangedFilesList`. The updated flows wire the frontend to branch/history APIs through the shared API client and keep Git-aware file rows aligned with the shared file decoration registry.

- **Backend Git Operations.** Complete ✓ 2026-05-16. Expanded git API coverage for branch and history actions: (1) `POST /api/git/:project/branches` creates a branch with optional checkout; (2) `POST /api/git/:project/branches/checkout` supports `normal`, `stash`, and `force`; (3) `POST /api/git/:project/branches/update` updates a branch from its tracking branch; (4) `POST /api/git/:project/cherry-pick` applies a commit; (5) `POST /api/git/:project/reset` supports `soft`, `mixed`, `hard`, and `keep`; (6) `POST /api/git/:project/commit` now accepts `amend`; (7) branch names and commit hashes are validated before execution; (8) destructive modes return structured result flags for dirty/conflict cases.

- **Port Session Control Data Flow.** Complete ✓ 2026-05-15. Frontend ports state now preserves detected owner sessions and exposes a kill-session mutation: (1) `PortEntry.sessionId` keeps `DetectedPort.session_id` for detected rows; (2) tunnel-only rows keep `sessionId: null`; (3) `usePorts()` exposes `killPortSession(sessionId)` and revalidates `ports` plus terminal session queries after `terminal:kill`; (4) no direct PID/process killing added.

- **Shared File Decoration Registry.** Complete ✓ 2026-05-15. Centralized frontend file metadata lookup in `packages/web/src/lib/file-decoration.ts`: (1) one registry now drives icon, badge, display-language, and Monaco-language selection; (2) exact filename matches cover dotfiles and toolchain files like `.env`, `.gitignore`, `Dockerfile`, `Makefile`, and lockfiles; (3) extension lookup covers code, docs, data, images, archives, fonts, and common config files; (4) MIME fallback handles generic or missing file types; (5) `file-decoration-icon.tsx` is a thin render wrapper; (6) `mime-to-language.ts` stays as a compatibility wrapper for MIME-only callers; (7) unit tests cover exact-name priority, extension fallback, MIME fallback, and neutral defaults.

- **Shared File Decoration Integration.** Complete ✓ 2026-05-15. Rolled the shared decorator out to the visible IDE surfaces: (1) `FileTree` now renders file-specific icons through the shared registry; (2) `EditorTab` uses the active file path/name for its decoration instead of a generic file glyph; (3) `SearchPanel` file headers show the same decoration as the explorer and tabs; (4) file rows in git/change views can reuse the same lookup without changing VCS badges; (5) `FilePathLabel` continues to read from the shared helper so path labels stay consistent everywhere.

- **IDE Tool Windows Refactoring.** Complete ✓ 2026-04-25. Refactored `IdeShell.tsx` to support a flexible, extensible Tool Window system with an Activity Bar, similar to IntelliJ IDEA: (1) New `ActivityBar` component for switching between tool windows (Files, Terminals, etc.); (2) Extensible `ToolWindowDef` interface for defining tool name, icon, and component; (3) `ToolPanel` container with header, actions, and auto-focusing behavior; (4) Persisted layout state in `IdeShell` (active tool ID, sidebar width); (5) Refactored `IdeShell` to use a cleaner tool window state management pattern; (6) Migrated `FileTree` to the new system as the default 'files' tool; (7) Seamless integration with existing `react-resizable-panels` layout; (8) Full TypeScript coverage and logic verification.

- **OPAQUE PAKE Server Integration (Stealth Encrypted Upload).** Complete ✓ 2026-04-27.
 Server-side OPAQUE password-authenticated key exchange for the encrypt-in-transit file upload feature: (1) New `server/src/crypto/` module — `DamHopperOpaqueSuite` implementing `CipherSuite` (Ristretto255 + TripleDH + Identity KSF, matching `@serenity-kit/opaque` client defaults); (2) `load_or_create_server_setup()` generates or loads the server long-term keypair at `~/.config/dam-hopper/opaque-server-setup` with 0o600 permissions; (3) Registration handlers: `handle_register_start()` / `handle_register_finish()` — stateless two-message flow, returning `RegistrationResponse` and `ServerRegistration`; (4) Login handlers: `handle_login_start()` / `handle_login_finish()` — two-message flow, returning intermediate `ServerLogin` state and final AES key derived via HKDF-SHA256 with label `"dam-hopper-aes-256-gcm-v1"`; (5) `export_key` wrapped in `Zeroizing<Vec<u8>>`, zeroed on drop; (6) New `AppState` fields: `opaque_server_setup: Arc<ServerSetup<DamHopperOpaqueSuite>>` (shared) and `opaque_registrations: OpaqueRegistrations` (in-memory HashMap, ephemeral by design — no disk persistence); (7) 8 new `ClientMsg` WS variants (`auth:register_start/finish`, `auth:login_start/finish`, `fs:put_begin/chunk/commit/save`) and 8 new `ServerMsg` response variants with neutral `auth:*` / `fs:put_*` kind names to avoid IDS/DLP fingerprinting; (8) Full WS dispatch in `ws.rs` with all OPAQUE ops in `spawn_blocking`; per-connection caps: 16 in-flight login states, 16 active session keys; `overwrite: bool` on `auth:register_finish` prevents silent credential overwrite; (9) Chunked `fs:put_*` handlers stubbed (return not-implemented error); (10) Identifier validation: alphanumeric + hyphens + underscores, max 128 chars. New Cargo dependencies: `opaque-ke = "4"`, `hkdf = "0.12"`, `rand`, `aes-gcm = "0.10"`, `sha2 = "0.10"`, `zeroize = "1"`.

- **Combined Ports & Tunnel Panel (F-09 Auto Port Forwarding).** Complete ✓ 2026-04-25. Unified sidebar panel merging port detection and tunnel management into single component: (1) `PortsPanel.tsx` replaces deprecated `TunnelPanel` + `PortsPanel`, deletes former; (2) `usePorts` hook merges `DetectedPort[]` (from `/api/ports` via WS `port:list` channel) with `TunnelInfo[]` (from `/api/tunnels`) by port number into single `PortEntry[]`; (3) Three port row states: A (no tunnel, "Open localhost" button if same-host + "Start tunnel"), B (tunnel starting with spinner), C (tunnel ready with public URL + copy/QR/stop buttons); (4) `isLocalServer()` helper determines if browser and server on same host — gates "Open localhost" button visibility; (5) WS event subscriptions: `port:discovered`, `port:lost`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped` invalidate queries in real-time; (6) Custom port form allows starting tunnels for specific ports not yet detected; (7) cloudflared installer row preserved (shows missing binary state); (8) Public URL warning banner localStorage-gated, shown once per browser; (9) Sidebar integration: single `{!collapsed && <PortsPanel />}` replaces both former panels; (10) `use-tunnels.ts` kept for subsequent evaluation. Zero breaking changes, full backward compatibility with existing port/tunnel infrastructure. [See documentation](./frontend-components.md#portspanel).

- **Drag-to-Split Terminal Layout (F-06 Terminal Splitting).** Complete ✓ 2026-04-24. Interactive terminal pane splitting and tab management via drag-and-drop: (1) New `TabBar` component with draggable tab handles using @dnd-kit/core (PointerSensor 8px activation); (2) `PaneContainer` with `PaneDropZones` (5 zones: top/bottom/left/right edges, center) always mounted for droppable registration; (3) `SplitLayout` wrapped in `DndContext` with `pointerWithin` collision strategy and floating `DragOverlay` showing dragged tab label; (4) Drag-end logic: edge zones trigger `layout.splitPane(paneId, direction)` to create new split pane, center zone triggers `layout.moveTabToPane()` to transfer tab without splitting; (5) Auto-collapse: if last tab leaves source pane, pane node removed from tree; (6) Visual feedback: blue highlight (`bg-blue-500/30 ring-blue-400`) on target zones during drag, zones invisible (pointer-events-none) when not dragging to preserve terminal input; (7) New `moveTabToPane(sessionId, fromPaneId, toPaneId)` hook method for atomic tab transfer; (8) Dependencies: @dnd-kit/core@6.3.1, @dnd-kit/utilities@3.2.2 added to package.json. User-facing: drag tab grip handle to pane edge → creates split; drag to pane center → moves tab (no split); blue highlights appear on targeted zone; floating label shows tab name during drag. Zero breaking changes, fully backward-compatible with existing layout tree. [See documentation](./frontend-components.md#panecontainer).

- **Port Detection Backend (F-09 Auto Port Forwarding).** In progress. Automatic detection of ports opened by running processes in PTY sessions: (1) `PortForwardManager` in-memory registry (Arc<RwLock<HashMap>>) tracks up to 100 detected ports with states: Provisional, Listening, Closed; (2) PTY stdout scanner: ANSI-strip output, apply 7-pattern regex bank (listening on, localhost:port, http://.., etc.), report first match as provisional; (3) Linux /proc/net/tcp poller (2s interval): confirms provisional → listening, reports lost (close event); (4) Port safety filter: blocks system ports (<1024) and danger list (SSH, SMTP, MySQL, PostgreSQL, Redis, MongoDB); (5) `GET /api/ports` REST endpoint (protected): returns `{ "ports": [..] }`; (6) WS push events: `port:discovered` (stdout or proc confirm) and `port:lost` (close); (7) Lazy regex bank via `once_cell`, Linux-only `procfs` crate for proc polling. Frontend receives port events and can construct proxy URLs. Historical implementation source unavailable; documentation in progress.

- **Startup Restore (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Automatic session restoration on server startup via SQLite persistence: (1) `restore_sessions()` function in new `persistence/restore.rs` module loads session records and respawns PTY processes; (2) Smart filtering: skip `RestartPolicy::Never` sessions (debug log), skip sessions for removed projects (warning log), skip manually killed sessions during kill window; (3) Config-driven restart retry count via `restart_max_retries` from project config with fallback to default; (4) Lazy buffer loading fallback in `PtySessionManager::get_buffer_with_offset()`: try in-memory first (live sessions), fall back to SQLite load (dead sessions); (5) Main.rs integration calls restore after PtySessionManager created, conditional on `session_persistence` config flag; (6) Startup time < 1s with 10 sessions (150ms SQLite load + 50ms PTY spawn); (7) Graceful error handling: per-session failures logged as warnings, database errors non-blocking; (8) Cleanup of expired buffers (TTL-based) triggered automatically; (9) 3/3 tests passing (skip never-restart, skip removed project, restore restartable); (10) Production-ready with comprehensive error scenarios and logging examples. Historical documentation source unavailable.

- **Persist Worker (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Async worker thread that batches buffer writes to SQLite without blocking PTY hot path: (1) Dedicated worker thread spawned in main.rs consumes commands from bounded mpsc channel (256 slots); (2) PersistCmd enum with 5 command types (BufferUpdate, SessionCreated, SessionExited, SessionRemoved, Shutdown); (3) Batching via HashMap: only latest buffer per session written on flush, deduplicating N updates → 1 write; (4) Flush triggers: 5-second timer, session exit (immediate), server shutdown (graceful); (5) Critical optimization: 16KB throttling reduces snapshot frequency from 100/sec → 6/sec, cutting memory churn from 256MB/sec → 16MB/sec (16x improvement); (6) Non-blocking integration: all 4 try_send() calls in manager.rs ensure PTY reader never blocks on DB I/O; (7) Graceful shutdown: explicit drop(persist_tx) signals worker to final flush on exit, zero data loss; (8) Bounded channel prevents memory explosion if worker stalls; (9) 5/5 unit tests passing (batching dedup, session create, immediate exit flush, removal, graceful shutdown); (10) Code review score 8.5/10 production-ready. All critical issues from initial review (blocking send, memory churn) resolved. Trade-off: <16KB sessions skip 5s flush but still persist on exit + WS reconnect works. Historical documentation source unavailable.

- **Buffer Offset Tracking (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Scrollback buffer enhancements for efficient WebSocket reconnect delta replay: (1) Monotonic byte counter `total_written: u64` tracks total bytes ever written, survives buffer eviction; (2) New `current_offset()` method returns checkpoint for client storage; (3) New `read_from(Option<u64>)` method returns (delta bytes, current offset) or fallback to full buffer if offset evicted; (4) O(1) delta calculation with zero-cost implementation; (5) 5 new unit tests + 4 existing tests (9/9 passing) covering fresh buffer, eviction, delta replay, edge cases, and monotonic property. Backward compatible, no breaking changes. Enables WebSocket reconnect to send only new bytes (~90% bandwidth reduction in typical scenarios).

- **Tombstone Idempotency.** Complete ✓ 2026-04-17. Server-side idempotency for terminal creation: (1) `terminal:create` now removes matching dead session tombstone before spawning, eliminating need for client-side alive status filtering; (2) Killed set tracks manually terminated sessions to prevent supervisor from restarting during user kill window; (3) Create inserts ID into `killed` set pre-spawn, removes post-spawn (TOCTOU guard ensures at most one spawn wins during concurrent creates); (4) Lock optimization: lock released before slow I/O (openpty, spawn), reacquired with concurrent create check; (5) Memory leak fix: cleanup task prunes orphaned `killed` set entries every 30s (prevents unbounded growth); (6) New integration test validates create-during-backoff race condition — supervisor respawn correctly cancelled by kill flag. Results: 50-100ms lock contention reduction under load, frontend can safely retry terminal creation without state checks. All tests passing. Historical documentation source unavailable.

- **Terminal Lifecycle UI (Frontend).** Complete ✓ 2026-04-17. Visual indicators for terminal process lifecycle events: (1) Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited); (2) Restart badge in DashboardPage showing `↻ N` when restartCount > 0; (3) Colored exit banners in TerminalPanel (green for code=0, red for non-zero, yellow for willRestart); (4) Restart banner showing `[Process restarted (#N)]` on process:restarted event; (5) Dim reconnect status banners on WebSocket connect/disconnect. New `session-status.ts` module centralizes lifecycle logic. All components subscribe to terminal lifecycle WS events. Query invalidation on process restart ensures dashboard auto-refresh; see [Frontend Components guide](./frontend-components.md).

- **Enhanced Exit Events + Channel Decoupling.** Complete ✓ 2026-04-17. Backend WS protocol enhancements: (1) Extended `terminal:exit` with optional `willRestart`, `restartInMs`, `restartCount` fields (backward-compatible); (2) New `process:restarted` event announcing successful restart with restart count and previous exit code; (3) Separate PTY and FS channels (PTY async backpressure, FS graceful overflow) to prevent FS event bursts from crashing PTY connections; (4) New `fs:overflow` event notifies of FS subscription overflow. Frontend: new `onProcessRestarted()` event listener, graceful `fs:overflow` handling. All 8 test matrix rows passing across channel integration tests. Resolves Failure Mode 3 (FS pump crushing WS).

- **Auto-Restart Engine.** Complete ✓ 2026-04-16. Process lifecycle management with auto-restart on crash: (1) Configurable restart policy per terminal (never/on-failure/always); (2) Exponential backoff (1s→2s→4s→8s→16s→30s max); (3) Supervisor pattern decouples blocking PTY I/O from async restart logic; (4) Dedicated reader thread handles exit detection and restart decisions; (5) Restart count tracking resets on clean exit (exit_code=0); (6) Session ID reused across restarts so frontend tab stays connected; (7) Extension to config and session metadata. All 8 decision matrix rows validated, 5 integration tests passing. Limitation: exit code always inferred as 0 for natural exits (portable-pty API).

- **SQLite Schema + Config.** Complete ✓ 2026-04-17. Session persistence infrastructure for surviving server restarts: (1) New `persistence/` module with SQLite-backed `SessionStore` providing CRUD operations; (2) Two-table schema: `sessions` (metadata + environment) and `session_buffers` (scrollback output); (3) New `[server]` config section with three fields: `session_persistence` (bool, default false), `session_db_path` (string, default ~/.config/dam-hopper/sessions.db), `session_buffer_ttl_hours` (u64, default 24); (4) Database files created with 0o600 permissions (Unix-only, user-exclusive access); (5) Automatic migrations on startup; (6) PersistedSession struct captures meta, env HashMap (JSON-serialized), terminal dimensions (cols, rows); (7) All enums (RestartPolicy, SessionType) stored as lowercase strings for portability; (8) 6 unit tests passing (open, save_session, save_buffer, load_sessions, load_buffer, delete_buffer_before); (9) Integration with auto-restart and buffer offset tracking. Disabled by default to maintain backward compatibility; opt-in via configuration. [See configuration guide](./configuration-guide.md#server-configuration) and [system architecture](./system-architecture.md#backend-state-and-service-composition).

- **Multi-Server Connection Management.** Client-side browser-based profile management for switching between multiple dam-hopper servers without app restart. Stores profiles in localStorage with JSON serialization. Includes: (1) `ServerProfile` interface with UUID id, name, URL, auth type, username, and timestamp; (2) Profile CRUD functions in `server-config.ts` (getProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile); (3) UI components: `ServerProfilesDialog` for list/switch/delete, `ServerSettingsDialog` for create/edit, Sidebar integration; (4) Automatic migration from legacy single-server config to profile system on first app load. All profiles persist across browser tabs and sessions. Password never stored locally (username only for Basic auth). Documentation in [Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md) and [API Reference](./api-reference.md#client-side-profile-management).

- **Server-Side Auth Bypass.** New `--no-auth` CLI flag for local development. Bypasses MongoDB authentication with production safety guards (fails if MongoDB configured or production environment detected). Includes multi-line warning banner and ERROR-level logging. Auto-generates dev tokens with 30-day expiry. Status endpoint shows `dev_mode: true` flag. All 7 integration tests passing: 3 no-auth mode tests + 3 normal auth regression + 1 production safety test. Historical documentation source unavailable.

### Previous Releases

#### Unreleased (Initial Development)

### Added

- **Binary streaming for FsWriteFile protocol.** This feature allows for more efficient writing of large files (>5MB) by using binary frames instead of base64 encoded text frames, reducing bandwidth overhead by ~33%.
- **Disk-backed buffering on the server.** The server now uses `NamedTempFile` for buffering `fsWriteFile` chunks, preventing memory spikes for large saves.
- **Client-side binary transport.** Updated `ws-transport.ts` to support the hybrid JSON+Binary frame protocol.
- **Improved Optimistic Concurrency Control (OCC).** mtime and size enforcement are now more robust and verified with extensive tests.

### Fixed

- **Large file RAM spike during saves.** Previously, the server buffered all chunks in RAM, leading to potential OOM for large files.

### Changed

- **Default encoding for large file writes.** Switched from base64 text frames to binary WebSocket frames for better efficiency.

## [1.0.4] - 2026-04-09

### Added

- **Monaco Editor integration.** Full-featured editor with syntax highlighting and tab management.
- **Three-step WebSocket write protocol.** Robust `begin -> chunks -> commit` flow for file saving.
- **File tiering.** Automatic handling of different file types and sizes (normal, degraded, large, binary).
- **Mtime-guarded atomic writes.** Prevents data loss during concurrent edits.
- **ConflictDialog.** User-friendly handling of save conflicts (overwrite vs reload).
- **LargeFileViewer.** Efficient viewing of files > 5MB via range reads.
- **BinaryPreview.** Hex dump viewer for binary files.

## [1.0.3] - 2026-03-25

### Added

- **IDE Shell layout.** Responsive layout using `react-resizable-panels`.
- **Live file tree.** Syncs in real-time with filesystem changes.
- **TanStack Query hooks.** Robust data fetching and FS subscription management.
- **Feature-gated /ide route.**

## [1.0.2] - 2026-03-10

### Added

- **File watcher.** notify-based real-time notifications for file system events.
- **WebSocket event push.** Efficiently pushes FS events to connected clients.
- **inotify-based debouncing.** Prevents event storms on large file changes.

## [1.0.1] - 2026-02-28

### Added

- **IDE File Explorer REST API.** Endpoints for listing, reading, and stating files.
- **Filesystem sandbox.** Secure path validation to prevent traversal.
- **Binary file detection.** Automatic identification of binary files using MIME guessing.

## [1.0.0] - 2026-02-15

### Added

- Initial release of DamHopper.
- Workspace management and project auto-discovery.
- PTY terminal session management.
- Bulk git operations.
- Agent store distribution via symlinks.

## 2026-08-18

- **Project worktree target lifecycle.** Added exact-target removal
 blockers for dirty editor tabs and live terminal sessions, fresh discovery
 before Git removal, unavailable-target root fallback, preserved editor state,
 and orphaned terminal labels for sessions whose project/cwd still points at a
 disappeared worktree. Added real-repository lifecycle coverage and a
 Chromium coverage through the real `WorkspacePage` surface wiring for the
 selected-target request boundary; broader Explorer, search, replace, Git,
 editor/diff, media, and terminal routing uses the shared target context.
 Terminal creation now carries the selected target through `terminal:create`;
 the server validates and persists canonical `worktreePath` metadata, loads
 the configured environment file relative to that target, and coordinates
 creation/removal ownership checks. Stable opaque target-scoped command/profile
 IDs prevent root/worktree collisions. Legacy sessions still reconcile
 through project/cwd metadata, while target-scoped sessions use their immutable
 server-validated marker. Target-loss create and respawn failures emit
 reconciliation events only after fresh validation confirms disappearance;
 unavailable sessions retain their identity and scrollback for close/retry
 while new work falls back to root.
