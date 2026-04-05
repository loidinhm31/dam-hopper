import { resolve, dirname, basename, join } from "node:path";
import {
  findConfigFile,
  readConfig,
  writeConfig,
  AgentStoreService,
  BulkGitService,
  discoverProjects,
  addKnownWorkspace,
  type DevHubConfig,
} from "@dev-hub/core";
import type { PtySessionManager } from "./pty/session-manager.js";
import type { WebSocketEventSink } from "./ws/ws-event-sink.js";

export interface WorkspaceData {
  config: DevHubConfig;
  configPath: string;
  workspaceRoot: string;
  bulkGitService: BulkGitService;
  agentStore: AgentStoreService;
}

/** Mutable shared context passed to all route handlers. */
export interface ServerContext {
  current: WorkspaceData | null;
  ptyManager: PtySessionManager;
  wsSink: WebSocketEventSink;
  /** Load initial workspace */
  loadWorkspace(wsPath: string): Promise<void>;
  /** Switch workspace: kill ptys, reload, rewire emitters */
  switchWorkspace(wsPath: string): Promise<void>;
  /** Send push event to all WS clients */
  sendEvent(channel: string, data: unknown): void;
  /** Lifecycle: re-wire event emitters after workspace switch */
  onSwitch: (() => void) | null;
}

function resolveAgentStorePath(config: DevHubConfig, workspaceRoot: string): string {
  const cfgPath = (config as DevHubConfig & { agentStore?: { path?: string } }).agentStore?.path;
  return resolve(workspaceRoot, cfgPath ?? ".dev-hub/agent-store");
}

async function loadWorkspaceData(wsPath: string): Promise<WorkspaceData> {
  let resolvedPath = await findConfigFile(wsPath);
  if (!resolvedPath) {
    // Auto-initialize
    const discovered = await discoverProjects(wsPath);
    const workspaceName = basename(wsPath);
    const newConfig: DevHubConfig = {
      workspace: { name: workspaceName, root: "." },
      projects: discovered.map((p) => ({
        name: p.name, path: p.path, type: p.type,
        services: undefined, commands: undefined, terminals: [],
        envFile: undefined, tags: undefined, agents: undefined,
      })),
    };
    const tomlPath = join(wsPath, "dev-hub.toml");
    await writeConfig(tomlPath, newConfig);
    resolvedPath = tomlPath;
  }

  const config = await readConfig(resolvedPath);
  const workspaceRoot = dirname(resolvedPath);

  const agentStorePath = resolveAgentStorePath(config, workspaceRoot);
  const agentStore = new AgentStoreService(agentStorePath);
  await agentStore.init();

  await addKnownWorkspace(config.workspace.name, workspaceRoot);

  return {
    config,
    configPath: resolvedPath,
    workspaceRoot,
    bulkGitService: new BulkGitService(),
    agentStore,
  };
}

export function createServerContext(
  ptyManager: PtySessionManager,
  wsSink: WebSocketEventSink,
): ServerContext {
  const ctx: ServerContext = {
    current: null,
    ptyManager,
    wsSink,
    onSwitch: null,

    sendEvent(channel: string, data: unknown): void {
      wsSink.broadcast(channel, data);
    },

    async loadWorkspace(wsPath: string): Promise<void> {
      const data = await loadWorkspaceData(wsPath);
      ctx.current = data;
      wireEmitters(ctx);
    },

    async switchWorkspace(wsPath: string): Promise<void> {
      ptyManager.dispose();
      ctx.current?.bulkGitService.emitter.removeAllListeners();
      const data = await loadWorkspaceData(wsPath);
      ctx.current = data;
      ctx.onSwitch?.();
      wsSink.broadcast("workspace:changed", {
        name: data.config.workspace.name,
        root: data.workspaceRoot,
      });
    },
  };

  return ctx;
}

function wireEmitters(ctx: ServerContext): void {
  const wire = () => {
    if (!ctx.current) return;
    ctx.current.bulkGitService.emitter.on("progress", (event) => {
      ctx.wsSink.broadcast("git:progress", event);
    });
  };
  wire();
  ctx.onSwitch = wire;
}
