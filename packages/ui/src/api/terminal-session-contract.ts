/**
 * Shared Frozen Contracts for DamHopper OS Session Management & Terminal Termination (P01).
 *
 * Implements architecture contracts C1–C5 from
 * plans/261104-1529-os-session-management-and-interactions/architecture-contracts.md
 * and phase-01-shared-contracts.md.
 *
 * Strictly typed interfaces, error codes, HTTP headers, pure validators, and seams.
 * No runtime services, mocks, or global state.
 */

import type { ConnectionRef } from "./ownership.js";
import type { SessionInfo } from "./client.js";

// ============================================================================
// Protocol Headers & Constants
// ============================================================================

export const X_DAM_HOPPER_TERMINATION_VERSION = "X-DamHopper-Termination-Version" as const;
export const X_DAM_HOPPER_PTY_EPOCH = "X-DamHopper-PTY-Epoch" as const;

export const TERMINATION_PROTOCOL_VERSION = 1 as const;
export const TERMINATION_MAX_BODY_BYTES = 512 as const;

// Maximum positive unsigned 64-bit integer: 2^64 - 1
export const MAX_U64_STRING = "18446744073709551615" as const;
export const MAX_U64_BIGINT = 18446744073709551615n;

// ============================================================================
// Error Codes & Envelopes
// ============================================================================

export const TERMINATION_INVALID_REQUEST = "TERMINATION_INVALID_REQUEST" as const;
export const TERMINATION_UNSUPPORTED_VERSION = "TERMINATION_UNSUPPORTED_VERSION" as const;
export const TERMINATION_NOT_FOUND = "TERMINATION_NOT_FOUND" as const;
export const TERMINATION_EPOCH_MISMATCH = "TERMINATION_EPOCH_MISMATCH" as const;
export const TERMINATION_INCARNATION_MISMATCH = "TERMINATION_INCARNATION_MISMATCH" as const;
export const TERMINATION_REPLACEMENT_PENDING = "TERMINATION_REPLACEMENT_PENDING" as const;
export const TERMINATION_NOT_LIVE = "TERMINATION_NOT_LIVE" as const;
export const TERMINATION_MANAGER_CLOSING = "TERMINATION_MANAGER_CLOSING" as const;
export const TERMINATION_ALREADY_REQUESTED = "TERMINATION_ALREADY_REQUESTED" as const;
export const TERMINATION_SIGNAL_FAILED = "TERMINATION_SIGNAL_FAILED" as const;
export const TERMINATION_BODY_TOO_LARGE = "TERMINATION_BODY_TOO_LARGE" as const;

export type TerminationErrorCode =
  | typeof TERMINATION_INVALID_REQUEST
  | typeof TERMINATION_UNSUPPORTED_VERSION
  | typeof TERMINATION_NOT_FOUND
  | typeof TERMINATION_EPOCH_MISMATCH
  | typeof TERMINATION_INCARNATION_MISMATCH
  | typeof TERMINATION_REPLACEMENT_PENDING
  | typeof TERMINATION_NOT_LIVE
  | typeof TERMINATION_MANAGER_CLOSING
  | typeof TERMINATION_ALREADY_REQUESTED
  | typeof TERMINATION_SIGNAL_FAILED
  | typeof TERMINATION_BODY_TOO_LARGE;

export interface TerminationErrorEnvelope {
  readonly error: string;
  readonly code: TerminationErrorCode;
}

// ============================================================================
// Terminal Inventory Wire & Observation Types
// ============================================================================

export type TerminationMetadata =
  | { readonly version: 1; readonly serverEpoch: string }
  | { readonly version: null; readonly serverEpoch: null; readonly reason: "unsupported" | "invalidMetadata" };

export type TerminalInventoryTerminationState =
  | "live"
  | "terminationRequested"
  | "restartPending"
  | "restartCancelled"
  | "exited"
  | "unavailable";

export type TerminalInventoryRow = SessionInfo & {
  readonly incarnationExact?: string;
  readonly terminationState?: TerminalInventoryTerminationState;
};

export type TerminalInventoryDetailedRow = TerminalInventoryRow & {
  readonly buffer_bytes: number;
};

export interface TerminalInventoryPayload {
  readonly sessions: readonly TerminalInventoryRow[];
  readonly termination: TerminationMetadata;
}

export interface TerminalInventoryDetailedPayload {
  readonly sessions: readonly TerminalInventoryDetailedRow[];
  readonly termination: TerminationMetadata;
}

