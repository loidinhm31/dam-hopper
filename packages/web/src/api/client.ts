// IPC-only API client — all calls route through window.devhub (Electron contextBridge).
// No HTTP fetch or SSE code.

// ── Agent Store Types ─────────────────────────────────────────────────────────

export type AgentType = "claude" | "gemini";

export type AgentItemCategory =
  | "skill"
  | "command"
  | "hook"
  | "mcp-server"
  | "subagent"
  | "memory-template";

export type DistributionMethod = "symlink" | "copy";

export interface AgentStoreItem {
  name: string;
  category: AgentItemCategory;
  relativePath: string;
  description?: string;
  compatibleAgents: AgentType[];
  sizeBytes?: number;
}

export interface ShipResult {
  item: string;
  category: AgentItemCategory;
  project: string;
  agent: AgentType;
  method: DistributionMethod;
  success: boolean;
  error?: string;
  targetPath?: string;
}

export interface ProjectAgentScanResult {
  projectName: string;
  projectPath: string;
  agents: Partial<Record<AgentType, {
    hasConfig: boolean;
    skills: string[];
    commands: string[];
    hooks: string[];
    hasMemoryFile: boolean;
    hasMcpConfig: boolean;
  }>>;
}

export interface HealthCheckResult {
  brokenSymlinks: Array<{ project: string; path: string; target: string }>;
  orphanedItems: Array<{ project: string; path: string; reason: string }>;
}

/** itemKey = "category:name", projectKey = "projectName:agent" */
export type DistributionMatrix = Record<
  string,
  Record<string, { shipped: boolean; method: DistributionMethod | null }>
>;

// ── Memory + Import Types ─────────────────────────────────────────────────────
// NOTE: These mirror types from @dev-hub/core. Duplication is intentional —
// the web renderer runs in Chromium and cannot import Node.js core packages.

export interface MemoryTemplateInfo {
  name: string;
  content: string;
}

export interface RepoScanItem {
  name: string;
  category: AgentItemCategory;
  description?: string;
  relativePath: string;
}

export interface RepoScanResult {
  repoUrl: string;
  tmpDir: string;
  items: RepoScanItem[];
}

export interface ImportResult {
  name: string;
  success: boolean;
  error?: string;
}

export type ProjectType =
  | "maven"
  | "gradle"
  | "npm"
  | "pnpm"
  | "cargo"
  | "custom";

export interface ServiceConfig {
  name: string;
  buildCommand?: string;
  runCommand?: string;
}

export interface TerminalProfile {
  name: string;
  command: string;
  cwd: string;
}

export interface ProjectConfig {
  name: string;
  path: string;
  type: ProjectType;
  services?: ServiceConfig[];
  commands?: Record<string, string>;
  terminals?: TerminalProfile[];
  envFile?: string;
  tags?: string[];
}

export interface WorkspaceConfig {
  name: string;
  root: string;
}

export interface DevHubConfig {
  workspace: WorkspaceConfig;
  projects: ProjectConfig[];
}

export interface GitStatus {
  projectName: string;
  branch: string;
  isClean: boolean;
  ahead: number;
  behind: number;
  modified: string[];
  untracked: string[];
}

export interface ProjectWithStatus extends ProjectConfig {
  status: GitStatus | null;
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  projectCount: number;
}

export interface KnownWorkspace {
  name: string;
  path: string;
}

export interface KnownWorkspacesResponse {
  workspaces: KnownWorkspace[];
  current: string | null;
}

export interface WorkspaceStatus {
  ready: boolean;
  name?: string;
  root?: string;
}

export interface GlobalConfig {
  defaults?: { workspace?: string };
  workspaces?: KnownWorkspace[];
}

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommit?: string;
}

export interface GitOpResult {
  projectName: string;
  success: boolean;
  error?: string;
}

export interface CommandDefinition {
  name: string;
  command: string;
  description: string;
  tags: string[];
}

export interface SearchResult {
  command: CommandDefinition;
  score: number;
  projectType: string;
}

