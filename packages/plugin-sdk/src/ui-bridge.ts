import { PluginError, PluginErrorCode, type PluginErrorPayload } from './errors.js';

export const UI_BRIDGE_VERSION = '1.0.0';
export const ADVISOR_WORKSPACE_EXTENSION_V1 = 'workspace-advisor-v1';

export type AdvisorHistoryScope = 'history-root' | 'project' | 'unavailable';
export type AdvisorContextScope = 'history-root' | 'project';

export interface AdvisorWorkspaceProject {
  projectId: string;
  label: string | null;
}

export interface AdvisorWorkspaceContext {
  revision: number;
  authorityKey: string;
  project: AdvisorWorkspaceProject;
  historyScope: AdvisorHistoryScope;
  contextScope: AdvisorContextScope;
  allowedOperations: string[];
}

export type UiIntent = 'activate' | 'dismiss';

export interface HostBootstrapEnvelope {
  type: 'host.bootstrap';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  pluginId: string;
  nonce: string;
  capabilities: string[];
  extensions?: string[];
  workspaceContext?: AdvisorWorkspaceContext;
}

export interface FrameReadyEnvelope {
  type: 'frame.ready';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
}

export interface FramePortAckEnvelope {
  type: 'frame.portAck';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  nonce: string;
}

export interface BridgeRequestEnvelope {
  type: 'request';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  requestId: string;
  operation: string;
  payload: unknown;
  deadlineMs?: number;
}

export interface BridgeCancelEnvelope {
  type: 'cancel';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  requestId: string;
}

export interface BridgeResponseEnvelope {
  type: 'response';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  requestId: string;
  result?: unknown;
  error?: PluginErrorPayload;
}

export interface BridgeContextRevokedEnvelope {
  type: 'context.revoked';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  reason: string;
}

export interface BridgeAvailabilityChangedEnvelope {
  type: 'availability.changed';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  available: boolean;
  reason?: string;
}

export interface HostContextReadyEnvelope {
  type: 'host.contextReady';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  workspaceContext: AdvisorWorkspaceContext;
}

export interface HostWorkspaceChangedEnvelope {
  type: 'host.workspaceChanged';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  workspaceContext: AdvisorWorkspaceContext;
}

export interface FrameUiIntentEnvelope {
  type: 'frame.uiIntent';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  intent: UiIntent;
}

export type BridgeMessage =
  | HostBootstrapEnvelope
  | FrameReadyEnvelope
  | FramePortAckEnvelope
  | BridgeRequestEnvelope
  | BridgeCancelEnvelope
  | BridgeResponseEnvelope
  | BridgeContextRevokedEnvelope
  | BridgeAvailabilityChangedEnvelope
  | HostContextReadyEnvelope
  | HostWorkspaceChangedEnvelope
  | FrameUiIntentEnvelope;

export const BRIDGE_ENVELOPE_TYPES: Record<string, true> = {
  'host.bootstrap': true,
  'frame.ready': true,
  'frame.portAck': true,
  request: true,
  cancel: true,
  response: true,
  'context.revoked': true,
  'availability.changed': true,
  'host.contextReady': true,
  'host.workspaceChanged': true,
  'frame.uiIntent': true,
};

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

