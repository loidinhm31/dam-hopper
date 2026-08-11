import {
  MAX_SEMANTIC_LABEL_LENGTH,
  MAX_SEMANTIC_POSITION,
  MAX_SEMANTIC_RESPONSE_BYTES,
  MAX_SEMANTIC_SEQUENCE,
  MAX_SEMANTIC_TARGETS,
  type SemanticLanguage,
  type SemanticAvailabilityReason,
  type SemanticDescriptorAvailability,
  type SemanticNavigationRequest,
  type SemanticNavigationCancellation,
  type SemanticNavigationErrorCode,
  type SemanticNavigationResponse,
  type SemanticNavigationResponseContext,
  type SemanticNavigationTarget,
  type SemanticPosition,
  type SemanticRange,
  type SemanticTrustTransitionRequest,
  type SemanticTrustChallenge,
  type SemanticTrustState,
  type SemanticTrustTransitionReason,
  type SemanticUri,
  SemanticProtocolError,
} from "./semantic-protocol.js";

const languages = new Set<SemanticLanguage>([
  "rust",
  "typescript",
  "javascript",
  "java",
]);
const operations = new Set(["definition", "implementation", "references"]);
const availabilityStates = new Set([
  "ready",
  "bundleUnavailable",
  "bundleInvalid",
  "unsupportedCapability",
  "restricted",
  "starting",
  "indexing",
  "crashed",
]);
const availabilityReasons = new Set<SemanticAvailabilityReason>([
  "releaseManifestMissing",
  "releaseManifestInvalid",
  "capabilityUnsupported",
  "projectRestricted",
  "runtimeStarting",
  "runtimeIndexing",
  "runtimeCrashed",
]);
const trustReasons = new Set<SemanticTrustTransitionReason>([
  "policyLocked",
  "confirmationRequired",
  "policyRevisionChanged",
]);
const responseKinds = new Set([
  "targets",
  "empty",
  "cancelled",
  "stale",
  "unavailable",
  "error",
]);
const responseErrors = new Set<SemanticNavigationErrorCode>([
  "requestInvalid",
  "staleDocument",
  "policyChanged",
  "deadlineExceeded",
  "responseTooLarge",
  "internalUnavailable",
]);

function record(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("object required");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) fail(`unsupported field: ${key}`);
  }
  return result;
}

function fail(message: string): never {
  throw new SemanticProtocolError(message);
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  maxLength = 256,
): string {
  const candidate = value[key];
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    new TextEncoder().encode(candidate).byteLength > maxLength ||
    candidate.includes("\0") ||
    candidate.trim() !== candidate
  ) {
    fail(`invalid ${key}`);
  }
  return candidate;
}

function opaqueId(value: Record<string, unknown>, key: string): string {
  const candidate = requiredString(value, key, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate)) {
    fail(`invalid opaque ${key}`);
  }
  return candidate;
}

function nonNegativeInteger(value: unknown, key: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SEMANTIC_POSITION
  ) {
    fail(`invalid ${key}`);
  }
  return value;
}

function sequence(value: unknown, key: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SEMANTIC_SEQUENCE
  ) {
    fail(`invalid ${key}`);
  }
  return value;
}

export function parseSemanticUri(value: unknown): SemanticUri {
  const input = record(value, ["profileId", "projectId", "path", "language"]);
  const path = requiredString(input, "path", 1024);
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail("path must be a normalized project-relative path");
  }
  const language = requiredString(input, "language", 32) as SemanticLanguage;
  if (!languages.has(language)) fail("unsupported language");
  return {
    profileId: opaqueId(input, "profileId"),
    projectId: opaqueId(input, "projectId"),
    path,
    language,
  };
}

function parsePosition(value: unknown): SemanticPosition {
  const input = record(value, ["line", "character"]);
  return {
    line: nonNegativeInteger(input.line, "line"),
    character: nonNegativeInteger(input.character, "character"),
  };
}

