// Transport-agnostic API client — delegates through the active Transport singleton.
import { getTransport } from "./transport.js";
import type { FsListResponse, HealthResponse } from "./fs-types.js";

export interface SessionInfo {
  id: string;
  project?: string;
  command: string;
  cwd: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
  // Phase 3 restart policy fields (mirrors backend)
  restartPolicy?: "never" | "on-failure" | "always";
  restartCount?: number;
  lastExitAt?: number;
  // Phase 5 exit event fields (willRestart computed by server on exit)
  willRestart?: boolean;
  restartInMs?: number;
}

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

// ── Tunnel Types ──────────────────────────────────────────────────────────────

export interface TunnelInfo {
  id: string;
  port: number;
  label: string;
  driver: string;
  status: "starting" | "ready" | "failed" | "stopped";
  url?: string;
  error?: string;
  startedAt: number;
  pid?: number;
}

// ── Port Detection Types ──────────────────────────────────────────────────────

export interface DetectedPort {
  port: number;
  session_id: string;
  project: string | null;
  detected_via: "stdout_regex" | "proc_net";
  state: "provisional" | "listening" | "lost";
}

// ── Memory + Import Types ─────────────────────────────────────────────────────
// NOTE: These mirror types from @dam-hopper/core. Duplication is intentional —
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