export function validateAdvisorWorkspaceContext(data: unknown): AdvisorWorkspaceContext {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext must be an object');
  }
  const obj = data as Record<string, unknown>;
  const allowedKeys: Record<string, true> = {
    revision: true,
    authorityKey: true,
    project: true,
    historyScope: true,
    contextScope: true,
    allowedOperations: true,
  };
  for (const key of Object.keys(obj)) {
    if (!allowedKeys[key]) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, `Unknown workspaceContext property: ${key}`);
    }
  }
  if (typeof obj.revision !== 'number' || !Number.isInteger(obj.revision) || obj.revision < 1) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext must include positive integer revision');
  }
  if (typeof obj.authorityKey !== 'string' || !SHA256_HEX_PATTERN.test(obj.authorityKey)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext authorityKey must be a 64-char lowercase hex SHA-256');
  }
  if (typeof obj.project !== 'object' || obj.project === null || Array.isArray(obj.project)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext project must be an object');
  }
  const proj = obj.project as Record<string, unknown>;
  const projKeys: Record<string, true> = {
    projectId: true,
    label: true,
  };
  for (const key of Object.keys(proj)) {
    if (!projKeys[key]) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, `Unknown workspaceContext project property: ${key}`);
    }
  }
  if (typeof proj.projectId !== 'string' || !SHA256_HEX_PATTERN.test(proj.projectId)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext project.projectId must be a 64-char lowercase hex SHA-256');
  }
  if (proj.label !== null && typeof proj.label !== 'string') {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext project.label must be string or null');
  }
  if (typeof proj.label === 'string') {
    if (proj.label.length > 256 || CONTROL_CHAR_PATTERN.test(proj.label)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext project.label must be bounded and free of control characters');
    }
  }
  if (obj.historyScope !== 'history-root' && obj.historyScope !== 'project' && obj.historyScope !== 'unavailable') {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext historyScope must be history-root, project, or unavailable');
  }
  if (obj.contextScope !== 'history-root' && obj.contextScope !== 'project') {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext contextScope must be history-root or project');
  }
  if (!Array.isArray(obj.allowedOperations)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext allowedOperations must be an array');
  }
  if (obj.allowedOperations.length > 256) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'workspaceContext allowedOperations exceeds maximum count');
  }
  for (const op of obj.allowedOperations) {
    if (typeof op !== 'string' || op.length === 0 || op.length > 128 || !OPERATION_PATTERN.test(op)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, `Invalid operation identifier in allowedOperations: ${String(op)}`);
    }
  }
  return data as AdvisorWorkspaceContext;
}

export function validateBridgeMessage(data: unknown): BridgeMessage {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge message must be an object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !Object.hasOwn(BRIDGE_ENVELOPE_TYPES, obj.type)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, `Unknown bridge envelope type: ${String(obj.type)}`);
  }
  if (typeof obj.frameSession !== 'string' || obj.frameSession.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge message must include non-empty frameSession');
  }
  if (typeof obj.bridgeVersion !== 'string' || obj.bridgeVersion.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge message must include non-empty bridgeVersion');
  }
  if (typeof obj.activationGeneration !== 'number' || !Number.isInteger(obj.activationGeneration) || obj.activationGeneration < 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge message must include non-negative integer activationGeneration');
  }

  if (obj.type === 'request') {
    if (typeof obj.requestId !== 'string' || obj.requestId.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge request must include non-empty requestId');
    }
    if (typeof obj.operation !== 'string' || obj.operation.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge request must include non-empty operation');
    }
  } else if (obj.type === 'response') {
    if (typeof obj.requestId !== 'string' || obj.requestId.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge response must include non-empty requestId');
    }
    if (obj.result !== undefined && obj.error !== undefined) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge response cannot include both result and error');
    }
    if (obj.result === undefined && obj.error === undefined) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge response must include either result or error');
    }
  } else if (obj.type === 'host.bootstrap') {
    if (typeof obj.nonce !== 'string' || obj.nonce.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'host.bootstrap must include non-empty nonce');
    }
    if (typeof obj.pluginId !== 'string' || obj.pluginId.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'host.bootstrap must include non-empty pluginId');
    }
    if (!Array.isArray(obj.capabilities)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'host.bootstrap must include capabilities array');
    }
  } else if (obj.type === 'frame.portAck') {
    if (typeof obj.nonce !== 'string' || obj.nonce.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'frame.portAck must include non-empty nonce');
    }
  } else if (obj.type === 'host.contextReady' || obj.type === 'host.workspaceChanged') {
    validateAdvisorWorkspaceContext(obj.workspaceContext);
  } else if (obj.type === 'frame.uiIntent') {
    if (obj.intent !== 'activate' && obj.intent !== 'dismiss') {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'frame.uiIntent intent must be activate or dismiss');
    }
  }
  if (obj.type === 'host.bootstrap') {
    if (obj.extensions !== undefined) {
      if (!Array.isArray(obj.extensions) || obj.extensions.some((e) => typeof e !== 'string')) {
        throw new PluginError(PluginErrorCode.INVALID_INPUT, 'host.bootstrap extensions must be an array of strings');
      }
    }
    if (obj.workspaceContext !== undefined) {
      validateAdvisorWorkspaceContext(obj.workspaceContext);
    }
  }
  return data as BridgeMessage;
}
