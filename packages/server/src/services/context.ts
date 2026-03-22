import { dirname, resolve, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import {
  findConfigFile,
  readConfig,
  ConfigNotFoundError,
  readGlobalConfig,
  addKnownWorkspace,
  type DevHubConfig,
} from "@dev-hub/core";
import {
  BulkGitService,
  BuildService,
  RunService,
  CommandService,
  type GitProgressEvent,
} from "@dev-hub/core";
import type { BuildProgressEvent, RunProgressEvent } from "@dev-hub/core";

export interface SSEClient {
  send: (event: SSEEvent) => void;
}

export type SSEEvent =
  | { type: "git:progress"; data: GitProgressEvent }
  | { type: "build:progress"; data: BuildProgressEvent }
  | { type: "command:progress"; data: BuildProgressEvent }
  | { type: "process:event"; data: RunProgressEvent }
  | { type: "status:changed"; data: { projectName: string } }
  | { type: "config:changed"; data: Record<string, unknown> }
  | { type: "heartbeat"; data: { timestamp: number } }
  | { type: "workspace:changed"; data: { name: string; root: string } };

export interface ServerContext {
  config: DevHubConfig;
  configPath: string;
  workspaceRoot: string;
  bulkGitService: BulkGitService;
  buildService: BuildService;
  runService: RunService;
  commandService: CommandService;
  sseClients: Set<SSEClient>;
  broadcast: (event: SSEEvent) => void;
  reloadConfig: () => Promise<void>;
  switching: boolean;
  switchWorkspace: (workspacePath: string) => Promise<void>;
}

export async function createServerContext(
  workspacePath?: string,
): Promise<ServerContext> {
  // Priority: explicit arg → DEV_HUB_WORKSPACE → DEV_HUB_CONFIG (compat) → CWD
  let input =
    workspacePath ??
    process.env.DEV_HUB_WORKSPACE ??
    process.env.DEV_HUB_CONFIG ??
    process.cwd();

  // Normalise: resolve relative, file → directory
  if (!isAbsolute(input)) {
    input = resolve(process.cwd(), input);
  }
  try {
    const s = await stat(input);
    if (s.isFile()) {
      input = dirname(input);
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  let resolvedPath = await findConfigFile(input);

  // XDG global config fallback (parity with CLI)
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

  const bulkGitService = new BulkGitService();
  const buildService = new BuildService();
  const runService = new RunService();
  const commandService = new CommandService();
  const sseClients = new Set<SSEClient>();

  function broadcast(event: SSEEvent): void {
    for (const client of sseClients) {
      try {
        client.send(event);
      } catch {
        // Ignore broken pipe — stream.onAbort will remove the client
      }
    }
  }

  // Wire emitters to SSE broadcast
  bulkGitService.emitter.on("progress", (event) => {
    broadcast({ type: "git:progress", data: event });
  });

  buildService.emitter.on("progress", (event) => {
    broadcast({ type: "build:progress", data: event });
  });

  runService.emitter.on("progress", (event) => {
    broadcast({ type: "process:event", data: event });
  });

  commandService.emitter.on("progress", (event) => {
    broadcast({ type: "command:progress", data: event });
  });

  const ctx: ServerContext = {
    config,
    configPath: resolvedPath,
    workspaceRoot,
    bulkGitService,
    buildService,
    runService,
    commandService,
    sseClients,
    broadcast,
    reloadConfig: async () => {
      ctx.config = await readConfig(ctx.configPath);
    },
    switching: false,
    switchWorkspace: async (workspacePath: string) => {
      // Reject immediately if already in progress (defense-in-depth; mutex middleware handles most cases)
      if (ctx.switching) {
        throw new Error("Workspace switch already in progress");
      }
      ctx.switching = true;
      try {
        // Stop all running processes first
        await ctx.runService.stopAll();

        // Resolve + normalize
        let newInput = workspacePath;
        if (!isAbsolute(newInput)) {
          newInput = resolve(process.cwd(), newInput);
        }
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

        // Remove all listeners from old service emitters to prevent memory leaks
        ctx.bulkGitService.emitter.removeAllListeners();
        ctx.buildService.emitter.removeAllListeners();
        ctx.runService.emitter.removeAllListeners();
        ctx.commandService.emitter.removeAllListeners();

        // Create new service instances
        const newBulkGitService = new BulkGitService();
        const newBuildService = new BuildService();
        const newRunService = new RunService();
        const newCommandService = new CommandService();

        // Wire new emitters to ctx.broadcast (uses monkey-patched version from routes)
        newBulkGitService.emitter.on("progress", (event) => {
          ctx.broadcast({ type: "git:progress", data: event });
        });
        newBuildService.emitter.on("progress", (event) => {
          ctx.broadcast({ type: "build:progress", data: event });
        });
        newRunService.emitter.on("progress", (event) => {
          ctx.broadcast({ type: "process:event", data: event });
        });
        newCommandService.emitter.on("progress", (event) => {
          ctx.broadcast({ type: "command:progress", data: event });
        });

        // Mutate ctx in place
        ctx.config = newConfig;
        ctx.configPath = newConfigPath;
        ctx.workspaceRoot = newWorkspaceRoot;
        ctx.bulkGitService = newBulkGitService;
        ctx.buildService = newBuildService;
        ctx.runService = newRunService;
        ctx.commandService = newCommandService;

        // Auto-register in known workspaces
        await addKnownWorkspace(newConfig.workspace.name, newWorkspaceRoot);

        // Notify all SSE clients (via ctx.broadcast so monkey-patches fire)
        ctx.broadcast({
          type: "workspace:changed",
          data: { name: newConfig.workspace.name, root: newWorkspaceRoot },
        });
      } finally {
        ctx.switching = false;
      }
    },
  };

  return ctx;
}
