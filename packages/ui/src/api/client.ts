// Transport-agnostic API client — supports explicit owner-bound createApiClient and legacy ambient delegation.
import { getTransport, type Transport } from "./transport.js";
import type {
  ExplorerLanguageFilter,
  FsEventDto,
  FsListResponse,
  FsOpResult,
  FsUploadResult,
  HealthResponse,
  LanguageFilesResponse,
} from "./fs-types.js";
import type {
  FsReadResponse,
  FsWriteResponse,
  FsPutResult,
} from "./ws-transport.js";
import type { CommandHistoryEntry } from "@/lib/command-history.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";
export { normalizeProjectTargetPath } from "@/lib/project-target-path.js";
import {
  assertOwnerMatch,
  normalizeProjectTargetRef,
  toServerProjectTarget,
  projectKey,
  projectTargetKey,
  terminalKey,
  terminalInstanceKey,
  connectionKey,
  type ConnectionRef,
  type ProfileId,
  type ProjectRef,
  type ProjectTargetRef,
  type ResourceBinding,
  type ServerProjectTarget,
  type TerminalInstanceRef,
  type TerminalRef,
  type Owned,
} from "./ownership.js";

export {
  assertOwnerMatch,
  normalizeProjectTargetRef,
  toServerProjectTarget,
  projectKey,
  projectTargetKey,
  terminalKey,
  terminalInstanceKey,
  connectionKey,
};
export type {
  ConnectionRef,
  ProfileId,
  ProjectRef,
  ProjectTargetRef,
  ResourceBinding,
  ServerProjectTarget,
  TerminalInstanceRef,
  TerminalRef,
  Owned,
};
import type {
  CancelOutcome,
  CancelRequest,
  CloseContextRequest,
  ContextCloseResult,
  ContextOpenResult,
  InvokeRequest,
  InvokeResponse,
  ListPluginsResponse,
  OpenContextRequest,
  PluginEpoch,
  PluginMetadataItem,
  PluginRevokedEvent,
  PluginUiAsset,
  PluginUiAssetRequest,
  RequestCancelResult,
} from "./plugin-types.js";
export type {
  CancelOutcome,
  CancelRequest,
  CloseContextRequest,
  ContextCloseResult,
  ContextOpenResult,
  InvokeRequest,
  InvokeResponse,
  ListPluginsResponse,
  OpenContextRequest,
  PluginEpoch,
  PluginMetadataItem,
  PluginRevokedEvent,
  PluginUiAsset,
  PluginUiAssetRequest,
  RequestCancelResult,
};
import type {
  AbandonSessionRequest,
  CreateItemRequest,
  CreateNoteRequest,
  CreateSessionRequest,
  DeleteItemRequest,
  DeleteNoteRequest,
  EndSessionRequest,
  EventsDto,
  EventsQuery,
  ItemDto,
  LinkDto,
  LinkResourceRequest,
  MutationDto,
  NoteDto,
  OverviewDto,
  PatchItemRequest,
  PurgeDto,
  PurgeHistoryRequest,
  SessionDto,
  TombstoneDto,
  UnlinkResourceRequest,
} from "./workflow-types.js";
export * from "./workflow-types.js";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
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
  /** Optional server-owned runtime label. */
  name?: string;
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

export interface SettingsImportResponse {
  imported: boolean;
  fileName: string;
  backupFileName: string;
  workspaceName?: string;
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
  terminalIncarnation: number;
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
// ── Terminal Idle Suspend Types ───────────────────────────────────────────────

export type IdleSuspendCoordinatorState =
  | "disabled"
  | "watching"
  | "armed"
  | "finalCheck"
  | "handedOff"
  | "suppressed"
  | "failed"
  | "resumed";

export interface IdleSuspendFleetSnapshot {
  generation: number;
  liveCount: number;
  creatingCount: number;
  restartPendingCount: number;
  quiescent?: boolean;
  disposing: boolean;
  closing?: boolean;
  handoffActive: boolean;
}

export type IdleSuspendOutcome =
  | { type: "resumedSuccessfully"; resumedAtMs: number }
  | { type: "rejectedFleetActive"; reason: string }
  | { type: "blockedByInhibitor"; inhibitor: string }
  | { type: "unsupportedCapability"; detail: string }
  | { type: "executionFailed"; error: string };

export type IdleSuspendAutomaticPolicy = "empty-fleet" | "agent-activity";

export type IdleSuspendActivityReasonCode =
  | "recentInput"
  | "recentOutput"
  | "recentNetwork"
  | "agentChanged"
  | "lifecycleBusy"
  | "quiet"
  | "procAccess"
  | "scanLimit"
  | "scanTimeout"
  | "socketDiagnostics"
  | "unsupportedTransport"
  | "namespaceMismatch"
  | "staleObservation"
  | "identityUncertain"
  | "counterOverflow"
  | "reconciling"
  | "epochSpent";

export type IdleSuspendActivityMeasurementState =
  | "initializing"
  | "available"
  | "unavailable";

export type IdleSuspendMeasurementWarningReasonCode =
  | "procAccess"
  | "scanLimit"
  | "scanTimeout"
  | "socketDiagnostics"
  | "unsupportedTransport"
  | "namespaceMismatch"
  | "staleObservation"
  | "identityUncertain"
  | "counterOverflow"
  | "reconciling";

export interface IdleSuspendWarningProcessV1 {
  pid: number;
  executableIdentity: string | null;
}

export interface IdleSuspendMeasurementWarningV1 {
  reasonCode: IdleSuspendMeasurementWarningReasonCode;
  blockedSinceMs: number;
  processes: IdleSuspendWarningProcessV1[];
  processesTruncated: boolean;
}

export interface IdleSuspendActivityStatusV1 {
  measurementState: IdleSuspendActivityMeasurementState;
  reasonCode: IdleSuspendActivityReasonCode | null;
  recognizedAgentCount: number | null;
  monitoredTerminalCount: number | null;
  sampledAtMs: number | null;
  lastActivityAtMs: number | null;
  networkCoverage: "tcp4-tcp6";
  measurementWarning: IdleSuspendMeasurementWarningV1 | null;
}

export interface IdleSuspendStatusV1 {
  version: 1;
  statusRevision: number;
  state: IdleSuspendCoordinatorState;
  automaticPolicy: IdleSuspendAutomaticPolicy;
  enabled: boolean;
  timingMutable: boolean;
  timingMutableReason?: string | null;
  capabilityCode: string;
  currentEpoch: number;
  quietPeriodSeconds: number;
  wakeAfterSeconds: number;
  minQuietPeriodSeconds: number;
  maxQuietPeriodSeconds: number;
  minWakeAfterSeconds: number;
  maxWakeAfterSeconds: number;
  fleetSnapshot: IdleSuspendFleetSnapshot;
  armDeadlineMs?: number | null;
  lastOutcome?: IdleSuspendOutcome | null;
  detail?: string | null;
  activity: IdleSuspendActivityStatusV1 | null;
  timestampMs: number;
}

const COORDINATOR_STATES: Record<string, true> = {
  disabled: true,
  watching: true,
  armed: true,
  finalCheck: true,
  handedOff: true,
  suppressed: true,
  failed: true,
  resumed: true,
};

const ACTIVITY_REASON_CODES: Record<string, true> = {
  recentInput: true,
  recentOutput: true,
  recentNetwork: true,
  agentChanged: true,
  lifecycleBusy: true,
  quiet: true,
  procAccess: true,
  scanLimit: true,
  scanTimeout: true,
  socketDiagnostics: true,
  unsupportedTransport: true,
  namespaceMismatch: true,
  staleObservation: true,
  identityUncertain: true,
  counterOverflow: true,
  reconciling: true,
  epochSpent: true,
};

const WARNING_REASON_CODES: Record<string, true> = {
  procAccess: true,
  scanLimit: true,
  scanTimeout: true,
  socketDiagnostics: true,
  unsupportedTransport: true,
  namespaceMismatch: true,
  staleObservation: true,
  identityUncertain: true,
  counterOverflow: true,
  reconciling: true,
};

const MEASUREMENT_STATES: Record<string, true> = {
  initializing: true,
  available: true,
  unavailable: true,
};

function isNonNegativeSafeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isSafeInteger(val) && val >= 0;
}

function isPositiveSafeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isSafeInteger(val) && val > 0;
}