export type TerminalInventoryObservation = TerminalInventoryPayload & {
  readonly owner: ConnectionRef | null;
};

export type TerminalInventoryDetailedObservation = TerminalInventoryDetailedPayload & {
  readonly owner: ConnectionRef | null;
};

// ============================================================================
// Terminal Target & Close Request
// ============================================================================

export type TerminalTarget = Readonly<{
  profileId: string;
  generation: number;
  serverEpoch: string;
  terminalId: string;
  incarnation: string;
}>;

/**
 * Canonical full-identity tuple string for TerminalTarget:
 * JSON.stringify([profileId, generation, serverEpoch, terminalId, incarnation])
 * Preserves incarnation as an exact string and eliminates delimiter collision risks.
 */
export function terminalTargetKey(target: TerminalTarget): string {
  return JSON.stringify([
    target.profileId,
    target.generation,
    target.serverEpoch,
    target.terminalId,
    target.incarnation,
  ]);
}

export function parseTerminalTargetKey(key: string): TerminalTarget | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 5 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "number" &&
      typeof parsed[2] === "string" &&
      typeof parsed[3] === "string" &&
      typeof parsed[4] === "string"
    ) {
      return Object.freeze({
        profileId: parsed[0],
        generation: parsed[1],
        serverEpoch: parsed[2],
        terminalId: parsed[3],
        incarnation: parsed[4],
      });
    }
  } catch {
    // ignore
  }
  return null;
}

export type WindowTerminalAvailability =
  | "live"
  | "terminationRequested"
  | "restartPending"
  | "restartCancelled"
  | "exited"
  | "unknown";

export function mapTerminalRowAvailability(
  state: TerminalInventoryTerminationState | undefined,
): WindowTerminalAvailability {
  switch (state) {
    case "live":
      return "live";
    case "terminationRequested":
      return "terminationRequested";
    case "restartPending":
      return "restartPending";
    case "restartCancelled":
      return "restartCancelled";
    case "exited":
      return "exited";
    case "unavailable":
    default:
      return "unknown";
  }
}

export interface TerminalCloseRequest {
  readonly windowId: string;
  readonly entry: "frame" | "window-list" | "pane-tab";
  readonly target: TerminalTarget | null;
  readonly availability: WindowTerminalAvailability;
  readonly reason?: string;
}

export interface TerminalTerminateBody {
  readonly version: 1;
  readonly expectedServerEpoch: string;
  readonly expectedIncarnation: string;
}

export type TerminationOutcome = "terminationRequested" | "restartCancelled";

export interface TerminationResult {
  readonly version: 1;
  readonly serverEpoch: string;
  readonly terminalId: string;
  readonly incarnation: string;
  readonly outcome: TerminationOutcome;
}

// ============================================================================
// Termination State Machine (Discriminated Union)
// ============================================================================

export type TerminationOrigin = "live" | "restartPending";

export type TerminationStatus =
  | "captured"
  | "confirming"
  | "dispatching"
  | "terminationRequested"
  | "restartCancelled"
  | "ended"
  | "refused"
  | "failed"
  | "outcomeUnknown";

export type TerminationTransportFailureCategory =
  | "network_error"
  | "timeout"
  | "abort"
  | "malformed_response"
  | "status_outcome_mismatch"
  | "echoed_identity_mismatch"
  | "origin_incompatible_success";

export type TerminationStateReason =
  | "user_close"
  | "user_end_confirmed"
  | "reconciliation_observed_exit"
  | "reconciliation_observed_cancelled"
  | "restart_pre_reservation_cancelled"
  | "live_signal_dispatched";

export interface TerminationFailureDetail {
  readonly category:
    | TerminationTransportFailureCategory
    | "protocol_refusal"
    | "signal_dispatch_failed";
  readonly code?: TerminationErrorCode;
  readonly message: string;
}