export interface LocalScanResult {
  dirPath: string;
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

export type RestartPolicy = "never" | "on-failure" | "always";

export interface ProjectConfig {
  name: string;
  path: string;
  type: ProjectType;
  services?: ServiceConfig[];
  commands?: Record<string, string>;
  terminals?: TerminalProfile[];
  envFile?: string;
  tags?: string[];
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  healthCheckUrl?: string;
}

export interface WorkspaceConfig {
  name: string;
  root: string;
}

export interface DamHopperConfig {
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
  path?: string;
  name?: string;
  projectCount?: number;
}

export interface DiscoveredProject {
  name: string;
  path: string;
  projectType: ProjectType;
  isGitRepo: boolean;
}

export interface DiscoverResponse {
  path: string;
  projects: DiscoveredProject[];
}

export interface UiConfig {
  systemFontSize: number;
  editorFontSize: number;
  editorZoomWheelEnabled: boolean;
  terminalOrder?: string[];
  projectOrder?: string[];
  projectCommandOrder?: Record<string, string[]>;
}

export interface GlobalConfig {
  defaults?: { workspace?: string };
  workspaces?: KnownWorkspace[];
  ui?: UiConfig;
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

export interface GitLogEntry {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  timestamp: number;
  message: string;
  refs: string[];
}

// ── Git Diff Types ────────────────────────────────────────────────────────────

export interface DiffFileEntry {
  path: string;
  /** "modified" | "added" | "deleted" | "renamed" | "copied" | "conflicted" */
  status: string;
  staged: boolean;
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface DiffResponse {
  entries: DiffFileEntry[];
  untrackedTruncated: boolean;
  untrackedTotal: number;
}

export interface HunkInfo {
  index: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
}

export interface FileDiffContent {
  path: string;
  original?: string;
  modified?: string;
  language: string;
  hunks: HunkInfo[];
  isBinary: boolean;
}

export interface ConflictFile {
  path: string;
  ancestor?: string;
  ours?: string;
  theirs?: string;
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
    get: () => getTransport().invoke<WorkspaceInfo>("workspace:get"),
    switch: (path: string) => getTransport().invoke<WorkspaceInfo>("workspace:switch", path),
    known: () => getTransport().invoke<KnownWorkspacesResponse>("workspace:known"),
    addKnown: (path: string) => getTransport().invoke<KnownWorkspace>("workspace:addKnown", path),
    removeKnown: (path: string) => getTransport().invoke<{ removed: boolean }>("workspace:removeKnown", path),
    status: () => getTransport().invoke<WorkspaceStatus>("workspace:status"),
    init: (path: string) => getTransport().invoke<{ name: string; root: string }>("workspace:init", path),
    discover: (path: string) => getTransport().invoke<DiscoverResponse>("workspace:discover", path),
  },
  globalConfig: {
    get: () => getTransport().invoke<GlobalConfig>("globalConfig:get"),
    updateDefaults: (defaults: { workspace?: string }) =>
      getTransport().invoke<{ updated: true }>("globalConfig:updateDefaults", defaults),
    updateUi: (ui: UiConfig) =>
      getTransport().invoke<{ updated: true }>("globalConfig:updateUi", ui),
  },
  projects: {
    list: () => getTransport().invoke<ProjectWithStatus[]>("projects:list"),
    get: (name: string) => getTransport().invoke<ProjectWithStatus>("projects:get", name),
    status: (name: string) => getTransport().invoke<GitStatus | null>("projects:status", name),
  },
  git: {
    fetch: (projects?: string[]) => getTransport().invoke<GitOpResult[]>("git:fetch", projects),
    pull: (projects?: string[]) => getTransport().invoke<GitOpResult[]>("git:pull", projects),
    push: (project: string) => getTransport().invoke<GitOpResult>("git:push", project),
    worktrees: (project: string) => getTransport().invoke<Worktree[]>("git:worktrees", project),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => getTransport().invoke<Worktree>("git:addWorktree", { project, options }),
    removeWorktree: (project: string, path: string) =>
      getTransport().invoke<void>("git:removeWorktree", { project, path }),
    branches: (project: string) => getTransport().invoke<Branch[]>("git:branches", project),
    updateBranch: (project: string, branch?: string) =>
      getTransport().invoke<GitOpResult[]>("git:updateBranch", { project, branch }),
    log: (project: string, limit?: number) => 
      getTransport().invoke<GitLogEntry[]>("git:log", { project, limit }),
    diff: (project: string) =>
      getTransport().invoke<DiffResponse>("git:diff", { project }),
    untrackedFiles: (project: string, offset: number, limit: number) =>
      getTransport().invoke<DiffFileEntry[]>("git:untrackedFiles", { project, offset, limit }),
    fileDiff: (project: string, path: string) =>
      getTransport().invoke<FileDiffContent>("git:fileDiff", { project, path }),
    stage: (project: string, paths: string[]) =>
      getTransport().invoke<{ ok: boolean }>("git:stage", { project, paths }),
    unstage: (project: string, paths: string[]) =>
      getTransport().invoke<{ ok: boolean }>("git:unstage", { project, paths }),
    discard: (project: string, path: string) =>
      getTransport().invoke<{ ok: boolean }>("git:discard", { project, path }),
    discardHunk: (project: string, path: string, hunkIndex: number) =>
      getTransport().invoke<{ ok: boolean }>("git:discardHunk", { project, path, hunkIndex }),
    conflicts: (project: string) =>
      getTransport().invoke<ConflictFile[]>("git:conflicts", { project }),
    resolve: (project: string, path: string, content: string) =>
      getTransport().invoke<{ ok: boolean }>("git:resolve", { project, path, content }),
    commit: (project: string, message: string) =>
      getTransport().invoke<{ ok: boolean; hash: string }>("git:commit", { project, message }),
    commitFiles: (project: string, hash: string) =>
      getTransport().invoke<DiffFileEntry[]>("git:commitFiles", { project, hash }),
    commitFileDiff: (project: string, hash: string, path: string) =>
      getTransport().invoke<FileDiffContent>("git:commitFileDiff", { project, hash, path }),
  },
  config: {
    get: () => getTransport().invoke<DamHopperConfig>("config:get"),
    update: (config: DamHopperConfig) => getTransport().invoke<DamHopperConfig>("config:update", config),
    updateProject: (name: string, data: Partial<ProjectConfig>) =>
      getTransport().invoke<ProjectConfig>("config:updateProject", { name, patch: data }),
  },
  settings: {
    clearCache: () => getTransport().invoke<{ cleared: boolean }>("cache:clear"),
    reset: () => getTransport().invoke<{ reset: boolean }>("workspace:reset"),
    exportConfig: () => getTransport().invoke<{ exported: boolean; path?: string }>("settings:export"),
    importConfig: () => getTransport().invoke<{ imported: boolean }>("settings:import"),
  },
  commands: {
    search: (query: string, projectType?: string, limit?: number) =>
      getTransport().invoke<SearchResult[]>("commands:search", { query, projectType, limit }),
    list: (projectType: string) =>
      getTransport().invoke<SearchResult[]>("commands:list", { projectType }),
  },
  agentStore: {
    list: (category?: AgentItemCategory) =>
      getTransport().invoke<AgentStoreItem[]>("agent-store:list", category ? { category } : undefined),
    get: (name: string, category: AgentItemCategory) =>
      getTransport().invoke<AgentStoreItem | null>("agent-store:get", { name, category }),
    getContent: (name: string, category: AgentItemCategory, fileName?: string) =>
      getTransport().invoke<string>("agent-store:getContent", { name, category, fileName }),
    remove: (name: string, category: AgentItemCategory) =>
      getTransport().invoke<{ removed: boolean }>("agent-store:remove", { name, category }),
    ship: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
      method?: DistributionMethod,
    ) => getTransport().invoke<ShipResult>("agent-store:ship", { itemName, category, projectName, agent, method }),
    unship: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
    ) => getTransport().invoke<ShipResult>("agent-store:unship", { itemName, category, projectName, agent }),
    absorb: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
    ) => getTransport().invoke<ShipResult>("agent-store:absorb", { itemName, category, projectName, agent }),
    bulkShip: (
      items: Array<{ name: string; category: AgentItemCategory }>,
      targets: Array<{ projectName: string; agent: AgentType }>,
      method?: DistributionMethod,
    ) => getTransport().invoke<ShipResult[]>("agent-store:bulkShip", { items, targets, method }),
    matrix: () => getTransport().invoke<DistributionMatrix>("agent-store:matrix"),
    scan: () => getTransport().invoke<ProjectAgentScanResult[]>("agent-store:scan"),
    health: () => getTransport().invoke<HealthCheckResult>("agent-store:health"),
  },
  agentMemory: {
    list: (projectName: string) => getTransport().invoke<Record<AgentType, string | null>>("agent-memory:list", { projectName }),
    get: (projectName: string, agent: AgentType) =>
      getTransport().invoke<string | null>("agent-memory:get", { projectName, agent }),
    update: (projectName: string, agent: AgentType, content: string) =>
      getTransport().invoke<{ updated: boolean }>("agent-memory:update", { projectName, agent, content }),
    templates: () => getTransport().invoke<MemoryTemplateInfo[]>("agent-memory:templates"),
    apply: (templateName: string, projectName: string, agent: AgentType) =>
      getTransport().invoke<{ content: string }>("agent-memory:apply", { templateName, projectName, agent }),
  },
  agentImport: {
    scan: (repoUrl: string) => getTransport().invoke<RepoScanResult>("agent-store:importScan", { repoUrl }),
    scanLocal: (dirPath: string) => getTransport().invoke<LocalScanResult>("agent-store:importScanLocal", { dirPath }),
    confirm: (
      tmpDir: string,
      selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>,
      skipCleanup?: boolean,
    ) => getTransport().invoke<ImportResult[]>("agent-store:importConfirm", { tmpDir, selectedItems, skipCleanup }),
  },
  terminal: {
    create: (opts: {
      id: string;
      project?: string;
      command: string;
      cwd?: string;
      cols: number;
      rows: number;
    }) => getTransport().invoke<void>("terminal:create", opts),
    kill: (id: string) => getTransport().invoke<void>("terminal:kill", id),
    remove: (id: string) => getTransport().invoke<void>("terminal:remove", id),
    list: () => getTransport().invoke<SessionInfo[]>("terminal:list"),
    listDetailed: () => getTransport().invoke<SessionInfo[]>("terminal:listDetailed"),
    getBuffer: (id: string) => getTransport().invoke<string>("terminal:buffer", id),
  },
  health: {
    get: () => getTransport().invoke<HealthResponse>("health:get"),
  },
  fs: {
    list: (project: string, path: string) =>
      getTransport().invoke<FsListResponse>("fs:list", { project, path }),
  },
  tunnels: {
    list: () => getTransport().invoke<TunnelInfo[]>("tunnel:list"),
    create: (port: number, label: string) =>
      getTransport().invoke<TunnelInfo>("tunnel:create", { port, label }),
    stop: (id: string) => getTransport().invoke<void>("tunnel:stop", { id }),
  },
};
