import { PluginError, PluginErrorCode } from './errors.js';

export const RUNNER_PROTOCOL_VERSION = '1.0.0';

export const PUBLIC_RUNNER_METHODS: Record<string, true> = {
  'runner.hello': true,
  'plugin.list': true,
  'plugin.readUi': true,
  'plugin.activate': true,
  'plugin.deactivate': true,
  'context.open': true,
  'context.close': true,
  'plugin.invoke': true,
  'request.cancel': true,
};

export const ADMIN_RUNNER_METHODS: Record<string, true> = {
  'management.stage.begin': true,
  'management.stage.chunk': true,
  'management.stage.finish': true,
  'management.approve': true,
  'management.rollback': true,
  'management.disable': true,
  'management.remove': true,
  'management.grants.replace': true,
  'management.bindings.replace': true,
};

export const WORKER_NOTIFICATION_METHODS: Record<string, true> = {
  'worker.health': true,
  'worker.shutdown': true,
};

// Params and results for runner methods

export interface RunnerHelloParams {
  hostVersion: string;
  clientProtocolVersion: string;
}

export interface RunnerHelloResult {
  runnerVersion: string;
  negotiatedProtocolVersion: string;
  supportedCapabilities: string[];
}

export interface PluginListParams {
  includeDisabled?: boolean;
}

export interface PluginMetadataItem {
  id: string;
  version: string;
  publisher: string;
  capabilities: string[];
  hasUi: boolean;
  activeGeneration: number;
  enabled: boolean;
}

export interface PluginListResult {
  plugins: PluginMetadataItem[];
}

export interface PluginReadUiParams {
  installationId: string;
  expectedDigest: string;
  activationGeneration: number;
  actorSubject: string;
  projectTarget: string;
}

export interface PluginReadUiResult {
  rawBytesBase64: string;
  sha256: string;
  size: number;
}

export const MAX_UI_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MiB ceiling

export interface PluginActivateParams {
  installationId: string;
  version: string;
}

export interface PluginActivateResult {
  activationGeneration: number;
  status: 'active';
}

export interface PluginDeactivateParams {
  installationId: string;
}

export interface PluginDeactivateResult {
  status: 'inactive';
}

export type ContextScopeKind = 'project' | 'history-root';

export interface ContextScopeDescriptor {
  kind: ContextScopeKind;
  rootIdentity?: string;
  sourceRevision?: number;
}

export interface ContextOpenParams {
  actorSubject: string;
  installationId: string;
  configuredProjectTarget: string;
  scope?: ContextScopeDescriptor;
  worktreePath?: string;
  allowedOperations: string[];
  allowCurrentAccountPolicy: boolean;
  apiConnectionEpoch: number;
  activationGeneration: number;
}

export interface ContextOpenResult {
  contextId: string;
  scopeKind?: ContextScopeKind;
  bindingRevision: number;
  grantRevision: number;
  activationGeneration: number;
  expiresAt: number;
}

export interface ContextCloseParams {
  contextId: string;
  reason?: string;
}

export interface ContextCloseResult {
  closed: boolean;
}

export interface PluginInvokeParams {
  contextId: string;
  operation: string;
  payload: Record<string, unknown>;
  deadlineMs?: number;
}

export interface PluginInvokeResult {
  result: unknown;
}

export interface RequestCancelParams {
  contextId: string;
  requestId: string;
}

export type CancelOutcome = 'accepted' | 'alreadySettled' | 'unknown';

export interface RequestCancelResult {
  outcome: CancelOutcome;
}

// Admin management params

export interface ManagementStageBeginParams {
  stagingId: string;
  expectedDigest: string;
  totalBytes: number;
}

export interface ManagementStageChunkParams {
  stagingId: string;
  offset: number;
  chunkBase64: string;
}

export interface ManagementStageFinishParams {
  stagingId: string;
}

export interface ManagementApproveParams {
  installationId: string;
  approvedDigest: string;
}

export interface ManagementRollbackParams {
  installationId: string;
  targetGeneration?: number;
}

export interface ManagementDisableParams {
  installationId: string;
  reason: string;
}

export interface ManagementRemoveParams {
  installationId: string;
}

export interface GrantDefinition {
  actorSubject: string;
  target: string;
  allowedOperations: string[];
  allowCurrentAccountPolicy: boolean;
}

export interface ManagementGrantsReplaceParams {
  installationId: string;
  grants: GrantDefinition[];
}

export interface BindingDefinition {
  projectTarget: string;
  canonicalTarget: string;
  historyRoot: string;
}

export interface ManagementBindingsReplaceParams {
  installationId: string;
  bindings: BindingDefinition[];
}

// Worker notifications

export interface WorkerHealthNotification {
  workerPid: number;
  status: 'healthy' | 'degraded';
  rssBytes: number;
}

export interface WorkerShutdownNotification {
  workerPid: number;
  exitCode: number | null;
  signal: string | null;
}

export function isPublicRunnerMethod(method: string): boolean {
  return Boolean(PUBLIC_RUNNER_METHODS[method]);
}

export function isAdminRunnerMethod(method: string): boolean {
  return Boolean(ADMIN_RUNNER_METHODS[method]);
}

export function isWorkerNotificationMethod(method: string): boolean {
  return Boolean(WORKER_NOTIFICATION_METHODS[method]);
}

export function validateRunnerMethodCall(method: string, isAdmin = false): void {
  if (isPublicRunnerMethod(method)) {
    return;
  }
  if (isAdmin && isAdminRunnerMethod(method)) {
    return;
  }
  if (isAdminRunnerMethod(method)) {
    throw new PluginError(PluginErrorCode.FORBIDDEN, `Admin method ${method} requires administrator privileges`);
  }
  throw new PluginError(PluginErrorCode.INVALID_INPUT, `Unknown runner method: ${method}`);
}
