# AI Dev OS Application Catalog & Deep Link Infrastructure

This document specifies the 14-application catalog, typed deep link URL query protocol, project desktop templates, and single-transport generation fences implemented in Phase 05 of DamHopper OS.

## 1. 14-App Catalog Overview & Manifest Registry

The application catalog is statically defined in `packages/ui/src/os/app-registry.ts` as `APP_MANIFESTS`. Every application conforms to the `AppManifest` interface (`packages/ui/src/os/types.ts`), specifying its identifier (`appId`), human-readable title (`displayName`), instancing rule (`instancing`), minimum context requirements (`minimumCtx`), default window placement mode (`defaultPlacement`), minimum size constraints (`minSize`), and supported intent action types (`intents`).

The 14 retained applications span workspace, review, and system management capabilities:

| App ID | Display Name | Instancing Rule | Minimum Context | Default Mode | Min Size ($W \times H$) | Supported Intents | Adapter Component |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `terminals` | Terminals | `multi-instance` | `profile` | `tile` | $320 \times 240$ | `terminal:open`, `terminal:focus` | `TerminalsApp.tsx` |
| `editor` | Editor | `multi-instance` | `project` | `tile` | $360 \times 280$ | `file:edit`, `file:open` | `EditorApp.tsx` |
| `browser` | Browser Preview | `multi-instance` | `profile` | `float` | $400 \times 300$ | `browser:preview`, `browser:open` | `BrowserApp.tsx` |
| `files` | Files | `worktree-instance` | `project` | `tile` | $240 \times 200$ | `file:reveal` | `FilesApp.tsx` |
| `search` | Search | `worktree-instance` | `project` | `tile` | $280 \times 240$ | `search:query` | `SearchApp.tsx` |
| `changes` | Changes | `worktree-instance` | `project` | `tile` | $300 \times 240$ | `changes:diff`, `changes:commit`, `changes:stage` | `ChangesApp.tsx` |
| `git` | Git | `worktree-instance` | `project` | `tile` | $380 \times 280$ | `git:status`, `git:diff`, `git:history`, `git:branch` | `GitApp.tsx` |
| `conflict-resolver` | Conflict Resolver | `project-instance` | `project` | `float` | $500 \times 400$ | `conflict:resolve`, `conflict:reveal` | `ConflictResolverApp.tsx` |
| `session-changes` | Session Changes | `tuple-instance` | `profile` | `float` | $500 \times 400$ | `session-changes:open` | `SessionChangesApp.tsx` |
| `workflow-plans` | Workflow & Plans | `project-instance` | `project` | `tile` | $340 \times 280$ | `workflow:open-item`, `workflow:open-plan` | `WorkflowPlansApp.tsx` |
| `ports-tunnels` | Ports & Tunnels | `profile-instance` | `profile` | `float` | $420 \times 320$ | `ports:open`, `ports:open-tunnel` | `PortsTunnelsApp.tsx` |
| `project-info` | Project Info | `project-instance` | `project` | `float` | $400 \times 320$ | `project:info`, `project:config` | `ProjectInfoApp.tsx` |
| `agent-store` | Agent Store | `profile-instance` | `profile` | `tile` | $480 \times 360$ | `agent-store:open` | `AgentStoreApp.tsx` |
| `settings` | Settings | `single-instance` | `none` | `tile` | $480 \times 360$ | `settings:open`, `settings:devices` | `SettingsApp.tsx` |

### Application Adapter Architecture