export type TerminationState =
  | {
      readonly status: "captured";
      readonly target: TerminalTarget;
      readonly origin: TerminationOrigin;
      readonly reason?: TerminationStateReason;
      readonly error?: undefined;
    }
  | {
      readonly status: "confirming";
      readonly target: TerminalTarget;
      readonly origin: TerminationOrigin;
      readonly reason?: TerminationStateReason;
      readonly error?: undefined;
    }
  | {
      readonly status: "dispatching";
      readonly target: TerminalTarget;
      readonly origin: TerminationOrigin;
      readonly reason?: TerminationStateReason;
      readonly error?: undefined;
    }
  | {
      readonly status: "terminationRequested";
      readonly target: TerminalTarget;
      readonly origin: "live";
      readonly reason?: TerminationStateReason;
      readonly error?: undefined;
    }
  | {
      readonly status: "restartCancelled";
      readonly target: TerminalTarget;
      readonly origin: "restartPending";
      readonly reason?: TerminationStateReason;
      readonly error?: undefined;
    }
  | {
      readonly status: "ended";
      readonly target: TerminalTarget;
      readonly origin: "live";
      readonly reason?: TerminationStateReason;
      readonly error?: undefined;
    }
  | {
      readonly status: "refused";
      readonly target: TerminalTarget;
      readonly origin: TerminationOrigin;
      readonly error: TerminationErrorEnvelope;
      readonly reason?: TerminationStateReason;
    }
  | {
      readonly status: "failed";
      readonly target: TerminalTarget;
      readonly origin: TerminationOrigin;
      readonly error: TerminationFailureDetail;
      readonly reason?: TerminationStateReason;
    }
  | {
      readonly status: "outcomeUnknown";
      readonly target: TerminalTarget;
      readonly origin: TerminationOrigin;
      readonly error?: TerminationFailureDetail;
      readonly reason?: TerminationStateReason;
    };
// ============================================================================
// Placement Intent & Review Target
// ============================================================================

export interface TerminalPlacementIntent {
  readonly sourceHubWindowId: string;
  readonly target: TerminalTarget;
  readonly action: "focus-existing" | "open-beside" | "move-beside";
}

export type ReviewTarget = Readonly<{
  profileId: string;
  generation: number;
  terminalId: string;
  terminalIncarnation: string;
  ompSessionId: string;
  serverEpoch: string;
  rootId: string;
  baselineId: string;
}>;

// ============================================================================
// Seams & Controller Callbacks
// ============================================================================

export type RequestTerminalCloseFn = (
  request: TerminalCloseRequest,
  onCloseView: () => void,
) => Promise<void>;

// ============================================================================
// Pure Validation & Invariant Helpers
// ============================================================================

const CANONICAL_POSITIVE_U64_RE = /^[1-9][0-9]{0,19}$/;
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Validates canonical positive-u64 decimal spelling:
 * Range: 1..18446744073709551615.
 * Strictly no leading zeros, signs, whitespace, floats, or exponents.
 */
export function isCanonicalPositiveU64(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Strictly reject any whitespace, newlines, carriage returns
  if (/[\s\r\n]/.test(value)) return false;
  if (!CANONICAL_POSITIVE_U64_RE.test(value)) return false;
  try {
    const n = BigInt(value);
    return n > 0n && n <= MAX_U64_BIGINT;
  } catch {
    return false;
  }
}

/**
 * Validates canonical lowercase hyphenated UUID format.
 */
export function isCanonicalUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (/[\s\r\n]/.test(value)) return false;
  return CANONICAL_UUID_RE.test(value);
}

const TERMINAL_INVENTORY_STATES: Record<TerminalInventoryTerminationState, true> = Object.freeze(
  Object.assign(Object.create(null), {
    live: true,
    terminationRequested: true,
    restartPending: true,
    restartCancelled: true,
    exited: true,
    unavailable: true,
  }),
);

/**
 * Validates whether a value is one of the six flat inventory termination states.
 * Unknown strings or inherited prototype properties return false and must NEVER default to 'exited'.
 */
export function isTerminalInventoryTerminationState(
  value: unknown,
): value is TerminalInventoryTerminationState {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TERMINAL_INVENTORY_STATES, value)
  );
}

/**
 * Validates whether an inventory row is eligible to form a TerminalTarget.
 *
 * Rules:
 * 1. incarnationExact MUST be present and valid canonical positive-u64 decimal.
 *    Missing/malformed exact NEVER falls back to legacy numeric, even if numeric is safe.
 * 2. When legacy numeric incarnation is a safe integer (Number.isSafeInteger(n)),
 *    it MUST be > 0 and losslessly equal: String(n) === incarnationExact.
 *    Safe disagreement or nonpositive legacy rejects eligibility.
 * 3. When legacy numeric incarnation is an unsafe integer (e.g. > Number.MAX_SAFE_INTEGER),
 *    it neither invalidates valid exact nor supplies equality proof; valid exact remains eligible.
 */
