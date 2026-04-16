# Workspace Initialization on New Server Connection

**Status:** COMPLETED  
**Created:** 2026-04-16  
**Completed:** 2026-04-16  
**Priority:** High

## Problem Statement

When adding a new server host or workspace, the app:
1. Gets stuck at Loading screen
2. Does not scan directories for projects
3. Does not prompt user to set up workspace

## Solution Overview

Add a workspace setup wizard that triggers when:
1. Connecting to a new server without workspace configured
2. Adding a new workspace to an existing server
3. The current workspace is not ready (`workspace-status.ready === false`)

## Phases

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Backend: Project Discovery API | ✅ COMPLETED | [phase-01-discovery-api.md](phase-01-discovery-api.md) |
| 2 | Frontend: Workspace Setup Wizard | ✅ COMPLETED | [phase-02-setup-wizard.md](phase-02-setup-wizard.md) |
| 3 | Integration & Testing | ✅ COMPLETED | [phase-03-integration.md](phase-03-integration.md) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        App.tsx                                   │
├─────────────────────────────────────────────────────────────────┤
│  AuthGuard                                                       │
│  ├─ Check auth status → if not authenticated → ServerSettings   │
│  └─ if authenticated                                             │
│       ├─ WorkspaceGuard (NEW)                                   │
│       │   ├─ Check workspace:status                              │
│       │   ├─ if ready=false → WorkspaceSetupWizard (NEW)        │
│       │   └─ if ready=true → render children (Routes)           │
│       └─ Routes (Dashboard, Workspace, Git, etc.)               │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

1. **Backend API Endpoints:**
   - `GET /api/workspace/discover?path=...` - Scan directory for projects
   - `POST /api/workspace/init` - Initialize workspace with config

2. **Frontend Components:**
   - `WorkspaceGuard` - Wrapper that checks workspace readiness
   - `WorkspaceSetupWizard` - Multi-step setup wizard
   - `DirectoryBrowser` - Remote directory browser
   - `ProjectSelector` - Project selection with checkboxes

## Success Criteria

- [ ] No stuck loading screen when adding new server
- [ ] Workspace setup wizard appears when workspace not ready
- [ ] User can browse remote directories
- [ ] Projects are automatically discovered
- [ ] User can select/deselect projects
- [ ] Workspace initializes successfully
- [ ] App navigates to dashboard after setup
