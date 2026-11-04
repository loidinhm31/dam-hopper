import { useSyncExternalStore } from "react";
import {
  terminalTargetKey,
  type TerminalInventoryObservation,
  type TerminalTarget,
  type TerminationOrigin,
  type TerminationState,
} from "@/api/terminal-session-contract.js";
import { reconcileTermination } from "./terminal-session-actions.js";

/**
 * Shared, presentation-independent action coordinator for destructive terminal operations.
 *
 * Invariants:
 * - Persists across view unmount, remount, minimize, and tab switching.
 * - Single-flight dispatch reservation: only one entry point can dispatch for a target at a time.
 * - Monotonic attempt tokens fence late completion responses.
 * - Settlement preservation: authoritative terminal states ("ended", "restartCancelled") are never overwritten.
 * - Continuous reconciliation against inventory observations runs regardless of active UI views.
 */
class TerminalSessionActionCoordinator {
  private readonly retainedActions = new Map<string, TerminationState>();
  private readonly inFlightTargets = new Set<string>();
  private readonly attemptTokens = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ReadonlyMap<string, TerminationState> = new Map();

  private notify(): void {
    this.snapshot = new Map(this.retainedActions);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("Error in terminal action coordinator listener", err);
      }
    }
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Synchronously attempts to reserve an End/Termination dispatch for the given target.
   *
   * Returns `{ allowed: false }` if the target is already in flight or holds an unresolved
   * action state ("dispatching", "terminationRequested", "outcomeUnknown").
   *
   * On success, marks target in-flight, creates a "dispatching" state, advances the attempt token,
   * and notifies subscribers synchronously.
   */
  public reserveDispatch(
    target: TerminalTarget,
    origin: TerminationOrigin,
  ): { allowed: boolean; reason?: "in_flight" | "unresolved_action"; attemptToken: number } {
    const key = terminalTargetKey(target);

    if (this.inFlightTargets.has(key)) {
      return { allowed: false, reason: "in_flight", attemptToken: 0 };
    }

    const existing = this.retainedActions.get(key);
    if (
      existing &&
      (existing.status === "dispatching" ||
        existing.status === "terminationRequested" ||
        existing.status === "outcomeUnknown")
    ) {
      return { allowed: false, reason: "unresolved_action", attemptToken: 0 };
    }

    const nextToken = (this.attemptTokens.get(key) ?? 0) + 1;
    this.attemptTokens.set(key, nextToken);
    this.inFlightTargets.add(key);

    const dispatchingState: TerminationState = Object.freeze({
      status: "dispatching",
      target,
      origin,
    });
    this.retainedActions.set(key, dispatchingState);
    this.notify();

    return { allowed: true, attemptToken: nextToken };
  }

  /**
   * Records the outcome of a dispatched termination attempt.
   * Fences late or superseded responses using `attemptToken`.
   */
  public recordOutcome(
    target: TerminalTarget,
    outcome: TerminationState,
    attemptToken: number,
  ): void {
    const key = terminalTargetKey(target);
    const activeToken = this.attemptTokens.get(key);

    if (attemptToken !== activeToken) {
      // Stale or superseded response ignored
      return;
    }

    this.inFlightTargets.delete(key);

    const existing = this.retainedActions.get(key);
    // Never overwrite an authoritatively settled state
    if (existing?.status === "ended" || existing?.status === "restartCancelled") {
      this.notify();
      return;
    }

    this.retainedActions.set(key, outcome);
    this.notify();
  }

  /**
   * Reconciles all pending or unknown action states against authoritative observations.
   */
  public reconcileWithObservations(
    observations: readonly TerminalInventoryObservation[],
  ): boolean {
    if (this.retainedActions.size === 0 || observations.length === 0) return false;

    let changed = false;
    for (const [key, state] of Array.from(this.retainedActions.entries())) {
      if (
        state.status !== "terminationRequested" &&
        state.status !== "outcomeUnknown" &&
        state.status !== "dispatching"
      ) {
        continue;
      }

      let reconciled: TerminationState = state;
      for (const obs of observations) {
        reconciled = reconcileTermination(reconciled, obs);
        if (reconciled !== state) {
          break;
        }
      }

      if (reconciled !== state) {
        this.retainedActions.set(key, reconciled);
        // If authoritatively resolved, remove from in-flight
        if (reconciled.status === "ended" || reconciled.status === "restartCancelled") {
          this.inFlightTargets.delete(key);
        }
        changed = true;
      }
    }

    if (changed) {
      this.notify();
    }
    return changed;
  }

  public getActionState(target: TerminalTarget | null | undefined): TerminationState | undefined {
    if (!target) return undefined;
    return this.retainedActions.get(terminalTargetKey(target));
  }

  public getAllActions = (): ReadonlyMap<string, TerminationState> => {
    return this.snapshot;
  };

  public isTargetUnresolved(target: TerminalTarget | null | undefined): boolean {
    if (!target) return false;
    const key = terminalTargetKey(target);
    if (this.inFlightTargets.has(key)) return true;
    const action = this.retainedActions.get(key);
    return Boolean(
      action &&
        (action.status === "dispatching" ||
          action.status === "terminationRequested" ||
          action.status === "outcomeUnknown"),
    );
  }

  public resetForTests(): void {
    this.retainedActions.clear();
    this.inFlightTargets.clear();
    this.attemptTokens.clear();
    this.notify();
  }
}

export const terminalActionCoordinator = new TerminalSessionActionCoordinator();

/**
 * React hook returning the current termination action state for a specific target.
 */
export function useTerminalActionState(
  target: TerminalTarget | null | undefined,
): TerminationState | undefined {
  return useSyncExternalStore(
    terminalActionCoordinator.subscribe,
    () => (target ? terminalActionCoordinator.getActionState(target) : undefined),
    () => undefined,
  );
}

/**
 * React hook returning all retained termination action states.
 */
export function useAllTerminalActions(): ReadonlyMap<string, TerminationState> {
  return useSyncExternalStore(
    terminalActionCoordinator.subscribe,
    terminalActionCoordinator.getAllActions,
    terminalActionCoordinator.getAllActions,
  );
}
