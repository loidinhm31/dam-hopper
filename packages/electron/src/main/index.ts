import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import Store from "electron-store";
import {
  findConfigFile,
  readConfig,
  ConfigNotFoundError,
  readGlobalConfig,
  addKnownWorkspace,
  BulkGitService,
  BuildService,
  RunService,
  CommandService,
  type DevHubConfig,
} from "@dev-hub/core";
import { registerIpcHandlers } from "./ipc/index.js";
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
  buildService: BuildService;
  runService: RunService;
  commandService: CommandService;
}

/** Mutable container passed to all IPC handlers so they always read the latest ctx. */
export interface CtxHolder {
  current: ElectronContext;
  /** Send an event to the renderer (called by config handlers after write) */
  sendEvent: (channel: string, data: unknown) => void;
  /** Switch workspace: stop all, reload, rewire emitters */
  switchWorkspace: (workspacePath: string) => Promise<void>;
  /** Called by wireEventEmitters — invoked after each switchWorkspace */
  onSwitch: (() => void) | null;
}

async function resolveWorkspace(): Promise<string> {
  const last = store.get("lastWorkspacePath");
  if (last) {
    try {
      const found = await findConfigFile(last);
      if (found) return last;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== undefined) throw e;
    }
  }

  const result = await dialog.showOpenDialog({
    title: "Select workspace folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    app.quit();
    throw new Error("No workspace selected");
  }

  return result.filePaths[0];
}

async function initContext(workspacePath: string): Promise<ElectronContext> {
  let input = resolve(workspacePath);

  // Normalise file → directory
  try {
    const s = await stat(input);
    if (s.isFile()) input = dirname(input);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

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
    buildService: new BuildService(),
    runService: new RunService(),
    commandService: new CommandService(),
  };
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
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

app.whenReady().then(async () => {
  let ctx: ElectronContext;
  try {
    const workspacePath = await resolveWorkspace();
    ctx = await initContext(workspacePath);
  } catch (err) {
    dialog.showErrorBox(
      "Failed to load workspace",
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
    return;
  }

  const holder: CtxHolder = {
    current: ctx,

    sendEvent(channel: string, data: unknown) {
      getMainWindow()?.webContents.send(channel, data);
    },

    async switchWorkspace(workspacePath: string) {
      // Stop all running processes first
      await holder.current.runService.stopAll();

      // Normalise input
      let newInput = workspacePath;
      if (!isAbsolute(newInput)) newInput = resolve(process.cwd(), newInput);
      try {
        const s = await stat(newInput);
        if (s.isFile()) newInput = dirname(newInput);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }

      const newConfigPath = await findConfigFile(newInput);
      if (!newConfigPath) throw new ConfigNotFoundError(newInput);

      const newConfig = await readConfig(newConfigPath);
      const newWorkspaceRoot = dirname(newConfigPath);

      // Remove all listeners from old service emitters
      holder.current.bulkGitService.emitter.removeAllListeners();
      holder.current.buildService.emitter.removeAllListeners();
      holder.current.runService.emitter.removeAllListeners();
      holder.current.commandService.emitter.removeAllListeners();

      // Swap in new context
      holder.current = {
        config: newConfig,
        configPath: newConfigPath,
        workspaceRoot: newWorkspaceRoot,
        bulkGitService: new BulkGitService(),
        buildService: new BuildService(),
        runService: new RunService(),
        commandService: new CommandService(),
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
  registerIpcHandlers(holder);

  // Handle workspace open-dialog from renderer (folder picker)
  ipcMain.handle(CH.WORKSPACE_OPEN_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select workspace folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (e) => {
  if (!appHolder) return;
  e.preventDefault();
  const done = () => app.exit(0);
  // Timeout guard: force-exit after 5s if stopAll hangs
  const timeout = setTimeout(done, 5_000);
  appHolder.current.runService
    .stopAll()
    .finally(() => {
      clearTimeout(timeout);
      done();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
