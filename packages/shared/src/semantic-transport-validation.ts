import {
  MAX_SEMANTIC_DOCUMENT_BYTES,
  MAX_SEMANTIC_SEQUENCE,
} from "./semantic-protocol.js";
import {
  MAX_SEMANTIC_OPEN_DOCUMENTS,
  MAX_SEMANTIC_WS_MESSAGE_BYTES,
  SEMANTIC_PROTOCOL_VERSION,
  type SemanticClientMessage,
  type SemanticCloseReason,
  type SemanticServerMessage,
  type SemanticStatusState,
  type SemanticTransportErrorCode,
  type SemanticTrustEventReason,
} from "./semantic-transport-types.js";
import {
  parseSemanticProtocolAvailability,
  parseSemanticProtocolCancellation,
  parseSemanticProtocolRequest,
  parseSemanticProtocolResponse,
  parseSemanticProtocolTrustState,
  parseSemanticProtocolUri,
  type SemanticDescriptorAvailability,
  type SemanticNavigationResponse,
  type SemanticTrustState,
  SemanticProtocolError,
} from "./semantic-protocol.js";

export function parseSemanticClientMessage(
  value: unknown,
): SemanticClientMessage {
  const input = record(value);
  const kind = requiredString(input.kind, "kind", 64);
  switch (kind) {
    case "semantic:project":
      assertKeys(input, ["kind", "profileId", "projectId"]);
      return {
        kind,
        profileId: opaqueId(input.profileId, "profileId"),
        projectId: opaqueId(input.projectId, "projectId"),
      };
    case "semantic:prewarm":
      assertKeys(input, ["kind", "projectId", "language", "tabGeneration"]);
      return {
        kind,
        projectId: opaqueId(input.projectId, "projectId"),
        language: parseSemanticProtocolUri({
          profileId: "profile",
          projectId: "project",
          path: "file",
          language: input.language,
        }).language,
        tabGeneration: sequence(input.tabGeneration, "tabGeneration"),
      };
    case "semantic:document_open":
    case "semantic:document_change": {
      assertKeys(input, ["kind", "uri", "documentVersion", "text"]);
      return {
        kind,
        uri: parseSemanticProtocolUri(input.uri),
        documentVersion: sequence(input.documentVersion, "documentVersion"),
        text: requiredText(input.text),
      };
    }
    case "semantic:document_close":
      assertKeys(input, ["kind", "uri", "documentVersion"]);
      return {
        kind,
        uri: parseSemanticProtocolUri(input.uri),
        documentVersion: sequence(input.documentVersion, "documentVersion"),
      };
    case "semantic:navigate":
      assertKeys(input, [
        "kind",
        "requestId",
        "documentVersion",
        "operation",
        "uri",
        "position",
        "maxTargets",
      ]);
      return {
        kind,
        ...parseSemanticProtocolRequest({
          requestId: input.requestId,
          documentVersion: input.documentVersion,
          operation: input.operation,
          uri: input.uri,
          position: input.position,
          ...(input.maxTargets === undefined
            ? {}
            : { maxTargets: input.maxTargets }),
        }),
      };
    case "semantic:cancel":
      assertKeys(input, ["kind", "requestId", "documentVersion"]);
      return {
        kind,
        ...parseSemanticProtocolCancellation({
          requestId: input.requestId,
          documentVersion: input.documentVersion,
        }),
      };
    case "semantic:resync":
      assertKeys(input, ["kind", "projectId"]);
      return { kind, projectId: opaqueId(input.projectId, "projectId") };
    default:
      throw new SemanticProtocolError("unsupported semantic message kind");
  }
}

