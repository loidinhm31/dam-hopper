---
parent: plan.md
phase: "02"
status: done
priority: P1
effort: 2h
depends_on: phase-01
---

# Phase 02: Web UI Workspace Switcher

## Context

- Parent: [plan.md](./plan.md)
- Depends on: Phase 01 (server APIs must exist)
- Research: [web-switcher](./research/researcher-02-web-switcher.md)

## Overview

Add a workspace switcher dropdown to the Sidebar, handle the `workspace:changed` SSE
event with nuclear query invalidation, and create React Query hooks for workspace
management APIs.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- SSE hook already has pub/sub pattern — adding `workspace:changed` is 3-4 lines
- Nuclear invalidation (`qc.invalidateQueries()` with no filter) is correct since entire workspace changed
- No modal/dialog library exists — use custom dropdown (button trigger + absolute-positioned panel)
- Click-outside-to-close via `useEffect` + document click listener
- Sidebar already imports `useWorkspace()` and `useSSE()` — minimal new imports

## Requirements

### 1. SSE: Handle `workspace:changed` Event

In `packages/web/src/hooks/useSSE.ts`:

```typescript
// Add to eventTypes array (line 64-70)
"workspace:changed";

// Add listener (after config:changed handler)
es.addEventListener("workspace:changed", () => {
  void qc.invalidateQueries(); // Nuclear — all queries stale
});
```

### 2. API Client Extensions

In `packages/web/src/api/client.ts`:

```typescript
// Types
export interface KnownWorkspace {
  name: string;
  path: string;
}

export interface KnownWorkspacesResponse {
  workspaces: KnownWorkspace[];
  current: string;
}

// Endpoints
workspace: {
  get: () => get<WorkspaceInfo>("/workspace"),
  switch: (path: string) => post<WorkspaceInfo>("/workspace/switch", { path }),
  known: () => get<KnownWorkspacesResponse>("/workspace/known"),
  addKnown: (path: string) => post<KnownWorkspace>("/workspace/known", { path }),
  removeKnown: (path: string) => del("/workspace/known", { path }),
},
```

### 3. React Query Hooks

In `packages/web/src/api/queries.ts`:

```typescript
export function useKnownWorkspaces() {
  return useQuery({
    queryKey: ["known-workspaces"],
    queryFn: () => api.workspace.known(),
  });
}

export function useSwitchWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.workspace.switch(path),
    onSuccess: () => {
      // SSE will also trigger invalidation, but do it eagerly for responsiveness
      void qc.invalidateQueries();
    },
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
```

### 4. WorkspaceSwitcher Component

New file: `packages/web/src/components/organisms/WorkspaceSwitcher.tsx`

**Behavior:**

- Default state: shows current workspace name (same as current Sidebar display)
- Click trigger: toggles dropdown panel below the workspace name
- Dropdown contents:
  - Known workspaces list (each clickable to switch)
  - Current workspace highlighted with checkmark icon
  - Divider
  - "Add workspace" section: text input for path + Add button
  - Each non-current workspace has a remove (X) button
- Loading state: show spinner during switch mutation
- Error state: show inline error message if switch fails
- Click outside or Escape key closes dropdown

**Styling:** Use existing design tokens (--color-surface, --color-border, --color-primary, etc.)

### 5. Sidebar Integration

Replace the static workspace display in `Sidebar.tsx` (lines 30-38) with:

```tsx
<WorkspaceSwitcher />
```

The WorkspaceSwitcher handles its own data fetching and styling, maintaining the same
visual footprint as the current workspace display when collapsed.

## Architecture

```
WorkspaceSwitcher
├── useWorkspace()           → current workspace info
├── useKnownWorkspaces()     → dropdown list
├── useSwitchWorkspace()     → switch mutation
├── useAddKnownWorkspace()   → add path mutation
└── useRemoveKnownWorkspace()→ remove mutation

User clicks workspace name
    ↓
Dropdown opens (known workspaces list)
    ↓
User clicks different workspace
    ↓
useSwitchWorkspace.mutate(path)
    ↓
POST /api/workspace/switch
    ↓
Server: ctx.switchWorkspace() → broadcast("workspace:changed")
    ↓
SSE event → qc.invalidateQueries() (nuclear)
    ↓
All queries refetch → UI updates with new workspace data
```

## Related Code Files

- `packages/web/src/hooks/useSSE.ts` — add workspace:changed handler
- `packages/web/src/api/client.ts` — new types + endpoints
- `packages/web/src/api/queries.ts` — new hooks
- `packages/web/src/components/organisms/WorkspaceSwitcher.tsx` (new)
- `packages/web/src/components/organisms/Sidebar.tsx` — replace workspace display

## Implementation Steps

1. Add `workspace:changed` event handling to `useSSE.ts`
2. Add types and endpoints to `client.ts`
3. Add React Query hooks to `queries.ts`
4. Create `WorkspaceSwitcher.tsx` organism:
   - Dropdown trigger (workspace name + chevron icon)
   - Known workspaces list with switch/remove actions
   - Add workspace input + button
   - Loading/error states
   - Click-outside-to-close
5. Replace Sidebar workspace section with `<WorkspaceSwitcher />`
6. Test manually: switch workspace, verify all pages refresh with new data

## Completed

- [x] Add workspace:changed to SSE hook
- [x] Add API client types + endpoints
- [x] Add React Query hooks (known, switch, add, remove)
- [x] Create WorkspaceSwitcher component
- [x] Integrate into Sidebar
- [x] Manual testing

## Success Criteria

- Clicking workspace name opens dropdown showing known workspaces
- Clicking a different workspace triggers switch → all pages update with new data
- Adding a workspace path validates and appears in dropdown
- Removing a workspace from known list works (cannot remove current)
- Switch errors show inline message (e.g., invalid path, no config found)
- Dropdown closes on click-outside and Escape key

## Risk Assessment

- **Low** — pure UI addition; no server-side risk
- **Low** — nuclear invalidation is aggressive but correct for workspace switch
- **Medium** — UX during switch: brief loading state while all queries refetch. Mitigated by showing a loading indicator on the switcher

## Security Considerations

- Path input is sent to server which validates — no client-side path resolution needed
- No sensitive data exposed in known workspaces list (just names and paths)

## Next Steps

→ Phase 03: Global config editor in Settings page
