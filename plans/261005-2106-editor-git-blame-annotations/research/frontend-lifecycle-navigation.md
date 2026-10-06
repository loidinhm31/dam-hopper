# Frontend Lifecycle, Navigation & State Research

Investigated UI lifecycle, persistence, layouts, and Git navigation touchpoints for Git blame annotations.

## 1. Tab Persistence Boundaries (`stores/editor.ts`)

- **Storage Key & Schema**: Zustand `persist` with key `"dam-hopper:editor-state"`, version `EDITOR_PERSIST_VERSION` (1).
- **`partialize` boundary (`lines 1603-1632`)**:
  - Persisted fields: `key`, `project`, `target`, `targetKey`, `targetAvailable`, `path`, `name`, `mtime`, `size`, `tier`, `mime`, `viewState`, `fileStatus`, `additions`, `deletions`, `commitHash`, `gitRootId`, `diffPath`, `resourceBinding`, `hydrated: true`.
  - Forced resets on rehydrate: `loading: false`, `dirty: false`, `saving: false`, `conflicted: false`, `stale: false`.
  - Non-persisted (ephemeral): `content` (never persisted to storage), `activeKeys`, `requestGenerations`.
- **Blame Toggle State Recommendation**:
  - Must remain strictly session per-tab in-memory (e.g. `blameEnabled?: boolean` on `Tab` interface or ephemeral record).
  - Explicit omission from `partialize` guarantees zero localStorage leakage and eliminates schema migrations.
- Tab close (`close`, `closeOthers`, `closeAll`) retires tab/request identity; blame requests must also check captured tab/model identity and abort/retire on unmount or close.

## 2. Profile & Generation Helpers (`api/connections.ts`, `api/queries.ts`)

- **Connection Model**:
  - `ConnectionRef`: `{ profileId: string; generation: number }`.
  - `captureConnection(profileId)` grabs current ref or throws `ConnectionOwnerError`.
  - `getConnectionSnapshot(profileId)` returns `{ owner: ConnectionRef, status, serverUrl, intent }`.
  - `isCurrentConnection(owner)` validates `entry.generation === owner.generation && status === "connected"`. Every disconnect/reconnect increments `generation += 1`.
  - `getTransport(owner)` and `getApi(owner)` throw `ConnectionOwnerError` on stale generations.
- **Query Scoping**:
  - `resolveTargetOwner(options)` extracts `ConnectionRef` from target's `profileId`.
  - `gitQueryKey(prefix, target, ...parts)`: Wraps queries in `profileQueryKey(owner, "git", prefix, normalized.project, projectTargetCacheKey(normalized), ...parts)`.
  - Guarantees complete cross-profile isolation: identical project names/worktrees across profiles never collide or leak cache. Blame query keys must include profile, connection generation, project target, root, and file path.

## 3. FS & Git Refresh Event Routes (`hooks/use-sse.ts`, `EditorTabs.tsx`, `queries.ts`)

- **SSE/WS Push Channels**:
  - `status:changed`: invalidates `["git", projectName]` and `["projects"]`.
  - `workspace:changed`: calls `handleWorkspaceChanged()`, clearing language scan caches and invalidating profile query prefix.
- **Editor Freshness Lifecycle**:
  - `EditorTabs.tsx:255-270`: invokes `reconcileTabFreshness(tab.key)` on active tab switch, `window.onFocus`, and `document.visibilitychange`.
  - `reconcileTabFreshness` checks `mtime` via `fsRead(..., { statOnly: true })`. If `mtime` changed and tab is not dirty, triggers `reloadTab(key)`.
  - Git mutations (`useGitStage`, `useGitCommit`, `useGitCheckoutBranch`, etc.) call `reconcileAffectedEditorTabs` / `reconcileProjectEditorTabs`, reloading clean affected tabs.
- **Blame Cache Invalidation**:
  - Buffer edits (debounced), tab reloads, and git mutations must invalidate blame data. Stale responses matching superseded editor model versions or older connection generations must be discarded immediately.

## 4. Panel Reveal Behavior Across Layouts (`WorkspacePage.tsx`, `IdeShell.tsx`, `TerminalWorkspaceShell.tsx`, `MobileWorkspaceShell.tsx`)

