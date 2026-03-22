import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
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

// Partial so get() returns string | undefined without a type cast
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

async function resolveWorkspace(): Promise<string> {
  const last = store.get("lastWorkspacePath");
  if (last) {
    try {
      const found = await findConfigFile(last);
      if (found) return last;
    } catch (e: unknown) {
      // Only swallow "not found" — re-throw I/O/permission errors
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
    // Never reached but satisfies TypeScript
    throw new Error("No workspace selected");
  }

  return result.filePaths[0];
}

async function initContext(workspacePath: string): Promise<ElectronContext> {
  // workspacePath is always a directory (from electron-store or dialog)
  const input = resolve(workspacePath);

  let resolvedPath = await findConfigFile(input);

  // XDG global config fallback (parity with server/CLI)
  if (!resolvedPath) {
    const globalCfg = await readGlobalConfig();
    if (globalCfg?.defaults?.workspace) {
      const fallbackDir = resolve(globalCfg.defaults.workspace);
      resolvedPath = await findConfigFile(fallbackDir);
    }
  }

  if (!resolvedPath) {
    throw new ConfigNotFoundError(input);
  }

  const config = await readConfig(resolvedPath);
  const workspaceRoot = dirname(resolvedPath);

  // Persist successful workspace path
  store.set("lastWorkspacePath", workspaceRoot);
  // Auto-register in known workspaces
  await addKnownWorkspace(config.workspace.name, workspaceRoot);

  return {
    config,
    configPath: resolvedPath,
    workspaceRoot,
    // Phase 02 IPC handlers call service methods with workspaceRoot at call-time
    bulkGitService: new BulkGitService(),
    buildService: new BuildService(),
    runService: new RunService(),
    commandService: new CommandService(),
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
    // Dev: electron-vite starts a Vite dev server and sets this env var
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Prod: load built renderer (run `pnpm build:electron` first)
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

let ctx: ElectronContext | null = null;

app.whenReady().then(async () => {
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

  registerIpcHandlers(ctx);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Electron does not await async before-quit handlers.
// Use preventDefault + app.exit() to ensure stopAll() completes before quit.
app.on("before-quit", (e) => {
  if (!ctx) return;
  e.preventDefault();
  ctx.runService.stopAll().finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
