---
name: Server Routes & Web Dashboard Research
description: Analysis of server route patterns, web API client, and settings page for config editor integration
type: research
---

## Current State

### Server (app.ts)

- Routes created as separate Hono apps, mounted via `.route()` under `/api`
- `AppType` exported for type-safe client (line 49-50)
- No config CRUD routes exist; `writeConfig()` in core is unused by server

### Build Routes (build.ts)

- Pattern: receive `ServerContext`, lookup project by name, call core service, return JSON
- Per-context tracking maps (inProgressBuilds) prevent duplicate operations

### Web API Client (client.ts)

- Plain fetch with `get()`/`post()`/`del()` helpers (no Hono RPC despite AppType export)
- Namespace organization: `api.workspace`, `api.projects`, `api.git`, `api.build`, `api.processes`
- TypeScript interfaces define request/response shapes

### Query Hooks (queries.ts)

- `useQuery()` for reads with cache keys; `useMutation()` for writes with invalidation
- Existing patterns: `useWorkspace()`, `useProjects()`, mutations invalidate related keys

### Settings Page (SettingsPage.tsx)

- Read-only display: workspace name, root, project count
- Shows "edit dev-hub.toml manually" text — no interactive editor

## Required Changes

| Component     | Change                                                   |
| ------------- | -------------------------------------------------------- |
| Server routes | New `routes/config.ts` with GET/PUT /config endpoints    |
| App mounting  | Import and mount config routes                           |
| Web client    | Add `api.config` namespace with getConfig/updateConfig   |
| Query hooks   | Add `useConfig()` query and `useUpdateConfig()` mutation |
| SettingsPage  | Replace static text with form-based config editor        |
| Types         | Extend interfaces for ServiceConfig, custom commands     |