All 14 application adapters reside under `packages/ui/src/os/apps/`. Adapters compose canonical organisms and page bodies without replicating business logic or database operations:
- **`FilesApp.tsx`:** Embeds `FileTree`, connecting file clicks to `file:edit` intents and directory context to `useFileWatch` subscriptions.
- **`SearchApp.tsx`:** Embeds `SearchPanel` with `isolatedState: true` and delivery keying, decoupling search queries per mode (files vs content) without mutating global search stores, and routing match selections with generation metadata to `file:open` or `file:edit` intents.
- **`ChangesApp.tsx`:** Embeds `ChangedFilesList`, `GitLocalChanges`, and `DiffViewer`. Canonical path resolution matches canonical project paths first via `createChangedFileSelection`. Consumes delivered `changes:diff` intents via `consumedDeliveryIdRef` to prevent repeating tab activation on unrelated query refreshes.
- **`GitApp.tsx`:** Embeds `WorkspaceGitPanel` with commit history search, branch operations, and commit inspection.
- **`ConflictResolverApp.tsx`:** Embeds `ConflictResolverPanel` and `MergeConflictEditor`. Verifies active conflict operations against `requestedOperation` (`requestedOperation !== undefined && (!liveOp || liveOp === "none" || liveOp !== requestedOperation)`), uniformly displaying fail-closed notices and blocking abort/continue actions when the requested operation is inactive or mismatched.
- **`SessionChangesApp.tsx`:** Embeds `SessionChangesPanel`, enforcing an exact 6-part owner tuple (`profileId`, `generation`, `terminalId`, `terminalIncarnation`, `ompSessionId`, `rootId`), stable generation capture via `useState`, resource claim acquisition, and fail-closed query cache purging on disable or disconnect.
- **`WorkflowPlansApp.tsx`:** Embeds `WorkflowContextSurface`, routing plan selections and task tracking.
- **`PortsTunnelsApp.tsx`:** Embeds `PortsPanel`, providing discovered port status, cloudflared tunnel lifecycle controls, and browser launch intents.
- **`ProjectInfoApp.tsx`:** Embeds `ProjectOverview` and `ConfigEditor`, binding edits to the current project owner.
- **`AgentStoreApp.tsx`:** Embeds `AgentStorePage` with controlled props (`AgentStorePageProps`), managing tab and profile selections in window `appState` without mutating global route query parameters.
- **`SettingsApp.tsx`:** Embeds `SettingsPage` with controlled props (`SettingsPageProps`), managing target profile selection in window `appState` without mutating global `useWorkbenchSelectionsStore.settingsProfileId`.
## 2. Instancing Rules & Window Matching

Window deduplication and reuse logic is governed by `findExistingWindowForApp` in `packages/ui/src/os/app-registry.ts`:

1. **`single-instance`:** Exactly one window exists across the entire OS session (`settings`). Matches by `w.appId === appId`. Window `appState` (`activeTab`, `targetProfileId`) stores instance state; `SettingsApp` and `SettingsPage` reactively reflect prop updates without mutating global stores.
2. **`profile-instance`:** One window per server profile (`ports-tunnels`, `agent-store`). Matches by `w.appId === appId && w.ctx.profileId === ctx.profileId`.
3. **`project-instance`:** One window per project (`workflow-plans`, `project-info`). Matches `appId`, `profileId`, and `projectId`.
   - *Specialization for `conflict-resolver`:* Matches `profileId`, `projectId`, `worktreeId`, `root` (or `gitRootId`), and `operation`. Differing conflict operations spawn separate windows.
4. **`worktree-instance`:** One window per worktree (`files`, `search`, `changes`, `git`). Matches `appId`, `profileId`, `projectId`, and `worktreeId`.
5. **`tuple-instance`:** Bound to an exact owner and process tuple (`session-changes`). Matches `appId`, `profileId`, `terminalId`, `terminalIncarnation`, `ompSessionId`, `rootId`, and `generation` (when specified).
6. **`multi-instance`:** No deduplication; multiple independent windows may coexist (`terminals`, `editor`, `browser`).

## 3. Deep Link URL Query Protocol

The typed deep link parser in `packages/ui/src/os/deep-links.ts` evaluates incoming navigation queries against registered profiles and catalog constraints. Deep links are accessed via `/os?<query>` on the authenticated OS route.

### Supported Query Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `open` | `OsAppId` | Conditional | Application identifier to open (e.g. `git`, `editor`, `terminals`). Required unless `action` is provided. |
| `action` | `string` | Conditional | Explicit action trigger (e.g. `new-terminal`). Required if `open` is omitted. |
| `profile` / `profileId` | `string` | Yes | Server profile ID. Must match an enrolled profile in `knownProfiles`. |
| `project` | `string` | Conditional | Project name. Required when the target app requires `minimumCtx: "project"`. |
| `worktree` | `string` | No | Worktree path or identifier. |
| `file` | `string` | No | Project-relative file path for editor, diff, or reveal intents. |
| `line` | `number` | No | 1-based positive integer line number. Accepts only canonical positive-integer decimal text (`parsed > 0 && String(parsed) === lineRaw.trim()`). |
| `hash` / `commit` | `string` | No | Git commit OID for `git:reveal-commit` intent. |
| `root` | `string` | No | Git root identifier. |
| `operation` | `string` | No | Conflict operation identifier (`merge`, `rebase`, `cherry-pick`, `revert`). |
| `terminal` | `string` | Conditional | Terminal session ID. Required for `session-changes`. |
| `incarnation` | `string` | Conditional | Terminal incarnation ID. Required for `session-changes`. |
| `ompSession` | `string` | Conditional | OMP session ID. Required for `session-changes`. |
| `generation` | `number` | No | Non-negative integer connection generation. |
| `url` | `string` | No | Browser preview URL (default: `http://localhost:5173`). |
| `query` | `string` | No | Initial search query string for `search:query`. |

