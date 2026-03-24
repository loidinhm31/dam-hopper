# Research: Web UI Workspace Switcher Patterns

## Sidebar Workspace Section (lines 30-37)

Current structure is a simple read-only display:

```tsx
<div className="px-4 py-4 border-b border-[var(--color-border)]">
  <p className="text-xs ...">Workspace</p>
  <p className="mt-0.5 font-semibold ...">{workspace?.name ?? "Dev Hub"}</p>
</div>
```

**Best location for switcher**: Replace this `<div>` with a `WorkspaceSwitcher` organism that shows the workspace name as a clickable trigger. No modals exist in the codebase — use an inline dropdown/collapsible panel consistent with existing patterns (expandable worktree form, collapsible project cards).

## SSE Event Handling

`useSSE()` hook (lines 64-70) maintains an `eventTypes` array. Adding `"workspace:changed"` requires:

1. Add to `eventTypes` array
2. Add listener that invalidates ALL query keys (nuclear invalidation)
3. Dispatch to pub/sub so components can react

Invalidation pattern mirrors `config:changed` handler (lines 97-101) but broader:

```typescript
es.addEventListener("workspace:changed", () => {
  void qc.invalidateQueries(); // invalidate everything
});
```

## React Query Keys to Invalidate

On workspace switch, ALL cached data is stale:

- `["workspace"]`, `["projects"]`, `["config"]`
- `["project", name]`, `["project-status", name]`
- `["branches", project]`, `["worktrees", project]`
- `["processes"]`

**Simplest approach**: `qc.invalidateQueries()` with no filter = invalidate all. This is the correct nuclear option since the entire workspace changed.

## New Queries/Mutations Needed

```typescript
// Queries
useKnownWorkspaces()  → GET /api/workspace/known
useGlobalConfig()     → GET /api/global-config

// Mutations
useSwitchWorkspace()  → POST /api/workspace/switch
useAddKnownWorkspace()    → POST /api/workspace/known
useRemoveKnownWorkspace() → DELETE /api/workspace/known
useUpdateGlobalConfig()   → PUT /api/global-config/defaults
```

## UI Component Pattern

No headless UI or modal library. Existing patterns:

- Collapsible inline forms (worktrees in ProjectDetailPage)
- Expandable rows (ProcessesPage)
- Dropdown selects (native `<select>` in BuildPage, ProcessesPage)

**Recommended**: Custom dropdown using a `<button>` trigger + absolutely-positioned panel with `useState` toggle. Click-outside-to-close via `useEffect` + document listener. Consistent with the "no dependencies" approach.

## Design System Tokens

All colors use CSS custom properties with oklch. Key tokens for dropdown:

- Background: `--color-surface` / `--color-surface-2`
- Border: `--color-border`
- Hover: `--color-surface-2`
- Active/selected: `--color-primary` with 15% opacity
- Text: `--color-text` / `--color-text-muted`