export function parseSemanticRange(value: unknown): SemanticRange {
  const input = record(value, ["start", "end"]);
  const start = parsePosition(input.start);
  const end = parsePosition(input.end);
  if (
    end.line < start.line ||
    (end.line === start.line && end.character < start.character)
  ) {
    fail("range end precedes start");
  }
  return { start, end };
}

export function parseSemanticNavigationRequest(
  value: unknown,
): SemanticNavigationRequest {
  const input = record(value, [
    "requestId",
    "documentVersion",
    "operation",
    "uri",
    "position",
    "maxTargets",
  ]);
  const operation = requiredString(input, "operation", 32);
  if (!operations.has(operation)) fail("unsupported operation");
  const maxTargets =
    input.maxTargets === undefined
      ? undefined
      : nonNegativeInteger(input.maxTargets, "maxTargets");
  if (
    maxTargets !== undefined &&
    (maxTargets === 0 || maxTargets > MAX_SEMANTIC_TARGETS)
  ) {
    fail("maxTargets outside limit");
  }
  return {
    requestId: opaqueId(input, "requestId"),
    documentVersion: sequence(input.documentVersion, "documentVersion"),
    operation: operation as SemanticNavigationRequest["operation"],
    uri: parseSemanticUri(input.uri),
    position: parsePosition(input.position),
    ...(maxTargets === undefined ? {} : { maxTargets }),
  };
}

function parseTarget(value: unknown): SemanticNavigationTarget {
  const input = record(value, ["uri", "range", "label"]);
  return {
    uri: parseSemanticUri(input.uri),
    range: parseSemanticRange(input.range),
    label: requiredString(input, "label", MAX_SEMANTIC_LABEL_LENGTH),
  };
}

export function parseSemanticNavigationTargets(
  value: unknown,
): SemanticNavigationTarget[] {
  if (!Array.isArray(value) || value.length > MAX_SEMANTIC_TARGETS) {
    fail("target count outside limit");
  }
  const targets = value.map(parseTarget);
  if (
    new TextEncoder().encode(JSON.stringify(targets)).byteLength >
    MAX_SEMANTIC_RESPONSE_BYTES
  ) {
    fail("target response outside byte limit");
  }
  return targets;
}

function parseResponseContext(
  value: Record<string, unknown>,
): SemanticNavigationResponseContext {
  return {
    requestId: opaqueId(value, "requestId"),
    documentVersion: sequence(value.documentVersion, "documentVersion"),
    policyRevision: sequence(value.policyRevision, "policyRevision"),
  };
}

function assertResponseFits(value: SemanticNavigationResponse): void {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_SEMANTIC_RESPONSE_BYTES
  ) {
    fail("semantic response outside byte limit");
  }
}

export function parseSemanticNavigationCancellation(
  value: unknown,
): SemanticNavigationCancellation {
  const input = record(value, ["requestId", "documentVersion"]);
  return {
    requestId: opaqueId(input, "requestId"),
    documentVersion: sequence(input.documentVersion, "documentVersion"),
  };
}

