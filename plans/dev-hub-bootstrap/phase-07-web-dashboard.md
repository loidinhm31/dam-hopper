# Phase 07 — Web Dashboard

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phase**: [phase-06-server-api.md](./phase-06-server-api.md)
- **Next phase**: [phase-08-integration-testing.md](./phase-08-integration-testing.md)
- **Depends on**: Phase 06 (Hono API + RPC type), Phase 01 (Vite + React setup)

## Overview

- **Date**: 2026-03-21
- **Priority**: Medium
- **Status**: `pending`

Build the `@dev-hub/web` React dashboard — a single-page app served by the dev-hub server. Provides a visual interface for all workspace operations: project overview, git operations with live progress, build triggering with log streaming, and running process management. Uses TanStack Query for data fetching, SSE for real-time updates, Hono RPC for type-safe API calls, and shadcn/ui for components.

## Key Insights

- Hono RPC client (`hc<AppType>`) gives end-to-end type safety from server route definitions to client fetch calls — no API types to manually sync.
- TanStack Query manages server state (caching, refetching, optimistic updates). SSE events trigger query invalidation for real-time UI updates.
- shadcn/ui provides copy-paste components built on Radix UI + Tailwind — no heavy UI library dependency.
- The dashboard is designed for local use only (no auth needed). It is served by the same server that provides the API.
- Dark mode by default since this is a developer tool.

## Requirements

- Dashboard page with workspace overview (project count, git status summary, running processes).
- Projects list with sortable table showing status, branch, actions.
- Project detail view with git info, worktrees, build controls, run controls.
- Bulk git operations page with live progress visualization.
- Build page with live log streaming.
- Process manager with start/stop/restart and live log viewing.
- Settings page for viewing/editing workspace config.
- Real-time updates via SSE (progress, status changes, logs).
- Dark mode default, clean developer-focused aesthetic.
- Responsive layout (but optimized for desktop widths).

## Architecture

### Page Structure

```
/                                         # Dashboard overview
/projects                                 # Projects list table
/projects/:name                           # Project detail (tabs: git, build, run)
/git                                      # Bulk git operations
/build                                    # Build overview + trigger
/processes                                # Running process manager
/settings                                 # Workspace config editor
```

### Module Structure (Atomic Design)

Path alias: `@/*` → `./src/*`

```
packages/web/src/
  main.tsx                                # Entry point, providers
  App.tsx                                 # Router + layout
  api/
    client.ts                             # Hono RPC client instance
    queries.ts                            # TanStack Query hooks (useProjects, useStatus, etc.)
    sse.ts                                # SSE connection hook + event dispatching
  components/
    atoms/                                # Smallest UI primitives (single responsibility)
      GitStatusBadge.tsx                  # Clean/dirty/conflict badge
      BranchBadge.tsx                     # Branch name display
      ConnectionDot.tsx                   # Green/red SSE connection indicator
      LogLine.tsx                         # Single log output line (monospace)
      ProgressBar.tsx                     # Single operation progress bar
    molecules/                            # Combinations of atoms
      OverviewCard.tsx                    # Icon + count + label card
      ProjectRow.tsx                      # Table row: name + type + branch + status + actions
      ProgressItem.tsx                    # Project name + ProgressBar + status message
      BuildLogViewer.tsx                  # Scrolling log container (LogLine[])
      WorktreeRow.tsx                     # Worktree path + branch + actions
      ProcessRow.tsx                      # Process: command + PID + status + actions
    organisms/                            # Complex, self-contained sections
      Sidebar.tsx                         # Navigation sidebar with links + ConnectionDot
      Header.tsx                          # Page header with breadcrumbs
      ProjectsTable.tsx                   # Sortable/filterable table of ProjectRow[]
      ProgressList.tsx                    # Multi-project ProgressItem[] for bulk ops
      WorktreeManager.tsx                 # WorktreeRow[] + "Add Worktree" dialog
      ProcessTable.tsx                    # ProcessRow[] + "Start New" dropdown
      BulkOperationPanel.tsx              # Select projects + start button + ProgressList
      ConfigEditor.tsx                    # TOML viewer/editor with save
    templates/                            # Page layouts (arrange organisms)
      AppLayout.tsx                       # Shell: Sidebar + Header + content slot
      DetailLayout.tsx                    # Tabs layout for project detail page
    ui/                                   # shadcn/ui primitives (auto-generated)
      button.tsx, card.tsx, table.tsx, badge.tsx, tabs.tsx,
      dialog.tsx, select.tsx, textarea.tsx, toast.tsx, ...
  hooks/
    useSSE.ts                             # SSE connection manager
    useQueryInvalidation.ts               # Invalidate queries on SSE events
  lib/
    utils.ts                              # cn() helper, formatters
  pages/                                  # Pages (compose templates + organisms)
    DashboardPage.tsx
    ProjectsPage.tsx
    ProjectDetailPage.tsx
    GitPage.tsx
    BuildPage.tsx
    ProcessesPage.tsx
    SettingsPage.tsx
```