### Validation & Fail-Closed Invariants
- **Empty State:** Queries lacking both `open` and `action` return `{ status: "empty" }` without side effects.
- **Known-Profile Validation Fence:** Missing `profile` or unknown profile IDs fail closed (`status: "invalid"`, `reason: "Unknown server profile..."`). This validates enrollment in `knownProfiles`; it does not establish active authentication or generation authority.
- **Minimum Context Verification:** Applications declaring `minimumCtx: "project"` (`editor`, `files`, `search`, `changes`, `git`, `conflict-resolver`, `workflow-plans`, `project-info`) reject requests missing a `project` parameter.
- **Strict Integer Line Parsing:** `line` must be canonical positive-integer decimal text (`parsed > 0 && String(parsed) === lineRaw.trim()`). Malformed values (e.g. `42:10`, `abc`, `-5`, float strings) fail validation immediately.
- **Full Tuple Enforcement:** `open=session-changes` requires `terminal`, `incarnation`, and `ompSession`. Omission returns `{ status: "invalid" }`.
- **Intent Synthesis Without Process Execution:** Deep links create typed `OsIntent` records (`createIntent`), never directly executing shell commands or spawning unattended processes.

## 4. Project Desktop Layout Template

`createProjectDesktopTemplate` in `packages/ui/src/os/desktop-templates.ts` implements the approved standard project desktop layout using a 60/40 binary split tree:

```text
+-------------------------------------------------------+
|                   Project Desktop                     |
+--------------------------+----------------------------+
|                          | Files (active) / Search    |
|                          | (50% height)               |
| Terminals                +----------------------------+
| (60% width)              | Git (active) / Changes     |
|                          | (50% height)               |
|                          |                            |
+--------------------------+----------------------------+
```

### Tile Tree Node Structure

1. **Root Split Node:** Horizontal split with sizes `[60, 40]`.
   - **Left Child (60%):** Pane node hosting `terminals` window.
   - **Right Child (40%):** Vertical split node with sizes `[50, 50]`.
     - **Top Pane (50%):** Tabbed pane hosting `files` (active) and `search` windows.
     - **Bottom Pane (50%):** Tabbed pane hosting `git` (active) and `changes` windows.
2. **Context Binding:** All 5 initial windows and the desktop itself are bound to the supplied `WindowContext` (`profileId`, `projectId`, `worktreeId`).
3. **Editor Placement:** Editor windows are not placed in the initial 5-window split; they are spawned on-demand into dedicated tiled splits or floating windows when files are opened.

## 5. Single-Transport Routing & Generation-Fencing Hardening

Phase 05 hardened UI components and data hooks against cross-profile leaks, retired generation races, and ambient transport fallbacks:

### DiffViewer (`packages/ui/src/components/organisms/DiffViewer.tsx`)
- **Authoritative Bound Transport:** `getBoundTransport(targetRef)` resolves transport strictly through `getConnectionSnapshot(profileId)` and `getConnectionTransport(owner)`. Missing or disconnected profiles throw immediately rather than falling back to ambient transport.
- **Active Save Invariants & In-Flight Reset:** Tracks `documentIdentityRef`, `editRevisionRef`, and `activeSaveRef`. Connection snapshot and generation are verified before read, after read, and after `fsWriteFile`. If user typing occurs while a stat or write is in-flight, `editRevisionRef` increments and `saveState` resets from `"saving"` to `"idle"` to reflect that newer edits supersede the pending save (an already-dispatched server write is not cancelled and concurrent writes remain guarded).
- **Authoritative Modified Pinning & Clean-Save Reconciliation:** Upon successful write acknowledgement, `authoritativeModified` pins the saved content as the clean baseline. Local dirty edits made after save are preserved over external refetches, and post-write query updates reconcile cleanly without leaving saveState locked. (In-memory draft retention across window/tab unmounts remains open under W7).

