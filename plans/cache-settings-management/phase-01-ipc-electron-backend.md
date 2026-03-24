# Phase 01: IPC & Electron Backend

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: None (first phase)
- Docs: [Codebase Analysis](./reports/01-codebase-analysis.md)

## Overview
- **Date**: 2026-03-24
- **Description**: Add IPC channels and Electron main process handlers for cache clearing, nuclear reset, settings export, and settings import.
- **Priority**: P2
- **Implementation status**: done (2026-03-25)
- **Review status**: approved

## Key Insights
- `electron-store` instance is module-scoped in `index.ts` — need to pass it to settings handler registration
- `CtxHolder.switchWorkspace` already handles PTY dispose + context swap — nuclear reset is similar but goes to "no workspace" state
- `readConfig()` validates with Zod — reuse for import validation
- `writeConfig()` does atomic write (tmp + rename) — reuse for import write

## Requirements
1. Add 4 IPC channels: `cache:clear`, `workspace:reset`, `settings:export`, `settings:import`
2. `cache:clear`: Clear electron-store → return `{ cleared: true }`
3. `workspace:reset`: Kill all PTY sessions, clear electron-store, null out context, notify renderer
4. `settings:export`: Show save dialog, copy raw TOML to destination
5. `settings:import`: Show open dialog, validate TOML, write to config path, reload config, notify renderer

## Architecture
```
packages/electron/src/
├── ipc-channels.ts          # Add CH.CACHE_CLEAR, CH.WORKSPACE_RESET, CH.SETTINGS_EXPORT, CH.SETTINGS_IMPORT
├── main/
│   ├── index.ts             # Pass `store` to registerSettingsHandlers
│   ├── ipc/
│   │   ├── index.ts         # Import + call registerSettingsHandlers
│   │   └── settings.ts      # NEW — all 4 handlers
│   └── ...
└── preload/index.ts         # Add settings.* namespace
```

## Related Code Files
- `packages/electron/src/ipc-channels.ts` — channel constants
- `packages/electron/src/main/index.ts` — `store` instance, `CtxHolder`, `initContext`
- `packages/electron/src/main/ipc/index.ts` — handler registration
- `packages/electron/src/preload/index.ts` — contextBridge

## Implementation Steps

### Step 1: Add IPC channels
**File**: `packages/electron/src/ipc-channels.ts`
- Add to `CH` object:
  ```ts
  CACHE_CLEAR: "cache:clear",
  WORKSPACE_RESET: "workspace:reset",
  SETTINGS_EXPORT: "settings:export",
  SETTINGS_IMPORT: "settings:import",
  ```

### Step 2: Create settings IPC handlers
**File**: `packages/electron/src/main/ipc/settings.ts` (NEW)

