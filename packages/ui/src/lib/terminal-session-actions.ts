import { isCurrentConnection } from "@/api/connections.js";
import { ApiRequestError } from "@/api/client.js";
import {
  createTerminalTargetFromObservation,
  TERMINATION_INVALID_REQUEST,
  TERMINATION_SIGNAL_FAILED,
  type TerminalInventoryObservation,
  type TerminalTarget,
  type TerminationErrorCode,
  type TerminationOrigin,
  type TerminationResult,
  type TerminationState,
} from "@/api/terminal-session-contract.js";

export interface GuardedTerminationClient {
  terminal: {
    terminateSessionGuarded: (
      target: TerminalTarget,
      origin: TerminationOrigin,
    ) => Promise<TerminationResult>;
  };
}

export type CapturedTerminalAction = {
  readonly status: "captured";
  readonly target: TerminalTarget;
  readonly origin: TerminationOrigin;
};

/**
 * Captures an immutable TerminalTarget and action origin from an authoritative observation.
 *
 * Rules:
 * - Session must exist in observation.sessions.
 * - Target is constructed using createTerminalTargetFromObservation (enforcing valid owner, metadata, and eligibility).
 * - Origin is determined strictly by terminationState + alive consistency:
 *   - "live": row.terminationState === "live" && row.alive === true
 *   - "restartPending": row.terminationState === "restartPending" && row.alive === false
 * - Any other state or inconsistent alive boolean returns null (not actionable for End).
 */
export function captureTerminalTarget(
  observation: TerminalInventoryObservation,
  id: string,
): CapturedTerminalAction | null {
  const row = observation.sessions.find((s) => s.id === id);
  if (!row) return null;

  const target = createTerminalTargetFromObservation(observation, row);
  if (!target) return null;

  let origin: TerminationOrigin | null = null;
  if (row.terminationState === "live" && row.alive === true) {
    origin = "live";
  } else if (row.terminationState === "restartPending" && row.alive === false) {
    origin = "restartPending";
  }

  if (!origin) return null;

  return Object.freeze({
    status: "captured",
    target,
    origin,
  });
}

/**
 * Dispatches a guarded termination request to the server.
 *
 * Checks connection owner currency before and after await.
 * Dispatches once, no retry.
 */
export async function requestGuardedTermination(
  target: TerminalTarget,
  origin: TerminationOrigin,
  client: GuardedTerminationClient,
  checkCurrent: () => boolean = () =>
    isCurrentConnection({
      profileId: target.profileId,
      generation: target.generation,
    }),
): Promise<TerminationState> {
  // Pre-dispatch currency check
  if (!checkCurrent()) {
    return Object.freeze<TerminationState>({
      status: "failed",
      target,
      origin,
      error: {
        category: "abort",
        message: "Connection owner is stale or disconnected before dispatch",
      },
    });
  }

  try {
    const result = await client.terminal.terminateSessionGuarded(target, origin);

    // Post-await currency check
    if (!checkCurrent()) {
      return Object.freeze<TerminationState>({
        status: "outcomeUnknown",
        target,
        origin,
        error: {
          category: "abort",
          message: "Connection owner retired or changed after dispatch",
        },
      });
    }

    if (origin === "live" && result.outcome === "terminationRequested") {
      return Object.freeze({
        status: "terminationRequested",
        target,
        origin: "live",
        reason: "live_signal_dispatched",
      });
    }

    if (origin === "restartPending" && result.outcome === "restartCancelled") {
      return Object.freeze({
        status: "restartCancelled",
        target,
        origin: "restartPending",
        reason: "restart_pre_reservation_cancelled",
      });
    }

    return Object.freeze<TerminationState>({
      status: "outcomeUnknown",
      target,
      origin,
      error: {
        category: "status_outcome_mismatch",
        message: `Unexpected termination outcome ${result.outcome} for origin ${origin}`,
      },
    });
  } catch (err) {
    // Post-await currency check
    if (!checkCurrent()) {
      return Object.freeze<TerminationState>({
        status: "outcomeUnknown",
        target,
        origin,
        error: {
          category: "abort",
          message: "Connection owner retired or changed after dispatch error",
        },
      });
    }

    if (err instanceof ApiRequestError) {
      if (
        err.status === 400 ||
        err.status === 404 ||
        err.status === 409 ||
        err.status === 413
      ) {
        return Object.freeze({
          status: "refused",
          target,
          origin,
          error: {
            error: err.message,
            code: (err.code as TerminationErrorCode) || TERMINATION_INVALID_REQUEST,
          },
        });
      }

      if (err.status === 500) {
        if (err.code === TERMINATION_SIGNAL_FAILED) {
          return Object.freeze<TerminationState>({
            status: "failed",
            target,
            origin,
            error: {
              category: "signal_dispatch_failed",
              code: TERMINATION_SIGNAL_FAILED,
              message: err.message,
            },
          });
        }
        return Object.freeze<TerminationState>({
          status: "outcomeUnknown",
          target,
          origin,
          error: {
            category: "network_error",
            message: err.message,
          },
        });
      }

      if (err.code === "status_outcome_mismatch") {
        return Object.freeze<TerminationState>({
          status: "outcomeUnknown",
          target,
          origin,
          error: {
            category: "status_outcome_mismatch",
            message: err.message,
          },
        });
      }
    }

    return Object.freeze<TerminationState>({
      status: "outcomeUnknown",
      target,
      origin,
      error: {
        category: "network_error",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Reconciles an active or unresolved termination state against a new inventory observation.
 *
 * Rules:
 * - Owner profileId, generation, and PTY serverEpoch must strictly match the target.
 * - Live origin:
 *   - Only exact row with terminationState === "exited" transitions to "ended".
 *   - Raw alive: false, restartCancelled, or absence stays unresolved.
 * - Pending origin:
 *   - Only exact row with terminationState === "restartCancelled" transitions to "restartCancelled".
 *   - Ordinary exited or absence stays unresolved.
 */
export function reconcileTermination(
  action: TerminationState,
  observation: TerminalInventoryObservation,
): TerminationState {
  if (
    !observation.owner ||
    observation.owner.profileId !== action.target.profileId ||
    observation.owner.generation !== action.target.generation ||
    observation.termination.version !== 1 ||
    observation.termination.serverEpoch !== action.target.serverEpoch
  ) {
    return action;
  }

  const row = observation.sessions.find(
    (s) =>
      s.id === action.target.terminalId &&
      s.incarnationExact === action.target.incarnation,
  );

  // If row not found (absence from inventory):
  if (!row) {
    return action;
  }
  if (
    typeof row.incarnation === "number" &&
    Number.isSafeInteger(row.incarnation) &&
    (row.incarnation <= 0 || String(row.incarnation) !== action.target.incarnation)
  ) {
    return action;
  }

  if (action.origin === "live") {
    if (row.terminationState === "exited") {
      return Object.freeze({
        status: "ended",
        target: action.target,
        origin: "live",
        reason: "reconciliation_observed_exit",
      });
    }
    return action;
  }

  if (action.origin === "restartPending") {
    if (row.terminationState === "restartCancelled") {
      return Object.freeze({
        status: "restartCancelled",
        target: action.target,
        origin: "restartPending",
        reason: "reconciliation_observed_cancelled",
      });
    }
    return action;
  }

  return action;
}
