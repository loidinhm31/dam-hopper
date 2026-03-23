# Phase 02: Welcome Page UI

## Context Links
- [Plan](./plan.md)
- [Phase 01](./phase-01-electron-main-changes.md)
- App entry: `packages/web/src/App.tsx`
- Existing patterns: `packages/web/src/components/organisms/WorkspaceSwitcher.tsx`

## Overview

- **Date**: 2026-03-23
- **Completed**: 2026-03-23
- **Description**: Build in-app WelcomePage replacing OS folder picker as first-launch experience. Conditional routing at App level.
- **Priority**: P2
- **Implementation status**: done
- **Review status**: done

## Key Insights

- `App.tsx` uses `BrowserRouter` + `Routes` -- can wrap with workspace-readiness check
- `WorkspaceSwitcher.tsx` already renders known workspaces list -- reuse pattern
- `useKnownWorkspaces()` query works pre-workspace (reads global config only)
- `window.devhub.workspace.openDialog()` already exists
- Tailwind v4 theme tokens provide consistent dark theme styling
- No sidebar needed on welcome page -- full-screen standalone

## Requirements

1. Full-screen welcome page (no sidebar, no AppLayout wrapper)
2. App branding/title at top ("Dev Hub")
3. "Open Workspace" button -- triggers `openDialog()` then `init(path)`
4. "Recent Workspaces" section -- lists known workspaces, click to init
5. Empty state for recent workspaces ("No recent workspaces")
6. Loading state while workspace initializes
7. Error handling with inline error display
8. Smooth transition to dashboard after workspace loads

## Architecture

```
App.tsx
├── useWorkspaceStatus() -- queries workspace:status
├── if !ready -> <WelcomePage onReady={invalidate} />
└── if ready -> <BrowserRouter><Routes>...</Routes></BrowserRouter>
```

**State machine in App.tsx**:
- `loading` -> checking workspace status
- `welcome` -> no workspace, show WelcomePage
- `ready` -> workspace loaded, show normal routes

**WelcomePage listens for `workspace:ready` event** via `window.devhub.on()` to handle
auto-resolve completing after initial render.

## Related Code Files

- `packages/web/src/App.tsx` -- add workspace gate
- `packages/web/src/main.tsx` -- QueryClientProvider wraps everything (no change needed)
- `packages/web/src/pages/` -- new WelcomePage.tsx
- `packages/web/src/api/queries.ts` -- new useWorkspaceStatus hook
- `packages/web/src/api/client.ts` -- add workspace.status/init to api object
- `packages/web/src/components/atoms/Button.tsx` -- reuse

## Implementation Steps

### Step 1: Add API client methods
File: `packages/web/src/api/client.ts`
- Add `status: () => window.devhub.workspace.status()` to api.workspace
- Add `init: (path: string) => window.devhub.workspace.init(path)` to api.workspace

### Step 2: Add TanStack Query hooks
File: `packages/web/src/api/queries.ts`
- `useWorkspaceStatus()` -- queryKey `["workspace-status"]`, queryFn `api.workspace.status()`
- `useInitWorkspace()` -- mutation, mutationFn `api.workspace.init(path)`

### Step 3: Create WelcomePage component
File: `packages/web/src/pages/WelcomePage.tsx`

Layout:
- Full viewport height, centered content, dark background
- Max-width container (~480px) centered horizontally and vertically

Sections:
1. **Header**: App icon area + "Dev Hub" title + subtitle
2. **Open Workspace Button**: Large primary button, triggers openDialog -> init
3. **Recent Workspaces**: Card listing known workspaces (name + path), click to init
4. **Error display**: Inline error below actions if init fails
5. **Loading overlay**: Spinner overlay during initialization

### Step 4: Add workspace gate to App.tsx
File: `packages/web/src/App.tsx`
- Import `useWorkspaceStatus` and `WelcomePage`
- Top-level: query workspace status
- If loading: minimal loading spinner
- If `ready === false`: render `<WelcomePage />`
- If `ready === true`: render existing `<BrowserRouter>` tree

### Step 5: Handle workspace:ready event
- In App.tsx, `useEffect` + `window.devhub.on("workspace:changed", ...)` to invalidate status query
- Handles: (a) auto-resolve after render, (b) user selection from welcome page

### Step 6: Polish
- Fade-in animation on welcome page load
- Hover effects on recent workspace items
- Keyboard support: Enter on workspace item triggers init

## Todo List

- [ ] Add `status()` and `init()` to api client
- [ ] Add `useWorkspaceStatus()` query hook
- [ ] Add `useInitWorkspace()` mutation hook
- [ ] Create `WelcomePage.tsx` with header, open button, recent list
- [ ] Add workspace readiness gate in `App.tsx`
- [ ] Wire `workspace:changed` event to invalidate status query
- [ ] Style with existing Tailwind v4 theme tokens
- [ ] Handle error states (init failure, no config found)
- [ ] Handle loading state during initialization
- [ ] Test empty state (no known workspaces)

## Success Criteria

- First launch shows welcome page instead of OS dialog
- "Open Workspace" opens folder picker and loads selected workspace
- Recent workspaces appear and are clickable
- After workspace loads, app transitions to dashboard seamlessly
- Error messages display inline on failure

## Risk Assessment

- **Flash of welcome page**: If auto-resolve is fast, user might see welcome flash. Mitigate with loading state until status is determined.
- **BrowserRouter mount/unmount**: Switching from WelcomePage to BrowserRouter may reset Router state. Acceptable since it's a one-time transition.

## Security Considerations

- Paths from known workspaces are from global config (user-controlled, trusted)
- `openDialog()` returns OS-validated paths
- `init(path)` validated in main process (Phase 01)

## Next Steps

Phase 03: Integration testing of the full first-launch flow.
