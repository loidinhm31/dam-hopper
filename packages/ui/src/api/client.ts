// Transport-agnostic API client — delegates through the active Transport singleton.
import { getTransport } from "./transport.js";
import type { FsListResponse, HealthResponse } from "./fs-types.js";
import type { CommandHistoryEntry } from "@/lib/command-history.js";

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

export type TerminalLifecycle =
  | "unverified"
  | "editing"
  | "submitted"
  | "opaque";

/** Server-validated shell lifecycle snapshot for one terminal incarnation. */
export type TerminalLifecycleEvent =
  | {
      id: string;
      lifecycle: "submitted";
      generation: number;
      /** Exact command emitted by the verified shell marker, when available. */
      command?: string;
    }
  | {
      id: string;
      lifecycle: Exclude<TerminalLifecycle, "submitted">;
      generation: number;
      command?: never;
    };

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
  agents: Partial<
    Record<
      AgentType,
      {
        hasConfig: boolean;
        skills: string[];
        commands: string[];
        hooks: string[];
        hasMemoryFile: boolean;
        hasMcpConfig: boolean;
      }
    >
  >;
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

export interface BrowserSelectionV1 {
  version: 1;
  tag: string;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  attributes: Record<string, string>;
  locator: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface BrowserDebugArtifactResponse {
  artifactId: string;
  terminalId: string;
  expiresAt: number;
  jsonPath: string;
  jsonSize: number;
  jsonSha256: string;
  pngPath?: string;
  pngSize?: number;
  pngSha256?: string;
}

export interface BrowserDebugHandoffResponse {
  inserted: boolean;
}

// ── Port Detection Types ──────────────────────────────────────────────────────

export interface DetectedPort {
  port: number;
  session_id: string;
  project: string | null;
  detected_via: "stdout_regex" | "proc_net";
  state: "provisional" | "listening" | "lost";
}

// ── Host System Metrics ─────────────────────────────────────────────────────

export interface HostMetrics {
  sampledAt: number;
  hostname?: string;
  osName?: string;
  uptimeSeconds: number;
  cpu: {
    usagePercent: number;
    logicalCoreCount: number;
    physicalCoreCount?: number;
    loadAverage?: { one: number; five: number; fifteen: number };
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  disk: DiskMetrics;
  disks?: DiskMetrics[];
  temperatures: Array<{
    label: string;
    celsius: number;
    source: string;
  }>;
}

export interface DiskMetrics {
  name: string;
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
}

export interface DiagnosticExportRequest {
  windowMinutes?: number;
  includeTerminalOutput?: boolean;
  terminalTailBytes?: number;
  terminalIds?: string[];
  frontend?: unknown;
}

export interface DiagnosticEvent {
  timestampMs: number;
  level: string;
  source: string;
  message: string;
  fields: Record<string, string>;
}

export interface DiagnosticExportScope {
  windowMinutes: number;
  includeTerminalOutput: boolean;
  terminalTailBytes: number;
  terminalIds?: string[] | null;
}

export interface DiagnosticExportManifest {
  backendEventCount: number;
  terminalSessionCount: number;
  retentionMinutes: number;
  storage: string;
  droppedPersistEvents: number;
  persistErrorCount: number;
}

export interface BackendDiagnosticsExport {
  events: DiagnosticEvent[];
}

export interface TerminalDiagnosticsExport {
  sessions: unknown[];
  tails: unknown[];
}

export interface DiagnosticExportResponse {
  diagnosticSchemaVersion: 1;
  generatedAt: number;
  scope: DiagnosticExportScope;
  manifest: DiagnosticExportManifest;
  frontend: unknown;
  backend: BackendDiagnosticsExport;
  terminals: TerminalDiagnosticsExport;
  system: HostMetrics;
}

export interface SshLoadKeyResult {
  success: boolean;
  saved: boolean;
  keyPath?: string;
  error?: string;
}

export interface SshCredentialStatus {
  saved: boolean;
  keyPath?: string;
  error?: string;
}

export interface SshForgetCredentialResult {
  success: boolean;
  forgotten: boolean;
  error?: string;
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

export type UsageBucket = "hour" | "day";
export type UsageWindow = "24h" | "7d" | "30d";
export type UsageShell = "bash" | "zsh" | "fish";
export type UsageCaptureQuality = "rich" | "partial" | "unavailable";

export interface UsageSummaryQuery {
  from?: number;
  to?: number;
  window?: UsageWindow;
  bucket?: UsageBucket;
  project?: string;
  shell?: UsageShell;
  captureQuality?: UsageCaptureQuality;
  category?: string;
  agent?: "codex";
  model?: "gpt-5.6-sol";
}

export interface UsageAggregate {
  commandCount: number;
  succeededCount: number;
  failedCount: number;
  interruptedCount: number;
  unknownCount: number;
  durationMsSum: number;
}

export interface UsageTokens {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
}

/** Privacy-safe aggregate bucket; no command, event, or conversation data. */
export interface UsageTimeBucket {
  startUtcMs: number;
  terminal: UsageAggregate;
  codex: UsageTokens | null;
}

export interface UsageDimensionAggregate {
  name: string;
  terminal: UsageAggregate;
}

/** Available only while the selected window is entirely in detail retention. */
export interface UsageDetailMetrics {
  durationP50Ms: number | null;
  durationP95Ms: number | null;
  repeatedCommandCount: number;
}

export interface UsageSummary {
  range: { from: number; to: number; bucket: UsageBucket };
  terminal: UsageAggregate;
  codex: UsageTokens | null;
  timeSeries: UsageTimeBucket[];
  categories: UsageDimensionAggregate[];
  projects: UsageDimensionAggregate[];
  detailMetrics: UsageDetailMetrics | null;
  coverage: {
    detailOnly: boolean;
    captureQualityFilter: UsageCaptureQuality | null;
    codexCorrelation: {
      exact: number;
      approximate: number;
      unattributed: number;
    } | null;
  };
  health: UsageHealth;
}

export interface UsageHealth {
  available: boolean;
  paused: boolean;
  writerErrors: number;
  rejectedEvents: number;
  sampledAt: number;
  collector: UsageCollectorHealth;
}

export interface UsageCollectorHealth {
  running: boolean;
  malformed: number;
  rejected: number;
  queued: number;
  dropped: number;
  duplicate: number;
  unverifiedVersion: number;
  coreSchemaDrift: number;
  unavailableTokenCoverage: number;
  lastAcceptedAtUtcMs: number | null;
}

export interface UsageCollectorSettings {
  enabled: boolean;
  host: string;
  port: number;
}

export interface UsageSettings {
  enabled: boolean;
  paused: boolean;
  detailRetentionDays: number;
  aggregateRetentionDays: number | null;
  excludedProjects: string[];
  collector: UsageCollectorSettings;
  collectorSetup: {
    endpoint: string;
    authorization: string;
    restartRequired: boolean;
    managedConfig: false;
    serverRestartRequired: true;
    baselineFixtureVersion: string;
  };
}

export interface UsageSettingsPatch {
  paused?: boolean;
  detailRetentionDays?: number;
  aggregateRetentionDays?: number | null;
  excludedProjects?: string[];
  collector?: UsageCollectorSettings;
}

export interface ProjectWithStatus extends ProjectConfig {
  status: GitStatus | null;
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  configPath: string;
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
  configPath?: string;
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

export type AgentCommandPatternKind = "literal" | "regex";
export type TerminalAgentType = "codex" | "claude" | "antigravity" | "unknown";
export type TerminalAgentNotificationPolicy = "always";
export type TerminalCodexNotificationSoundPattern =
  | "default"
  | "soft"
  | "two-tone"
  | "urgent";

export interface AgentCommandPattern {
  id: string;
  label: string;
  kind: AgentCommandPatternKind;
  pattern: string;
  agent: TerminalAgentType;
  enabled: boolean;
}

export interface UiConfig {
  systemFontSize: number;
  editorFontSize: number;
  editorZoomWheelEnabled: boolean;
  searchTextShortcut: string;
  searchFilenameShortcut: string;
  terminalWorkspaceShortcut: string;
  terminalFilePanelShortcut: string;
  revealActiveFileShortcut: string;
  gitPanelShortcut: string;
  portsPanelShortcut: string;
  fleetTerminalShortcut: string;
  terminalSuggestionsEnabled?: boolean;
  terminalCodexNotificationsEnabled?: boolean;
  terminalCodexNotificationToastEnabled?: boolean;
  terminalCodexBrowserNotificationsEnabled?: boolean;
  terminalCodexNotificationSoundEnabled?: boolean;
  terminalCodexNotificationSoundVolume?: number;
  terminalCodexNotificationSoundPattern?: TerminalCodexNotificationSoundPattern;
  terminalScrollButtonsEnabled?: boolean;
  terminalScrollStep?: number;
  explorerShowHidden?: boolean;
  mobileCustomKeyboardEnabled?: boolean;
  mobileCustomKeyboardFontSize?: number;
  mobileCustomKeyboardPadding?: number;
  mobileCustomKeyboardRowGap?: number;
  terminalOrder?: string[];
  projectOrder?: string[];
  projectCommandOrder?: Record<string, string[]>;
  runtimeGroupOrder?: string[];
  runtimeItemOrder?: Record<string, string[]>;
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
  trackingBranch?: string;
  ahead: number;
  behind: number;
  lastCommit: string;
}

export interface GitOpResult {
  projectName: string;
  success: boolean;
  error?: string;
}

export interface BranchUpdateResult {
  branch: string;
  success: boolean;
  reason?: string;
}

export type VcsRootKind = "primary" | "submodule" | "nestedRepo";
export type VcsRootMappingState =
  | "mapped"
  | "unmapped"
  | "missing"
  | "uninitialized";

export interface SubmoduleGitlinkInfo {
  path: string;
  objectId: string;
  moduleName?: string;
  url?: string;
}

export interface VcsRoot {
  rootId: string;
  path: string;
  absolutePath: string;
  kind: VcsRootKind;
  mappingState?: VcsRootMappingState;
  gitlink?: SubmoduleGitlinkInfo;
  status?: unknown;
  warnings: string[];
}

export type CheckoutStrategy = "normal" | "stash" | "force";

export type ResetMode = "soft" | "mixed" | "hard" | "keep";

export interface GitActionResult {
  ok: boolean;
  message?: string;
  branch?: string;
  hash?: string;
  stashed?: boolean;
  conflict?: boolean;
  dirty?: boolean;
  destructive?: boolean;
  recovery?: {
    operation: "merge" | "rebase" | "cherry-pick";
    canAbort: boolean;
    canContinue: boolean;
  };
  blockedReason?:
    | "active-operation"
    | "checked-out-branch"
    | "dirty-worktree"
    | "detached-head"
    | "pushed-commit"
    | "unreachable-commit"
    | "root-commit"
    | "mixed-vcs-roots";
  recommendation?: string;
}

export interface CommitMessageResponse {
  message: string;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  timestamp: number;
  message: string;
  refs: string[];
  isPushed: boolean;
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
  rootId?: string;
  rootPath?: string;
  submodule?: SubmoduleGitlinkInfo;
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

export interface GitLineChange {
  kind: "added" | "modified" | "deleted";
  line: number;
  length: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface FileDiffContent {
  path: string;
  original?: string;
  modified?: string;
  language: string;
  hunks: HunkInfo[];
  lineChanges: GitLineChange[];
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

export interface CombinedSearchResult {
  source: "history" | "catalog";
  command: CommandDefinition;
  score: number;
  projectType?: string;
  historyEntry?: CommandHistoryEntry;
}

export const api = {
  workspace: {
    get: () => getTransport().invoke<WorkspaceInfo>("workspace:get"),
    switch: (path: string) =>
      getTransport().invoke<WorkspaceInfo>("workspace:switch", path),
    known: () =>
      getTransport().invoke<KnownWorkspacesResponse>("workspace:known"),
    addKnown: (path: string) =>
      getTransport().invoke<KnownWorkspace>("workspace:addKnown", path),
    removeKnown: (path: string) =>
      getTransport().invoke<{ removed: boolean }>(
        "workspace:removeKnown",
        path,
      ),
    status: () => getTransport().invoke<WorkspaceStatus>("workspace:status"),
    init: (path: string) =>
      getTransport().invoke<{ name: string; root: string }>(
        "workspace:init",
        path,
      ),
    discover: (path: string) =>
      getTransport().invoke<DiscoverResponse>("workspace:discover", path),
  },
  globalConfig: {
    get: () => getTransport().invoke<GlobalConfig>("globalConfig:get"),
    updateDefaults: (defaults: { workspace?: string }) =>
      getTransport().invoke<{ updated: true }>(
        "globalConfig:updateDefaults",
        defaults,
      ),
    updateUi: (ui: Partial<UiConfig>) =>
      getTransport().invoke<{ updated: true }>("globalConfig:updateUi", ui),
  },
  projects: {
    list: () => getTransport().invoke<ProjectWithStatus[]>("projects:list"),
    get: (name: string) =>
      getTransport().invoke<ProjectWithStatus>("projects:get", name),
    status: (name: string) =>
      getTransport().invoke<GitStatus | null>("projects:status", name),
  },
  git: {
    fetch: (projects?: string[]) =>
      getTransport().invoke<GitOpResult[]>("git:fetch", projects),
    pull: (projects?: string[]) =>
      getTransport().invoke<GitOpResult[]>("git:pull", projects),
    push: (project: string, root?: string, force?: boolean) =>
      getTransport().invoke<GitOpResult>("git:push", { project, root, force }),
    worktrees: (project: string) =>
      getTransport().invoke<Worktree[]>("git:worktrees", project),
    roots: (project: string) =>
      getTransport().invoke<VcsRoot[]>("git:roots", project),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) =>
      getTransport().invoke<Worktree>("git:addWorktree", { project, options }),
    removeWorktree: (project: string, path: string) =>
      getTransport().invoke<void>("git:removeWorktree", { project, path }),
    branches: (project: string, root?: string) =>
      getTransport().invoke<Branch[]>("git:branches", { project, root }),
    createBranch: (
      project: string,
      options: {
        name: string;
        startPoint?: string;
        checkout?: boolean;
        root?: string;
      },
    ) =>
      getTransport().invoke<GitActionResult>("git:createBranch", {
        project,
        options,
      }),
    checkoutBranch: (
      project: string,
      options: {
        branch: string;
        startPoint?: string;
        create?: boolean;
        strategy?: CheckoutStrategy;
        root?: string;
      },
    ) =>
      getTransport().invoke<GitActionResult>("git:checkoutBranch", {
        project,
        options,
      }),
    deleteBranch: (
      project: string,
      options: {
        name: string;
        root?: string;
      },
    ) =>
      getTransport().invoke<GitActionResult>("git:deleteBranch", {
        project,
        options,
      }),
    updateBranch: (project: string, branch?: string, root?: string) =>
      getTransport().invoke<BranchUpdateResult>("git:updateBranch", {
        project,
        branch,
        root,
      }),
    log: (
      project: string,
      limit?: number,
      offset?: number,
      ref?: string,
      root?: string,
    ) =>
      getTransport().invoke<GitLogEntry[]>("git:log", {
        project,
        limit,
        offset,
        ref,
        root,
      }),
    diff: (project: string, root?: string) =>
      getTransport().invoke<DiffResponse>("git:diff", { project, root }),
    untrackedFiles: (
      project: string,
      offset: number,
      limit: number,
      root?: string,
    ) =>
      getTransport().invoke<DiffFileEntry[]>("git:untrackedFiles", {
        project,
        offset,
        limit,
        root,
      }),
    fileDiff: (project: string, path: string, root?: string) =>
      getTransport().invoke<FileDiffContent>("git:fileDiff", {
        project,
        path,
        root,
      }),
    stage: (project: string, paths: string[], root?: string) =>
      getTransport().invoke<{ ok: boolean }>("git:stage", {
        project,
        paths,
        root,
      }),
    unstage: (project: string, paths: string[], root?: string) =>
      getTransport().invoke<{ ok: boolean }>("git:unstage", {
        project,
        paths,
        root,
      }),
    discard: (project: string, path: string, root?: string) =>
      getTransport().invoke<{ ok: boolean }>("git:discard", {
        project,
        path,
        root,
      }),
    discardHunk: (
      project: string,
      path: string,
      hunkIndex: number,
      root?: string,
    ) =>
      getTransport().invoke<{ ok: boolean }>("git:discardHunk", {
        project,
        path,
        hunkIndex,
        root,
      }),
    conflicts: (project: string, root?: string) =>
      getTransport().invoke<ConflictFile[]>("git:conflicts", { project, root }),
    resolve: (project: string, path: string, content: string, root?: string) =>
      getTransport().invoke<{ ok: boolean }>("git:resolve", {
        project,
        path,
        content,
        root,
      }),
    commit: (
      project: string,
      message: string,
      amend?: boolean,
      root?: string,
    ) =>
      getTransport().invoke<{ ok: boolean; hash: string }>("git:commit", {
        project,
        message,
        amend,
        root,
      }),
    cherryPick: (project: string, hash: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:cherryPick", {
        project,
        hash,
        root,
      }),
    reset: (project: string, hash: string, mode: ResetMode, root?: string) =>
      getTransport().invoke<GitActionResult>("git:reset", {
        project,
        hash,
        mode,
        root,
      }),
    undoLastCommit: (project: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:undoLastCommit", {
        project,
        root,
      }),
    commitFiles: (project: string, hash: string, root?: string) =>
      getTransport().invoke<DiffFileEntry[]>("git:commitFiles", {
        project,
        hash,
        root,
      }),
    commitMessage: (project: string, hash: string, root?: string) =>
      getTransport().invoke<CommitMessageResponse>("git:commitMessage", {
        project,
        hash,
        root,
      }),
    editCommitMessage: (
      project: string,
      hash: string,
      message: string,
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:editCommitMessage", {
        project,
        hash,
        message,
        root,
      }),
    commitFileDiff: (
      project: string,
      hash: string,
      path: string,
      root?: string,
    ) =>
      getTransport().invoke<FileDiffContent>("git:commitFileDiff", {
        project,
        hash,
        path,
        root,
      }),
    cherryPickCommitFiles: (
      project: string,
      hash: string,
      paths: string[],
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:cherryPickCommitFiles", {
        project,
        hash,
        paths,
        root,
      }),
    dropCommitFiles: (
      project: string,
      hash: string,
      paths: string[],
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:dropCommitFiles", {
        project,
        hash,
        paths,
        root,
      }),
    dropCommit: (project: string, hash: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:dropCommit", {
        project,
        hash,
        root,
      }),
    revertCommit: (project: string, hash: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:revertCommit", {
        project,
        hash,
        root,
      }),
    revertCommitFiles: (
      project: string,
      hash: string,
      paths: string[],
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:revertCommitFiles", {
        project,
        hash,
        paths,
        root,
      }),
  },
  config: {
    get: () => getTransport().invoke<DamHopperConfig>("config:get"),
    update: (config: DamHopperConfig) =>
      getTransport().invoke<DamHopperConfig>("config:update", config),
    updateProject: (name: string, data: Partial<ProjectConfig>) =>
      getTransport().invoke<ProjectConfig>("config:updateProject", {
        name,
        patch: data,
      }),
  },
  settings: {
    clearCache: () =>
      getTransport().invoke<{ cleared: boolean }>("cache:clear"),
    reset: () => getTransport().invoke<{ reset: boolean }>("workspace:reset"),
    exportConfig: () =>
      getTransport().invoke<{ exported: boolean; path?: string }>(
        "settings:export",
      ),
    importConfig: () =>
      getTransport().invoke<{ imported: boolean }>("settings:import"),
  },
  diagnostics: {
    export: (request: DiagnosticExportRequest) =>
      getTransport().invoke<DiagnosticExportResponse>(
        "diagnostics:export",
        request,
      ),
  },
  commands: {
    search: (query: string, projectType?: string, limit?: number) =>
      getTransport().invoke<SearchResult[]>("commands:search", {
        query,
        projectType,
        limit,
      }),
    list: (projectType: string) =>
      getTransport().invoke<SearchResult[]>("commands:list", { projectType }),
  },
  agentStore: {
    list: (category?: AgentItemCategory) =>
      getTransport().invoke<AgentStoreItem[]>(
        "agent-store:list",
        category ? { category } : undefined,
      ),
    get: (name: string, category: AgentItemCategory) =>
      getTransport().invoke<AgentStoreItem | null>("agent-store:get", {
        name,
        category,
      }),
    getContent: (
      name: string,
      category: AgentItemCategory,
      fileName?: string,
    ) =>
      getTransport().invoke<string>("agent-store:getContent", {
        name,
        category,
        fileName,
      }),
    remove: (name: string, category: AgentItemCategory) =>
      getTransport().invoke<{ removed: boolean }>("agent-store:remove", {
        name,
        category,
      }),
    ship: (
      itemName: string,
      category: AgentItemCategory,
      projectName: string,
      agent: AgentType,
      method?: DistributionMethod,
    ) =>
      getTransport().invoke<ShipResult>("agent-store:ship", {
        itemName,
        category,
        projectName,
        agent,
        method,
      }),
    unship: (
      itemName: string,
      category: AgentItemCategory,
      projectName: string,
      agent: AgentType,
    ) =>
      getTransport().invoke<ShipResult>("agent-store:unship", {
        itemName,
        category,
        projectName,
        agent,
      }),
    absorb: (
      itemName: string,
      category: AgentItemCategory,
      projectName: string,
      agent: AgentType,
    ) =>
      getTransport().invoke<ShipResult>("agent-store:absorb", {
        itemName,
        category,
        projectName,
        agent,
      }),
    bulkShip: (
      items: Array<{ name: string; category: AgentItemCategory }>,
      targets: Array<{ projectName: string; agent: AgentType }>,
      method?: DistributionMethod,
    ) =>
      getTransport().invoke<ShipResult[]>("agent-store:bulkShip", {
        items,
        targets,
        method,
      }),
    matrix: () =>
      getTransport().invoke<DistributionMatrix>("agent-store:matrix"),
    scan: () =>
      getTransport().invoke<ProjectAgentScanResult[]>("agent-store:scan"),
    health: () =>
      getTransport().invoke<HealthCheckResult>("agent-store:health"),
  },
  agentMemory: {
    list: (projectName: string) =>
      getTransport().invoke<Record<AgentType, string | null>>(
        "agent-memory:list",
        { projectName },
      ),
    get: (projectName: string, agent: AgentType) =>
      getTransport().invoke<string | null>("agent-memory:get", {
        projectName,
        agent,
      }),
    update: (projectName: string, agent: AgentType, content: string) =>
      getTransport().invoke<{ updated: boolean }>("agent-memory:update", {
        projectName,
        agent,
        content,
      }),
    templates: () =>
      getTransport().invoke<MemoryTemplateInfo[]>("agent-memory:templates"),
    apply: (templateName: string, projectName: string, agent: AgentType) =>
      getTransport().invoke<{ content: string }>("agent-memory:apply", {
        templateName,
        projectName,
        agent,
      }),
  },
  agentImport: {
    scan: (repoUrl: string) =>
      getTransport().invoke<RepoScanResult>("agent-store:importScan", {
        repoUrl,
      }),
    scanLocal: (dirPath: string) =>
      getTransport().invoke<LocalScanResult>("agent-store:importScanLocal", {
        dirPath,
      }),
    confirm: (
      tmpDir: string,
      selectedItems: Array<{
        name: string;
        category: AgentItemCategory;
        relativePath: string;
      }>,
      skipCleanup?: boolean,
    ) =>
      getTransport().invoke<ImportResult[]>("agent-store:importConfirm", {
        tmpDir,
        selectedItems,
        skipCleanup,
      }),
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
    listDetailed: () =>
      getTransport().invoke<SessionInfo[]>("terminal:listDetailed"),
    getBuffer: (id: string) =>
      getTransport().invoke<string>("terminal:buffer", id),
  },
  health: {
    get: () => getTransport().invoke<HealthResponse>("health:get"),
  },
  system: {
    metrics: () => getTransport().invoke<HostMetrics>("system:metrics"),
  },
  usage: {
    summary: (query: UsageSummaryQuery = {}) =>
      getTransport().invoke<UsageSummary>("usage:summary", query),
    health: () => getTransport().invoke<UsageHealth>("usage:health"),
    settings: () => getTransport().invoke<UsageSettings>("usage:settings"),
    updateSettings: (patch: UsageSettingsPatch) =>
      getTransport().invoke<UsageSettings>("usage:updateSettings", patch),
    delete: (request: { confirmation: string; from?: number; to?: number }) =>
      getTransport().invoke<{ deleted: true }>("usage:deleteAll", {
        ...request,
      }),
    deleteAll: () => api.usage.delete({ confirmation: "delete-usage-data" }),
    deleteRange: (from: number, to: number) =>
      api.usage.delete({ confirmation: "delete-usage-data", from, to }),
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
  browserDebug: {
    createArtifact: (terminalId: string, selection: BrowserSelectionV1) =>
      getTransport().invoke<BrowserDebugArtifactResponse>(
        "browser-debug:create",
        { terminalId, selection },
      ),
    deleteArtifact: (artifactId: string) =>
      getTransport().invoke<void>("browser-debug:delete", { artifactId }),
    handoff: (artifactId: string) =>
      getTransport().invoke<BrowserDebugHandoffResponse>(
        "browser-debug:handoff",
        { artifactId },
      ),
    uploadPng: (artifactId: string, png: Blob) => {
      const upload = getTransport().uploadBrowserDebugPng;
      if (!upload)
        throw new Error(
          "Browser screenshot upload is unsupported by this transport",
        );
      return upload.call(getTransport(), artifactId, png);
    },
  },
};