- **IDE Layout (`IdeShell.tsx:237-251, 295-326`)**:
  - Managed by `activateBottomToolRequest` (`ActivateToolRequest { nonce, toolId, exclusiveTarget? }`).
  - **HAZARD**: When `exclusiveTarget: "git"` is supplied, `resolveTerminalPanelShortcut` (`ide-shell-layout.ts:194-201`) executes toggle logic (`isActive ? null : targetId`), closing the panel if already open.
  - Omission of `exclusiveTarget` triggers direct activation (`setActiveLeftBottomId(toolId)`), safely revealing the panel without toggling closed.
- **Terminal Layout (`TerminalWorkspaceShell.tsx:68-79`, `terminal-workspace-panel.ts:36-44`)**:
  - Managed by `terminalWorkspacePanelRequest` (`{ nonce, targetId }`).
  - **HAZARD**: Handler always passes request through `resolveTerminalWorkspacePanelActivation`, which toggles: `activePanelId === targetId ? null : targetId`. Re-requesting Git closes the drawer.
  - Requires explicit reveal mode or open helper ensuring `activePanelId = "git"` unconditionally when navigating from blame.
- **Compact Layout (`MobileWorkspaceShell.tsx`, `WorkspacePage.tsx:2248-2395`)**:
  - Managed by `activeCompactSurface` and `setRequestedCompactSurface`.
  - Both `compactIdeSurfaces` and `compactTerminalSurfaces` register `{ id: "git" }`.
  - **HAZARD**: Existing shortcut helper (`WorkspacePage.tsx:1003`) contains `if (isCompactWorkspace) return;`. Blame commit reveal must invoke `setRequestedCompactSurface("git")` on compact screens.

## 5. Commit Selection Resets & Action-Safety Risks (`use-git-history-view.ts`, `WorkspaceGitPanel.tsx`, `CommitDetailsPanel.tsx`)

- **Commit Selection Resets in `useGitHistoryView`**:
  - `selectedCommit` is local hook state (`GitLogEntry | null`).
  - Resets to `null` synchronously on `effectiveScopeKey` change (`[profileId, project, worktreePath, effectiveRootId, branch, generation]`).
  - Resets on search/query change (`lines 475, 492, 510`), pagination (`lines 548, 555`), and refresh (`line 628` if commit not in refreshed first 200 rows).
- **History View Limitations**:
  - `GitLogTree` loads 200 entries (`GIT_HISTORY_PAGE_SIZE = 200`). Blame can reference commits older than 200 revisions or outside the active branch/filter.
  - Navigating to a commit OID must NOT depend on that commit existing in loaded `GitLogTree` rows.
- **Action-Safety Risks in `CommitDetailsPanel` (`lines 170-185`)**:
  - Actions like `canDrop = Boolean(onDropSelectedChanges) && !commit.isPushed`, cherry-pick, and revert require canonical `GitLogEntry` fields (`isPushed`, `parents`, etc.).
  - Synthesizing fake `GitLogEntry` records from blame metadata will cause corrupt safety checks (e.g. allowing drop on pushed commits or failing repo integrity).
- Header currently renders `commit.message` as truncated subject. Use a direct canonical read-only commit-details lookup for full body; existing `useGitCommitMessage` calls branch/reachability-constrained edit-snapshot API and is unsuitable for arbitrary blame inspection.

## 6. Minimal Integrations Suggested

1. **Tab Blame State**: Store `blameEnabled?: boolean` in `Tab` (or session Map in `useEditorStore`), strictly omitted from `partialize`.
2. **Safe Workspace Reveal**: Provide `revealWorkspacePanel("git")` in `WorkspacePage` that:
   - For IDE: sends `activateBottomToolRequest` without `exclusiveTarget` (safe reveal).
   - For Terminal: sends `activatePanelRequest` with non-toggling reveal contract.
   - For Compact: calls `setRequestedCompactSurface("git")`.
3. **Direct Commit Revelation**: In `WorkspaceGitPanel` / `useGitHistoryView`:
   - Support pinned commit OID navigation that fetches canonical commit metadata directly (honoring VCS root and connection generation), rendering `CommitDetailsPanel` even when unlisted in paginated log rows.
4. **Clean File Root Resolution**: Decouple VCS root resolution in `EditorTabs` from `activeGitState` (which only indexes modified files), using `useGitRoots` or file path to root resolution.

## Unresolved Questions
- None blocking frontend design; backend endpoint contract will dictate exact payload for direct commit lookup.
