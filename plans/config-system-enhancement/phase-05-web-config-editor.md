---
parent: plan.md
phase: 05
status: done
priority: P1
effort: 2.5h
depends_on: [phase-04]
---

# Phase 05: Web Config Editor — Form-Based UI

## Context

- Parent: [plan.md](./plan.md)
- Dependencies: Phase 04 (server config API)

## Overview

Build a form-based config editor in the web dashboard. Replace the static SettingsPage with an interactive editor for workspace settings, projects, services, and custom commands.

## Key Insights

- SettingsPage.tsx currently shows read-only info with "edit manually" text
- Web uses TanStack Query for state, plain fetch client (no Hono RPC)
- Form validation should mirror Zod schemas on the server
- Need add/edit/remove for projects, services within projects, and custom commands

## Related Code Files

- `packages/web/src/pages/SettingsPage.tsx` — replace with editor
- `packages/web/src/api/client.ts` — add config API methods
- `packages/web/src/api/queries.ts` — add config query/mutation hooks
- `packages/web/src/components/` — new form components

## Implementation Steps

1. **Update API client (client.ts)**
   - Add types: `ServiceConfig`, updated `ProjectConfig` with services/commands
   - Add `api.config` namespace:
     - `getConfig()` → GET /api/config
     - `updateConfig(config)` → PUT /api/config
     - `updateProject(name, data)` → PATCH /api/config/projects/:name

2. **Add query hooks (queries.ts)**
   - `useConfig()` — query hook for GET /api/config, key: ["config"]
   - `useUpdateConfig()` — mutation, invalidates ["config", "projects", "workspace"]
   - `useUpdateProject()` — mutation for single project update

3. **Build ConfigEditor components**
   - `components/organisms/ConfigEditor.tsx` — main editor container
   - **Workspace section**: name input
   - **Projects list**: expandable cards for each project
   - **Project form**: name, path, type (dropdown), env_file, tags
   - **Services sub-form**: add/remove services with name, build_command, run_command
   - **Commands sub-form**: add/remove key-value pairs for custom commands
   - **Save/Cancel buttons**: validate client-side, submit via mutation
   - **Success/error feedback**: toast or inline messages

4. **Update SettingsPage.tsx**
   - Replace static content with ConfigEditor component
   - Wire up useConfig() and useUpdateConfig()

5. **Listen for config:changed SSE events**
   - Invalidate config query on config:changed event
   - Update useSSE hook to handle new event type

6. **Styling**
   - Follow existing dark theme CSS variables
   - Consistent with existing form patterns in the app

## Todo

- [x] Add config types and API methods to client.ts
- [x] Add useConfig and useUpdateConfig hooks to queries.ts
- [x] Build ConfigEditor organism component
- [x] Build ProjectForm sub-component
- [x] Build ServiceForm sub-component
- [x] Build CommandsForm sub-component
- [x] Update SettingsPage.tsx
- [x] Handle config:changed SSE event
- [x] Style editor with dark theme

## Success Criteria

- Can view full workspace config in web UI
- Can edit workspace name
- Can add/edit/remove projects with all fields
- Can add/edit/remove services within a project
- Can add/edit/remove custom commands
- Save validates and writes to dev-hub.toml
- UI updates in real-time after save
- Validation errors shown inline

## Risk Assessment

- **Form complexity**: Many nested fields — keep UX simple with expandable sections
- **Concurrent edits**: If someone edits TOML directly while web editor is open — SSE event will trigger refresh