function isValidEpochMs(val: unknown): val is number {
  return (
    typeof val === "number" &&
    Number.isSafeInteger(val) &&
    val >= 0 &&
    val <= 8640000000000000
  );
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

const textEncoder = new TextEncoder();

function isValidExecutableIdentity(val: unknown): val is string | null {
  if (val === null) return true;
  if (typeof val !== "string") return false;
  if (val.length === 0) return false;
  if (/[\x00-\x1F\x7F]/.test(val)) return false;
  return textEncoder.encode(val).length <= 256;
}

function decodeMeasurementWarning(
  val: unknown,
): IdleSuspendMeasurementWarningV1 {
  if (!isPlainObject(val)) {
    throw new Error("Invalid measurementWarning: expected plain object");
  }
  if (
    typeof val.reasonCode !== "string" ||
    !WARNING_REASON_CODES[val.reasonCode]
  ) {
    throw new Error("Invalid measurementWarning: invalid reasonCode");
  }
  if (!isValidEpochMs(val.blockedSinceMs)) {
    throw new Error("Invalid measurementWarning: invalid blockedSinceMs");
  }
  if (typeof val.processesTruncated !== "boolean") {
    throw new Error("Invalid measurementWarning: invalid processesTruncated");
  }
  if (!Array.isArray(val.processes) || val.processes.length > 32) {
    throw new Error("Invalid measurementWarning: invalid processes array");
  }
  const processes: IdleSuspendWarningProcessV1[] = [];
  let prevPid = 0;
  for (let i = 0; i < val.processes.length; i++) {
    const item = val.processes[i];
    if (!isPlainObject(item)) {
      throw new Error(
        "Invalid measurementWarning process: expected plain object",
      );
    }
    if (!isPositiveSafeInteger(item.pid)) {
      throw new Error("Invalid measurementWarning process: invalid pid");
    }
    if (item.pid <= prevPid) {
      throw new Error(
        "Invalid measurementWarning process: pids must be strictly ascending",
      );
    }
    prevPid = item.pid;
    if (!isValidExecutableIdentity(item.executableIdentity)) {
      throw new Error(
        "Invalid measurementWarning process: invalid executableIdentity",
      );
    }
    processes.push({
      pid: item.pid,
      executableIdentity: item.executableIdentity,
    });
  }

  return {
    reasonCode: val.reasonCode as IdleSuspendMeasurementWarningReasonCode,
    blockedSinceMs: val.blockedSinceMs,
    processes,
    processesTruncated: val.processesTruncated,
  };
}

function decodeActivityStatus(val: unknown): IdleSuspendActivityStatusV1 {
  if (!isPlainObject(val)) {
    throw new Error("Invalid activity: expected plain object");
  }
  if (
    typeof val.measurementState !== "string" ||
    !MEASUREMENT_STATES[val.measurementState]
  ) {
    throw new Error("Invalid activity: invalid measurementState");
  }
  const measurementState =
    val.measurementState as IdleSuspendActivityMeasurementState;

  let reasonCode: IdleSuspendActivityReasonCode | null = null;
  if (val.reasonCode !== null && val.reasonCode !== undefined) {
    if (
      typeof val.reasonCode !== "string" ||
      !ACTIVITY_REASON_CODES[val.reasonCode]
    ) {
      throw new Error("Invalid activity: invalid reasonCode");
    }
    reasonCode = val.reasonCode as IdleSuspendActivityReasonCode;
  }

  let recognizedAgentCount: number | null = null;
  if (
    val.recognizedAgentCount !== null &&
    val.recognizedAgentCount !== undefined
  ) {
    if (!isNonNegativeSafeInteger(val.recognizedAgentCount)) {
      throw new Error("Invalid activity: invalid recognizedAgentCount");
    }
    recognizedAgentCount = val.recognizedAgentCount;
  }

  let monitoredTerminalCount: number | null = null;
  if (
    val.monitoredTerminalCount !== null &&
    val.monitoredTerminalCount !== undefined
  ) {
    if (!isNonNegativeSafeInteger(val.monitoredTerminalCount)) {
      throw new Error("Invalid activity: invalid monitoredTerminalCount");
    }
    monitoredTerminalCount = val.monitoredTerminalCount;
  }

  let sampledAtMs: number | null = null;
  if (val.sampledAtMs !== null && val.sampledAtMs !== undefined) {
    if (!isValidEpochMs(val.sampledAtMs)) {
      throw new Error("Invalid activity: invalid sampledAtMs");
    }
    sampledAtMs = val.sampledAtMs;
  }

  let lastActivityAtMs: number | null = null;
  if (val.lastActivityAtMs !== null && val.lastActivityAtMs !== undefined) {
    if (!isValidEpochMs(val.lastActivityAtMs)) {
      throw new Error("Invalid activity: invalid lastActivityAtMs");
    }
    lastActivityAtMs = val.lastActivityAtMs;
  }

  if (val.networkCoverage !== "tcp4-tcp6") {
    throw new Error("Invalid activity: networkCoverage must be 'tcp4-tcp6'");
  }

  let measurementWarning: IdleSuspendMeasurementWarningV1 | null = null;
  if (measurementState === "available") {
    if (val.measurementWarning !== null) {
      throw new Error(
        "Invalid activity: measurementWarning must be null when available",
      );
    }
  } else {
    if (
      val.measurementWarning === null ||
      val.measurementWarning === undefined
    ) {
      throw new Error(
        "Invalid activity: measurementWarning required when initializing or unavailable",
      );
    }
    measurementWarning = decodeMeasurementWarning(val.measurementWarning);
  }

  return {
    measurementState,
    reasonCode,
    recognizedAgentCount,
    monitoredTerminalCount,
    sampledAtMs,
    lastActivityAtMs,
    networkCoverage: "tcp4-tcp6",
    measurementWarning,
  };
}

function decodeFleetSnapshot(val: unknown): IdleSuspendFleetSnapshot {
  if (!isPlainObject(val)) {
    throw new Error("Invalid fleetSnapshot: expected plain object");
  }
  if (!isNonNegativeSafeInteger(val.generation)) {
    throw new Error("Invalid fleetSnapshot: invalid generation");
  }
  if (!isNonNegativeSafeInteger(val.liveCount)) {
    throw new Error("Invalid fleetSnapshot: invalid liveCount");
  }
  if (!isNonNegativeSafeInteger(val.creatingCount)) {
    throw new Error("Invalid fleetSnapshot: invalid creatingCount");
  }
  if (!isNonNegativeSafeInteger(val.restartPendingCount)) {
    throw new Error("Invalid fleetSnapshot: invalid restartPendingCount");
  }
  if (typeof val.disposing !== "boolean") {
    throw new Error("Invalid fleetSnapshot: invalid disposing");
  }
  if (typeof val.handoffActive !== "boolean") {
    throw new Error("Invalid fleetSnapshot: invalid handoffActive");
  }
  if (val.quiescent !== undefined && typeof val.quiescent !== "boolean") {
    throw new Error("Invalid fleetSnapshot: invalid quiescent");
  }
  if (val.closing !== undefined && typeof val.closing !== "boolean") {
    throw new Error("Invalid fleetSnapshot: invalid closing");
  }
  return {
    generation: val.generation,
    liveCount: val.liveCount,
    creatingCount: val.creatingCount,
    restartPendingCount: val.restartPendingCount,
    disposing: val.disposing,
    handoffActive: val.handoffActive,
    quiescent: val.quiescent as boolean | undefined,
    closing: val.closing as boolean | undefined,
    ...(isNonNegativeSafeInteger((val as Record<string, unknown>).runningCount)
      ? {
          runningCount: (val as Record<string, unknown>).runningCount as number,
        }
      : {}),
  };
}

export function decodeIdleSuspendStatusV1(value: unknown): IdleSuspendStatusV1 {
  if (!isPlainObject(value)) {
    throw new Error("Invalid idle suspend status: expected plain object");
  }

  if (value.version !== 1) {
    throw new Error("Invalid idle suspend status: expected version 1");
  }
  if (!isNonNegativeSafeInteger(value.statusRevision)) {
    throw new Error("Invalid idle suspend status: invalid statusRevision");
  }
  if (typeof value.state !== "string" || !COORDINATOR_STATES[value.state]) {
    throw new Error("Invalid idle suspend status: invalid coordinator state");
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error("Invalid idle suspend status: invalid enabled");
  }
  if (typeof value.timingMutable !== "boolean") {
    throw new Error("Invalid idle suspend status: invalid timingMutable");
  }
  if (
    value.timingMutableReason !== undefined &&
    value.timingMutableReason !== null &&
    typeof value.timingMutableReason !== "string"
  ) {
    throw new Error("Invalid idle suspend status: invalid timingMutableReason");
  }
  if (typeof value.capabilityCode !== "string") {
    throw new Error("Invalid idle suspend status: invalid capabilityCode");
  }
  if (!isNonNegativeSafeInteger(value.currentEpoch)) {
    throw new Error("Invalid idle suspend status: invalid currentEpoch");
  }
  if (!isNonNegativeSafeInteger(value.quietPeriodSeconds)) {
    throw new Error("Invalid idle suspend status: invalid quietPeriodSeconds");
  }
  if (!isNonNegativeSafeInteger(value.wakeAfterSeconds)) {
    throw new Error("Invalid idle suspend status: invalid wakeAfterSeconds");
  }
  if (!isNonNegativeSafeInteger(value.minQuietPeriodSeconds)) {
    throw new Error(
      "Invalid idle suspend status: invalid minQuietPeriodSeconds",
    );
  }
  if (!isNonNegativeSafeInteger(value.maxQuietPeriodSeconds)) {
    throw new Error(
      "Invalid idle suspend status: invalid maxQuietPeriodSeconds",
    );
  }
  if (!isNonNegativeSafeInteger(value.minWakeAfterSeconds)) {
    throw new Error("Invalid idle suspend status: invalid minWakeAfterSeconds");
  }
  if (!isNonNegativeSafeInteger(value.maxWakeAfterSeconds)) {
    throw new Error("Invalid idle suspend status: invalid maxWakeAfterSeconds");
  }
  if (
    value.armDeadlineMs !== undefined &&
    value.armDeadlineMs !== null &&
    !isValidEpochMs(value.armDeadlineMs)
  ) {
    throw new Error("Invalid idle suspend status: invalid armDeadlineMs");
  }
  if (
    value.detail !== undefined &&
    value.detail !== null &&
    typeof value.detail !== "string"
  ) {
    throw new Error("Invalid idle suspend status: invalid detail");
  }
  if (!isValidEpochMs(value.timestampMs)) {
    throw new Error("Invalid idle suspend status: invalid timestampMs");
  }

  const fleetSnapshot = decodeFleetSnapshot(value.fleetSnapshot);

  const hasAutomaticPolicy = Object.prototype.hasOwnProperty.call(
    value,
    "automaticPolicy",
  );
  const hasActivity = Object.prototype.hasOwnProperty.call(value, "activity");

  let automaticPolicy: IdleSuspendAutomaticPolicy;
  let activity: IdleSuspendActivityStatusV1 | null;

  if (!hasAutomaticPolicy && !hasActivity) {
    automaticPolicy = "empty-fleet";
    activity = null;
  } else if (!hasAutomaticPolicy || !hasActivity) {
    throw new Error(
      "Invalid idle suspend status: partial additive fields (one of automaticPolicy/activity missing)",
    );
  } else {
    if (value.automaticPolicy === undefined || value.activity === undefined) {
      throw new Error(
        "Invalid idle suspend status: additive fields cannot be undefined",
      );
    }
    if (value.automaticPolicy === "empty-fleet") {
      if (value.activity !== null) {
        throw new Error(
          "Invalid idle suspend status: activity must be null for empty-fleet policy",
        );
      }
      automaticPolicy = "empty-fleet";
      activity = null;
    } else if (value.automaticPolicy === "agent-activity") {
      if (value.activity === null || typeof value.activity !== "object") {
        throw new Error(
          "Invalid idle suspend status: activity object required for agent-activity policy",
        );
      }
      automaticPolicy = "agent-activity";
      activity = decodeActivityStatus(value.activity);
    } else {
      throw new Error("Invalid idle suspend status: unknown automaticPolicy");
    }
  }

  return {
    version: 1,
    statusRevision: value.statusRevision as number,
    state: value.state as IdleSuspendCoordinatorState,
    automaticPolicy,
    enabled: value.enabled as boolean,
    timingMutable: value.timingMutable as boolean,
    timingMutableReason: (value.timingMutableReason ?? null) as string | null,
    capabilityCode: value.capabilityCode as string,
    currentEpoch: value.currentEpoch as number,
    quietPeriodSeconds: value.quietPeriodSeconds as number,
    wakeAfterSeconds: value.wakeAfterSeconds as number,
    minQuietPeriodSeconds: value.minQuietPeriodSeconds as number,
    maxQuietPeriodSeconds: value.maxQuietPeriodSeconds as number,
    minWakeAfterSeconds: value.minWakeAfterSeconds as number,
    maxWakeAfterSeconds: value.maxWakeAfterSeconds as number,
    fleetSnapshot,
    armDeadlineMs: (value.armDeadlineMs ?? null) as number | null,
    lastOutcome: (value.lastOutcome ?? null) as IdleSuspendOutcome | null,
    detail: (value.detail ?? null) as string | null,
    activity,
    timestampMs: value.timestampMs as number,
  };
}

export function isIdleSuspendStatusV1(
  value: unknown,
): value is IdleSuspendStatusV1 {
  try {
    decodeIdleSuspendStatusV1(value);
    return true;
  } catch {
    return false;
  }
}

export function asIdleSuspendStatusV1(
  value: unknown,
): IdleSuspendStatusV1 | null {
  try {
    return decodeIdleSuspendStatusV1(value);
  } catch {
    return null;
  }
}

export interface IdleSuspendTimingPatchRequest {
  quietPeriodSeconds: number;
  wakeAfterSeconds: number;
}

export interface IdleSuspendTimingPatchResponse {
  version: 1;
  changed: boolean;
  statusRevision: number;
  quietPeriodSeconds: number;
  wakeAfterSeconds: number;
}

export interface ForceSuspendRequest {
  wakeAfterSeconds: number;
  force: boolean;
}

export interface ForceSuspendAcceptedResponse {
  version: number;
  requestId: string;
  statusRevision: number;
  state: "handedOff" | string;
  wakeAfterSeconds: number;
  forced: boolean;
  fleetSnapshot: IdleSuspendFleetSnapshot;
}

export interface IdleSuspendConflictResponse {
  error: string;
  code: string;
  activeSessionCount: number;
  fleetSnapshot: IdleSuspendFleetSnapshot;
}

export function isForceSuspendAcceptedResponse(
  value: unknown,
): value is ForceSuspendAcceptedResponse {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.version === "number" &&
    typeof s.requestId === "string" &&
    typeof s.statusRevision === "number" &&
    typeof s.state === "string" &&
    typeof s.wakeAfterSeconds === "number" &&
    typeof s.forced === "boolean" &&
    typeof s.fleetSnapshot === "object" &&
    s.fleetSnapshot !== null
  );
}

