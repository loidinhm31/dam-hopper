import { ipcMain, dialog } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type Store from "electron-store";
import { readConfig, writeConfig } from "@dev-hub/core";
import { CH, EV } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

interface StoreSchema {
  lastWorkspacePath?: string;
}

export function registerSettingsHandlers(
  holder: CtxHolder,
  store: Store<StoreSchema>,
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
    // readConfig throws on invalid TOML or schema violations (with descriptive messages)
    const validated = await readConfig(sourcePath);
    // Write validated config (uses atomic write)
    await writeConfig(ctx.configPath, validated);
    // Reload into context
    ctx.config = await readConfig(ctx.configPath);
    holder.sendEvent(EV.CONFIG_CHANGED, {});
    return { imported: true };
  });
}