### File Search & Replace Hooks
- **`useFileSearch` (`packages/ui/src/hooks/use-file-search.ts`):** Project-scoped queries capture the profile connection and assert `isCurrentConnection(conn)` upon response arrival. Empty federated profile sets return empty results immediately without ambient fallback. Search matches are stamped with authoritative `profileId` and `generation`.
- **`SearchPanel` (`packages/ui/src/components/organisms/SearchPanel.tsx`):** Enforces query-result binding via `isSearchMatchingInput` (`data.query === query.slice(0, 200)` and `!isLoading`). When live typing diverges from completed search results, Replace buttons are disabled (`replaceDisabled: true`) and displayed matches are cleared. Supports `isolatedState: true` for independent per-mode query state.
- **`useSearchPanelReplace` (`packages/ui/src/hooks/use-search-panel-replace.ts`):** `runReplaceNext` checks match generation against current connection snapshot (`snap.owner.generation !== nextMatch.generation`). Batch Replace All verifies that all matches in a group have matching `profileId` and valid, current `generation` (`allMatchesValid`), rejecting stale generations fail-closed while skipping dirty open tabs.

### Ports & Cloudflared Tunnels (`packages/ui/src/hooks/use-ports.ts`)
- **Authoritative Target Owner:** `installCloudflared` captures `targetOwner` from the explicit target owners list and binds to `getBoundTransport(targetOwner)`.
- **Generation & Currency Checks:** Catch handlers verify `isCurrentConnection(targetOwner)` and generation equality before publishing error states.

### Session Changes App (`packages/ui/src/os/apps/SessionChangesApp.tsx`)
- **Resource Claim Contract:** Obtains a deterministic claim key `session-changes/${profileId}/${generation}/${resourceId}` via `useResourceClaim`.
- **Mounted-Window Teardown:** Listens to `useSessionChangesEnabled`; if the service becomes disabled or disconnected, all owner queries under `profileQueryKey(owner, "session-changes")` are cancelled and removed, and the mounted window closes immediately. Offscreen/hidden review retirement and background cache purging remain open (W2).
- **Focus & Input Trapping:** Focus is directed to the modal container on mount and state transitions, and initial generation is captured via `useState` on mount. (Durable pre-open generation capture, removal of generation-wildcard matching, and physical PTY focus isolation remain open under W2/W3).

### Management Pages Controlled Props Decoupling
- **`AgentStorePage`:** Exposes `AgentStorePageProps` (`noLayout`, `profileId`, `tab`, `onTabChange`, `onProfileChange`). Operates in controlled mode inside `AgentStoreApp`, isolating tab and profile selection from route query parameters.
- **`SettingsPage`:** Exposes `SettingsPageProps` (`noLayout`, `targetProfileId`, `onTargetProfileChange`). When rendered in `noLayout` or explicit `targetProfileId`, maintains local state and updates window `appState`. Operations follow capture-and-recheck: `{ profileId, generation }` is captured before I/O, and `getCurrentEffectiveProfileId()` confirms target currency before applying post-await mutations rather than retargeting an in-flight action.
- **`DevicesPage`:** Exposes `DevicesPageProps` (`noLayout`, `profileId`, `onProfileChange`). Server picker renders for `profiles.length > 0` with explicit `(Current / Default Server)` fallback option.
### Verification Note
Automated verification results (115 tests across 15 files, clean typecheck) are reported in `plans/reports/tester-261102-1911-phase05-cycle5-validation.md` and were not independently rerun during this documentation update.

## 6. Verification & Code Review Remediation Disposition

### Automated Test Coverage (Phase 05 Remediation)
Automated verification reported 115 passed checks across 15 test files:
- **OS Unit & Component Tests (`src/os/`, `organisms/`, `hooks/`):** 99 passed / 99 total across 12 test files, including:
  - `src/os/app-registry.test.ts` (manifest completeness, minimumCtx checks, instancing rules, window matching)
  - `src/os/deep-links.test.ts` (query parameter parsing, profile gating, line parsing, owner tuple validation, template layout generation)
  - `DiffViewer.test.tsx` (authoritative transport binding, in-flight stat/save revision reset, local dirty edit retention)
  - `use-search-panel-replace.test.tsx` (target recovery, stale generation rejection in Replace All, dirty tab skipping)
  - `src/os/intents.test.ts`, `src/os/resource-registry.test.ts`, `src/os/window-ops.test.ts`, `src/os/persistence.test.ts`, `src/os/input-arbiter.test.ts`
