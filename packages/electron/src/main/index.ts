import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname, resolve } from "node:path";
import { stat } from "node:fs/promises";
import Store from "electron-store";
import {
  findConfigFile,
  readConfig,
  ConfigNotFoundError,
  readGlobalConfig,
  addKnownWorkspace,
  BulkGitService,
  type DevHubConfig,
} from "@dev-hub/core";
import { PtySessionManager } from "./pty/session-manager.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { registerPreWorkspaceHandlers } from "./ipc/workspace.js";
import { getMainWindow } from "./window.js";
import { CH, EV } from "../ipc-channels.js";

interface StoreSchema {
  lastWorkspacePath?: string;
}

const store = new Store<StoreSchema>();

export interface ElectronContext {
  config: DevHubConfig;
  configPath: string;
  workspaceRoot: string;
  bulkGitService: BulkGitService;
}

/** Mutable container passed to all IPC handlers so they always read the latest ctx. */
export interface CtxHolder {
  current: ElectronContext | null;
  ptyManager: PtySessionManager;
  /** Send an event to the renderer (called by config handlers after write) */
  sendEvent: (channel: string, data: unknown) => void;
  /** Switch workspace: stop all, reload, rewire emitters */
  switchWorkspace: (workspacePath: string) => Promise<void>;
  /** Called by wireEventEmitters — invoked after each switchWorkspace */
  onSwitch: (() => void) | null;
}

/** Resolve path and normalise file → parent directory. */
async function normalizeInputPath(input: string): Promise<string> {
  const abs = resolve(input);
  try {
    const s = await stat(abs);
    if (s.isFile()) return dirname(abs);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return abs;
}

async function initContext(workspacePath: string): Promise<ElectronContext> {
  const input = await normalizeInputPath(workspacePath);

  let resolvedPath = await findConfigFile(input);

  if (!resolvedPath) {
    const globalCfg = await readGlobalConfig();
    if (globalCfg?.defaults?.workspace) {
      const fallbackDir = resolve(globalCfg.defaults.workspace);
      resolvedPath = await findConfigFile(fallbackDir);
    }
  }

  if (!resolvedPath) throw new ConfigNotFoundError(input);

  const config = await readConfig(resolvedPath);
  const workspaceRoot = dirname(resolvedPath);

  store.set("lastWorkspacePath", workspaceRoot);
  await addKnownWorkspace(config.workspace.name, workspaceRoot);

  return {
    config,
    configPath: resolvedPath,
    workspaceRoot,
    bulkGitService: new BulkGitService(),
  };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

let appHolder: CtxHolder | null = null;
let fullIpcRegistered = false;
let initInProgress = false;

app.whenReady().then(async () => {
  const ptyManager = new PtySessionManager();

  const holder: CtxHolder = {
    current: null,
    ptyManager,

    sendEvent(channel: string, data: unknown) {
      getMainWindow()?.webContents.send(channel, data);
    },

    async switchWorkspace(workspacePath: string) {
      // Kill all active PTY sessions
      ptyManager.dispose();

      const newInput = await normalizeInputPath(workspacePath);

      const newConfigPath = await findConfigFile(newInput);
      if (!newConfigPath) throw new ConfigNotFoundError(newInput);

      const newConfig = await readConfig(newConfigPath);
      const newWorkspaceRoot = dirname(newConfigPath);

      // Remove all listeners from old git service emitter (guard if no current context)
      holder.current?.bulkGitService.emitter.removeAllListeners();

      // Swap in new context
      holder.current = {
        config: newConfig,
        configPath: newConfigPath,
        workspaceRoot: newWorkspaceRoot,
        bulkGitService: new BulkGitService(),
      };

      // Re-wire event emitters for new services
      holder.onSwitch?.();

      // Persist + register
      store.set("lastWorkspacePath", newWorkspaceRoot);
      await addKnownWorkspace(newConfig.workspace.name, newWorkspaceRoot);

      // Notify renderer
      getMainWindow()?.webContents.send(EV.WORKSPACE_CHANGED, {
        name: newConfig.workspace.name,
        root: newWorkspaceRoot,
      });
    },

    onSwitch: null,
  };

  appHolder = holder;

  // Create window immediately — before workspace resolution
  createWindow();

  // Register handlers that work without a loaded workspace
  registerPreWorkspaceHandlers(holder);

  // Initialize full IPC exactly once; prevent concurrent calls during initial load
  async function loadWorkspace(workspacePath: string): Promise<void> {
    if (fullIpcRegistered) {
      await holder.switchWorkspace(workspacePath);
      return;
    }
    if (initInProgress) throw new Error("Workspace initialization already in progress");
    initInProgress = true;
    try {
      const ctx = await initContext(workspacePath);
      holder.current = ctx;
      registerIpcHandlers(holder);
      fullIpcRegistered = true;
      // Notify renderer workspace is ready (drives workspace-status query invalidation)
      getMainWindow()?.webContents.send(EV.WORKSPACE_CHANGED, {
        name: ctx.config.workspace.name,
        root: ctx.workspaceRoot,
      });
    } finally {
      initInProgress = false;
    }
  }

  // workspace:init — called from WelcomePage when user selects a folder
  ipcMain.handle(CH.WORKSPACE_INIT, async (_e, path: string) => {
    if (!path) throw new Error("path is required");
    await loadWorkspace(path);
    return {
      name: holder.current!.config.workspace.name,
      root: holder.current!.workspaceRoot,
    };
  });

  // Try auto-resolve from persisted path or env var
  const lastPath = store.get("lastWorkspacePath");
  const envPath = process.env.DEV_HUB_WORKSPACE;
  const autoPath = lastPath ?? envPath;

  if (autoPath) {
    try {
      const normalizedAutoPath = await normalizeInputPath(autoPath);
      const found = await findConfigFile(normalizedAutoPath);
      if (found) {
        await loadWorkspace(autoPath);
      } else {
        // Stored path no longer has a config — clear it so welcome page shows
        store.delete("lastWorkspacePath");
      }
    } catch {
      store.delete("lastWorkspacePath");
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (e) => {
  if (!appHolder) return;
  e.preventDefault();
  // Kill all PTY sessions then exit
  appHolder.ptyManager.dispose();
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
