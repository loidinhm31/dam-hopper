export const UI_BRIDGE_VERSION = "1.0.0";
export const MAX_BRIDGE_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_BRIDGE_CONTROL_BYTES = 64 * 1024;
export const MAX_BRIDGE_ID_LENGTH = 128;
export const MAX_BRIDGE_OPERATION_LENGTH = 128;
export const MAX_BRIDGE_DEADLINE_MS = 30_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_ITEMS = 50_000;
const MAX_CAPABILITIES = 256;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface FrameReadyMessage {
  type: "frame.ready";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
}

export interface FramePortAckMessage {
  type: "frame.portAck";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
  nonce: string;
}

export interface FrameRequestMessage {
  type: "request";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
  requestId: string;
  operation: string;
  payload: unknown;
  deadlineMs?: number;
}

export interface FrameCancelMessage {
  type: "cancel";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
  requestId: string;
}

export type FramePortMessage =
  | FramePortAckMessage
  | FrameRequestMessage
  | FrameCancelMessage;

export interface HostBootstrapMessage {
  type: "host.bootstrap";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
  pluginId: string;
  nonce: string;
  capabilities: string[];
}

export interface HostResponseError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface HostResponseMessage {
  type: "response";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
  requestId: string;
  result?: unknown;
  error?: HostResponseError;
}

export interface HostContextRevokedMessage {
  type: "context.revoked";
  bridgeVersion: typeof UI_BRIDGE_VERSION;
  frameSession: string;
  activationGeneration: number;
  reason: string;
}