export function isTerminalInventoryRowEligible(
  row: Pick<TerminalInventoryRow, "incarnation" | "incarnationExact">,
): boolean {
  if (!row.incarnationExact || !isCanonicalPositiveU64(row.incarnationExact)) {
    return false;
  }
  if (typeof row.incarnation === "number" && Number.isSafeInteger(row.incarnation)) {
    if (row.incarnation <= 0 || String(row.incarnation) !== row.incarnationExact) {
      return false;
    }
  }
  return true;
}

/**
 * Proves downstream numeric join evidence (e.g. Agent, Port, Replay observations).
 *
 * Distinct from inventory eligibility:
 * Downstream join proof STRICTLY REQUIRES positive-safe lossless equality to the exact target.
 * Unsafe numbers ALWAYS fail proof, even if the inventory row's exact string is fully valid.
 */
export function proveNumericEvidenceJoin(
  numericEvidence: unknown,
  targetIncarnationExact: string,
): boolean {
  if (!isCanonicalPositiveU64(targetIncarnationExact)) return false;
  if (typeof numericEvidence !== "number") return false;
  if (!Number.isSafeInteger(numericEvidence)) return false;
  if (numericEvidence <= 0) return false;
  return String(numericEvidence) === targetIncarnationExact;
}

/**
 * Constructs an immutable TerminalTarget from a verified observation and one of its rows.
 *
 * Enforces Architecture Contract C1:
 * - observation must have a non-null owner ConnectionRef.
 * - observation termination metadata must be valid (version 1, canonical UUID serverEpoch).
 * - row MUST be an actual member of observation.sessions (never combine an old row with a new epoch).
 * - row must satisfy isTerminalInventoryRowEligible.
 *
 * NOTE: This is a pure snapshot invariant constructor. Callers remain strictly obligated
 * to revalidate that the owner connection is currently active before dispatching mutations.
 */
export function createTerminalTargetFromObservation(
  observation: TerminalInventoryObservation,
  row: TerminalInventoryRow,
): TerminalTarget | null {
  if (!observation.owner) return null;
  if (observation.termination.version !== 1) return null;
  if (!isCanonicalUuid(observation.termination.serverEpoch)) return null;
  if (!observation.sessions.includes(row)) return null;
  if (!isTerminalInventoryRowEligible(row)) return null;

  return Object.freeze({
    profileId: observation.owner.profileId,
    generation: observation.owner.generation,
    serverEpoch: observation.termination.serverEpoch,
    terminalId: row.id,
    incarnation: row.incarnationExact!,
  });
}

/**
 * Validates a termination HTTP response against the dispatch target and origin.
 *
 * Invariants:
 * - 202 is ONLY valid for origin === "live" and outcome === "terminationRequested".
 * - 200 is ONLY valid for origin === "restartPending" and outcome === "restartCancelled".
 * - Echoed serverEpoch, terminalId, and incarnation must match target losslessly.
 * - Status/outcome/echo mismatch returns false (caller must treat as outcomeUnknown).
 */
export function isTerminationResultValid(
  statusCode: number,
  body: unknown,
  target: TerminalTarget,
  origin: TerminationOrigin,
): body is TerminationResult {
  if (typeof body !== "object" || body === null) return false;
  const res = body as Record<string, unknown>;

  if (res.version !== 1) return false;
  if (!isCanonicalUuid(res.serverEpoch)) return false;
  if (!isCanonicalPositiveU64(res.incarnation)) return false;
  if (res.serverEpoch !== target.serverEpoch) return false;
  if (res.terminalId !== target.terminalId) return false;
  if (res.incarnation !== target.incarnation) return false;

  if (origin === "live") {
    return statusCode === 202 && res.outcome === "terminationRequested";
  } else if (origin === "restartPending") {
    return statusCode === 200 && res.outcome === "restartCancelled";
  }
  return false;
}

export interface WindowTerminalObservationResult {
  readonly target: TerminalTarget | null;
  readonly availability: WindowTerminalAvailability;
}

/**
 * Resolves an OsWindow's terminal identity against actual owner-qualified inventory observations.
 *
 * Rules:
 * - Never defaults to "live" when unobserved. Unobserved returns availability: "unknown".
 * - Never replaces an already-captured target with a newer generation/epoch from inventory.
 * - For ordinary (dock-created or explicit-launched) windows without captured authority, matches
 *   the window's session ID and incarnation against observation rows to acquire verified TerminalTarget.
 */
