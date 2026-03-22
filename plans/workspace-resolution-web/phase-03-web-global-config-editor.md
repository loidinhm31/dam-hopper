---
parent: plan.md
phase: "03"
status: done
priority: P2
effort: 1.5h
depends_on: phase-02
---

# Phase 03: Web UI Global Config Editor

## Context

- Parent: [plan.md](./plan.md)
- Depends on: Phase 02 (workspace switcher UI patterns established)
- Related: Settings page already has ConfigEditor for workspace `dev-hub.toml`

## Overview

Add a "Global Settings" section to the Settings page for managing the XDG global
config: set default workspace, view/manage known workspaces list. This makes the
web dashboard fully self-service — users never need CLI for workspace management.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- Settings page currently renders only `ConfigEditor` for workspace config
- Global config is a separate file (`~/.config/dev-hub/config.toml`) from workspace config (`dev-hub.toml`)
- The global config editor is simpler than workspace ConfigEditor — just a default path + workspace list
- Known workspaces CRUD already available from Phase 02 hooks — reuse them
- Can use existing form patterns (input + button) from ConfigEditor

## Requirements

### 1. API Client + Hooks

Already partially done in Phase 02. Add if not yet present:

```typescript
// client.ts
globalConfig: {
  get: () => get<GlobalConfig>("/global-config"),
  updateDefaults: (defaults: { workspace?: string }) =>
    put<{ updated: true }>("/global-config/defaults", defaults),
},

// queries.ts
export function useGlobalConfig() {
  return useQuery({
    queryKey: ["global-config"],
    queryFn: () => api.globalConfig.get(),
  });
}

export function useUpdateGlobalDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defaults: { workspace?: string }) =>
      api.globalConfig.updateDefaults(defaults),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["global-config"] });
    },
  });
}
```

### 2. GlobalConfigEditor Component

New file: `packages/web/src/components/organisms/GlobalConfigEditor.tsx`

**Sections:**

#### A. Default Workspace
- Text input with current default workspace path (or empty placeholder)
- "Set Default" / "Clear" buttons
- Help text: "Bare `dev-hub` invocations will use this workspace when no config is found in CWD"

#### B. Known Workspaces
- Table/list of registered workspaces (name + path columns)
- Current workspace highlighted
- Remove button per row (disabled for current workspace)
- "Add Workspace" row at bottom: path input + Add button
- Reuses `useKnownWorkspaces()`, `useAddKnownWorkspace()`, `useRemoveKnownWorkspace()` from Phase 02

**Styling:** Match ConfigEditor patterns — same card/section structure, same button variants,
same input styling. Use `--color-surface-2` background for section cards.

### 3. Settings Page Integration

In `packages/web/src/pages/SettingsPage.tsx`:

Add `GlobalConfigEditor` above or below the existing `ConfigEditor`, with a clear
section heading ("Global Settings" vs "Workspace Config").

```tsx
<AppLayout title="Settings">
  <section className="mb-8">
    <h2 className="text-lg font-semibold mb-4">Global Settings</h2>
    <GlobalConfigEditor />
  </section>
  <section>
    <h2 className="text-lg font-semibold mb-4">Workspace Config</h2>
    {/* existing ConfigEditor */}
  </section>
</AppLayout>
```

## Architecture

```
SettingsPage
├── GlobalConfigEditor
│   ├── useGlobalConfig()           → GET /api/global-config
│   ├── useUpdateGlobalDefaults()   → PUT /api/global-config/defaults
│   ├── useKnownWorkspaces()        → GET /api/workspace/known (Phase 02)
│   ├── useAddKnownWorkspace()      → POST /api/workspace/known (Phase 02)
│   └── useRemoveKnownWorkspace()   → DELETE /api/workspace/known (Phase 02)
│
└── ConfigEditor (existing)
    └── useConfig() → workspace dev-hub.toml
```

## Related Code Files

- `packages/web/src/api/client.ts` — globalConfig endpoints
- `packages/web/src/api/queries.ts` — globalConfig hooks
- `packages/web/src/components/organisms/GlobalConfigEditor.tsx` (new)
- `packages/web/src/pages/SettingsPage.tsx` — integrate GlobalConfigEditor

## Implementation Steps

1. Add globalConfig endpoints to `client.ts` (if not done in Phase 02)
2. Add `useGlobalConfig()` and `useUpdateGlobalDefaults()` hooks
3. Create `GlobalConfigEditor.tsx`:
   - Default workspace section with input + set/clear
   - Known workspaces table with add/remove
   - Loading/error/saved states
4. Integrate into `SettingsPage.tsx` with section headings
5. Manual testing: set default, add/remove workspaces, verify persistence

## Todo

- [x] Add globalConfig API client endpoints
- [x] Add globalConfig React Query hooks
- [x] Create GlobalConfigEditor component
- [x] Integrate into SettingsPage
- [x] Manual testing

## Success Criteria

- Settings page shows two distinct sections: Global Settings + Workspace Config
- Setting a default workspace persists to `~/.config/dev-hub/config.toml`
- Known workspaces list matches what workspace switcher shows (same data source)
- Adding/removing workspaces updates both the editor and the sidebar switcher
- Clearing default workspace removes the `defaults.workspace` key

## Risk Assessment

- **Low** — read/write to global config uses existing atomic write pattern
- **Low** — UI addition only; no changes to data flow or server architecture

## Security Considerations

- Default workspace path input is sent to server for validation
- Path must resolve to an existing directory (server validates)
- Global config file permissions (0o600) maintained by existing `writeGlobalConfig()`

## Next Steps

→ Plan complete. All three phases = full workspace resolution in web UI.