export class BridgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeValidationError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BridgeValidationError("Bridge envelope must be an object");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new BridgeValidationError(`Missing bridge field: ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new BridgeValidationError(`Unknown bridge field: ${key}`);
    }
  }
}

function requireEnvelopeFence(
  value: Record<string, unknown>,
  frameSession: string,
  activationGeneration: number,
): void {
  if (value.bridgeVersion !== UI_BRIDGE_VERSION) {
    throw new BridgeValidationError("Unsupported bridge version");
  }
  if (value.frameSession !== frameSession) {
    throw new BridgeValidationError("Frame session mismatch");
  }
  if (value.activationGeneration !== activationGeneration) {
    throw new BridgeValidationError("Activation generation mismatch");
  }
}

function requireBoundedIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BRIDGE_ID_LENGTH ||
    !ID_PATTERN.test(value)
  ) {
    throw new BridgeValidationError(`Invalid ${label}`);
  }
  return value;
}

function encodedJsonSize(value: unknown, label: string): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BridgeValidationError(`${label} is not JSON serializable`);
  }
  if (serialized === undefined) {
    throw new BridgeValidationError(`${label} is not JSON serializable`);
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function validateJsonPayload(payload: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: payload, depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let items = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    items += 1;
    if (items > MAX_JSON_ITEMS || current.depth > MAX_JSON_DEPTH) {
      throw new BridgeValidationError("Bridge payload is too complex");
    }
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        throw new BridgeValidationError(
          "Bridge payload contains a non-finite number",
        );
      }
      continue;
    }
    if (typeof current.value !== "object") {
      throw new BridgeValidationError(
        "Bridge payload must contain JSON values only",
      );
    }
    if (seen.has(current.value)) {
      throw new BridgeValidationError("Bridge payload must not be cyclic");
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BridgeValidationError(
        "Bridge payload must contain plain objects only",
      );
    }
    for (const item of Object.values(
      current.value as Record<string, unknown>,
    )) {
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }

  if (encodedJsonSize(payload, "Bridge payload") > MAX_BRIDGE_PAYLOAD_BYTES) {
    throw new BridgeValidationError("Bridge payload exceeds the 16 MiB limit");
  }
}

export function validateCapabilities(
  capabilities: readonly string[],
): string[] {
  if (capabilities.length > MAX_CAPABILITIES) {
    throw new BridgeValidationError("Too many bridge capabilities");
  }
  const unique = new Set<string>();
  for (const capability of capabilities) {
    if (
      capability.length === 0 ||
      capability.length > MAX_BRIDGE_OPERATION_LENGTH ||
      !OPERATION_PATTERN.test(capability) ||
      unique.has(capability)
    ) {
      throw new BridgeValidationError("Invalid bridge capability list");
    }
    unique.add(capability);
  }
  return [...unique];
}

export function validateHostResponse(message: HostResponseMessage): void {
  if (message.result !== undefined) validateJsonPayload(message.result);
  if (encodedJsonSize(message, "Bridge response") > MAX_BRIDGE_PAYLOAD_BYTES) {
    throw new BridgeValidationError("Bridge response exceeds the 16 MiB limit");
  }
}

export function validateFrameReady(
  data: unknown,
  frameSession: string,
  activationGeneration: number,
): FrameReadyMessage {
  const value = asRecord(data);
  requireExactKeys(value, [
    "type",
    "bridgeVersion",
    "frameSession",
    "activationGeneration",
  ]);
  if (value.type !== "frame.ready") {
    throw new BridgeValidationError("Expected frame.ready");
  }
  requireEnvelopeFence(value, frameSession, activationGeneration);
  if (encodedJsonSize(value, "frame.ready") > MAX_BRIDGE_CONTROL_BYTES) {
    throw new BridgeValidationError("frame.ready exceeds the control limit");
  }
  return value as unknown as FrameReadyMessage;
}

export function validateFramePortMessage(
  data: unknown,
  frameSession: string,
  activationGeneration: number,
  nonce: string,
  allowedOperations: ReadonlySet<string>,
): FramePortMessage {
  const value = asRecord(data);
  if (value.type === "frame.portAck") {
    requireExactKeys(value, [
      "type",
      "bridgeVersion",
      "frameSession",
      "activationGeneration",
      "nonce",
    ]);
    requireEnvelopeFence(value, frameSession, activationGeneration);
    if (value.nonce !== nonce) {
      throw new BridgeValidationError("Bootstrap nonce mismatch");
    }
    if (encodedJsonSize(value, "frame.portAck") > MAX_BRIDGE_CONTROL_BYTES) {
      throw new BridgeValidationError(
        "frame.portAck exceeds the control limit",
      );
    }
    return value as unknown as FramePortAckMessage;
  }

  if (value.type === "request") {
    requireExactKeys(
      value,
      [
        "type",
        "bridgeVersion",
        "frameSession",
        "activationGeneration",
        "requestId",
        "operation",
        "payload",
      ],
      ["deadlineMs"],
    );
    requireEnvelopeFence(value, frameSession, activationGeneration);
    requireBoundedIdentifier(value.requestId, "requestId");
    if (
      typeof value.operation !== "string" ||
      value.operation.length === 0 ||
      value.operation.length > MAX_BRIDGE_OPERATION_LENGTH ||
      !OPERATION_PATTERN.test(value.operation) ||
      !allowedOperations.has(value.operation)
    ) {
      throw new BridgeValidationError("Operation is not allowed");
    }
    validateJsonPayload(value.payload);
    if (
      value.deadlineMs !== undefined &&
      (!Number.isSafeInteger(value.deadlineMs) ||
        (value.deadlineMs as number) < 1 ||
        (value.deadlineMs as number) > MAX_BRIDGE_DEADLINE_MS)
    ) {
      throw new BridgeValidationError("Invalid request deadline");
    }
    if (encodedJsonSize(value, "Bridge request") > MAX_BRIDGE_PAYLOAD_BYTES) {
      throw new BridgeValidationError(
        "Bridge request exceeds the 16 MiB limit",
      );
    }
    return value as unknown as FrameRequestMessage;
  }

  if (value.type === "cancel") {
    requireExactKeys(value, [
      "type",
      "bridgeVersion",
      "frameSession",
      "activationGeneration",
      "requestId",
    ]);
    requireEnvelopeFence(value, frameSession, activationGeneration);
    requireBoundedIdentifier(value.requestId, "requestId");
    if (encodedJsonSize(value, "Bridge cancel") > MAX_BRIDGE_CONTROL_BYTES) {
      throw new BridgeValidationError(
        "Bridge cancel exceeds the control limit",
      );
    }
    return value as unknown as FrameCancelMessage;
  }

  throw new BridgeValidationError("Unsupported frame-to-host envelope");
}
