import type {
  WorkspaceInfo,
  KnownWorkspacesResponse,
  KnownWorkspace,
  GlobalConfig,
  ProjectWithStatus,
  GitStatus,
  Worktree,
  Branch,
  GitOpResult,
  DevHubConfig,
  ProjectConfig,
} from "../api/client.js";

type Unsubscribe = () => void;

export interface TerminalCreateOpts {
  id: string;
  project: string;
  command: string;
  cols: number;
  rows: number;
}

export interface SessionInfo {
  id: string;
  project: string;
  command: string;
  type: "build" | "run" | "custom" | "shell" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
}

export interface DevHubBridge {
  platform: string;
  versions: { electron: string; node: string };

  workspace: {
    get: () => Promise<WorkspaceInfo>;
    switch: (path: string) => Promise<WorkspaceInfo>;
    known: () => Promise<KnownWorkspacesResponse>;
    addKnown: (path: string) => Promise<KnownWorkspace>;
    removeKnown: (path: string) => Promise<{ removed: boolean }>;
    openDialog: () => Promise<string | null>;
    status: () => Promise<{ ready: boolean; name?: string; root?: string }>;
    init: (path: string) => Promise<{ name: string; root: string }>;
  };

  globalConfig: {
    get: () => Promise<GlobalConfig>;
    updateDefaults: (defaults: {
      workspace?: string;
    }) => Promise<{ updated: true }>;
  };

  projects: {
    list: () => Promise<ProjectWithStatus[]>;
    get: (name: string) => Promise<ProjectWithStatus>;
    status: (name: string) => Promise<GitStatus | null>;
  };

  git: {
    fetch: (projects?: string[]) => Promise<GitOpResult[]>;
    pull: (projects?: string[]) => Promise<GitOpResult[]>;
    push: (project: string) => Promise<GitOpResult>;
    worktrees: (project: string) => Promise<Worktree[]>;
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => Promise<Worktree>;
    removeWorktree: (project: string, path: string) => Promise<void>;
    branches: (project: string) => Promise<Branch[]>;
    updateBranch: (project: string, branch?: string) => Promise<GitOpResult[]>;
  };

  config: {
    get: () => Promise<DevHubConfig>;
    update: (config: DevHubConfig) => Promise<DevHubConfig>;
    updateProject: (
      name: string,
      data: Partial<ProjectConfig>,
    ) => Promise<ProjectConfig>;
  };

  ssh: {
    addKey: (passphrase: string, keyPath?: string) => Promise<{ success: boolean; error?: string }>;
    checkAgent: () => Promise<{ hasKeys: boolean; keyCount: number }>;
    listKeys: () => Promise<string[]>;
  };

  settings: {
    clearCache: () => Promise<{ cleared: boolean }>;
    reset: () => Promise<{ reset: boolean }>;
    exportConfig: () => Promise<{ exported: boolean; path?: string }>;
    importConfig: () => Promise<{ imported: boolean }>;
  };

  terminal: {
    create: (opts: TerminalCreateOpts) => Promise<string>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => void;
    list: () => Promise<string[]>;
    listDetailed: () => Promise<SessionInfo[]>;
    getBuffer: (id: string) => Promise<string>;
    onData: (id: string, cb: (data: string) => void) => Unsubscribe;
    onExit: (id: string, cb: (exitCode: number | null) => void) => Unsubscribe;
  };

  on: (channel: string, callback: (data: unknown) => void) => Unsubscribe;
  off: (channel: string, callback: (data: unknown) => void) => void;

  /** Push-event channel names exposed by the preload (from ipc-channels.ts) */
  eventChannels: readonly string[];
}

declare global {
  interface Window {
    devhub: DevHubBridge;
  }
}
