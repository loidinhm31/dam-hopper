import { PluginError, PluginErrorCode, type PluginErrorPayload } from './errors.js';

export const UI_BRIDGE_VERSION = '1.0.0';

export interface HostBootstrapEnvelope {
  type: 'host.bootstrap';
  bridgeVersion: string;
  frameSession: string;
  activationGeneration: number;
  pluginId: string;
  nonce: string;
  capabilities: string[];
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

export type BridgeMessage =
  | HostBootstrapEnvelope
  | FrameReadyEnvelope
  | FramePortAckEnvelope
  | BridgeRequestEnvelope
  | BridgeCancelEnvelope
  | BridgeResponseEnvelope
  | BridgeContextRevokedEnvelope
  | BridgeAvailabilityChangedEnvelope;

export const BRIDGE_ENVELOPE_TYPES: Record<string, true> = {
  'host.bootstrap': true,
  'frame.ready': true,
  'frame.portAck': true,
  request: true,
  cancel: true,
  response: true,
  'context.revoked': true,
  'availability.changed': true,
};

export function validateBridgeMessage(data: unknown): BridgeMessage {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Bridge message must be an object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !BRIDGE_ENVELOPE_TYPES[obj.type]) {
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
  }

  return data as BridgeMessage;
}