export const api = {
  workspace: {
    get: () => window.devhub.workspace.get(),
    switch: (path: string) => window.devhub.workspace.switch(path),
    known: () => window.devhub.workspace.known(),
    addKnown: (path: string) => window.devhub.workspace.addKnown(path),
    removeKnown: (path: string) => window.devhub.workspace.removeKnown(path),
    status: () => window.devhub.workspace.status(),
    init: (path: string) => window.devhub.workspace.init(path),
  },
  globalConfig: {
    get: () => window.devhub.globalConfig.get(),
    updateDefaults: (defaults: { workspace?: string }) =>
      window.devhub.globalConfig.updateDefaults(defaults),
  },
  projects: {
    list: () => window.devhub.projects.list(),
    get: (name: string) => window.devhub.projects.get(name),
    status: (name: string) => window.devhub.projects.status(name),
  },
  git: {
    fetch: (projects?: string[]) => window.devhub.git.fetch(projects),
    pull: (projects?: string[]) => window.devhub.git.pull(projects),
    push: (project: string) => window.devhub.git.push(project),
    worktrees: (project: string) => window.devhub.git.worktrees(project),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => window.devhub.git.addWorktree(project, options),
    removeWorktree: (project: string, path: string) =>
      window.devhub.git.removeWorktree(project, path),
    branches: (project: string) => window.devhub.git.branches(project),
    updateBranch: (project: string, branch?: string) =>
      window.devhub.git.updateBranch(project, branch),
  },
  config: {
    get: () => window.devhub.config.get(),
    update: (config: DevHubConfig) => window.devhub.config.update(config),
    updateProject: (name: string, data: Partial<ProjectConfig>) =>
      window.devhub.config.updateProject(name, data),
  },
  settings: {
    clearCache: () => window.devhub.settings.clearCache(),
    reset: () => window.devhub.settings.reset(),
    exportConfig: () => window.devhub.settings.exportConfig(),
    importConfig: () => window.devhub.settings.importConfig(),
  },
  agentStore: {
    list: (category?: AgentItemCategory) =>
      window.devhub.agentStore.list(category ? { category } : undefined),
    get: (name: string, category: AgentItemCategory) =>
      window.devhub.agentStore.get({ name, category }),
    getContent: (name: string, category: AgentItemCategory, fileName?: string) =>
      window.devhub.agentStore.getContent({ name, category, fileName }),
    add: (category: AgentItemCategory, name?: string) =>
      window.devhub.agentStore.add({ category, name }),
    remove: (name: string, category: AgentItemCategory) =>
      window.devhub.agentStore.remove({ name, category }),
    ship: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
      method?: DistributionMethod,
    ) => window.devhub.agentStore.ship({ itemName, category, projectName, agent, method }),
    unship: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
    ) => window.devhub.agentStore.unship({ itemName, category, projectName, agent }),
    absorb: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
    ) => window.devhub.agentStore.absorb({ itemName, category, projectName, agent }),
    bulkShip: (
      items: Array<{ name: string; category: AgentItemCategory }>,
      targets: Array<{ projectName: string; agent: AgentType }>,
      method?: DistributionMethod,
    ) => window.devhub.agentStore.bulkShip({ items, targets, method }),
    matrix: () => window.devhub.agentStore.matrix(),
    scan: () => window.devhub.agentStore.scan(),
    health: () => window.devhub.agentStore.health(),
  },
  agentMemory: {
    list: (projectName: string) => window.devhub.agentMemory.list({ projectName }),
    get: (projectName: string, agent: AgentType) =>
      window.devhub.agentMemory.get({ projectName, agent }),
    update: (projectName: string, agent: AgentType, content: string) =>
      window.devhub.agentMemory.update({ projectName, agent, content }),
    templates: () => window.devhub.agentMemory.templates(),
    apply: (templateName: string, projectName: string, agent: AgentType) =>
      window.devhub.agentMemory.apply({ templateName, projectName, agent }),
  },
  agentImport: {
    scan: (repoUrl: string) => window.devhub.agentImport.scan({ repoUrl }),
    confirm: (
      tmpDir: string,
      selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>,
    ) => window.devhub.agentImport.confirm({ tmpDir, selectedItems }),
  },
};