export function parseSemanticServerMessage(
  value: unknown,
): SemanticServerMessage {
  const input = record(value);
  const kind = requiredString(input.kind, "kind", 64);
  if (navigationKinds.has(kind)) return parseSemanticProtocolResponse(input);
  if (kind === "semantic:error") {
    assertKeys(input, ["kind", "code"]);
    const code = requiredString(
      input.code,
      "code",
      32,
    ) as SemanticTransportErrorCode;
    if (!transportErrors.has(code))
      throw new SemanticProtocolError("invalid transport error");
    return { kind, code };
  }
  if (kind === "semantic:handshake") {
    assertKeys(input, [
      "kind",
      "protocolVersion",
      "sessionEpoch",
      "workspaceGeneration",
      "availability",
      "trust",
    ]);
    if (input.protocolVersion !== SEMANTIC_PROTOCOL_VERSION) {
      throw new SemanticProtocolError("unsupported semantic protocol version");
    }
    return {
      kind,
      protocolVersion: input.protocolVersion,
      sessionEpoch: sequence(input.sessionEpoch, "sessionEpoch"),
      workspaceGeneration: sequence(
        input.workspaceGeneration,
        "workspaceGeneration",
      ),
      availability: availabilityList(input.availability),
      trust: trustList(input.trust),
    };
  }
  if (kind === "semantic:project") {
    assertKeys(input, [
      "kind",
      "projectId",
      "workspaceGeneration",
      "trust",
      "availability",
    ]);
    return {
      kind,
      projectId: opaqueId(input.projectId, "projectId"),
      workspaceGeneration: sequence(
        input.workspaceGeneration,
        "workspaceGeneration",
      ),
      trust: parseSemanticProtocolTrustState(input.trust),
      availability: availabilityList(input.availability),
    };
  }
  if (kind === "semantic:document_accepted") {
    assertKeys(input, ["kind", "uri", "documentVersion"]);
    return {
      kind,
      uri: parseSemanticProtocolUri(input.uri),
      documentVersion: sequence(input.documentVersion, "documentVersion"),
    };
  }
  if (kind === "semantic:replay") {
    assertKeys(input, ["kind", "projectId", "documents"]);
    if (
      !Array.isArray(input.documents) ||
      input.documents.length > MAX_SEMANTIC_OPEN_DOCUMENTS
    ) {
      throw new SemanticProtocolError("invalid replay documents");
    }
    return {
      kind,
      projectId: opaqueId(input.projectId, "projectId"),
      documents: input.documents.map((document) => {
        const item = record(document);
        assertKeys(item, ["uri", "documentVersion"]);
        return {
          uri: parseSemanticProtocolUri(item.uri),
          documentVersion: sequence(item.documentVersion, "documentVersion"),
        };
      }),
    };
  }
  if (kind === "semantic:status") {
    assertKeys(input, ["kind", "projectId", "state", "policyRevision"]);
    return {
      kind,
      projectId: opaqueId(input.projectId, "projectId"),
      state: statusState(input.state),
      policyRevision: sequence(input.policyRevision, "policyRevision"),
    };
  }
  if (kind === "semantic:progress") {
    assertKeys(input, [
      "kind",
      "requestId",
      "documentVersion",
      "policyRevision",
      "state",
    ]);
    return {
      kind,
      requestId: opaqueId(input.requestId, "requestId"),
      documentVersion: sequence(input.documentVersion, "documentVersion"),
      policyRevision: sequence(input.policyRevision, "policyRevision"),
      state: statusState(input.state),
    };
  }
  if (kind === "semantic:trust_changed") {
    assertKeys(input, ["kind", "projectId", "trust", "reason"]);
    return {
      kind,
      projectId: opaqueId(input.projectId, "projectId"),
      trust: parseSemanticProtocolTrustState(input.trust),
      reason: trustEventReason(input.reason),
    };
  }
  if (kind === "semantic:workspace_changed" || kind === "semantic:closed") {
    assertKeys(input, ["kind", "reason"]);
    return { kind, reason: closeReason(input.reason) };
  }
  throw new SemanticProtocolError("unsupported semantic server message kind");
}

export function serializeSemanticClientMessage(value: unknown): string {
  const json = JSON.stringify(parseSemanticClientMessage(value));
  if (
    new TextEncoder().encode(json).byteLength > MAX_SEMANTIC_WS_MESSAGE_BYTES
  ) {
    throw new SemanticProtocolError("semantic message too large");
  }
  return json;
}

function availabilityList(value: unknown): SemanticDescriptorAvailability[] {
  if (!Array.isArray(value))
    throw new SemanticProtocolError("invalid availability list");
  return value.map(parseSemanticProtocolAvailability);
}

function trustList(value: unknown): SemanticTrustState[] {
  if (!Array.isArray(value))
    throw new SemanticProtocolError("invalid trust list");
  return value.map(parseSemanticProtocolTrustState);
}

function statusState(value: unknown): SemanticStatusState {
  if (!statusStates.has(value as SemanticStatusState)) {
    throw new SemanticProtocolError("invalid semantic status");
  }
  return value as SemanticStatusState;
}

function trustEventReason(value: unknown): SemanticTrustEventReason {
  if (!trustEventReasons.has(value as SemanticTrustEventReason)) {
    throw new SemanticProtocolError("invalid trust event reason");
  }
  return value as SemanticTrustEventReason;
}

function closeReason(value: unknown): SemanticCloseReason {
  if (!closeReasons.has(value as SemanticCloseReason)) {
    throw new SemanticProtocolError("invalid semantic close reason");
  }
  return value as SemanticCloseReason;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SemanticProtocolError("object required");
  }
  return value as Record<string, unknown>;
}

function assertKeys(input: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new SemanticProtocolError("unsupported semantic field");
  }
}

function requiredString(value: unknown, key: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0") ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    throw new SemanticProtocolError(`invalid ${key}`);
  }
  return value;
}

function requiredText(value: unknown): string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > MAX_SEMANTIC_DOCUMENT_BYTES
  ) {
    throw new SemanticProtocolError("invalid document text");
  }
  return value;
}

function opaqueId(value: unknown, key: string): string {
  const candidate = requiredString(value, key, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate)) {
    throw new SemanticProtocolError(`invalid ${key}`);
  }
  return candidate;
}

function sequence(value: unknown, key: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SEMANTIC_SEQUENCE
  ) {
    throw new SemanticProtocolError(`invalid ${key}`);
  }
  return value;
}

const navigationKinds = new Set([
  "targets",
  "empty",
  "cancelled",
  "stale",
  "unavailable",
  "error",
]);
const statusStates = new Set<SemanticStatusState>([
  "starting",
  "ready",
  "indexing",
  "restricted",
  "crashed",
  "unavailable",
]);
const trustEventReasons = new Set<SemanticTrustEventReason>([
  "transition",
  "revoked",
  "policyChanged",
]);
const closeReasons = new Set<SemanticCloseReason>([
  "clientDisconnected",
  "workspaceChanged",
  "projectRevoked",
  "policyChanged",
  "serverShutdown",
]);
const transportErrors = new Set<SemanticTransportErrorCode>([
  "invalidMessage",
  "unknownMessage",
  "unknownProject",
  "projectMismatch",
  "profileMismatch",
  "staleDocument",
  "policyChanged",
  "deadlineExceeded",
  "unsupportedCapability",
  "internalUnavailable",
  "messageTooLarge",
]);

export type { SemanticNavigationResponse };
