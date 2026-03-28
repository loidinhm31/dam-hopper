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
  TerminalProfile,
  SearchResult,
  CommandDefinition,
  AgentType,
  AgentItemCategory,
  DistributionMethod,
  AgentStoreItem,
  ShipResult,
  ProjectAgentScanResult,
  HealthCheckResult,
  DistributionMatrix,
  MemoryTemplateInfo,
  RepoScanResult,
  ImportResult,
} from "../api/client.js";

type Unsubscribe = () => void;

export interface TerminalCreateOpts {
  id: string;
  /** Omit for free (project-less) terminals. */
  project?: string;
  /** Shell command to run. Empty string spawns an interactive login shell. */
  command: string;
  cwd?: string;
  cols: number;
  rows: number;
}

export interface SessionInfo {
  id: string;
  project?: string;
  command: string;
  cwd: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
}

export type { TerminalProfile };

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

  commands: {
    search: (query: string, projectType?: string, limit?: number) => Promise<SearchResult[]>;
    list: (projectType: string) => Promise<CommandDefinition[]>;
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

  agentStore: {
    list: (opts?: { category?: AgentItemCategory }) => Promise<AgentStoreItem[]>;
    get: (opts: { name: string; category: AgentItemCategory }) => Promise<AgentStoreItem | null>;
    getContent: (opts: { name: string; category: AgentItemCategory; fileName?: string }) => Promise<string>;
    add: (opts: { category: AgentItemCategory; name?: string }) => Promise<AgentStoreItem | null>;
    remove: (opts: { name: string; category: AgentItemCategory }) => Promise<{ removed: boolean }>;
    ship: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
      method?: DistributionMethod;
    }) => Promise<ShipResult>;
    unship: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
    }) => Promise<ShipResult>;
    absorb: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
    }) => Promise<ShipResult>;
    bulkShip: (opts: {
      items: Array<{ name: string; category: AgentItemCategory }>;
      targets: Array<{ projectName: string; agent: AgentType }>;
      method?: DistributionMethod;
    }) => Promise<ShipResult[]>;
    matrix: () => Promise<DistributionMatrix>;
    scan: () => Promise<ProjectAgentScanResult[]>;
    health: () => Promise<HealthCheckResult>;
  };

  agentMemory: {
    list: (opts: { projectName: string }) => Promise<Record<AgentType, string | null>>;
    get: (opts: { projectName: string; agent: AgentType }) => Promise<string | null>;
    update: (opts: { projectName: string; agent: AgentType; content: string }) => Promise<{ updated: boolean }>;
    templates: () => Promise<MemoryTemplateInfo[]>;
    apply: (opts: { templateName: string; projectName: string; agent: AgentType }) => Promise<{ content: string }>;
  };

  agentImport: {
    scan: (opts: { repoUrl: string }) => Promise<RepoScanResult>;
    confirm: (opts: {
      tmpDir: string;
      selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>;
    }) => Promise<ImportResult[]>;
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