export function resolveWindowTerminalObservation(
  win: {
    readonly id: string;
    readonly appId?: string;
    readonly ctx?: { readonly profileId?: string };
    readonly runtimeIdentity?: {
      readonly kind?: string;
      readonly target?: unknown;
    };
    readonly appState?: Record<string, unknown>;
  },
  observations: readonly TerminalInventoryDetailedObservation[],
): WindowTerminalObservationResult {
  if (win.appId && win.appId !== "terminals") {
    return { target: null, availability: "unknown" };
  }

  const profileId =
    win.ctx?.profileId ?? (win.appState?.profileId as string | undefined);
  const sessionId =
    (win.appState?.sessionId as string | undefined) ??
    (win.appState?.terminalId as string | undefined);

  const capturedTarget =
    win.runtimeIdentity?.kind === "terminal"
      ? (win.runtimeIdentity.target as TerminalTarget)
      : ((win.appState?.target ?? win.appState?.terminalTarget) as
          | TerminalTarget
          | undefined) ?? null;

  if (!sessionId && !capturedTarget) {
    return { target: null, availability: "unknown" };
  }

  const effectiveSessionId = capturedTarget?.terminalId ?? sessionId!;

  for (const obs of observations) {
    // Fail-closed: observation MUST have a non-null owner
    if (!obs.owner) {
      continue;
    }
    if (profileId && obs.owner.profileId !== profileId) {
      continue;
    }
    if (
      capturedTarget &&
      (obs.owner.profileId !== capturedTarget.profileId ||
        obs.owner.generation !== capturedTarget.generation)
    ) {
      continue;
    }

    for (const row of obs.sessions) {
      if (row.id !== effectiveSessionId) continue;
      // Fail-closed: enforce row eligibility (including numeric safe integer agreement)
      if (!isTerminalInventoryRowEligible(row)) continue;

      if (capturedTarget) {
        // Must match captured authority: same epoch and matching incarnation
        if (
          obs.termination.version !== 1 ||
          obs.termination.serverEpoch !== capturedTarget.serverEpoch
        ) {
          continue;
        }
        if (
          !row.incarnationExact ||
          row.incarnationExact !== capturedTarget.incarnation
        ) {
          continue;
        }

        const availability = mapTerminalRowAvailability(row.terminationState);
        return { target: capturedTarget, availability };
      }

      // Ordinary launched terminal without capturedTarget
      // Enforce complete verified originating lifetime provenance before promoting to destructive target:
      // 1. Originating generation: safe non-negative integer strictly matching observation generation
      const winGeneration = win.appState?.generation;
      if (
        typeof winGeneration !== "number" ||
        !Number.isSafeInteger(winGeneration) ||
        winGeneration < 0 ||
        obs.owner.generation !== winGeneration
      ) {
        continue;
      }

      // 2. Originating profileId: non-empty string strictly matching observation profile
      const winProfileId = (win.appState?.profileId ?? profileId) as string | undefined;
      if (!winProfileId || obs.owner.profileId !== winProfileId) {
        continue;
      }

      // 3. Originating PTY serverEpoch: canonical UUID strictly matching observation epoch
      const winServerEpoch = win.appState?.serverEpoch;
      if (
        typeof winServerEpoch !== "string" ||
        !isCanonicalUuid(winServerEpoch) ||
        obs.termination.version !== 1 ||
        obs.termination.serverEpoch !== winServerEpoch
      ) {
        continue;
      }

      // 4. Originating incarnation: canonical positive u64 string and/or safe number, with mutual consistency
      const rawExact = win.appState?.incarnationExact;
      const rawNum = win.appState?.incarnation;

      let validExact: string | null = null;
      if (typeof rawExact === "string") {
        if (!isCanonicalPositiveU64(rawExact)) {
          continue;
        }
        validExact = rawExact;
      }

      let validNumExact: string | null = null;
      if (typeof rawNum === "number") {
        if (!Number.isSafeInteger(rawNum) || rawNum <= 0) {
          continue;
        }
        validNumExact = String(rawNum);
      }

      if (validExact !== null && validNumExact !== null && validExact !== validNumExact) {
        continue;
      }

      const winIncarnation = validExact ?? validNumExact;
      if (!winIncarnation || row.incarnationExact !== winIncarnation) {
        continue;
      }
      const verifiedTarget = createTerminalTargetFromObservation(obs, row);
      if (!verifiedTarget) {
        continue;
      }
      const availability = mapTerminalRowAvailability(row.terminationState);
      return { target: verifiedTarget, availability };
    }
  }

  // Unobserved: do not default to live
  return {
    target: capturedTarget,
    availability: "unknown",
  };
}
