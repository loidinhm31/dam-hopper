# Phase 03: Welcome Page Integration Testing — Manual Test Scenarios

**Status:** Complete | **Date:** 2026-03-23 | **Plan:** welcome-init-page/phase-03

## Summary

Manual test scenarios validating the welcome-page first-launch flow. No E2E framework
exists; these scenarios document expected behavior for manual verification and future
automation (Playwright Electron).

Core unit tests: **126/126 passing** (no regressions from phases 01–02).

---

## Prerequisites

- Built app: `pnpm build` or running `pnpm dev`
- electron-store path (Linux): `~/.config/dev-hub/` (userData from `app.getPath('userData')`)
- To clear electron-store: delete `~/.config/dev-hub/` or run `rm ~/.config/dev-hub/config.json`
- Global config: `~/.config/dev-hub/config.toml`

---

## Test Matrix

| # | Scenario | Expected |
|---|----------|----------|
| T1 | Fresh install — no electron-store | Welcome page shown |
| T2 | Fresh install — pick valid folder via dialog | Dashboard loads |
| T3 | Fresh install — click recent workspace | Dashboard loads |
| T4 | Fresh install — cancel folder picker | Stays on welcome page |
| T5 | Persisted path invalid/deleted | Welcome page shown |
| T6 | Select folder without dev-hub.toml | Auto-discovers projects, creates config, dashboard loads |
| T7 | Select invalid/empty folder | Error message shown on welcome page |
| T8 | Existing user with valid persisted workspace | Welcome page never shown — direct to dashboard |
| T9 | Workspace switch from sidebar after initial load | Workspace changes, dashboard updates |

---

## Detailed Scenarios

### T1 — Fresh install (no electron-store)

**Setup:**
```bash
rm -f ~/.config/dev-hub/config.json
```

**Steps:**
1. Launch app
2. Observe initial render

**Expected:**
- App shows welcome page (`WelcomePage` component)
- "Open Workspace…" button visible
- "Recent" section shows "No recent workspaces" (or populated list from global config)
- No dashboard flash before welcome page

---

### T2 — Pick valid workspace via dialog

**Setup:** T1 setup (fresh install)

**Steps:**
1. On welcome page, click "Open Workspace…"
2. OS folder picker opens
3. Select a folder containing `dev-hub.toml`
4. Confirm selection

**Expected:**
- Loading spinner overlay shown during init
- `workspace:init` IPC called with selected path
- `workspace:changed` event fires → `workspace-status` query invalidated
- App transitions to dashboard (no manual refresh)
- `lastWorkspacePath` persisted in electron-store
- Workspace added to known list

---

### T3 — Click recent workspace

**Setup:**
- Global config has ≥1 known workspace: `~/.config/dev-hub/config.toml`
- Electron-store cleared (fresh launch)

**Steps:**
1. Welcome page shows recent workspace(s)
2. Click a workspace entry

**Expected:**
- Loading spinner shown
- `workspace:init` called with that workspace path
- Dashboard loads with correct workspace name

---

### T4 — Cancel folder picker

**Setup:** T1 setup

**Steps:**
1. Click "Open Workspace…"
2. In OS dialog, click Cancel

**Expected:**
- `workspace.openDialog()` returns `null`
- No error shown
- Welcome page remains, no spinner

---

### T5 — Persisted path invalid or deleted

**Setup:**
```bash
# Set a non-existent path in electron-store manually
# or delete the workspace directory that was previously used
```

**Steps:**
1. Launch app with stale `lastWorkspacePath` pointing to deleted/moved folder

**Expected:**
- `findConfigFile(storedPath)` returns null
- `store.delete("lastWorkspacePath")` called — clears stale entry
- Welcome page shown (not a crash, not dashboard)

---

### T6 — Folder without dev-hub.toml (auto-init)

**Setup:** T1 setup

**Steps:**
1. Click "Open Workspace…"
2. Select a folder that has no `dev-hub.toml` but contains sub-projects

**Expected:**
- `workspace:init` triggers `initContext` → `findConfigFile` returns null
- `ConfigNotFoundError` thrown → surfaced as error message on welcome page
- **Note:** Auto-discovery happens only via `workspace:addKnown` (sidebar), not `workspace:init`
- Error message displayed: e.g. "No dev-hub.toml found in …"

> **Clarification:** `workspace:init` (`initContext`) throws `ConfigNotFoundError` for folders
> without a config. Auto-discovery (via `discoverProjects` + `writeConfig`) is in
> `workspace:addKnown` handler. To test auto-init, use the sidebar "Add Workspace" flow.

---

### T7 — Invalid or empty folder selection

**Setup:** T1 setup

**Steps:**
1. Click "Open Workspace…"
2. Select an empty folder or a folder with no recognizable structure

**Expected:**
- Error caught in `WelcomePage.openDialog()` catch block
- Error message rendered in red error box below the form
- Welcome page remains usable (no crash, error is dismissible by re-trying)

---

### T8 — Existing user with valid persisted workspace

**Setup:**
- electron-store has valid `lastWorkspacePath`
- Folder and `dev-hub.toml` exist

**Steps:**
1. Launch app normally

**Expected:**
- `loadWorkspace(autoPath)` called during `app.whenReady()`
- `workspace:changed` event fires before renderer queries `workspace:status`
- `useWorkspaceStatus()` returns `{ ready: true }`
- `App` renders `<AppRoutes />` directly — welcome page **never** shown
- No flicker or loading state on welcome page

---

### T9 — Workspace switch from sidebar

**Setup:** Working workspace loaded (T2 or T8 baseline)

**Steps:**
1. Open sidebar workspace switcher dropdown
2. Select a different known workspace (or add one)

**Expected:**
- All PTY sessions stopped
- `switchWorkspace()` loads new config
- `workspace:changed` event fires
- `workspace-status` query invalidated → `{ ready: true }` (stays on dashboard)
- Sidebar shows new workspace name
- Dashboard reflects new workspace's projects

---

## Implementation Notes

### IPC Flow (for reference)

```
First launch:
  app.whenReady() → createWindow() → registerPreWorkspaceHandlers()
    → autoPath? → loadWorkspace() → initContext()
    → registerIpcHandlers() → webContents.send("workspace:changed")

Renderer:
  App mounts → useWorkspaceStatus() → workspace:status IPC
    → { ready: false } → render WelcomePage
    workspace:changed event → invalidate query → refetch
    → { ready: true } → render AppRoutes

WelcomePage user action:
  openDialog() → workspace:open-dialog → returns path
  → workspace:init IPC → loadWorkspace() → initContext()
  → webContents.send("workspace:changed")
  → onReady() → invalidate workspace-status → AppRoutes
```

### Key Guard Rails

- `fullIpcRegistered` flag: prevents double-registration of IPC handlers
- `initInProgress` flag: prevents concurrent `initContext` calls
- `store.delete("lastWorkspacePath")` on invalid path: clears stale state
- `switchWorkspace` vs `loadWorkspace`: switch reuses existing handlers; first load registers them

---

## Risk Notes

- **No automated E2E**: Regressions possible between manual test runs.
  Next step: add Playwright Electron tests (`playwright-electron` or `@electron/playwright`).
- **Platform differences**: electron-store path differs on macOS (`~/Library/Application Support/dev-hub/`)
  and Windows (`%APPDATA%\dev-hub\`). Test on each target platform before release.
- **Race condition**: if `workspace:changed` fires before renderer subscribes (very fast auto-resolve),
  the query invalidation in `App.useEffect` won't fire. Mitigation: `useWorkspaceStatus` will
  still see `{ ready: true }` on its initial query since context is already set.