- **Browser Component Regressions (`packages/ui/browser-tests/`):** 16 passed / 16 total across 3 files:
  - `os-workspace-apps.browser.tsx` (7 tests): Shell mounting of workspace adapters, context binding, `file:reveal` intent routing, `search:query` delivery, `changes:diff` delivery and repeat activation, `terminal:focus` safe validation.
  - `os-review-apps.browser.tsx` (6 tests): GitApp mounting, ConflictResolverApp fail-closed no-operation view, operation mismatch rejection, SessionChangesApp tuple validation & input isolation, disable cache purging, and multi-profile project collision isolation.
  - `os-management-apps.browser.tsx` (3 tests): Management apps mounting inside OS windows, 60/40 binary split project desktop template application, and AgentStoreApp window appState decoupling without route URL mutation.
- **TypeScript Typecheck:** Clean build via `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`, 0 type errors).

### Code Review Remediation Disposition (Cycle 4, Score 7/10)
Implementation and remediation checkpoint reached completion per user direction (0 Critical, 2 High, 2 Medium warnings addressed):
- **W0a / C4-W1 (DiffViewer Save Reconciliation):** `editRevisionRef` and `activeSaveRef` track in-flight edits, resetting `saveState` from `"saving"` to `"idle"` on typing during stat/save without cancelling already-dispatched server writes. `authoritativeModified` pinning protects post-save baseline while preserving newer local dirty edits against query refetches.
- **W0b / C3-W1 (Search Result-Query Binding & Generation Fencing):** `isSearchMatchingInput` binds matches to active results within 200-char normalization, disabling replace when typing diverges. `useSearchPanelReplace` enforces `allMatchesValid` across batch replace and checks dirty tabs.
- **W1 / C4-W3 (Intent Routing & Delivery Consumption):** `OsShell.tsx` registers active handlers for `search:query`, `changes:diff`, `terminal:focus`, `file:open` (generation fenced), `git:status`, and `settings:open`. Unique `deliveryId` in window `appState` provides once-per-delivery consumption to prevent stale intent replays on unrelated query refetches.
- **C4-W2 (Canonical Changes Selection):** `ChangesApp` prioritizes canonical project paths before root-relative aliases using `createChangedFileSelection`.
- **W4 (Conflict Resolver Operation Verification):** `ConflictResolverApp` strictly verifies `requestedOperation` against live operation state, blocking actions fail-closed when inactive or mismatched.
- **W5 (Management Target & State Decoupling):** Controlled props on `AgentStorePage`, `SettingsPage`, and `DevicesPage` decouple window state from global URL search parameters and singleton stores; `SettingsPage` enforces capture-and-recheck async ownership.

### Open Carryover Qualification Gates (Tracked for Phase 09)
Technical acceptance remains incomplete; the following carryover gates remain open:
- **W2 (Generation Capture & Offscreen Purge):** Durable in-memory generation capture at pre-open, removal of generation-wildcard matching, and background/offscreen review retirement.
- **W3 (Focus Trap & PTY Isolation):** Live physical PTY focus isolation, loading-state Tab containment, and terminal autofocus suppression.
- **W6 (Deep Link Navigation Consumption):** Router/basename-aware navigation identity and supported action whitelisting.
- **W7 (Unsaved Diff/View Retention Across Unmounts):** In-memory draft retention for DiffViewer across window/tab switches and desktop transitions (distinguished from local dirty-edit retention during query refetches).
- **W8 (Template Context & Lazy Catalog):** Enforcing non-empty project context on templates and lazy/Suspense catalog loading.
- **W9 (Live Lifecycle Regressions):** Regressions for live xterm object continuity, zero attach/replay counters, dirty Monaco undo continuity, and live Playwright journey qualification.
- **W10 (Tunnel Installer Owner Scope):** Per-row failed owner retention in aggregate tunnel installer views.
