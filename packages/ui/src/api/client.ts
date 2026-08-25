// Transport-agnostic API client — delegates through the active Transport singleton.
import { getTransport } from "./transport.js";
import type {
  ExplorerLanguageFilter,
  FsListResponse,
  HealthResponse,
  LanguageFilesResponse,
} from "./fs-types.js";
import type { CommandHistoryEntry } from "@/lib/command-history.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";
export { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isGitUnavailableError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.code === "GIT_NOT_INITIALIZED"
  );
}

const PROJECT_TARGET_ERROR_CODES = [
  "WORKSPACE_PROJECT_NOT_FOUND",
  "WORKSPACE_TARGET_UNREGISTERED",
  "WORKSPACE_TARGET_UNAVAILABLE",
  "WORKSPACE_TARGET_INVALID_PATH",
] as const;

/** Returns true when an API value identifies the selected project target. */
export function isProjectTargetError(
  ...values: Array<string | null | undefined>
): boolean {
  const text = values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toUpperCase();
  return (
    PROJECT_TARGET_ERROR_CODES.some((code) => text.includes(code)) ||
    ((text.includes("TARGET") || text.includes("WORKTREE")) &&
      /(UNAVAILABLE|UNREGISTERED|INVALID_PATH)/.test(text))
  );
}

