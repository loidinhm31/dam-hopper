# Phase 02: Web UI Workspace Switcher — Implementation Report

**Status:** Complete | **Date:** 2026-03-22 | **Effort:** 2h

## Summary

Successfully implemented a fully functional workspace switcher dropdown in the web dashboard sidebar. Users can now view known workspaces, switch between them, add new workspace paths, and remove workspaces from the known list. The implementation follows the specification in `/plans/workspace-resolution-web/phase-02-web-workspace-switcher.md` with all requirements met.

## Implementation Details

### 1. SSE Event Handler (`packages/web/src/hooks/useSSE.ts`)

Added `workspace:changed` event listener that performs nuclear query invalidation:

```typescript
es.addEventListener("workspace:changed", () => {
  void qc.invalidateQueries(); // Nuclear — entire workspace changed
  void qc.invalidateQueries({ queryKey: ["known-workspaces"] }); // Also explicit
});
```

**Location:** Lines 104–107

**Behavior:**

- Triggered when server broadcasts `workspace:changed` (after `/workspace/switch` completes)
- Invalidates all React Query cache entries, forcing full UI refresh
- Explicit invalidation of `["known-workspaces"]` for clarity
- Ensures all stale data is refreshed when workspace switches

### 2. API Client Extensions (`packages/web/src/api/client.ts`)

Added three new type definitions and extended `api` namespace:

**Types (lines 58–71):**

```typescript
export interface KnownWorkspace {
  name: string;
  path: string;
}

export interface KnownWorkspacesResponse {
  workspaces: KnownWorkspace[];
  current: string;
}

export interface GlobalConfig {
  defaults?: { workspace?: string };
  workspaces?: KnownWorkspace[];
}
```

**Endpoints (lines 174–185):**

```typescript
workspace: {
  get: () => get<WorkspaceInfo>("/workspace"),
  switch: (path: string) => post<WorkspaceInfo>("/workspace/switch", { path }),
  known: () => get<KnownWorkspacesResponse>("/workspace/known"),
  addKnown: (path: string) => post<KnownWorkspace>("/workspace/known", { path }),
  removeKnown: (path: string) => del("/workspace/known", { path }),
},
globalConfig: {
  get: () => get<GlobalConfig>("/global-config"),
  updateDefaults: (defaults: { workspace?: string }) =>
    put<{ updated: true }>("/global-config/defaults", defaults),
},
```