### Data Flow

```
Server (Hono)
  ├── REST API ──> Hono RPC client ──> TanStack Query ──> React components
  └── SSE stream ──> useSSE hook ──> event dispatcher
                                      ├── invalidate TanStack queries (refetch data)
                                      ├── append to log buffers (build/process logs)
                                      └── update progress state (git/build operations)
```

## Related Code Files

- `packages/web/src/**/*.tsx` — all new (except stubs from Phase 01)
- `packages/server/src/app.ts` — imports `AppType` for Hono RPC (from Phase 06)
- `packages/web/package.json` — update dependencies

## Implementation Steps

1. **Install dependencies and configure shadcn/ui**
   - Add to package.json: `@tanstack/react-query@^5`, `@tanstack/react-router@^1` (or `react-router-dom@^7`), `hono`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/react-*` (as needed by shadcn components).
   - Initialize shadcn/ui: create `components.json`, add base components (button, card, table, badge, tabs, dialog, select, input, textarea, toast, dropdown-menu, separator, scroll-area).
   - Configure Tailwind v4 with dark mode as default: add `@theme` block in `index.css` with dark color variables.

2. **Implement `api/client.ts`**
   - Import `AppType` from `@dev-hub/server` (Hono RPC type).
   - Create client: `export const api = hc<AppType>(window.location.origin);`
   - This gives fully typed methods like `api.api.projects.$get()`.

3. **Implement `api/queries.ts`**
   - TanStack Query hooks:
     ```typescript
     export function useWorkspace() {
       return useQuery({ queryKey: ["workspace"], queryFn: () => api.api.workspace.$get().then(r => r.json()) });
     }
     export function useProjects() {
       return useQuery({ queryKey: ["projects"], queryFn: () => api.api.projects.$get().then(r => r.json()), refetchInterval: 30000 });
     }
     export function useProjectStatus(name: string) {
       return useQuery({ queryKey: ["project-status", name], queryFn: () => api.api.projects[":name"].status.$get({ param: { name } }).then(r => r.json()) });
     }
     export function useWorktrees(project: string) { ... }
     export function useBranches(project: string) { ... }
     export function useProcesses() { ... }
     export function useProcessLogs(project: string, lines?: number) { ... }
     ```
   - Mutation hooks:
     ```typescript
     export function useGitFetch() {
       return useMutation({ mutationFn: (projects?: string[]) => api.api.git.fetch.$post({ json: { projects } }).then(r => r.json()) });
     }
     export function useGitPull() { ... }
     export function useBuild(project: string) { ... }
     export function useStartProcess(project: string) { ... }
     export function useStopProcess(project: string) { ... }
     export function useRestartProcess(project: string) { ... }
     export function useAddWorktree(project: string) { ... }
     export function useRemoveWorktree(project: string) { ... }
     ```

4. **Implement `hooks/useSSE.ts`**
   - Custom hook that manages an EventSource connection to `/api/events`.
   - Parses incoming events by type.
   - Returns event state and connection status.
   - Auto-reconnects on disconnect with exponential backoff (1s, 2s, 4s, max 30s).
   ```typescript
   export function useSSE() {
     const [connectionStatus, setStatus] = useState<"connected" | "connecting" | "disconnected">("connecting");
     const queryClient = useQueryClient();

     useEffect(() => {
       const es = new EventSource("/api/events");
       es.onopen = () => setStatus("connected");
       es.onerror = () => setStatus("disconnected");

       es.addEventListener("git:progress", (e) => { /* dispatch to subscribers */ });
       es.addEventListener("build:progress", (e) => { /* dispatch */ });
       es.addEventListener("process:event", (e) => { /* dispatch */ });
       es.addEventListener("status:changed", (e) => {
         const { projectName } = JSON.parse(e.data);
         queryClient.invalidateQueries({ queryKey: ["project-status", projectName] });
         queryClient.invalidateQueries({ queryKey: ["projects"] });
       });

       return () => es.close();
     }, []);

     return { connectionStatus };
   }
   ```

5. **Implement `hooks/useQueryInvalidation.ts`**
   - Hook that subscribes to SSE events and invalidates relevant TanStack queries.
   - On `git:progress` completed -> invalidate `["projects"]`, `["project-status", name]`.
   - On `build:progress` completed -> invalidate `["projects"]`.
   - On `process:event` -> invalidate `["processes"]`.

6. **Implement layout components**
   - `Layout.tsx`: flex container with fixed sidebar (240px) + main content area.
   - `Sidebar.tsx`: nav links using `lucide-react` icons: Dashboard, Projects, Git, Build, Processes, Settings. Active link highlighted. Workspace name at top. Connection status indicator (green/red dot) at bottom.
   - `Header.tsx`: page title + breadcrumbs.

7. **Implement `pages/DashboardPage.tsx`**
   - `OverviewCards`: 4 cards — Total Projects, Clean Repos, Dirty Repos, Running Processes. Each shows count with icon.
   - `StatusSummary`: simple horizontal bar showing proportion of clean/dirty/unknown repos.
   - `RecentActivity`: list of recent SSE events (last 20), showing timestamp + message.

8. **Implement `pages/ProjectsPage.tsx`**
   - `ProjectsTable`: columns — Name, Type, Branch, Status (badge), Ahead/Behind, Actions (fetch, pull, build, run buttons).
   - Sortable by name, type, status.
   - Filter by type (dropdown) or search by name.
   - Row click navigates to project detail.

9. **Implement `pages/ProjectDetailPage.tsx`**
   - Tabs: Overview, Git, Worktrees, Build, Run.
   - **Overview tab**: project config, current branch, status badge, last commit.
   - **Git tab**: fetch/pull/push buttons, branch list with `BranchList` component, update-all button.
   - **Worktrees tab**: `WorktreeManager` — list existing worktrees in a table, "Add Worktree" button opens dialog with branch name input + create-new-branch checkbox.
   - **Build tab**: `BuildTrigger` button + `BuildLog` component showing live streaming output.
   - **Run tab**: start/stop/restart buttons + `ProcessLog` live log viewer.

10. **Implement `pages/GitPage.tsx`**
    - Two sections: Bulk Fetch, Bulk Pull.
    - Each has a "Start" button and a `ProgressList` showing per-project progress.
    - Project selector: checkboxes to select which projects to operate on (default: all).
    - Results summary after completion: success count, failure count, failure details.

11. **Implement `pages/BuildPage.tsx`**
    - Project selector dropdown.
    - "Build" button.
    - `BuildLog` component: monospace scrolling div, auto-scroll to bottom, pause auto-scroll when user scrolls up.
    - Build result banner at completion (green success / red failure with exit code and duration).

12. **Implement `pages/ProcessesPage.tsx`**
    - `ProcessTable`: columns — Project, Command, PID, Status (badge), Uptime, Actions (stop, restart, view logs).
    - "Start New" dropdown to start a project that is not running.
    - Click row to expand inline log viewer.
    - `ProcessLog`: live-updating log viewer. Streams from SSE + initial load from `GET /api/run/:project/logs`.

13. **Implement `pages/SettingsPage.tsx`**
    - Display workspace config as formatted TOML in a read-only code block.
    - "Edit" button switches to a textarea with syntax highlighting (optional: use a simple monospace textarea).
    - "Save" button sends updated config to server (future: add a PUT /api/workspace endpoint).
    - Show config file path.

14. **Implement `components/git/ProgressList.tsx`**
    - Subscribes to SSE git:progress events.
    - Shows each project as a row: icon (spinner/check/cross) + name + progress bar + status message.
    - Animated transitions as projects complete.

15. **Implement `components/build/BuildLog.tsx`**
    - Monospace container with dark background.
    - Appends lines as they arrive from SSE.
    - Auto-scrolls to bottom unless user has scrolled up.
    - "Copy" button copies full log to clipboard.
    - "Clear" button resets the log display.
    - Timestamps optional (toggle).

16. **Set up routing in `App.tsx`**
    - Use `react-router-dom` v7 with `BrowserRouter`.
    - Routes map to pages as defined in Page Structure above.
    - Wrap in `QueryClientProvider` and SSE provider.

17. **Configure `main.tsx`**
    - Mount React app, setup QueryClient with defaults (staleTime: 10s, retry: 1).
    - Render `<App />`.

18. **Build and verify**
    - `pnpm build` in web package produces `dist/` with index.html + assets.
    - Verify server can serve these static files.
    - Verify Hono RPC client types resolve correctly.

## Todo List

- [ ] Install all web dependencies (TanStack Query, react-router, shadcn/ui, lucide-react)
- [ ] Configure shadcn/ui with dark mode default
- [ ] Set up Tailwind v4 theme with dark color palette
- [ ] Implement Hono RPC client (`api/client.ts`)
- [ ] Implement TanStack Query hooks for all endpoints
- [ ] Implement SSE hook with auto-reconnect
- [ ] Implement query invalidation on SSE events
- [ ] Build layout: Sidebar, Header, Layout shell
- [ ] Implement DashboardPage with overview cards and status summary
- [ ] Implement ProjectsPage with sortable/filterable table
- [ ] Implement ProjectDetailPage with tabs (git, worktrees, build, run)
- [ ] Implement GitPage with bulk operations and progress visualization
- [ ] Implement BuildPage with live log streaming
- [ ] Implement ProcessesPage with process table and log viewer
- [ ] Implement SettingsPage with config display
- [ ] Implement ProgressList component for git/build progress
- [ ] Implement BuildLog component with auto-scroll
- [ ] Set up routing in App.tsx
- [ ] Verify build output is servable by the server
- [ ] Verify Hono RPC types work end-to-end

## Success Criteria

1. Dashboard loads at `/` and shows project counts, status summary, and recent activity.
2. Projects table at `/projects` shows all workspace projects with live status.
3. Clicking a project shows its detail page with working git/build/run tabs.
4. Triggering "Fetch All" on the git page shows live progress bars that update via SSE.
5. Building a project shows live log output in the BuildLog component.
6. Starting a process shows it in the process table; logs stream in real-time.
7. SSE connection indicator shows green when connected.
8. All API calls are type-safe via Hono RPC (no `any` types in API layer).
9. Dark mode renders correctly with good contrast and readability.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hono RPC type import from server package causes build issues | Medium | High | If problematic, extract shared API types to `@dev-hub/core` instead |
| SSE reconnection storms after server restart | Low | Medium | Exponential backoff with jitter in useSSE hook |
| Large build logs cause browser memory pressure | Medium | Medium | Cap log buffer at 5000 lines in the UI; offer "download full log" |
| shadcn/ui component styling conflicts with Tailwind v4 | Low | Medium | Pin shadcn/ui component versions; test each component after adding |

## Next Steps

With the web dashboard complete, proceed to:
- [Phase 08 — Integration & Testing](./phase-08-integration-testing.md) — end-to-end testing of the full stack