export interface SessionInfo {
  id: string;
  /** Opaque concrete PTY identity used to reject stale push events. */
  incarnation?: number;
  project?: string;
  command: string;
  cwd: string;
  /** Server-validated canonical worktree target, when session is target-scoped. */
  worktreePath?: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  /** Client-only marker when a live session's original target disappeared. */
  orphaned?: boolean;
  /** Server marker retained for unavailable sessions across restart. */
  targetUnavailable?: boolean;
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
  /** Owning PTY session, when the tunnel was created for a terminal port. */
  sessionId?: string;
  /** Concrete PTY identity used to reject stale ownership updates. */
  incarnation?: number;
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
  incarnation: number;
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

// ── Host resource monitoring ────────────────────────────────────────────────

export type AvailabilityState =
  | "available"
  | "unsupported"
  | "permissionDenied"
  | "temporarilyUnavailable"
  | "stale";

export interface Availability {
  state: AvailabilityState;
  sampledAt: number;
  detailCode?: string | null;
}

export type BatteryStatus =
  | "charging"
  | "discharging"
  | "full"
  | "notCharging"
  | "unknown"
  | "mixed";

/** Additive host snapshot section; optional for clients connected to old servers. */
export interface BatterySnapshot {
  count: number;
  capacityPercent?: number | null;
  status?: BatteryStatus | null;
  remainingEnergyWh?: number | null;
  instantaneousPowerW?: number | null;
  availability: Availability;
}

export type AlertState =
  | "healthy"
  | "reclaimableCacheHigh"
  | "elevatedNoPressure"
  | "memoryPressure"
  | "oomRisk"
  | "limitedData";

export type AlertSeverity = "info" | "warning" | "critical";
export type Confidence = "low" | "medium" | "high";

export interface HostResourceAlertEvidence {
  availablePercent?: number | null;
  reclaimablePercent?: number | null;
  psiSomeAvg10?: number | null;
  psiFullAvg10?: number | null;
  cgroupOomDelta: boolean;
}

export interface HostResourceAlert {
  state: AlertState;
  severity: AlertSeverity;
  incidentId?: string | null;
  openedAt?: number | null;
  updatedAt: number;
  durationSeconds: number;
  scope: string;
  confidence: Confidence;
  threshold: string;
  evidence: HostResourceAlertEvidence;
  nextAction: string;
}

export interface MemoryHostResourceAlertIncident extends HostResourceAlert {
  incidentId: string;
  openedAt: number;
  resolvedAt?: number | null;
}

export type ResourceAlertState = "temperatureHigh" | "diskFull";
export type ResourceAlertKind = "temperature" | "disk";

export interface HostResourceResourceAlertEvidence {
  temperatureSource?: string;
  temperatureLabel?: string;
  temperatureCelsius?: number;
  diskMountPoint?: string;
  diskName?: string;
  diskUsagePercent?: number;
}

/** Additive thermal/disk alert; memory alerts retain the legacy DTO above. */
export interface HostResourceResourceAlert {
  kind: ResourceAlertKind;
  key: string;
  state: ResourceAlertState;
  severity: AlertSeverity;
  incidentId: string;
  openedAt: number;
  updatedAt: number;
  durationSeconds: number;
  scope: string;
  evidence: HostResourceResourceAlertEvidence;
  threshold: string;
  nextAction: string;
  resolvedAt?: number;
}

/** Additive history response: legacy memory or thermal/disk incident. */
export type HostResourceAlertIncident =
  | MemoryHostResourceAlertIncident
  | HostResourceResourceAlert;

export interface MemoryPressure {
  some?: {
    avg10: number;
    avg60: number;
    avg300: number;
    totalMicros: number;
  } | null;
  full?: {
    avg10: number;
    avg60: number;
    avg300: number;
    totalMicros: number;
  } | null;
  availability: Availability;
}

export interface CacheAttribution {
  label:
    | "systemFileCache"
    | "cgroupFileCache"
    | "processFileRss"
    | "mountFileMappings"
    | "unattributedSharedCache";
  bytes?: number | null;
  confidence: Confidence;
  method: string;
}

export interface HostResourceSnapshotV1 {
  schemaVersion: 1;
  sampleId: string;
  sampledAt: number;
  host: {
    bootId?: string | null;
    hostname?: string | null;
    osName?: string | null;
  };
  capabilities: { linuxDeepMetrics: Availability };
  memory: {
    totalBytes?: number | null;
    availableBytes?: number | null;
    anonBytes?: number | null;
    fileCacheBytes?: number | null;
    reclaimableSlabBytes?: number | null;
    swapUsedBytes?: number | null;
    availability: Availability;
  };
  /** Added after v1; old servers omit this field. */
  battery?: BatterySnapshot | null;
  pressure: {
    memory: MemoryPressure;
  };
  cgroups: Array<{
    path: string;
    namespace: string;
    currentBytes?: number | null;
    maxBytes?: number | null;
    maxUnlimited: boolean;
    highBytes?: number | null;
    highUnlimited: boolean;
    fileCacheBytes?: number | null;
    events: Array<[string, number]>;
    pressure: MemoryPressure;
    availability: Availability;
  }>;
  processes: {
    processes: Array<{
      pid: number;
      startTicks?: number | null;
      uid?: number | null;
      name: string;
      commandSummary?: string | null;
      rssBytes?: number | null;
      anonRssBytes?: number | null;
      fileRssBytes?: number | null;
      shmemRssBytes?: number | null;
      pssBytes?: number | null;
      availability: Availability;
    }>;
    scannedCount: number;
    truncated: boolean;
    deadlineExceeded: boolean;
    skippedCount: number;
    permissionDeniedCount: number;
    invalidUtf8Count: number;
    malformedCount: number;
    disappearedCount: number;
    availability: Availability;
  };
  mountContext: {
    mountPoint: string;
    fsType?: string | null;
    freeBytes?: number | null;
    activeMappedPaths: string[];
    activeMappedPathsAvailability: Availability;
    cacheAttribution: CacheAttribution;
    availability: Availability;
  };
  alert?: HostResourceAlert | null;
  /** Additive concurrent thermal/disk incidents; the legacy alert is unchanged. */
  currentAlerts?: HostResourceResourceAlert[];
  actionCapabilities: { availability: Availability };
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
  staged: number;
  modified: number;
  untracked: number;
  hasStash: boolean;
  lastCommit: LastCommit;
  pathExists?: boolean;
  statusError?: string;
}

export interface LastCommit {
  hash: string;
  message: string;
  date: string;
}

export type UsageBucket = "hour" | "day";
export type UsageWindow = "24h" | "7d" | "30d";
/** Bounded provider model identifier. Treat as display-only opaque text. */
export type UsageModel = string;

export interface UsageSummaryQuery {
  from?: number;
  to?: number;
  window?: UsageWindow;
  bucket?: UsageBucket;
  model?: UsageModel;
}

export interface UsageTokens {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  responseCount?: number;
  durationMs?: number | null;
}

/** Privacy-safe aggregate bucket; no command, event, or conversation data. */
export interface UsageTimeBucket {
  startUtcMs: number;
  codex: UsageTokens | null;
}

export interface UsageSummary {
  range: { from: number; to: number; bucket: UsageBucket };
  codex: UsageTokens | null;
  timeSeries: UsageTimeBucket[];
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

export interface UsageRuntimeStatus {
  active: boolean;
  collector: UsageCollectorHealth;
  collectorError: string | null;
}

export type UsageCodexExporterStatus = "notConfigured" | "managed" | "conflict";

export interface UsageCollectorSetup {
  codexExporter: UsageCodexExporterStatus;
  restartRequired: boolean;
  serverRestartRequired: boolean;
}

export interface UsageSetupStatus {
  enabled: boolean;
  paused: boolean;
  collectorEnabled: boolean;
  runtime: UsageRuntimeStatus;
  collectorSetup: UsageCollectorSetup;
}

export interface UsageSettings {
  enabled: boolean;
  paused: boolean;
  detailRetentionDays: number;
  aggregateRetentionDays: number | null;
  collectorEnabled: boolean;
  runtime: UsageRuntimeStatus;
  collectorSetup: UsageCollectorSetup;
}

export interface UsageSettingsPatch {
  enabled?: boolean;
  paused?: boolean;
  detailRetentionDays?: number;
  aggregateRetentionDays?: number | null;
  collector?: UsageCollectorSettings;
  codexExporter?: boolean;
  retryCollector?: boolean;
}

export interface UsageSessionQuery {
  from?: number;
  to?: number;
  model?: UsageModel;
  limit?: number;
  cursor?: string;
}

export interface UsageSessionExecutorModel {
  model: UsageModel | null;
  responseCount: number;
  tokens: UsageTokens;
}

export interface UsageSessionSummary {
  id: string;
  startedAtUtcMs: number;
  endedAtUtcMs: number | null;
  model: UsageModel | null;
  tokens: UsageTokens;
  models: UsageSessionExecutorModel[];
}

export interface UsageSessionPage {
  range: { from: number; to: number };
  sessions: UsageSessionSummary[];
  nextCursor: string | null;
  paused: boolean;
}

export interface UsageSessionDetail {
  session: UsageSessionSummary;
  paused: boolean;
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
  hostResourcePinnedMount?: string | null;
  systemFontSize: number;
  editorFontSize: number;
  terminalFontSize?: number;
  editorZoomWheelEnabled: boolean;
  searchTextShortcut: string;
  searchFilenameShortcut: string;
  terminalWorkspaceShortcut: string;
  terminalFilePanelShortcut: string;
  projectPanelShortcut: string;
  revealActiveFileShortcut: string;
  gitPanelShortcut: string;
  portsPanelShortcut: string;
  fleetTerminalShortcut: string;
  terminalFontSizeIncreaseShortcut?: string;
  terminalFontSizeDecreaseShortcut?: string;
  terminalSuggestionsEnabled?: boolean;
  terminalAutoSwitchProjectEnabled?: boolean;
  terminalCodexNotificationsEnabled?: boolean;
  terminalCodexNotificationToastEnabled?: boolean;
  terminalCodexBrowserNotificationsEnabled?: boolean;
  terminalCodexNotificationSoundEnabled?: boolean;
  terminalCodexNotificationSoundVolume?: number;
  terminalCodexNotificationSoundPattern?: TerminalCodexNotificationSoundPattern;
  terminalScrollButtonsEnabled?: boolean;
  terminalCommitStatusEnabled?: boolean;
  terminalScrollStep?: number;
  explorerShowHidden?: boolean;
  explorerLanguageFilter?: ExplorerLanguageFilter;
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
  repositoryPath: string;
  branch: string;
  commitHash: string;
  isMain: boolean;
  isLocked: boolean;
  isDetached: boolean;
  isBare: boolean;
  isPrunable: boolean;
  isAvailable: boolean;
}

/** Project identity plus an optional registered worktree operation target. */
export interface ProjectTargetRef {
  project: string;
  /** Omitted/null selects the configured project root. */
  worktreePath?: string | null;
}

/** Backward-compatible input accepted while callers migrate to target refs. */
export type ProjectTargetInput = string | ProjectTargetRef;

export function normalizeProjectTarget(
  target: ProjectTargetInput,
): ProjectTargetRef {
  if (typeof target === "string") return { project: target };
  return target.worktreePath == null
    ? { project: target.project }
    : { project: target.project, worktreePath: target.worktreePath };
}

export function projectTargetCacheKey(target: ProjectTargetInput): string {
  const normalized = normalizeProjectTarget(target);
  return normalized.worktreePath == null
    ? "root"
    : `worktree:${normalizeProjectTargetPath(normalized.worktreePath)}`;
}

export interface ResolvedProjectTarget {
  project: string;
  configuredRoot: string;
  targetPath: string;
  targetKey: string;
  isRoot: boolean;
  available: boolean;
  worktree?: Worktree;
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
  /** Present for bulk operations that were requested against a worktree. */
  worktreePath?: string | null;
  /** Server-confirmed target disappearance, distinct from a generic Git error. */
  targetUnavailable?: boolean;
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

export interface GitUnavailableResult {
  gitAvailable: false;
  code: "GIT_NOT_INITIALIZED";
  entries: [];
  untrackedTruncated: false;
  untrackedTotal: 0;
}

export type GitDiffResult =
  | (DiffResponse & { gitAvailable: true })
  | GitUnavailableResult;

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
    status: (target: ProjectTargetInput) =>
      getTransport().invoke<GitStatus | null>(
        "projects:status",
        normalizeProjectTarget(target),
      ),
  },
  git: {
    fetch: (targets?: ProjectTargetInput[]) =>
      getTransport().invoke<GitOpResult[]>("git:fetch", targets),
    pull: (targets?: ProjectTargetInput[]) =>
      getTransport().invoke<GitOpResult[]>("git:pull", targets),
    push: (target: ProjectTargetInput, root?: string, force?: boolean) =>
      getTransport().invoke<GitOpResult>("git:push", {
        ...normalizeProjectTarget(target),
        root,
        force,
      }),
    worktrees: (project: string) =>
      getTransport().invoke<Worktree[]>("git:worktrees", project),
    roots: (target: ProjectTargetInput) =>
      getTransport().invoke<VcsRoot[]>(
        "git:roots",
        normalizeProjectTarget(target),
      ),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) =>
      getTransport().invoke<Worktree>("git:addWorktree", { project, options }),
    removeWorktree: (project: string, path: string) =>
      getTransport().invoke<void>("git:removeWorktree", { project, path }),
    branches: (target: ProjectTargetInput, root?: string) =>
      getTransport().invoke<Branch[]>("git:branches", {
        ...normalizeProjectTarget(target),
        root,
      }),
    createBranch: (
      target: ProjectTargetInput,
      options: {
        name: string;
        startPoint?: string;
        checkout?: boolean;
        root?: string;
      },
    ) =>
      getTransport().invoke<GitActionResult>("git:createBranch", {
        ...normalizeProjectTarget(target),
        options,
      }),
    checkoutBranch: (
      target: ProjectTargetInput,
      options: {
        branch: string;
        startPoint?: string;
        create?: boolean;
        strategy?: CheckoutStrategy;
        root?: string;
      },
    ) =>
      getTransport().invoke<GitActionResult>("git:checkoutBranch", {
        ...normalizeProjectTarget(target),
        options,
      }),
    deleteBranch: (
      target: ProjectTargetInput,
      options: {
        name: string;
        root?: string;
      },
    ) =>
      getTransport().invoke<GitActionResult>("git:deleteBranch", {
        ...normalizeProjectTarget(target),
        options,
      }),
    updateBranch: (
      target: ProjectTargetInput,
      branch?: string,
      root?: string,
    ) =>
      getTransport().invoke<BranchUpdateResult>("git:updateBranch", {
        ...normalizeProjectTarget(target),
        branch,
        root,
      }),
    log: (
      target: ProjectTargetInput,
      limit?: number,
      offset?: number,
      ref?: string,
      root?: string,
    ) =>
      getTransport().invoke<GitLogEntry[]>("git:log", {
        ...normalizeProjectTarget(target),
        limit,
        offset,
        ref,
        root,
      }),
    diff: (target: ProjectTargetInput, root?: string) =>
      getTransport().invoke<DiffResponse>("git:diff", {
        ...normalizeProjectTarget(target),
        root,
      }),
    untrackedFiles: (
      target: ProjectTargetInput,
      offset: number,
      limit: number,
      root?: string,
    ) =>
      getTransport().invoke<DiffFileEntry[]>("git:untrackedFiles", {
        ...normalizeProjectTarget(target),
        offset,
        limit,
        root,
      }),
    fileDiff: (target: ProjectTargetInput, path: string, root?: string) =>
      getTransport().invoke<FileDiffContent>("git:fileDiff", {
        ...normalizeProjectTarget(target),
        path,
        root,
      }),
    stage: (target: ProjectTargetInput, paths: string[], root?: string) =>
      getTransport().invoke<{ ok: boolean; error?: string }>("git:stage", {
        ...normalizeProjectTarget(target),
        paths,
        root,
      }),
    unstage: (target: ProjectTargetInput, paths: string[], root?: string) =>
      getTransport().invoke<{ ok: boolean; error?: string }>("git:unstage", {
        ...normalizeProjectTarget(target),
        paths,
        root,
      }),
    discard: (target: ProjectTargetInput, path: string, root?: string) =>
      getTransport().invoke<{ ok: boolean; error?: string }>("git:discard", {
        ...normalizeProjectTarget(target),
        path,
        root,
      }),
    discardHunk: (
      target: ProjectTargetInput,
      path: string,
      hunkIndex: number,
      root?: string,
    ) =>
      getTransport().invoke<{ ok: boolean; error?: string }>(
        "git:discardHunk",
        {
          ...normalizeProjectTarget(target),
          path,
          hunkIndex,
          root,
        },
      ),
    conflicts: (target: ProjectTargetInput, root?: string) =>
      getTransport().invoke<ConflictFile[]>("git:conflicts", {
        ...normalizeProjectTarget(target),
        root,
      }),
    resolve: (
      target: ProjectTargetInput,
      path: string,
      content: string,
      root?: string,
    ) =>
      getTransport().invoke<{ ok: boolean; error?: string }>("git:resolve", {
        ...normalizeProjectTarget(target),
        path,
        content,
        root,
      }),
    commit: (
      target: ProjectTargetInput,
      message: string,
      amend?: boolean,
      root?: string,
    ) =>
      getTransport().invoke<{ ok: boolean; hash: string; error?: string }>(
        "git:commit",
        {
          ...normalizeProjectTarget(target),
          message,
          amend,
          root,
        },
      ),
    cherryPick: (target: ProjectTargetInput, hash: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:cherryPick", {
        ...normalizeProjectTarget(target),
        hash,
        root,
      }),
    reset: (
      target: ProjectTargetInput,
      hash: string,
      mode: ResetMode,
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:reset", {
        ...normalizeProjectTarget(target),
        hash,
        mode,
        root,
      }),
    undoLastCommit: (target: ProjectTargetInput, root?: string) =>
      getTransport().invoke<GitActionResult>("git:undoLastCommit", {
        ...normalizeProjectTarget(target),
        root,
      }),
    commitFiles: (target: ProjectTargetInput, hash: string, root?: string) =>
      getTransport().invoke<DiffFileEntry[]>("git:commitFiles", {
        ...normalizeProjectTarget(target),
        hash,
        root,
      }),
    commitMessage: (target: ProjectTargetInput, hash: string, root?: string) =>
      getTransport().invoke<CommitMessageResponse>("git:commitMessage", {
        ...normalizeProjectTarget(target),
        hash,
        root,
      }),
    editCommitMessage: (
      target: ProjectTargetInput,
      hash: string,
      message: string,
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:editCommitMessage", {
        ...normalizeProjectTarget(target),
        hash,
        message,
        root,
      }),
    commitFileDiff: (
      target: ProjectTargetInput,
      hash: string,
      path: string,
      root?: string,
    ) =>
      getTransport().invoke<FileDiffContent>("git:commitFileDiff", {
        ...normalizeProjectTarget(target),
        hash,
        path,
        root,
      }),
    cherryPickCommitFiles: (
      target: ProjectTargetInput,
      hash: string,
      paths: string[],
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:cherryPickCommitFiles", {
        ...normalizeProjectTarget(target),
        hash,
        paths,
        root,
      }),
    dropCommitFiles: (
      target: ProjectTargetInput,
      hash: string,
      paths: string[],
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:dropCommitFiles", {
        ...normalizeProjectTarget(target),
        hash,
        paths,
        root,
      }),
    dropCommit: (target: ProjectTargetInput, hash: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:dropCommit", {
        ...normalizeProjectTarget(target),
        hash,
        root,
      }),
    revertCommit: (target: ProjectTargetInput, hash: string, root?: string) =>
      getTransport().invoke<GitActionResult>("git:revertCommit", {
        ...normalizeProjectTarget(target),
        hash,
        root,
      }),
    revertCommitFiles: (
      target: ProjectTargetInput,
      hash: string,
      paths: string[],
      root?: string,
    ) =>
      getTransport().invoke<GitActionResult>("git:revertCommitFiles", {
        ...normalizeProjectTarget(target),
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
      worktreePath?: string;
    }) => getTransport().invoke<SessionInfo>("terminal:create", opts),
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
    resourceSnapshot: () =>
      getTransport().invoke<HostResourceSnapshotV1>("system:resourceSnapshot"),
    resourceAlerts: (limit = 20) =>
      getTransport().invoke<HostResourceAlertIncident[]>(
        "system:resourceAlerts",
        {
          limit,
        },
      ),
  },
  usage: {
    summary: (query: UsageSummaryQuery = {}) =>
      getTransport().invoke<UsageSummary>("usage:summary", query),
    sessions: (query: UsageSessionQuery = {}) =>
      getTransport().invoke<UsageSessionPage>("usage:sessions", query),
    session: (id: string) =>
      getTransport().invoke<UsageSessionDetail>("usage:session", { id }),
    health: () => getTransport().invoke<UsageHealth>("usage:health"),
    settings: () => getTransport().invoke<UsageSettings>("usage:settings"),
    setupStatus: () =>
      getTransport().invoke<UsageSetupStatus>("usage:setupStatus"),
    updateSettings: (patch: UsageSettingsPatch) =>
      getTransport().invoke<UsageSettings>("usage:updateSettings", patch),
    configure: (patch: UsageSettingsPatch) =>
      getTransport().invoke<UsageSetupStatus>("usage:configure", patch),
    delete: (request: { confirmation: string; from?: number; to?: number }) =>
      getTransport().invoke<{ deleted: true }>("usage:deleteAll", {
        ...request,
      }),
    deleteAll: () => api.usage.delete({ confirmation: "delete-usage-data" }),
    deleteRange: (from: number, to: number) =>
      api.usage.delete({ confirmation: "delete-usage-data", from, to }),
  },
  fs: {
    list: (target: ProjectTargetInput, path: string) =>
      getTransport().invoke<FsListResponse>("fs:list", {
        ...normalizeProjectTarget(target),
        path,
      }),
    languageFiles: (target: ProjectTargetInput) =>
      getTransport().invoke<LanguageFilesResponse>(
        "fs:languageFiles",
        normalizeProjectTarget(target),
      ),
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