**Design:** Plain `fetch` wrapper (no Hono RPC needed since server routes don't use validators).

### 3. React Query Hooks (`packages/web/src/api/queries.ts`)

Five new hooks for workspace management:

**Queries:**

```typescript
export function useKnownWorkspaces() {
  return useQuery({
    queryKey: ["known-workspaces"],
    queryFn: () => api.workspace.known(),
    staleTime: 30_000,
  });
}

export function useGlobalConfig() {
  return useQuery({
    queryKey: ["global-config"],
    queryFn: () => api.globalConfig.get(),
  });
}
```

**Mutations:**

```typescript
export function useSwitchWorkspace() {
  return useMutation({
    mutationFn: (path: string) => api.workspace.switch(path),
    // No onSuccess invalidation — SSE workspace:changed handles nuclear flush
  });
}

export function useAddKnownWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.workspace.addKnown(path),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["known-workspaces"] }),
  });
}

export function useRemoveKnownWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.workspace.removeKnown(path),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["known-workspaces"] }),
  });
}

export function useUpdateGlobalDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defaults: { workspace?: string }) =>
      api.globalConfig.updateDefaults(defaults),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["global-config"] }),
  });
}
```

**Design:** `useSwitchWorkspace()` deliberately omits `onSuccess` callback—SSE `workspace:changed` event triggers nuclear invalidation for consistency. Other mutations invalidate their respective query keys.

### 4. WorkspaceSwitcher Component (`packages/web/src/components/organisms/WorkspaceSwitcher.tsx`)

New organism component managing the workspace switcher UI.

**Features:**

- **Trigger button:** Shows current workspace name with chevron icon
- **Loading state:** Spinner during switch operation
- **Dropdown panel:**
  - Known workspaces list (fetched on mount, cached 30s)
  - Current workspace highlighted with checkmark icon
  - Non-current workspaces have remove (X) button
  - Divider separating list from "Add workspace" section
  - Add workspace input field + button (validates non-empty path)
  - Inline error display for mutation failures
- **Interactions:**
  - Click workspace to switch (disabled if already current or switching)
  - Click remove button to delete from known list
  - Enter key in input submits add form
  - Click outside or Escape key closes dropdown
- **Styling:** Uses CSS custom properties (--color-surface, --color-primary, --color-danger, etc.)

**Helper function:**

```typescript
function abbreviatePath(p: string) {
  return p
    .replace(/^\/(?:home|Users)\/[^/]+/, "~")
    .replace(/^\/root(\/|$)/, "~$1");
}
```

Abbreviates home directories for compact display.

**State management:**

- `open`: Dropdown visibility
- `addPath`: Input field value for new workspace path
- `removingPath`: Track which workspace is being removed (UI feedback)

**Location:** `/packages/web/src/components/organisms/WorkspaceSwitcher.tsx` (189 lines)

### 5. Sidebar Integration (`packages/web/src/components/organisms/Sidebar.tsx`)

Replaced static workspace display (lines 30–32) with `<WorkspaceSwitcher />`:

```tsx
<div className="px-4 py-4 border-b border-[var(--color-border)]">
  <WorkspaceSwitcher />
</div>
```

**Impact:** WorkspaceSwitcher handles all data fetching and UI logic; Sidebar remains clean and focused on navigation structure.

## Data Flow

```
User clicks workspace name in Sidebar
    ↓
WorkspaceSwitcher dropdown opens
    ↓
useKnownWorkspaces() fetches available workspaces
    ↓
User clicks different workspace
    ↓
useSwitchWorkspace.mutate(path) → POST /api/workspace/switch
    ↓
Server-side: ctx.switchWorkspace()
    ├ Stops all running processes
    ├ Reloads config from new workspace
    └ Broadcasts SSE: workspace:changed
    ↓
Browser receives workspace:changed event
    ↓
useSSE hook: qc.invalidateQueries() (nuclear)
    ↓
All queries refetch automatically
    ↓
Dashboard pages update with new workspace data
```

## Testing Checklist

All success criteria met:

- [x] Clicking workspace name opens dropdown showing known workspaces
- [x] Clicking a different workspace triggers switch → all pages update with new data
- [x] Adding a workspace path validates and appears in dropdown
- [x] Removing a workspace from known list works (cannot remove current)
- [x] Switch errors show inline message (e.g., invalid path, no config found)
- [x] Dropdown closes on click-outside and Escape key
- [x] Loading state visible during switch (spinner in trigger button)
- [x] Current workspace highlighted with checkmark
- [x] Path abbreviation for home directories (~/... format)

## Architecture Notes

**Component hierarchy:**

```
Sidebar
└── WorkspaceSwitcher
    ├── useWorkspace() — current workspace info
    ├── useKnownWorkspaces() — dropdown list
    ├── useSwitchWorkspace() — switch mutation
    ├── useAddKnownWorkspace() — add path mutation
    └── useRemoveKnownWorkspace() — remove mutation
```

**Cache strategy:**

- `["workspace"]`: Invalidated on config:changed and workspace:changed
- `["known-workspaces"]`: Invalidated on add/remove mutations and workspace:changed
- `["global-config"]`: Fetched for Phase 03 (Settings page integration)
- No `onSuccess` on switch mutation—SSE event triggers nuclear flush for consistency

**Error handling:**

- Failed switch: Error message displayed inline
- Failed add/remove: Error message displayed inline
- Network errors: Standard React Query error flow

## Related Files

- `/packages/web/src/hooks/useSSE.ts` — SSE event handling
- `/packages/web/src/api/client.ts` — API types and endpoints
- `/packages/web/src/api/queries.ts` — React Query hooks
- `/packages/web/src/components/organisms/WorkspaceSwitcher.tsx` — New component
- `/packages/web/src/components/organisms/Sidebar.tsx` — Integration point

## CLAUDE.md Alignment

The CLAUDE.md file contains complete documentation of workspace switching design:

**Lines 72:** "Workspace switching: Server-side switching via `POST /workspace/switch` stops all running processes, loads a new workspace, and broadcasts `workspace:changed` SSE event."

**Lines 66–70:** "Known workspaces: Global config (`~/.config/dev-hub/config.toml`) maintains a list of known workspace names and paths."

No updates needed to CLAUDE.md—web implementation precisely follows documented architecture.

## Next Steps

→ Phase 03: Global config editor in Settings page (planned)

This will allow users to:

- View and edit default workspace selection
- Manage known workspaces list persistence
- Set XDG config paths

## Risk Assessment Summary

- **Low risk:** Pure UI addition, no server-side changes required
- **Low risk:** Nuclear invalidation is aggressive but correct for workspace changes
- **Medium UX:** Brief loading state during cache refetch; mitigated by spinner

All risks addressed. Implementation complete and production-ready.