export function isIdleSuspendConflictResponse(
  value: unknown,
): value is IdleSuspendConflictResponse {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.error === "string" &&
    typeof s.code === "string" &&
    typeof s.activeSessionCount === "number" &&
    typeof s.fleetSnapshot === "object" &&
    s.fleetSnapshot !== null
  );
}

export function asIdleSuspendConflictResponse(
  error: unknown,
): IdleSuspendConflictResponse | null {
  if (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    error.details
  ) {
    if (isIdleSuspendConflictResponse(error.details)) {
      return error.details;
    }
  }
  return null;
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

/** Backward-compatible input accepted while callers migrate to qualified target refs. */
export type ProjectTargetInput =
  | string
  | { project: string; worktreePath?: string | null; profileId?: string }
  | ProjectTargetRef;

export function normalizeProjectTarget(target: ProjectTargetInput): {
  project: string;
  worktreePath?: string;
  profileId?: string;
} {
  if (typeof target === "string") return { project: target };
  const worktreePath =
    target.worktreePath != null && target.worktreePath.trim() !== ""
      ? normalizeProjectTargetPath(target.worktreePath)
      : undefined;
  return {
    project: target.project,
    ...(worktreePath ? { worktreePath } : {}),
    ...(target.profileId ? { profileId: target.profileId } : {}),
  };
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

export function createApiClient(
  owner: ConnectionRef,
  transport: Transport = defaultAmbientTransport,
): ApiClient {
  function toWireTarget(target: ProjectTargetInput): ServerProjectTarget {
    if (
      typeof target === "object" &&
      target !== null &&
      "profileId" in target &&
      target.profileId &&
      owner.profileId
    ) {
      assertOwnerMatch(owner, target as ProjectRef, "project-target");
    }
    const norm = normalizeProjectTarget(target);
    return {
      project: norm.project,
      ...(norm.worktreePath ? { worktreePath: norm.worktreePath } : {}),
    };
  }

  function toWireTargetList(
    targets?: ProjectTargetInput[],
  ): ServerProjectTarget[] | undefined {
    if (!targets) return undefined;
    return targets.map(toWireTarget);
  }

  const usageDelete = (request: {
    confirmation: string;
    from?: number;
    to?: number;
  }) =>
    transport.invoke<{ deleted: true }>("usage:deleteAll", {
      ...request,
    });

  return {
    owner,
    transport,
    workspace: {
      get: () => transport.invoke<WorkspaceInfo>("workspace:get"),
      switch: (path: string) =>
        transport.invoke<WorkspaceInfo>("workspace:switch", path),
      known: () => transport.invoke<KnownWorkspacesResponse>("workspace:known"),
      addKnown: (path: string) =>
        transport.invoke<KnownWorkspace>("workspace:addKnown", path),
      removeKnown: (path: string) =>
        transport.invoke<{ removed: boolean }>("workspace:removeKnown", path),
      status: () => transport.invoke<WorkspaceStatus>("workspace:status"),
      init: (path: string) =>
        transport.invoke<{ name: string; root: string }>(
          "workspace:init",
          path,
        ),
      discover: (path: string) =>
        transport.invoke<DiscoverResponse>("workspace:discover", path),
    },
    globalConfig: {
      get: () => transport.invoke<GlobalConfig>("globalConfig:get"),
      updateDefaults: (defaults: { workspace?: string }) =>
        transport.invoke<{ updated: true }>(
          "globalConfig:updateDefaults",
          defaults,
        ),
      updateUi: (ui: Partial<UiConfig>) =>
        transport.invoke<{ updated: true }>("globalConfig:updateUi", ui),
    },
    projects: {
      list: () => transport.invoke<ProjectWithStatus[]>("projects:list"),
      get: (name: string) =>
        transport.invoke<ProjectWithStatus>("projects:get", name),
      status: (target: ProjectTargetInput) =>
        transport.invoke<GitStatus | null>(
          "projects:status",
          toWireTarget(target),
        ),
    },
    git: {
      fetch: (targets?: ProjectTargetInput[]) =>
        transport.invoke<GitOpResult[]>("git:fetch", toWireTargetList(targets)),
      pull: (targets?: ProjectTargetInput[]) =>
        transport.invoke<GitOpResult[]>("git:pull", toWireTargetList(targets)),
      push: (target: ProjectTargetInput, root?: string, force?: boolean) =>
        transport.invoke<GitOpResult>("git:push", {
          ...toWireTarget(target),
          root,
          force,
        }),
      worktrees: (project: string) =>
        transport.invoke<Worktree[]>("git:worktrees", project),
      roots: (target: ProjectTargetInput) =>
        transport.invoke<VcsRoot[]>("git:roots", toWireTarget(target)),
      addWorktree: (
        project: string,
        options: { path: string; branch: string; createBranch?: boolean },
      ) => transport.invoke<Worktree>("git:addWorktree", { project, options }),
      removeWorktree: (project: string, path: string) =>
        transport.invoke<void>("git:removeWorktree", { project, path }),
      branches: (target: ProjectTargetInput, root?: string) =>
        transport.invoke<Branch[]>("git:branches", {
          ...toWireTarget(target),
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
        transport.invoke<GitActionResult>("git:createBranch", {
          ...toWireTarget(target),
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
        transport.invoke<GitActionResult>("git:checkoutBranch", {
          ...toWireTarget(target),
          options,
        }),
      deleteBranch: (
        target: ProjectTargetInput,
        options: {
          name: string;
          root?: string;
        },
      ) =>
        transport.invoke<GitActionResult>("git:deleteBranch", {
          ...toWireTarget(target),
          options,
        }),
      updateBranch: (
        target: ProjectTargetInput,
        branch?: string,
        root?: string,
      ) =>
        transport.invoke<BranchUpdateResult>("git:updateBranch", {
          ...toWireTarget(target),
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
        transport.invoke<GitLogEntry[]>("git:log", {
          ...toWireTarget(target),
          limit,
          offset,
          ref,
          root,
        }),
      diff: (target: ProjectTargetInput, root?: string) =>
        transport.invoke<DiffResponse>("git:diff", {
          ...toWireTarget(target),
          root,
        }),
      untrackedFiles: (
        target: ProjectTargetInput,
        offset: number,
        limit: number,
        root?: string,
      ) =>
        transport.invoke<DiffFileEntry[]>("git:untrackedFiles", {
          ...toWireTarget(target),
          offset,
          limit,
          root,
        }),
      fileDiff: (target: ProjectTargetInput, path: string, root?: string) =>
        transport.invoke<FileDiffContent>("git:fileDiff", {
          ...toWireTarget(target),
          path,
          root,
        }),
      stage: (target: ProjectTargetInput, paths: string[], root?: string) =>
        transport.invoke<{ ok: boolean; error?: string }>("git:stage", {
          ...toWireTarget(target),
          paths,
          root,
        }),
      unstage: (target: ProjectTargetInput, paths: string[], root?: string) =>
        transport.invoke<{ ok: boolean; error?: string }>("git:unstage", {
          ...toWireTarget(target),
          paths,
          root,
        }),
      discard: (target: ProjectTargetInput, path: string, root?: string) =>
        transport.invoke<{ ok: boolean; error?: string }>("git:discard", {
          ...toWireTarget(target),
          path,
          root,
        }),
      discardHunk: (
        target: ProjectTargetInput,
        path: string,
        hunkIndex: number,
        root?: string,
      ) =>
        transport.invoke<{ ok: boolean; error?: string }>("git:discardHunk", {
          ...toWireTarget(target),
          path,
          hunkIndex,
          root,
        }),
      conflicts: (target: ProjectTargetInput, root?: string) =>
        transport.invoke<ConflictFile[]>("git:conflicts", {
          ...toWireTarget(target),
          root,
        }),
      resolve: (
        target: ProjectTargetInput,
        path: string,
        content: string,
        root?: string,
      ) =>
        transport.invoke<{ ok: boolean; error?: string }>("git:resolve", {
          ...toWireTarget(target),
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
        transport.invoke<{ ok: boolean; hash: string; error?: string }>(
          "git:commit",
          {
            ...toWireTarget(target),
            message,
            amend,
            root,
          },
        ),
      cherryPick: (target: ProjectTargetInput, hash: string, root?: string) =>
        transport.invoke<GitActionResult>("git:cherryPick", {
          ...toWireTarget(target),
          hash,
          root,
        }),
      reset: (
        target: ProjectTargetInput,
        hash: string,
        mode: ResetMode,
        root?: string,
      ) =>
        transport.invoke<GitActionResult>("git:reset", {
          ...toWireTarget(target),
          hash,
          mode,
          root,
        }),
      undoLastCommit: (target: ProjectTargetInput, root?: string) =>
        transport.invoke<GitActionResult>("git:undoLastCommit", {
          ...toWireTarget(target),
          root,
        }),
      commitFiles: (target: ProjectTargetInput, hash: string, root?: string) =>
        transport.invoke<DiffFileEntry[]>("git:commitFiles", {
          ...toWireTarget(target),
          hash,
          root,
        }),
      commitMessage: (
        target: ProjectTargetInput,
        hash: string,
        root?: string,
      ) =>
        transport.invoke<CommitMessageResponse>("git:commitMessage", {
          ...toWireTarget(target),
          hash,
          root,
        }),
      editCommitMessage: (
        target: ProjectTargetInput,
        hash: string,
        message: string,
        root?: string,
      ) =>
        transport.invoke<GitActionResult>("git:editCommitMessage", {
          ...toWireTarget(target),
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
        transport.invoke<FileDiffContent>("git:commitFileDiff", {
          ...toWireTarget(target),
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
        transport.invoke<GitActionResult>("git:cherryPickCommitFiles", {
          ...toWireTarget(target),
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
        transport.invoke<GitActionResult>("git:dropCommitFiles", {
          ...toWireTarget(target),
          hash,
          paths,
          root,
        }),
      dropCommit: (target: ProjectTargetInput, hash: string, root?: string) =>
        transport.invoke<GitActionResult>("git:dropCommit", {
          ...toWireTarget(target),
          hash,
          root,
        }),
      revertCommit: (target: ProjectTargetInput, hash: string, root?: string) =>
        transport.invoke<GitActionResult>("git:revertCommit", {
          ...toWireTarget(target),
          hash,
          root,
        }),
      revertCommitFiles: (
        target: ProjectTargetInput,
        hash: string,
        paths: string[],
        root?: string,
      ) =>
        transport.invoke<GitActionResult>("git:revertCommitFiles", {
          ...toWireTarget(target),
          hash,
          paths,
          root,
        }),
    },
    config: {
      get: () => transport.invoke<DamHopperConfig>("config:get"),
      update: (config: DamHopperConfig) =>
        transport.invoke<DamHopperConfig>("config:update", config),
      updateProject: (name: string, data: Partial<ProjectConfig>) =>
        transport.invoke<ProjectConfig>("config:updateProject", {
          name,
          patch: data,
        }),
    },
    settings: {
      clearCache: () => transport.invoke<{ cleared: boolean }>("cache:clear"),
      reset: () => transport.invoke<{ reset: boolean }>("workspace:reset"),
      exportConfig: () => transport.invoke<string>("settings:export"),
      importConfig: (tomlContent: string) =>
        transport.invoke<SettingsImportResponse>(
          "settings:import",
          tomlContent,
        ),
    },
    diagnostics: {
      export: (request: DiagnosticExportRequest) =>
        transport.invoke<DiagnosticExportResponse>(
          "diagnostics:export",
          request,
        ),
    },
    commands: {
      search: (query: string, projectType?: string, limit?: number) =>
        transport.invoke<SearchResult[]>("commands:search", {
          query,
          projectType,
          limit,
        }),
      list: (projectType: string) =>
        transport.invoke<SearchResult[]>("commands:list", { projectType }),
    },
    agentStore: {
      list: (category?: AgentItemCategory) =>
        transport.invoke<AgentStoreItem[]>(
          "agent-store:list",
          category ? { category } : undefined,
        ),
      get: (name: string, category: AgentItemCategory) =>
        transport.invoke<AgentStoreItem | null>("agent-store:get", {
          name,
          category,
        }),
      getContent: (
        name: string,
        category: AgentItemCategory,
        fileName?: string,
      ) =>
        transport.invoke<string>("agent-store:getContent", {
          name,
          category,
          fileName,
        }),
      remove: (name: string, category: AgentItemCategory) =>
        transport.invoke<{ removed: boolean }>("agent-store:remove", {
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
        transport.invoke<ShipResult>("agent-store:ship", {
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
        transport.invoke<ShipResult>("agent-store:unship", {
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
        transport.invoke<ShipResult>("agent-store:absorb", {
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
        transport.invoke<ShipResult[]>("agent-store:bulkShip", {
          items,
          targets,
          method,
        }),
      matrix: () => transport.invoke<DistributionMatrix>("agent-store:matrix"),
      scan: () =>
        transport.invoke<ProjectAgentScanResult[]>("agent-store:scan"),
      health: () => transport.invoke<HealthCheckResult>("agent-store:health"),
    },
    agentMemory: {
      list: (projectName: string) =>
        transport.invoke<Record<AgentType, string | null>>(
          "agent-memory:list",
          { projectName },
        ),
      get: (projectName: string, agent: AgentType) =>
        transport.invoke<string | null>("agent-memory:get", {
          projectName,
          agent,
        }),
      update: (projectName: string, agent: AgentType, content: string) =>
        transport.invoke<{ updated: boolean }>("agent-memory:update", {
          projectName,
          agent,
          content,
        }),
      templates: () =>
        transport.invoke<MemoryTemplateInfo[]>("agent-memory:templates"),
      apply: (templateName: string, projectName: string, agent: AgentType) =>
        transport.invoke<{ content: string }>("agent-memory:apply", {
          templateName,
          projectName,
          agent,
        }),
    },
    agentImport: {
      scan: (repoUrl: string) =>
        transport.invoke<RepoScanResult>("agent-store:importScan", {
          repoUrl,
        }),
      scanLocal: (dirPath: string) =>
        transport.invoke<LocalScanResult>("agent-store:importScanLocal", {
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
        transport.invoke<ImportResult[]>("agent-store:importConfirm", {
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
        name?: string | null;
      }) => transport.invoke<SessionInfo>("terminal:create", opts),
      kill: (id: string) => transport.invoke<void>("terminal:kill", id),
      remove: (id: string) => transport.invoke<void>("terminal:remove", id),
      rename: (id: string, name: string | null) =>
        transport.invoke<SessionInfo>("terminal:rename", { id, name }),
      list: () => transport.invoke<SessionInfo[]>("terminal:list"),
      listDetailed: () =>
        transport.invoke<SessionInfo[]>("terminal:listDetailed"),
      getBuffer: (id: string) =>
        transport.invoke<string>("terminal:buffer", id),
    },
    health: {
      get: () => transport.invoke<HealthResponse>("health:get"),
    },
    system: {
      metrics: () => transport.invoke<HostMetrics>("system:metrics"),
      resourceSnapshot: () =>
        transport.invoke<HostResourceSnapshotV1>("system:resourceSnapshot"),
      resourceAlerts: (limit = 20) =>
        transport.invoke<HostResourceAlertIncident[]>("system:resourceAlerts", {
          limit,
        }),
      idleSuspendStatus: async () => {
        const raw = await transport.invoke<unknown>("system:idleSuspendStatus");
        return decodeIdleSuspendStatusV1(raw);
      },
      updateIdleSuspendTiming: (timing: IdleSuspendTimingPatchRequest) =>
        transport.invoke<IdleSuspendTimingPatchResponse>(
          "system:updateIdleSuspendTiming",
          timing,
        ),
      forceSuspend: (request: ForceSuspendRequest) =>
        transport.invoke<ForceSuspendAcceptedResponse>(
          "system:forceSuspend",
          request,
        ),
    },
    usage: {
      summary: (query: UsageSummaryQuery = {}) =>
        transport.invoke<UsageSummary>("usage:summary", query),
      sessions: (query: UsageSessionQuery = {}) =>
        transport.invoke<UsageSessionPage>("usage:sessions", query),
      session: (id: string) =>
        transport.invoke<UsageSessionDetail>("usage:session", { id }),
      health: () => transport.invoke<UsageHealth>("usage:health"),
      settings: () => transport.invoke<UsageSettings>("usage:settings"),
      setupStatus: () =>
        transport.invoke<UsageSetupStatus>("usage:setupStatus"),
      updateSettings: (patch: UsageSettingsPatch) =>
        transport.invoke<UsageSettings>("usage:updateSettings", patch),
      configure: (patch: UsageSettingsPatch) =>
        transport.invoke<UsageSetupStatus>("usage:configure", patch),
      delete: (request: { confirmation: string; from?: number; to?: number }) =>
        transport.invoke<{ deleted: true }>("usage:deleteAll", {
          ...request,
        }),
      deleteAll: () => usageDelete({ confirmation: "delete-usage-data" }),
      deleteRange: (from: number, to: number) =>
        usageDelete({ confirmation: "delete-usage-data", from, to }),
    },
    fs: {
      list: (target: ProjectTargetInput, path: string) =>
        transport.invoke<FsListResponse>("fs:list", {
          ...toWireTarget(target),
          path,
        }),
      languageFiles: (target: ProjectTargetInput) =>
        transport.invoke<LanguageFilesResponse>(
          "fs:languageFiles",
          toWireTarget(target),
        ),
      read: (
        target: ProjectTargetInput,
        path: string,
        opts?: { offset?: number; len?: number },
      ) => {
        const wire = toWireTarget(target);
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsRead === "function") {
          return fsTrans.fsRead(
            {
              profileId: owner.profileId,
              project: wire.project,
              worktreePath: wire.worktreePath,
            },
            path,
            opts,
          ) as Promise<FsReadResponse>;
        }
        return transport.invoke<FsReadResponse>("fs:read", {
          ...wire,
          path,
          ...opts,
        });
      },
      writeFile: (
        target: ProjectTargetInput,
        path: string,
        content: string,
        expectedMtime: number,
      ) => {
        const wire = toWireTarget(target);
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsWriteFile === "function") {
          return fsTrans.fsWriteFile(
            {
              profileId: owner.profileId,
              project: wire.project,
              worktreePath: wire.worktreePath,
            },
            path,
            content,
            expectedMtime,
          ) as Promise<FsWriteResponse>;
        }
        return transport.invoke<FsWriteResponse>("fs:writeFile", {
          ...wire,
          path,
          content,
          expectedMtime,
        });
      },
      subscribeTree: (target: ProjectTargetInput, path: string) => {
        const wire = toWireTarget(target);
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsSubscribeTree === "function") {
          return fsTrans.fsSubscribeTree(
            {
              profileId: owner.profileId,
              project: wire.project,
              worktreePath: wire.worktreePath,
            },
            path,
          ) as Promise<number>;
        }
        return transport
          .invoke<{ sub_id: number }>("fs:subscribeTree", { ...wire, path })
          .then((r) => r.sub_id);
      },
      unsubscribeTree: (sub_id: number) => {
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsUnsubscribeTree === "function") {
          return fsTrans.fsUnsubscribeTree(sub_id) as Promise<boolean>;
        }
        return transport
          .invoke<{ ok: boolean }>("fs:unsubscribeTree", { sub_id })
          .then((r) => r.ok);
      },
      onEvent: (sub_id: number, cb: (event: FsEventDto) => void) => {
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.onFsEvent === "function") {
          return fsTrans.onFsEvent(sub_id, cb) as () => void;
        }
        return transport.onEvent(`fs:${sub_id}`, (payload) =>
          cb(payload as FsEventDto),
        );
      },
      uploadFile: (
        target: ProjectTargetInput,
        dir: string,
        file: File,
        onProgress?: (pct: number) => void,
      ) => {
        const wire = toWireTarget(target);
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsUploadFile === "function") {
          return fsTrans.fsUploadFile(
            {
              profileId: owner.profileId,
              project: wire.project,
              worktreePath: wire.worktreePath,
            },
            dir,
            file,
            onProgress,
          ) as Promise<FsUploadResult>;
        }
        return Promise.reject(
          new Error("Upload not supported by current transport"),
        );
      },
      putFile: (
        target: ProjectTargetInput,
        dir: string,
        file: File,
        uploadId: string,
        encKey: CryptoKey,
        onProgress?: (pct: number) => void,
      ) => {
        const wire = toWireTarget(target);
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsPutFile === "function") {
          return fsTrans.fsPutFile(
            {
              profileId: owner.profileId,
              project: wire.project,
              worktreePath: wire.worktreePath,
            },
            dir,
            file,
            uploadId,
            encKey,
            onProgress,
          ) as Promise<FsPutResult>;
        }
        return Promise.reject(
          new Error("Encrypted putFile not supported by current transport"),
        );
      },
      putSave: (
        target: ProjectTargetInput,
        path: string,
        blob: Blob,
        saveId: string,
        encKey: CryptoKey,
      ) => {
        const wire = toWireTarget(target);
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsPutSave === "function") {
          return fsTrans.fsPutSave(
            {
              profileId: owner.profileId,
              project: wire.project,
              worktreePath: wire.worktreePath,
            },
            path,
            blob,
            saveId,
            encKey,
          ) as Promise<FsPutResult>;
        }
        return Promise.reject(
          new Error("Encrypted putSave not supported by current transport"),
        );
      },
      op: (
        op: "delete" | "rename" | "mkdir" | "create_file",
        params: Record<string, unknown>,
      ) => {
        const fsTrans = transport as unknown as FsTransportSeam;
        if (typeof fsTrans.fsOp === "function") {
          return fsTrans.fsOp(op, params) as Promise<FsOpResult>;
        }
        return transport.invoke<FsOpResult>(`fs:${op}`, params);
      },
    },
    tunnels: {
      list: () => transport.invoke<TunnelInfo[]>("tunnel:list"),
      create: (port: number, label: string) =>
        transport.invoke<TunnelInfo>("tunnel:create", { port, label }),
      stop: (id: string) => transport.invoke<void>("tunnel:stop", { id }),
    },
    browserDebug: {
      createArtifact: (
        terminalId: string,
        terminalIncarnation: number,
        selection: BrowserSelectionV1,
      ) =>
        transport.invoke<BrowserDebugArtifactResponse>("browser-debug:create", {
          terminalId,
          terminalIncarnation,
          selection,
        }),
      deleteArtifact: (artifactId: string) =>
        transport.invoke<void>("browser-debug:delete", { artifactId }),
      handoff: (artifactId: string) =>
        transport.invoke<BrowserDebugHandoffResponse>("browser-debug:handoff", {
          artifactId,
        }),
      uploadPng: (artifactId: string, png: Blob) => {
        const upload = transport.uploadBrowserDebugPng;
        if (!upload)
          throw new Error(
            "Browser screenshot upload is unsupported by this transport",
          );
        return upload.call(transport, artifactId, png);
      },
    },
    workflow: {
      overview: () => transport.invoke<OverviewDto>("workflow:overview"),
      events: (query: EventsQuery = {}) =>
        transport.invoke<EventsDto>("workflow:events", query),
      createItem: (req: CreateItemRequest) =>
        transport.invoke<MutationDto<ItemDto>>("workflow:createItem", req),
      patchItem: (id: string, req: PatchItemRequest) =>
        transport.invoke<MutationDto<ItemDto>>("workflow:patchItem", {
          id,
          ...req,
        }),
      deleteItem: (id: string, req: DeleteItemRequest) =>
        transport.invoke<MutationDto<TombstoneDto>>("workflow:deleteItem", {
          id,
          ...req,
        }),
      createSession: (req: CreateSessionRequest) =>
        transport.invoke<MutationDto<SessionDto>>(
          "workflow:createSession",
          req,
        ),
      endSession: (id: string, req: EndSessionRequest) =>
        transport.invoke<MutationDto<SessionDto>>("workflow:endSession", {
          id,
          ...req,
        }),
      abandonSession: (id: string, req: AbandonSessionRequest) =>
        transport.invoke<MutationDto<SessionDto>>("workflow:abandonSession", {
          id,
          ...req,
        }),
      linkResource: (sessionId: string, req: LinkResourceRequest) =>
        transport.invoke<MutationDto<LinkDto>>("workflow:linkResource", {
          sessionId,
          ...req,
        }),
      unlinkResource: (sessionId: string, req: UnlinkResourceRequest) =>
        transport.invoke<MutationDto<TombstoneDto>>("workflow:unlinkResource", {
          sessionId,
          ...req,
        }),
      createNote: (req: CreateNoteRequest) =>
        transport.invoke<MutationDto<NoteDto>>("workflow:createNote", req),
      deleteNote: (id: string, req: DeleteNoteRequest) =>
        transport.invoke<MutationDto<TombstoneDto>>("workflow:deleteNote", {
          id,
          ...req,
        }),
      purgeHistory: (req: PurgeHistoryRequest) =>
        transport.invoke<PurgeDto>("workflow:purgeHistory", req),
    },
    plugins: {
      list: (target: ServerProjectTarget) => {
        const query = new URLSearchParams({ project: target.project });
        if (target.worktreePath) query.set("worktreePath", target.worktreePath);
        return transport.invoke<ListPluginsResponse>(
          `plugins:list?${query.toString()}`,
        );
      },
      getEpoch: () => {
        const method = (transport as Transport & PluginTransportSeam)
          .getPluginEpoch;
        if (!method) {
          return Promise.reject(
            new Error("Plugin connection epoch is unavailable"),
          );
        }
        return method.call(transport);
      },
      readUiAsset: (request: PluginUiAssetRequest, signal?: AbortSignal) => {
        const method = (transport as Transport & PluginTransportSeam)
          .fetchPluginUi;
        if (!method) {
          return Promise.reject(new Error("Plugin UI assets are unavailable"));
        }
        return method.call(transport, request, signal);
      },
      openContext: (req: OpenContextRequest) =>
        transport.invoke<ContextOpenResult>("plugins:openContext", req),
      closeContext: (req: CloseContextRequest) =>
        transport.invoke<ContextCloseResult>("plugins:closeContext", req),
      invoke: <T = unknown>(req: InvokeRequest) =>
        transport.invoke<InvokeResponse<T>>("plugins:invoke", req),
      cancel: (req: CancelRequest) =>
        transport.invoke<RequestCancelResult>("plugins:cancel", req),
      onRevoked: (listener: (event: PluginRevokedEvent) => void) =>
        transport.onEvent("plugin:revoked", (payload) => {
          if (typeof payload !== "object" || payload === null) return;
          const value = payload as Record<string, unknown>;
          const contextId = value.contextId ?? value.context_id;
          if (
            typeof contextId !== "string" ||
            contextId.length === 0 ||
            typeof value.reason !== "string"
          ) {
            return;
          }
          listener({
            kind: "plugin:revoked",
            contextId,
            reason: value.reason,
          });
        }),
    },
  };
}

export interface ApiClient {
  owner: ConnectionRef;
  transport: Transport;
  workspace: {
    get: () => Promise<WorkspaceInfo>;
    switch: (path: string) => Promise<WorkspaceInfo>;
    known: () => Promise<KnownWorkspacesResponse>;
    addKnown: (path: string) => Promise<KnownWorkspace>;
    removeKnown: (path: string) => Promise<{ removed: boolean }>;
    status: () => Promise<WorkspaceStatus>;
    init: (path: string) => Promise<{ name: string; root: string }>;
    discover: (path: string) => Promise<DiscoverResponse>;
  };
  globalConfig: {
    get: () => Promise<GlobalConfig>;
    updateDefaults: (defaults: {
      workspace?: string;
    }) => Promise<{ updated: true }>;
    updateUi: (ui: Partial<UiConfig>) => Promise<{ updated: true }>;
  };
  projects: {
    list: () => Promise<ProjectWithStatus[]>;
    get: (name: string) => Promise<ProjectWithStatus>;
    status: (target: ProjectTargetInput) => Promise<GitStatus | null>;
  };
  git: {
    fetch: (targets?: ProjectTargetInput[]) => Promise<GitOpResult[]>;
    pull: (targets?: ProjectTargetInput[]) => Promise<GitOpResult[]>;
    push: (
      target: ProjectTargetInput,
      root?: string,
      force?: boolean,
    ) => Promise<GitOpResult>;
    worktrees: (project: string) => Promise<Worktree[]>;
    roots: (target: ProjectTargetInput) => Promise<VcsRoot[]>;
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => Promise<Worktree>;
    removeWorktree: (project: string, path: string) => Promise<void>;
    branches: (target: ProjectTargetInput, root?: string) => Promise<Branch[]>;
    createBranch: (
      target: ProjectTargetInput,
      options: {
        name: string;
        startPoint?: string;
        checkout?: boolean;
        root?: string;
      },
    ) => Promise<GitActionResult>;
    checkoutBranch: (
      target: ProjectTargetInput,
      options: {
        branch: string;
        startPoint?: string;
        create?: boolean;
        strategy?: CheckoutStrategy;
        root?: string;
      },
    ) => Promise<GitActionResult>;
    deleteBranch: (
      target: ProjectTargetInput,
      options: { name: string; root?: string },
    ) => Promise<GitActionResult>;
    updateBranch: (
      target: ProjectTargetInput,
      branch: string,
      root?: string,
    ) => Promise<BranchUpdateResult>;
    log: (
      target: ProjectTargetInput,
      limit?: number,
      offset?: number,
      ref?: string,
      root?: string,
    ) => Promise<GitLogEntry[]>;
    diff: (target: ProjectTargetInput, root?: string) => Promise<DiffResponse>;
    untrackedFiles: (
      target: ProjectTargetInput,
      offset: number,
      limit: number,
      root?: string,
    ) => Promise<DiffFileEntry[]>;
    fileDiff: (
      target: ProjectTargetInput,
      path: string,
      root?: string,
    ) => Promise<FileDiffContent>;
    stage: (
      target: ProjectTargetInput,
      paths: string[],
      root?: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    unstage: (
      target: ProjectTargetInput,
      paths: string[],
      root?: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    discard: (
      target: ProjectTargetInput,
      path: string,
      root?: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    discardHunk: (
      target: ProjectTargetInput,
      path: string,
      hunkIndex: number,
      root?: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    conflicts: (
      target: ProjectTargetInput,
      root?: string,
    ) => Promise<ConflictFile[]>;
    resolve: (
      target: ProjectTargetInput,
      path: string,
      content: string,
      root?: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    commit: (
      target: ProjectTargetInput,
      message: string,
      amend?: boolean,
      root?: string,
    ) => Promise<{ ok: boolean; hash: string; error?: string }>;
    cherryPick: (
      target: ProjectTargetInput,
      hash: string,
      root?: string,
    ) => Promise<GitActionResult>;
    reset: (
      target: ProjectTargetInput,
      hash: string,
      mode: ResetMode,
      root?: string,
    ) => Promise<GitActionResult>;
    undoLastCommit: (
      target: ProjectTargetInput,
      root?: string,
    ) => Promise<GitActionResult>;
    commitFiles: (
      target: ProjectTargetInput,
      hash: string,
      root?: string,
    ) => Promise<DiffFileEntry[]>;
    commitMessage: (
      target: ProjectTargetInput,
      hash: string,
      root?: string,
    ) => Promise<CommitMessageResponse>;
    editCommitMessage: (
      target: ProjectTargetInput,
      hash: string,
      message: string,
      root?: string,
    ) => Promise<GitActionResult>;
    commitFileDiff: (
      target: ProjectTargetInput,
      hash: string,
      path: string,
      root?: string,
    ) => Promise<FileDiffContent>;
    cherryPickCommitFiles: (
      target: ProjectTargetInput,
      hash: string,
      paths: string[],
      root?: string,
    ) => Promise<GitActionResult>;
    dropCommitFiles: (
      target: ProjectTargetInput,
      hash: string,
      paths: string[],
      root?: string,
    ) => Promise<GitActionResult>;
    dropCommit: (
      target: ProjectTargetInput,
      hash: string,
      root?: string,
    ) => Promise<GitActionResult>;
    revertCommit: (
      target: ProjectTargetInput,
      hash: string,
      root?: string,
    ) => Promise<GitActionResult>;
    revertCommitFiles: (
      target: ProjectTargetInput,
      hash: string,
      paths: string[],
      root?: string,
    ) => Promise<GitActionResult>;
  };
  config: {
    get: () => Promise<DamHopperConfig>;
    update: (config: DamHopperConfig) => Promise<DamHopperConfig>;
    updateProject: (
      name: string,
      data: Partial<ProjectConfig>,
    ) => Promise<ProjectConfig>;
  };
  settings: {
    clearCache: () => Promise<{ cleared: boolean }>;
    reset: () => Promise<{ reset: boolean }>;
    exportConfig: () => Promise<string>;
    importConfig: (tomlContent: string) => Promise<SettingsImportResponse>;
  };
  diagnostics: {
    export: (
      request: DiagnosticExportRequest,
    ) => Promise<DiagnosticExportResponse>;
  };
  commands: {
    search: (
      query: string,
      projectType?: string,
      limit?: number,
    ) => Promise<SearchResult[]>;
    list: (projectType: string) => Promise<SearchResult[]>;
  };
  agentStore: {
    list: (category?: AgentItemCategory) => Promise<AgentStoreItem[]>;
    get: (
      name: string,
      category: AgentItemCategory,
    ) => Promise<AgentStoreItem | null>;
    getContent: (
      name: string,
      category: AgentItemCategory,
      fileName?: string,
    ) => Promise<string>;
    remove: (
      name: string,
      category: AgentItemCategory,
    ) => Promise<{ removed: boolean }>;
    ship: (
      itemName: string,
      category: AgentItemCategory,
      projectName: string,
      agent: AgentType,
      method?: DistributionMethod,
    ) => Promise<ShipResult>;
    unship: (
      itemName: string,
      category: AgentItemCategory,
      projectName: string,
      agent: AgentType,
    ) => Promise<ShipResult>;
    absorb: (
      itemName: string,
      category: AgentItemCategory,
      projectName: string,
      agent: AgentType,
    ) => Promise<ShipResult>;
    bulkShip: (
      items: Array<{ name: string; category: AgentItemCategory }>,
      targets: Array<{ projectName: string; agent: AgentType }>,
      method?: DistributionMethod,
    ) => Promise<ShipResult[]>;
    matrix: () => Promise<DistributionMatrix>;
    scan: () => Promise<ProjectAgentScanResult[]>;
    health: () => Promise<HealthCheckResult>;
  };
  agentMemory: {
    list: (projectName: string) => Promise<Record<AgentType, string | null>>;
    get: (projectName: string, agent: AgentType) => Promise<string | null>;
    update: (
      projectName: string,
      agent: AgentType,
      content: string,
    ) => Promise<{ updated: boolean }>;
    templates: () => Promise<MemoryTemplateInfo[]>;
    apply: (
      templateName: string,
      projectName: string,
      agent: AgentType,
    ) => Promise<{ content: string }>;
  };
  agentImport: {
    scan: (repoUrl: string) => Promise<RepoScanResult>;
    scanLocal: (dirPath: string) => Promise<LocalScanResult>;
    confirm: (
      tmpDir: string,
      selectedItems: Array<{
        name: string;
        category: AgentItemCategory;
        relativePath: string;
      }>,
      skipCleanup?: boolean,
    ) => Promise<ImportResult[]>;
  };
  terminal: {
    create: (opts: {
      id: string;
      project?: string;
      command: string;
      cwd?: string;
      cols: number;
      rows: number;
      worktreePath?: string;
      name?: string | null;
    }) => Promise<SessionInfo>;
    kill: (id: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    rename: (id: string, name: string | null) => Promise<SessionInfo>;
    list: () => Promise<SessionInfo[]>;
    listDetailed: () => Promise<SessionInfo[]>;
    getBuffer: (id: string) => Promise<string>;
  };
  health: {
    get: () => Promise<HealthResponse>;
  };
  system: {
    metrics: () => Promise<HostMetrics>;
    resourceSnapshot: () => Promise<HostResourceSnapshotV1>;
    resourceAlerts: (limit?: number) => Promise<HostResourceAlertIncident[]>;
    idleSuspendStatus: () => Promise<IdleSuspendStatusV1>;
    updateIdleSuspendTiming: (
      timing: IdleSuspendTimingPatchRequest,
    ) => Promise<IdleSuspendTimingPatchResponse>;
    forceSuspend: (
      request: ForceSuspendRequest,
    ) => Promise<ForceSuspendAcceptedResponse>;
  };
  usage: {
    summary: (query?: UsageSummaryQuery) => Promise<UsageSummary>;
    sessions: (query?: UsageSessionQuery) => Promise<UsageSessionPage>;
    session: (id: string) => Promise<UsageSessionDetail>;
    health: () => Promise<UsageHealth>;
    settings: () => Promise<UsageSettings>;
    setupStatus: () => Promise<UsageSetupStatus>;
    updateSettings: (patch: UsageSettingsPatch) => Promise<UsageSettings>;
    configure: (patch: UsageSettingsPatch) => Promise<UsageSetupStatus>;
    delete: (request: {
      confirmation: string;
      from?: number;
      to?: number;
    }) => Promise<{ deleted: true }>;
    deleteAll: () => Promise<{ deleted: true }>;
    deleteRange: (from: number, to: number) => Promise<{ deleted: true }>;
  };
  fs: {
    list: (target: ProjectTargetInput, path: string) => Promise<FsListResponse>;
    languageFiles: (
      target: ProjectTargetInput,
    ) => Promise<LanguageFilesResponse>;
    read: (
      target: ProjectTargetInput,
      path: string,
      opts?: { offset?: number; len?: number },
    ) => Promise<FsReadResponse>;
    writeFile: (
      target: ProjectTargetInput,
      path: string,
      content: string,
      expectedMtime: number,
    ) => Promise<FsWriteResponse>;
    subscribeTree: (
      target: ProjectTargetInput,
      path: string,
    ) => Promise<number>;
    unsubscribeTree: (sub_id: number) => Promise<boolean>;
    onEvent: (sub_id: number, cb: (event: FsEventDto) => void) => () => void;
    uploadFile: (
      target: ProjectTargetInput,
      dir: string,
      file: File,
      onProgress?: (pct: number) => void,
    ) => Promise<FsUploadResult>;
    putFile: (
      target: ProjectTargetInput,
      dir: string,
      file: File,
      uploadId: string,
      encKey: CryptoKey,
      onProgress?: (pct: number) => void,
    ) => Promise<FsPutResult>;
    putSave: (
      target: ProjectTargetInput,
      path: string,
      blob: Blob,
      saveId: string,
      encKey: CryptoKey,
    ) => Promise<FsPutResult>;
    op: (
      op: "delete" | "rename" | "mkdir" | "create_file",
      params: Record<string, unknown>,
    ) => Promise<FsOpResult>;
  };
  tunnels: {
    list: () => Promise<TunnelInfo[]>;
    create: (port: number, label: string) => Promise<TunnelInfo>;
    stop: (id: string) => Promise<void>;
  };
  browserDebug: {
    createArtifact: (
      terminalId: string,
      terminalIncarnation: number,
      selection: BrowserSelectionV1,
    ) => Promise<BrowserDebugArtifactResponse>;
    deleteArtifact: (artifactId: string) => Promise<void>;
    handoff: (artifactId: string) => Promise<BrowserDebugHandoffResponse>;
    uploadPng: (
      artifactId: string,
      png: Blob,
    ) => Promise<BrowserDebugArtifactResponse>;
  };
  workflow: {
    overview: () => Promise<OverviewDto>;
    events: (query?: EventsQuery) => Promise<EventsDto>;
    createItem: (req: CreateItemRequest) => Promise<MutationDto<ItemDto>>;
    patchItem: (
      id: string,
      req: PatchItemRequest,
    ) => Promise<MutationDto<ItemDto>>;
    deleteItem: (
      id: string,
      req: DeleteItemRequest,
    ) => Promise<MutationDto<TombstoneDto>>;
    createSession: (
      req: CreateSessionRequest,
    ) => Promise<MutationDto<SessionDto>>;
    endSession: (
      id: string,
      req: EndSessionRequest,
    ) => Promise<MutationDto<SessionDto>>;
    abandonSession: (
      id: string,
      req: AbandonSessionRequest,
    ) => Promise<MutationDto<SessionDto>>;
    linkResource: (
      sessionId: string,
      req: LinkResourceRequest,
    ) => Promise<MutationDto<LinkDto>>;
    unlinkResource: (
      sessionId: string,
      req: UnlinkResourceRequest,
    ) => Promise<MutationDto<TombstoneDto>>;
    createNote: (req: CreateNoteRequest) => Promise<MutationDto<NoteDto>>;
    deleteNote: (
      id: string,
      req: DeleteNoteRequest,
    ) => Promise<MutationDto<TombstoneDto>>;
    purgeHistory: (req: PurgeHistoryRequest) => Promise<PurgeDto>;
  };
  plugins: {
    list: (target: ServerProjectTarget) => Promise<ListPluginsResponse>;
    getEpoch: () => Promise<PluginEpoch>;
    readUiAsset: (
      request: PluginUiAssetRequest,
      signal?: AbortSignal,
    ) => Promise<PluginUiAsset>;
    openContext: (req: OpenContextRequest) => Promise<ContextOpenResult>;
    closeContext: (req: CloseContextRequest) => Promise<ContextCloseResult>;
    invoke: <T = unknown>(req: InvokeRequest) => Promise<InvokeResponse<T>>;
    cancel: (req: CancelRequest) => Promise<RequestCancelResult>;
    onRevoked: (listener: (event: PluginRevokedEvent) => void) => () => void;
  };
}

interface PluginTransportSeam {
  getPluginEpoch?: () => Promise<PluginEpoch>;
  fetchPluginUi?: (
    request: PluginUiAssetRequest,
    signal?: AbortSignal,
  ) => Promise<PluginUiAsset>;
}

interface FsTransportSeam {
  fsRead?: (...args: unknown[]) => unknown;
  fsWriteFile?: (...args: unknown[]) => unknown;
  fsPutFile?: (...args: unknown[]) => unknown;
  fsPutSave?: (...args: unknown[]) => unknown;
  fsSubscribeTree?: (...args: unknown[]) => unknown;
  fsUnsubscribeTree?: (...args: unknown[]) => unknown;
  onFsEvent?: (...args: unknown[]) => unknown;
  fsUploadFile?: (...args: unknown[]) => unknown;
  fsOp?: (...args: unknown[]) => unknown;
}

const defaultAmbientTransport: Transport = {
  invoke: (channel, data, opts) => {
    const t = getTransport();
    if (opts !== undefined) return t.invoke(channel, data, opts);
    if (data !== undefined) return t.invoke(channel, data);
    return t.invoke(channel);
  },
  onTerminalData: (id, cb) => getTransport().onTerminalData(id, cb),
  onTerminalExit: (id, cb) => getTransport().onTerminalExit(id, cb),
  onEvent: (channel, cb) => getTransport().onEvent(channel, cb),
  terminalWrite: (id, data) => getTransport().terminalWrite(id, data),
  terminalResize: (id, cols, rows) =>
    getTransport().terminalResize(id, cols, rows),
  uploadBrowserDebugPng: (id, png) =>
    getTransport().uploadBrowserDebugPng?.(id, png) ??
    Promise.reject(
      new Error("Browser screenshot upload is unsupported by this transport"),
    ),
  onStatusChange: (cb) => getTransport().onStatusChange?.(cb) ?? (() => {}),
  fsRead: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsRead?.(...args),
  fsWriteFile: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsWriteFile?.(...args),
  fsPutFile: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsPutFile?.(...args),
  fsPutSave: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsPutSave?.(...args),
  fsSubscribeTree: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsSubscribeTree?.(...args),
  fsUnsubscribeTree: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsUnsubscribeTree?.(...args),
  onFsEvent: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).onFsEvent?.(...args),
  fsUploadFile: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsUploadFile?.(...args),
  fsOp: (...args: unknown[]) =>
    (getTransport() as unknown as FsTransportSeam).fsOp?.(...args),
};

export const api = createApiClient(
  { profileId: "", generation: 0 },
  defaultAmbientTransport,
);
