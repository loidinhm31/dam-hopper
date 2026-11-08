# Scout Report: Agent Hub File Changes Refresh Affordance

**Date:** 2026-11-08
**Context:** Agent Hub right sidebar ("file changes" section) refresh button investigation

---

## 1. Component Hierarchy & Files

Agent Hub hosts a collapsible right sidebar displaying project files and file changes:

- **Host App:** `packages/ui/src/os/apps/AgentHubApp.tsx`
  - Registered OS application (`appId: "agent-hub"`, window mode: tile/maximized).
  - Owns `fileTreeHidden` state (`useState(false)`) and `handleToggleFileTree`.
  - Renders `AgentHubHeader` (top) and `TraditionalTerminalProjectsDisplay` (body).
  - Handles `onOpenFile` (forwarding `file:open` intents) and `onOpenSessionChanges` (OMP agent review).

- **Header Component:** `packages/ui/src/os/agent-hub/AgentHubHeader.tsx`
  - Contains `[Files]` toggle button (`aria-label="Toggle files sidebar"`, `aria-expanded={!fileTreeHidden}`) that shows/hides the right sidebar.

- **Sidebar Container:** `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` (lines 737–790)
  - Element: `<aside role="complementary" aria-label={`${selectedGroup.projectName} files and changes`} data-testid="agent-hub-right-file-tree-sidebar">`
  - Top header: Folder icon + project name + Close button (`aria-label="Close files sidebar"`).
  - Section 1 ("files", lines 760–774):
    - Subheader: `<div className="flex h-7 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 text-2xs font-semibold lowercase tracking-wide text-[var(--color-text-muted)]"><span>files</span></div>`
    - Content: `<TraditionalProjectWorkspaceTree ... />` (wraps `<FileTree />` inside `<EncryptProvider>`).
  - Section 2 ("file changes", lines 775–788):
    - Subheader: `<div className="flex h-7 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 text-2xs font-semibold lowercase tracking-wide text-[var(--color-text-muted)]"><span>file changes</span></div>`
    - Content: `<TraditionalProjectFileChanges projectName={selectedGroup.projectName} profileId={selectedGroup.profileId} projectRef={selectedGroup.projectRef} onOpenFile={onOpenFile} className="px-2 py-1" />`

- **Changes Display Component:** `packages/ui/src/components/organisms/TraditionalProjectFileChanges.tsx`
  - Renders the file list for the selected project.
  - Normalizes target to `ProjectTargetRef` (resolving profile, project name, worktree path).
  - Calls `useGitDiff(targetRef, "*")`.
  - Renders loading spinner, error message, git uninitialized notice, empty state ("No changed files"), or file list items with badges (`M`, `A`, `D`, `R`, `C`, `?`).
  - Double-click / Enter triggers `onOpenFile({ isDiff: true, fileStatus, mode: "float" })`.

- **Related Session Changes Drawer:** `packages/ui/src/os/apps/SessionChangesApp.tsx` & `packages/ui/src/components/organisms/SessionChangesPanel.tsx`
  - Used for AI agent OMP session review via `requestAgentHubReview` (`packages/ui/src/os/agent-hub/agent-hub-review.ts`).

---

## 2. Data Fetching Mechanism & Query Hook

- **Hook:** `useGitDiff(target: ProjectTargetInput, root?: string)`
  - Location: `packages/ui/src/api/queries.ts` (lines 1354–1382).
  - Backend API: `getBoundApiClient(owner).git.diff(normalized, root)` -> `GET /api/git/:project/diff` on Axum server (`server/src/api/git.rs`).
- **Query Key:**
  - Built with `gitQueryKey("git-diff", normalized, rootKey)`.
  - Remote profile: `["profile:<id>", "git", "git-diff", <project>, <cacheKey>, ...]`
  - Default/local profile: `["git-diff", <project>, <cacheKey>, ...]`
- **Query Config:**
  - `enabled: !!normalized.project`
  - `staleTime: 0`
