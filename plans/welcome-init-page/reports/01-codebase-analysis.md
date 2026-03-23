# Codebase Analysis: Welcome/Init Page

## Current First-Launch Flow

### Electron Main Process (`packages/electron/src/main/index.ts`)

1. `app.whenReady()` -> `resolveWorkspace()` -> `initContext()` -> `createWindow()`
2. `resolveWorkspace()` checks `electron-store.lastWorkspacePath` first
3. If missing: shows native `dialog.showOpenDialog()` **before** window exists
4. If canceled: `app.quit()` -- no UI ever appears
5. `initContext()` finds config, reads it, persists path, registers known workspace
6. Window only created after successful context init

### Problem
- No BrowserWindow exists when folder picker fires
- User sees an OS dialog with no app branding or context
- Cancel = immediate quit, no retry or alternative options
- No way to see recent workspaces or get guidance

### Workspace IPC Already Available
- `CH.WORKSPACE_KNOWN` -> `listKnownWorkspaces()` from global config
- `CH.WORKSPACE_OPEN_DIALOG` -> OS folder picker, returns path or null
- `CH.WORKSPACE_SWITCH` -> full workspace load + persist + event broadcast
- `CH.WORKSPACE_ADD_KNOWN` -> auto-discover projects, create config if missing

### Renderer Architecture
- React 19 + React Router 7 (BrowserRouter, `<Routes>`)
- TanStack Query for data fetching via IPC
- AppLayout template wraps all pages (sidebar + main content)
- `window.devhub` bridge: typed via `DevHubBridge` in `electron.d.ts`

### UI Patterns
- Tailwind v4 with `@theme` CSS custom properties in `index.css`
- Color tokens: `--color-background`, `--color-surface`, `--color-primary`, etc.
- Component hierarchy: atoms -> molecules -> organisms -> templates
- `cn()` utility from `clsx` + `tailwind-merge`
- Lucide React for icons

### What Needs to Change

**Electron main (`index.ts`)**:
- Decouple window creation from workspace resolution
- Create window first, then resolve workspace
- Add new IPC channel to query "has workspace" status
- Support "no-workspace" state where renderer shows welcome page

**Preload (`preload/index.ts`)**:
- Add IPC for checking workspace readiness status
- Add `workspace.init(path)` for first-time setup from renderer

**Web App (`App.tsx`)**:
- Add conditional routing: if no workspace loaded, show WelcomePage
- New root-level conditional render

**New Components**:
- `WelcomePage.tsx` -- full-screen welcome (no sidebar)
- Reuse existing `useKnownWorkspaces` query for recent list
- Reuse `workspace.openDialog()` for folder picker trigger

### Existing Code to Reuse
- `WorkspaceSwitcher.tsx` -- workspace list rendering, switch/add logic
- `Button.tsx` -- styled button component with variants
- `useKnownWorkspaces`, `useSwitchWorkspace`, `useAddKnownWorkspace` queries
