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
- **`SearchApp.tsx`:** Embeds `SearchPanel`, connecting search match selections to `file:open` or `file:edit` intents.
- **`ChangesApp.tsx`:** Embeds `ChangedFilesList`, `GitLocalChanges`, and `DiffViewer`, routing file diff selections to `changes:diff` and conflict handoffs to `conflict:resolve`.
- **`GitApp.tsx`:** Embeds `WorkspaceGitPanel` with commit history search, branch operations, and commit inspection.
- **`ConflictResolverApp.tsx`:** Embeds `ConflictResolverPanel` and `MergeConflictEditor`, requiring an active conflict operation on the claimed git root; unmerged paths without an active operation display a fail-closed notice (open carryover W4 tracks uniformly rejecting missing/`none` requested operations).
- **`SessionChangesApp.tsx`:** Embeds `SessionChangesPanel`, enforcing an exact 6-part owner tuple (`profileId`, `generation`, `terminalId`, `terminalIncarnation`, `ompSessionId`, `rootId`), resource claim acquisition, and fail-closed query cache purging on disable or disconnect (subject to W2/W3 open lifecycle and focus containment limitations).
- **`WorkflowPlansApp.tsx`:** Embeds `WorkflowContextSurface`, routing plan selections and task tracking.
- **`PortsTunnelsApp.tsx`:** Embeds `PortsPanel`, providing discovered port status, cloudflared tunnel lifecycle controls, and browser launch intents.
- **`ProjectInfoApp.tsx`:** Embeds `ProjectOverview` and `ConfigEditor`, binding edits to the current project owner.
- **`AgentStoreApp.tsx`:** Embeds `AgentStorePage` without legacy plugin runner dependencies (open carryover W5 tracks remaining route-query coupling).
- **`SettingsApp.tsx`:** Embeds `SettingsPage` with independent server target and preferences source selectors (open carryover W5 tracks singleton target reactivity).

## 2. Instancing Rules & Window Matching

Window deduplication and reuse logic is governed by `findExistingWindowForApp` in `packages/ui/src/os/app-registry.ts`:

1. **`single-instance`:** Exactly one window exists across the entire OS session (`settings`). Matches by `w.appId === appId`. (Note W5: target updates to the existing window do not reactively re-target local settings page state).
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
- **Partial Generation Fencing & Stale Save Invalidation:** Connection snapshot and generation are verified **after `fsRead`** and **after `fsWriteFile`** (aborting if disconnected or generation rotated). `saveRevisionRef` increments on file switch, unmount, and model edits (`onDidChangeModelContent`), discarding pre-write save results if typing occurs during the read stat.
- **Open Hardening Gap (W0a):** Revision equality is currently checked after `fsRead`, but not after `fsWriteFile`. Consequently, user edits during write completion can still be marked clean, and a revision mismatch during the stat call returns without clearing the `"saving"` state, potentially locking the save button until the component unmounts. Full post-write revision fencing and delayed-save regressions remain open under W0a.

### File Search & Replace Hooks
- **`useFileSearch` (`packages/ui/src/hooks/use-file-search.ts`):** Project-scoped queries capture the profile connection and assert `isCurrentConnection(conn)` upon response arrival. Empty federated profile sets return empty results immediately without ambient fallback. Search matches are stamped with authoritative `profileId` and `generation`.
- **`useSearchPanelReplace` (`packages/ui/src/hooks/use-search-panel-replace.ts`):** `runReplaceNext` checks match generation against current connection snapshot (`snap.owner.generation !== nextMatch.generation`). The captured connection reference is preserved through read and write stages via `replaceOperationConnectionRef`, asserting connection currency across the operation. Open carryover W0b notes that batch Replace All groups without match generation and does not fence final publication.

### Ports & Cloudflared Tunnels (`packages/ui/src/hooks/use-ports.ts`)
- **Authoritative Target Owner:** `installCloudflared` captures `targetOwner` from the explicit target owners list and binds to `getBoundTransport(targetOwner)`.
- **Generation & Currency Checks:** Catch handlers verify `isCurrentConnection(targetOwner)` and generation equality before publishing error states. Open carryover W10 notes that aggregate installer views select `targetOwners[0]` rather than the failed row.