- **Hook Return Value:** TanStack Query `UseQueryResult<GitDiffResult>`:
  - `data: GitDiffResult | undefined` (`{ gitAvailable: boolean, entries: DiffFileEntry[], ... }`)
  - `isLoading: boolean`
  - `isFetching: boolean`
  - `isError: boolean`
  - `error: unknown`
  - `refetch: () => Promise<QueryObserverResult<GitDiffResult>>`

---

## 3. Refresh & Invalidation Patterns

DamHopper uses two primary patterns for refreshing file changes:

### Pattern A: Direct `refetch()` on `useGitDiff`
- Hook returns `{ refetch, isFetching } = useGitDiff(...)`.
- Executed on button click: `onClick={() => void refetch()}`.
- Reference implementation: `packages/ui/src/components/organisms/ChangedFilesList.tsx`:
  ```tsx
  <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
    <span className="text-2xs font-bold tracking-widest text-[var(--color-text-muted)] uppercase">Local Changes</span>
    <button
      type="button"
      onClick={() => void refetch()}
      aria-label="Refresh changes"
      className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
    </button>
  </div>
  ```

### Pattern B: Query Invalidation via `QueryClient`
- Invalidation helper: `invalidateGitProjectQueries(qc, target, { includeGitDiff: true })` or `qc.invalidateQueries({ queryKey: gitQueryKey("git-diff", normalized) })`.
- Reference: `packages/ui/src/api/queries.ts` (lines 355, 375, 403, 450).
- If refresh button is in `TraditionalTerminalProjectsDisplay`:
  - `TraditionalTerminalProjectsDisplay` has `selectedGroup` (`projectName`, `profileId`, `projectRef`).
  - Uses `useQueryClient()` and calls `queryClient.invalidateQueries({ queryKey: gitQueryKey("git-diff", targetRef) })`.
  - Can track fetching state via `useIsFetching({ queryKey: gitQueryKey("git-diff", targetRef) }) > 0`.

### UI / Icon Button Conventions
- Icon: `RefreshCw` from `lucide-react`.
- Spin animation: `className={cn("h-3 w-3", isFetching && "animate-spin")}`.
- Placement: In `TraditionalTerminalProjectsDisplay.tsx:776-778`, the section header `<div className="flex h-7 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 text-2xs font-semibold lowercase tracking-wide text-[var(--color-text-muted)]">` already uses `justify-between` with only `<span>file changes</span>`.
- Button styling:
  ```tsx
  <button
    type="button"
    onClick={handleRefresh}
    disabled={isFetching}
    title="Refresh file changes"
    aria-label="Refresh file changes"
    className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
  >
    <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
  </button>
  ```

---

## 4. Test Files

### Unit Tests
- `packages/ui/src/components/organisms/TraditionalProjectFileChanges.test.tsx`
  - Tests loading, git unavailable, empty states, click selection, and double-click float opening.
- `packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.test.tsx`
  - Tests right sidebar tree rendering, target isolation, file open dispatch.
- `packages/ui/src/os/agent-hub/AgentHubHeader.test.tsx`
  - Tests Agent Hub header controls, files toggle button, Git button, counters.
- `packages/ui/src/api/queries-git-diff.test.ts`
  - Tests `useGitDiff` query key derivation, worktree keys, invalidation on mutations.
- `packages/ui/src/components/organisms/ChangedFilesListRender.test.tsx`
  - Tests git diff query states and unavailable git messaging.

### Browser & E2E Tests
- `packages/ui/browser-tests/os-agent-hub.browser.tsx`
  - Tests Agent Hub window mounting, `AgentHubHeader`, sidebar toggle persistence.
- `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`
  - Tests `TraditionalTerminalProjectsDisplay` layout, tab selection, terminals stage.
- `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts`
  - Tests right sidebar `[data-testid="agent-hub-right-file-tree-sidebar"]`, `Toggle files sidebar` button, and opening files into floating Monaco editor.

---

## Unresolved Questions
None. All components, queries, invalidation helpers, UI patterns, and test suites have been identified.
