import {
  parseSemanticNavigationRequest,
  parseSemanticNavigationTargets,
  parseSemanticNavigationCancellation,
  parseSemanticNavigationResponse,
  parseSemanticRange,
  parseSemanticDescriptorAvailability,
  parseSemanticTrustState,
  parseSemanticTrustChallenge,
  parseSemanticTrustTransitionRequest,
  parseSemanticUri,
} from "./semantic-protocol-validation.js";

export const PREWARM_DWELL_MS = 750;
/** Gate B: virtualized metadata results avoid Monaco's unopened-model resolver. */
export const SEMANTIC_NAVIGATION_UI_BRANCH = "sharedVirtualizedResults";
export const MAX_SEMANTIC_TARGETS = 500;
export const MAX_SEMANTIC_RESPONSE_BYTES = 1024 * 1024;
export const MAX_SEMANTIC_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_SEMANTIC_POSITION = 1_000_000;
export const MAX_SEMANTIC_LABEL_LENGTH = 512;
export const MAX_SEMANTIC_REASON_LENGTH = 512;
export const MAX_SEMANTIC_SEQUENCE = Number.MAX_SAFE_INTEGER;

export type SemanticLanguage = "rust" | "typescript" | "javascript" | "java";
export type SemanticOperation = "definition" | "implementation" | "references";

/** A browser-safe identity; the server resolves it only after authorization. */
export interface SemanticUri {
  profileId: string;
  projectId: string;
  path: string;
  language: SemanticLanguage;
}

export interface SemanticPosition {
  /** Zero-based UTF-16 line and character offsets, matching Monaco and LSP. */
  line: number;
  character: number;
}

export interface SemanticRange {
  start: SemanticPosition;
  end: SemanticPosition;
}

export interface SemanticNavigationRequest {
  requestId: string;
  /** Monotonic open-buffer version; binds the request to one document snapshot. */
  documentVersion: number;
  operation: SemanticOperation;
  uri: SemanticUri;
  position: SemanticPosition;
  maxTargets?: number;
}

export interface SemanticNavigationTarget {
  uri: SemanticUri;
  range: SemanticRange;
  label: string;
}

/** Correlates every result with the exact document and trust policy snapshot. */
export interface SemanticNavigationResponseContext {
  requestId: string;
  documentVersion: number;
  policyRevision: number;
}

export interface SemanticNavigationCancellation {
  requestId: string;
  documentVersion: number;
}

export type SemanticNavigationErrorCode =
  | "requestInvalid"
  | "staleDocument"
  | "policyChanged"
  | "deadlineExceeded"
  | "responseTooLarge"
  | "internalUnavailable";

export type SemanticNavigationResponse =
  | (SemanticNavigationResponseContext & {
      kind: "targets";
      targets: SemanticNavigationTarget[];
    })
  | (SemanticNavigationResponseContext & {
      kind: "empty" | "cancelled" | "stale";
    })
  | (SemanticNavigationResponseContext & {
      kind: "unavailable";
      availability: SemanticDescriptorAvailability;
    })
  | (SemanticNavigationResponseContext & {
      kind: "error";
      error: SemanticNavigationErrorCode;
    });

export type SemanticAvailabilityState =
  | "ready"
  | "bundleUnavailable"
  | "bundleInvalid"
  | "unsupportedCapability"
  | "restricted"
  | "starting"
  | "indexing"
  | "crashed";

/** Stable, non-sensitive diagnostics. Never carry paths, stderr, or commands. */
export type SemanticAvailabilityReason =
  | "releaseManifestMissing"
  | "releaseManifestInvalid"
  | "capabilityUnsupported"
  | "projectRestricted"
  | "runtimeStarting"
  | "runtimeIndexing"
  | "runtimeCrashed";

export interface SemanticDescriptorAvailability {
  descriptorId: string;
  language: SemanticLanguage;
  state: SemanticAvailabilityState;
  reason?: SemanticAvailabilityReason;
}

export type SemanticTrust = "restricted" | "trusted" | "revoked";

/** Stable trust transition diagnostics; arbitrary consent text is never returned. */
export type SemanticTrustTransitionReason =
  | "policyLocked"
  | "confirmationRequired"
  | "policyRevisionChanged";

export interface SemanticTrustState {
  projectId: string;
  trust: SemanticTrust;
  canTransition: boolean;
  transitionReason?: SemanticTrustTransitionReason;
  policyRevision: number;
}

/** The server issues this before accepting a trust transition. */
export interface SemanticTrustChallenge {
  projectId: string;
  challenge: string;
  policyRevision: number;
  expiresAt: number;
}

/** Client input intentionally cannot select policy, commands, or LSP options. */
export interface SemanticTrustTransitionRequest {
  projectId: string;
  desiredTrust: Exclude<SemanticTrust, "revoked">;
  confirmation: string;
}

/** Local-only event; a semantic transport may receive it after the dwell. */
export interface PrewarmIntent {
  profileId: string;
  /** Local workspace label retained for churn grouping; never a host path. */
  workspaceId: string;
  /** Server-authoritative lifecycle generation used to fence replacements. */
  workspaceGeneration: number;
  projectId: string;
  language: SemanticLanguage;
  tabGeneration: number;
}

export interface PrewarmEligibility {
  supported: boolean;
  hydrated: boolean;
  active: boolean;
}

export class SemanticProtocolError extends Error {
  override name = "SemanticProtocolError";
}

export function parseSemanticProtocolUri(value: unknown): SemanticUri {
  return parseSemanticUri(value);
}

export function parseSemanticProtocolRange(value: unknown): SemanticRange {
  return parseSemanticRange(value);
}

export function parseSemanticProtocolRequest(
  value: unknown,
): SemanticNavigationRequest {
  return parseSemanticNavigationRequest(value);
}

export function parseSemanticProtocolTargets(
  value: unknown,
): SemanticNavigationTarget[] {
  return parseSemanticNavigationTargets(value);
}

export function parseSemanticProtocolCancellation(
  value: unknown,
): SemanticNavigationCancellation {
  return parseSemanticNavigationCancellation(value);
}

export function parseSemanticProtocolResponse(
  value: unknown,
): SemanticNavigationResponse {
  return parseSemanticNavigationResponse(value);
}

export function parseSemanticProtocolAvailability(
  value: unknown,
): SemanticDescriptorAvailability {
  return parseSemanticDescriptorAvailability(value);
}

export function parseSemanticProtocolTrustState(
  value: unknown,
): SemanticTrustState {
  return parseSemanticTrustState(value);
}

export function parseSemanticProtocolTrustChallenge(
  value: unknown,
): SemanticTrustChallenge {
  return parseSemanticTrustChallenge(value);
}

export function parseSemanticTrustTransition(
  value: unknown,
): SemanticTrustTransitionRequest {
  return parseSemanticTrustTransitionRequest(value);
}

/** Strict parsing prevents object spreads from leaking host-only fields on wire. */
export function serializeSemanticNavigationRequest(value: unknown): string {
  return JSON.stringify(parseSemanticNavigationRequest(value));
}