### Session Changes App (`packages/ui/src/os/apps/SessionChangesApp.tsx`)
- **Resource Claim Contract:** Obtains a deterministic claim key `session-changes/${profileId}/${generation}/${resourceId}` via `useResourceClaim`.
- **Fail-Closed Teardown:** Listens to `useSessionChangesEnabled`; if the service becomes disabled or disconnected, all owner queries under `profileQueryKey(owner, "session-changes")` are cancelled and removed, and the window closes immediately. Open carryover W2 notes that offscreen/hidden reviews do not retire or purge cache until mounted.
- **Focus & Input Trapping:** Focus is directed to the modal container on mount and state transitions. Open carryover W3 notes that the claim-denied branch lacks `ref={rootRef}`, the loading branch contains zero tabbable controls (allowing Tab to escape), negative-tabindex controls are not excluded, and background terminal writes are not intercepted at the PTY dispatch layer.

### Verification Note
Automated verification results (70 tests across 12 files, clean typecheck) are reported in `plans/reports/tester-261102-1706-phase-05-cycle-5.md` and were not independently rerun during this documentation update.

## 6. Verification & Open Qualification Gates

### Automated Test Coverage (Phase 05 Cycle 5)
Automated verification reported 70 passed checks across 12 test files:
- **OS Unit Tests (`src/os/`):** 61 passed / 61 total across 9 test files, including:
  - `src/os/app-registry.test.ts` (manifest completeness, minimumCtx checks, instancing rules, window matching)
  - `src/os/deep-links.test.ts` (query parameter parsing, profile gating, line parsing, owner tuple validation, template layout generation)
  - `src/os/intents.test.ts`, `src/os/resource-registry.test.ts`, `src/os/window-ops.test.ts`, `src/os/persistence.test.ts`, `src/os/input-arbiter.test.ts`
- **Browser Component Regressions (`packages/ui/browser-tests/`):** 9 passed / 9 total across 3 files:
  - `os-workspace-apps.browser.tsx`: Shell mounting of workspace adapters, context binding, and `file:reveal` intent routing.
  - `os-review-apps.browser.tsx`: GitApp mounting, ConflictResolverApp fail-closed no-operation view, SessionChangesApp tuple validation & input isolation, and multi-profile project collision isolation.
  - `os-management-apps.browser.tsx`: Management apps mounting inside OS windows, and 60/40 binary split project desktop template application.
- **TypeScript Typecheck:** Clean build via `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`, 0 type errors).

### Carried-Forward Review Findings (Reviewer Cycle 5, Score 5/10)
Technical acceptance is carried forward with open qualification gates to Phase 09:
- **W0a (DiffViewer Save Revision):** Revision equality rechecking after `fsWriteFile` and delayed-stat/write edge case testing.
- **W0b (Search Replace All):** Grouping and validating originating generation across batch replace matches.
- **W1 (Catalog Intent Delivery):** Production consumers for remaining catalog actions and canonical payload delivery across cold and reused windows.
- **W2 (Generation Capture & Offscreen Purge):** Durable in-memory generation capture at pre-open, wildcard matching removal, and background review retirement.
- **W3 (Focus Trap & PTY Isolation):** Live physical PTY focus isolation, loading-state Tab containment, and terminal autofocus suppression.
- **W4 (Conflict Resolver Active Operation):** Uniformly rejecting requested operations when active operation is `none` or missing.
- **W5 (Management Target Independence):** Controlled URL-free body props for Agent Store, Settings, and Devices.
- **W6 (Deep Link Navigation Consumption):** Router/basename-aware navigation identity and supported action white-listing.
- **W7 (Unsaved Diff/View Retention):** In-memory draft retention for DiffViewer across tab switches and desktop transitions.
- **W8 (Template Context & Lazy Catalog):** Enforcing non-empty project context on templates and lazy/Suspense catalog loading.
- **W9 (Regression Coverage):** Regressions for delayed-await safety, real browser input transitions, and live PTY streaming.
- **W10 (Tunnel Installer Owner Scope):** Per-row failed owner retention in aggregate tunnel installer views.