export function parseSemanticNavigationResponse(
  value: unknown,
): SemanticNavigationResponse {
  const raw = record(value, [
    "kind",
    "requestId",
    "documentVersion",
    "policyRevision",
    "targets",
    "availability",
    "error",
  ]);
  const kind = requiredString(raw, "kind", 32);
  if (!responseKinds.has(kind)) fail("invalid semantic response kind");
  const context = parseResponseContext(raw);
  let response: SemanticNavigationResponse;
  switch (kind) {
    case "targets":
      if (raw.availability !== undefined || raw.error !== undefined) {
        fail("invalid target response");
      }
      response = {
        ...context,
        kind,
        targets: parseSemanticNavigationTargets(raw.targets),
      };
      break;
    case "empty":
    case "cancelled":
    case "stale":
      if (
        raw.targets !== undefined ||
        raw.availability !== undefined ||
        raw.error !== undefined
      ) {
        fail("invalid terminal response");
      }
      response = { ...context, kind };
      break;
    case "unavailable":
      if (raw.targets !== undefined || raw.error !== undefined) {
        fail("invalid unavailable response");
      }
      response = {
        ...context,
        kind,
        availability: parseSemanticDescriptorAvailability(raw.availability),
      };
      break;
    case "error": {
      if (raw.targets !== undefined || raw.availability !== undefined) {
        fail("invalid error response");
      }
      const error = requiredString(
        raw,
        "error",
        32,
      ) as SemanticNavigationErrorCode;
      if (!responseErrors.has(error)) fail("invalid semantic response error");
      response = { ...context, kind, error };
      break;
    }
    default:
      fail("invalid semantic response kind");
  }
  assertResponseFits(response);
  return response;
}

export function parseSemanticTrustTransitionRequest(
  value: unknown,
): SemanticTrustTransitionRequest {
  const input = record(value, ["projectId", "desiredTrust", "confirmation"]);
  const desiredTrust = requiredString(input, "desiredTrust", 16);
  if (desiredTrust !== "restricted" && desiredTrust !== "trusted") {
    fail("invalid desiredTrust");
  }
  return {
    projectId: opaqueId(input, "projectId"),
    desiredTrust,
    confirmation: requiredString(input, "confirmation", 512),
  };
}

export function parseSemanticTrustChallenge(
  value: unknown,
): SemanticTrustChallenge {
  const input = record(value, [
    "projectId",
    "challenge",
    "policyRevision",
    "expiresAt",
  ]);
  return {
    projectId: opaqueId(input, "projectId"),
    challenge: requiredString(input, "challenge", 512),
    policyRevision: sequence(input.policyRevision, "policyRevision"),
    expiresAt: sequence(input.expiresAt, "expiresAt"),
  };
}

export function parseSemanticDescriptorAvailability(
  value: unknown,
): SemanticDescriptorAvailability {
  const input = record(value, ["descriptorId", "language", "state", "reason"]);
  const language = requiredString(input, "language", 32) as SemanticLanguage;
  const state = requiredString(input, "state", 32);
  const reason = input.reason;
  if (!languages.has(language) || !availabilityStates.has(state)) {
    fail("invalid descriptor availability");
  }
  if (
    reason !== undefined &&
    !availabilityReasons.has(reason as SemanticAvailabilityReason)
  ) {
    fail("invalid descriptor availability reason");
  }
  return {
    descriptorId: opaqueId(input, "descriptorId"),
    language,
    state: state as SemanticDescriptorAvailability["state"],
    ...(reason === undefined
      ? {}
      : { reason: reason as SemanticAvailabilityReason }),
  };
}

export function parseSemanticTrustState(value: unknown): SemanticTrustState {
  const input = record(value, [
    "projectId",
    "trust",
    "canTransition",
    "transitionReason",
    "policyRevision",
  ]);
  const trust = requiredString(input, "trust", 16);
  const transitionReason = input.transitionReason;
  const policyRevision = input.policyRevision;
  if (
    !["restricted", "trusted", "revoked"].includes(trust) ||
    typeof input.canTransition !== "boolean" ||
    typeof policyRevision !== "number" ||
    !Number.isSafeInteger(policyRevision) ||
    policyRevision < 0 ||
    (transitionReason !== undefined &&
      !trustReasons.has(transitionReason as SemanticTrustTransitionReason))
  ) {
    fail("invalid trust state");
  }
  return {
    projectId: opaqueId(input, "projectId"),
    trust: trust as SemanticTrustState["trust"],
    canTransition: input.canTransition,
    policyRevision,
    ...(transitionReason === undefined
      ? {}
      : {
          transitionReason: transitionReason as SemanticTrustTransitionReason,
        }),
  };
}
