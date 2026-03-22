import { dirname, resolve, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import {
  findConfigFile,
  readConfig,
  ConfigNotFoundError,
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
  | { type: "heartbeat"; data: { timestamp: number } };

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

  const resolvedPath = await findConfigFile(input);

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
  };

  return ctx;
}
