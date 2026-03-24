# Phase 02: Web API & Settings UI

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: [Phase 01](./phase-01-ipc-electron-backend.md) (IPC channels + preload must exist)
- Docs: [Codebase Analysis](./reports/01-codebase-analysis.md)

## Overview
- **Date**: 2026-03-24
- **Description**: Add web API client methods, TanStack Query mutations, and Settings page UI sections for maintenance actions and settings import/export.
- **Priority**: P2
- **Implementation status**: done (2026-03-25)
- **Review status**: approved

## Key Insights
- Settings page already exists at `/settings` with ConfigEditor + GlobalConfigEditor
- TanStack Query's `queryClient.clear()` removes all cached data (not just invalidate — actually drops entries)
- Nuclear reset sends `workspace:changed(null)` → `useWorkspaceStatus` refetches → `ready: false` → App.tsx shows WelcomePage automatically
- For revalidate, renderer needs to call `queryClient.clear()` after the IPC succeeds — IPC clears electron-store, renderer clears its own query cache

## Requirements
1. API client methods for 4 settings operations
2. 4 TanStack Query mutations with appropriate cache side-effects
3. "Maintenance" section in Settings page: Revalidate + Nuclear Reset buttons
4. "Import/Export" section in Settings page: Export + Import buttons
5. Confirmation dialog before nuclear reset

## Architecture
```
packages/web/src/
├── api/
│   ├── client.ts         # Add settings.* methods
│   └── queries.ts        # Add 4 mutation hooks
├── pages/
│   └── SettingsPage.tsx   # Add 2 new sections
└── types/
    └── electron.ts       # Extend window.devhub type (if exists)
```

## Related Code Files
- `packages/web/src/api/client.ts` — API client object
- `packages/web/src/api/queries.ts` — all query/mutation hooks
- `packages/web/src/pages/SettingsPage.tsx` — existing settings page
- `packages/web/src/hooks/useSSE.ts` — IPC event subscriptions (already handles workspace:changed → nuclear invalidation)

## Implementation Steps

### Step 1: Add API client methods
**File**: `packages/web/src/api/client.ts`
```ts
// Add to `api` object:
settings: {
  clearCache: () => window.devhub.settings.clearCache(),
  reset: () => window.devhub.settings.reset(),
  exportConfig: () => window.devhub.settings.exportConfig(),
  importConfig: () => window.devhub.settings.importConfig(),
},
```

### Step 2: Add mutation hooks
**File**: `packages/web/src/api/queries.ts`

```ts
export function useClearCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.clearCache(),
    onSuccess: () => {
      qc.clear(); // Drop all cached query data — forces fresh fetches
    },
  });
}

export function useResetWorkspace() {
  // No onSuccess needed — workspace:changed event (from IPC) triggers
  // nuclear invalidation in useIpc hook, and App.tsx re-evaluates
  // workspace status → shows WelcomePage
  return useMutation({
    mutationFn: () => api.settings.reset(),
  });
}

export function useExportSettings() {
  return useMutation({
    mutationFn: () => api.settings.exportConfig(),
  });
}

export function useImportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.importConfig(),
    onSuccess: (result) => {
      if (result?.imported) {
        void qc.invalidateQueries({ queryKey: ["config"] });
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["workspace"] });
      }
    },
  });
}
```

### Step 3: Update Settings page UI
**File**: `packages/web/src/pages/SettingsPage.tsx`

Add two new sections below existing content:

**Maintenance section:**
- "Revalidate" button — calls `useClearCache`, shows success toast/feedback
- "Nuclear Reset" button (red/danger styled) — shows confirm dialog, then calls `useResetWorkspace`
- Brief description text for each action

**Import/Export section:**
- "Export Settings" button — calls `useExportSettings`, shows result feedback
- "Import Settings" button — calls `useImportSettings`, shows result/error feedback
- Brief description text explaining what gets exported/imported

UI pattern: use existing glass-card / section styling consistent with current page. Buttons styled with existing Tailwind patterns (primary for safe actions, danger variant for nuclear reset).

**Confirmation dialog for Nuclear Reset:**
- Simple modal or `window.confirm()` — keep it minimal
- Message: "This will kill all terminal sessions, clear all cached data, and return to the workspace selection screen. Continue?"
- If user cancels, do nothing

### Step 4: Update window.devhub TypeScript type
Check if `packages/web/src/types/electron.ts` (or similar) defines the `window.devhub` interface. If so, add `settings` namespace type. If types are implicit, skip this step.

## Todo
- [ ] Add `settings` namespace to API client
- [ ] Create 4 mutation hooks
- [ ] Add Maintenance section to SettingsPage
- [ ] Add Import/Export section to SettingsPage
- [ ] Add nuclear reset confirmation dialog
- [ ] Update window.devhub TypeScript type if needed
- [ ] Verify workspace:changed(null) correctly triggers WelcomePage flow

## Success Criteria
- Revalidate button clears all caches → all queries refetch with fresh data
- Nuclear Reset (after confirmation) kills terminals, clears everything, shows WelcomePage
- Export opens native save dialog → saves TOML file to chosen location
- Import opens native open dialog → validates → updates config → UI refreshes
- Import with invalid TOML shows error message
- All actions show appropriate loading/success/error states

## Risk Assessment
- **Low**: Nuclear reset race condition — renderer might briefly try to fetch data after context is nulled. Mitigated by: `workspace:status` returns `{ ready: false }` when no context, and workspace:changed event triggers full invalidation + WelcomePage redirect.
- **Low**: Import might change workspace name — existing code handles this (config reload updates `ctx.config`).

## Security Considerations
- No user-controlled paths sent from renderer — all file paths resolved via Electron native dialogs in main process
- Import validation happens server-side (main process) before writing

## Next Steps
→ Testing: Manual verification of all 4 actions + edge cases (import bad file, export with no workspace, reset during active terminals)