```ts
import { ipcMain, dialog } from "electron";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import Store from "electron-store";
import { readConfig, writeConfig, validateConfig } from "@dev-hub/core";
import { parse } from "smol-toml";
import { CH, EV } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

export function registerSettingsHandlers(
  holder: CtxHolder,
  store: Store<{ lastWorkspacePath?: string }>,
): void {

  // --- Cache Clear ---
  ipcMain.handle(CH.CACHE_CLEAR, async () => {
    store.clear();
    return { cleared: true };
  });

  // --- Nuclear Reset ---
  ipcMain.handle(CH.WORKSPACE_RESET, async () => {
    // 1. Kill all PTY sessions
    holder.ptyManager.dispose();
    // 2. Clear persisted state
    store.clear();
    // 3. Detach event emitters from old git service
    holder.current?.bulkGitService.emitter.removeAllListeners();
    // 4. Null out context
    holder.current = null;
    // 5. Notify renderer — App.tsx will see ready=false → WelcomePage
    holder.sendEvent(EV.WORKSPACE_CHANGED, null);
    return { reset: true };
  });

  // --- Export Settings ---
  ipcMain.handle(CH.SETTINGS_EXPORT, async () => {
    const ctx = holder.current;
    if (!ctx) throw new Error("No workspace loaded");
    const result = await dialog.showSaveDialog({
      title: "Export workspace settings",
      defaultPath: "dev-hub.toml",
      filters: [{ name: "TOML", extensions: ["toml"] }],
    });
    if (result.canceled || !result.filePath) return { exported: false };
    // Read raw TOML to preserve comments/formatting
    const raw = await readFile(ctx.configPath, "utf-8");
    await writeFile(result.filePath, raw, "utf-8");
    return { exported: true, path: result.filePath };
  });

  // --- Import Settings ---
  ipcMain.handle(CH.SETTINGS_IMPORT, async () => {
    const ctx = holder.current;
    if (!ctx) throw new Error("No workspace loaded");
    const result = await dialog.showOpenDialog({
      title: "Import workspace settings",
      filters: [{ name: "TOML", extensions: ["toml"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0)
      return { imported: false };
    const sourcePath = result.filePaths[0];
    // Validate before writing
    const raw = await readFile(sourcePath, "utf-8");
    const parsed = parse(raw); // throws on bad TOML
    const validation = validateConfig(parsed);
    if (!validation.ok) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid config: ${issues}`);
    }
    // Write validated config (uses atomic write)
    await writeConfig(ctx.configPath, validation.value);
    // Reload into context
    ctx.config = await readConfig(ctx.configPath);
    holder.sendEvent(EV.CONFIG_CHANGED, {});
    return { imported: true };
  });
}
```

### Step 3: Pass store to settings handler registration
**File**: `packages/electron/src/main/index.ts`
- Export `store` or pass it to `registerIpcHandlers`
- Simplest: export `store` and import in `ipc/index.ts`, or change `registerIpcHandlers` signature

**File**: `packages/electron/src/main/ipc/index.ts`
- Import `registerSettingsHandlers` from `./settings.js`
- Call it with `holder` and `store`
- Need to thread `store` through — either:
  - a) Change `registerIpcHandlers(holder, store)` signature
  - b) Add `store` to `CtxHolder` interface

Option (a) is cleaner since only settings handlers need store.

### Step 4: Add preload bridge
**File**: `packages/electron/src/preload/index.ts`
- Add `settings` namespace:
  ```ts
  settings: {
    clearCache: () => ipcRenderer.invoke(CH.CACHE_CLEAR),
    reset: () => ipcRenderer.invoke(CH.WORKSPACE_RESET),
    exportConfig: () => ipcRenderer.invoke(CH.SETTINGS_EXPORT),
    importConfig: () => ipcRenderer.invoke(CH.SETTINGS_IMPORT),
  },
  ```

## Todo
- [ ] Add 4 IPC channel constants
- [ ] Create `settings.ts` handler file
- [ ] Thread `store` to handler registration
- [ ] Update `ipc/index.ts` to register settings handlers
- [ ] Add `settings` namespace to preload bridge
- [ ] Update `window.devhub` TypeScript type (if typed in web package)

## Success Criteria
- All 4 IPC channels respond correctly when invoked
- `cache:clear` clears electron-store
- `workspace:reset` kills PTY + clears store + nulls context + sends event
- `settings:export` opens save dialog and writes TOML
- `settings:import` validates + writes + reloads config

## Risk Assessment
- **Low**: Nuclear reset nulling `holder.current` — all other IPC handlers do `holder.current!` (non-null assertion). If renderer fires queries between reset and welcome page, they'll throw. Mitigation: `workspace:status` handler already guards with `if (!ctx)` check; other handlers could temporarily error but the renderer will have already navigated to WelcomePage.

## Security Considerations
- Import validates against Zod schema before writing — prevents malformed config
- Export/import use Electron native dialogs — no arbitrary path injection from renderer
- No secrets in config files (env_file is a path reference, not actual env values)

## Next Steps
→ Phase 02: Web API layer + Settings page UI sections
