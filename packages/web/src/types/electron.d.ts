import type {
  WorkspaceInfo,
  KnownWorkspacesResponse,
  KnownWorkspace,
  GlobalConfig,
  ProjectWithStatus,
  GitStatus,
  Worktree,
  Branch,
  BuildResult,
  ProcessInfo,
  GitOpResult,
  DevHubConfig,
  ProjectConfig,
} from "../api/client.js";

type Unsubscribe = () => void;

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
  };

  globalConfig: {
    get: () => Promise<GlobalConfig>;
    updateDefaults: (defaults: { workspace?: string }) => Promise<{ updated: true }>;
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
    updateProject: (name: string, data: Partial<ProjectConfig>) => Promise<ProjectConfig>;
  };

  build: {
    start: (project: string, service?: string) => Promise<BuildResult[]>;
  };

  exec: {
    run: (project: string, command: string) => Promise<BuildResult>;
  };

  processes: {
    list: () => Promise<ProcessInfo[]>;
    start: (project: string, service?: string) => Promise<ProcessInfo>;
    stop: (project: string, service?: string) => Promise<void>;
    restart: (project: string, service?: string) => Promise<ProcessInfo>;
    logs: (
      project: string,
      service?: string,
      lines?: number,
    ) => Promise<{ timestamp: string; stream: string; line: string }[]>;
  };

  on: (channel: string, callback: (data: unknown) => void) => Unsubscribe;
  off: (channel: string, callback: (data: unknown) => void) => void;

  /** Push-event channel names exposed by the preload (from ipc-channels.ts) */
  eventChannels: readonly string[];

  terminal: Record<string, never>; // expanded in Phase 03
}

declare global {
  interface Window {
    devhub: DevHubBridge;
  }
}
