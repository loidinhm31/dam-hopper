import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  terminalActionCoordinator,
} from "./terminal-session-action-coordinator.js";
import type {
  TerminalInventoryObservation,
  TerminalTarget,
  TerminationState,
} from "@/api/terminal-session-contract.js";

describe("TerminalSessionActionCoordinator", () => {
  const targetA: TerminalTarget = {
    profileId: "prof-1",
    generation: 1,
    serverEpoch: "epoch-1111-2222-3333",
    terminalId: "term-1",
    incarnation: "42",
  };

  const targetB: TerminalTarget = {
    profileId: "prof-1",
    generation: 1,
    serverEpoch: "epoch-1111-2222-3333",
    terminalId: "term-2",
    incarnation: "100",
  };

  beforeEach(() => {
    terminalActionCoordinator.resetForTests();
  });

  it("reserves dispatch synchronously and prevents concurrent dispatch for same target", () => {
    const res1 = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(res1.allowed).toBe(true);
    expect(res1.attemptToken).toBe(1);

    // Second call while in-flight is refused
    const res2 = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(res2.allowed).toBe(false);
    expect(res2.reason).toBe("in_flight");

    // Independent targetB can still be reserved
    const resB = terminalActionCoordinator.reserveDispatch(targetB, "live");
    expect(resB.allowed).toBe(true);
    expect(resB.attemptToken).toBe(1);
  });

  it("prevents re-dispatch when target holds an unresolved action state", () => {
    const res = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(res.allowed).toBe(true);

    // Record outcomeUnknown (e.g. response lost/network drop)
    const unknownState: TerminationState = {
      status: "outcomeUnknown",
      target: targetA,
      origin: "live",
      error: { category: "network_error", message: "Timeout waiting for server response" },
    };
    terminalActionCoordinator.recordOutcome(targetA, unknownState, res.attemptToken);

    // Target is no longer in-flight, but unresolved outcomeUnknown remains
    expect(terminalActionCoordinator.isTargetUnresolved(targetA)).toBe(true);

    // Attempting to dispatch again is refused to prevent duplicate signal
    const resRetry = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(resRetry.allowed).toBe(false);
    expect(resRetry.reason).toBe("unresolved_action");
  });

  it("fences late completion using attemptToken", () => {
    const res1 = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(res1.attemptToken).toBe(1);

    // Reset or advance token manually by recording outcome
    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "refused", target: targetA, origin: "live", error: { error: "bad", code: "TERMINATION_INVALID_REQUEST" } },
      res1.attemptToken,
    );

    const res2 = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(res2.attemptToken).toBe(2);

    // Late response from attempt 1 arrives: MUST be ignored
    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "terminationRequested", target: targetA, origin: "live" },
      1, // stale token
    );

    // State remains dispatching from attempt 2
    expect(terminalActionCoordinator.getActionState(targetA)?.status).toBe("dispatching");
  });

  it("preserves authoritative settlement against late failure or unknown responses", () => {
    const res = terminalActionCoordinator.reserveDispatch(targetA, "live");

    // Settle authoritatively as ended
    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "ended", target: targetA, origin: "live", reason: "reconciliation_observed_exit" },
      res.attemptToken,
    );
    expect(terminalActionCoordinator.getActionState(targetA)?.status).toBe("ended");

    // Late response arriving afterward cannot overwrite settled state
    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "outcomeUnknown", target: targetA, origin: "live" },
      res.attemptToken,
    );
    expect(terminalActionCoordinator.getActionState(targetA)?.status).toBe("ended");
  });

  it("reconciles unresolved action states with authoritative inventory observations", () => {
    const res = terminalActionCoordinator.reserveDispatch(targetA, "live");
    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "terminationRequested", target: targetA, origin: "live" },
      res.attemptToken,
    );

    // Still unresolved
    expect(terminalActionCoordinator.isTargetUnresolved(targetA)).toBe(true);

    // Incoming observation with exited state
    const observation: TerminalInventoryObservation = {
      owner: { profileId: targetA.profileId, generation: targetA.generation },
      termination: { version: 1, serverEpoch: targetA.serverEpoch },
      sessions: [
        {
          id: targetA.terminalId,
          command: "bash",
          cwd: "/home",
          type: "terminal",
          alive: false,
          startedAt: 100,
          incarnation: 42,
          incarnationExact: "42",
          terminationState: "exited",
        },
      ],
    };

    const changed = terminalActionCoordinator.reconcileWithObservations([observation]);
    expect(changed).toBe(true);
    expect(terminalActionCoordinator.getActionState(targetA)?.status).toBe("ended");
    expect(terminalActionCoordinator.isTargetUnresolved(targetA)).toBe(false);
  });

  it("notifies subscribers when action states update", () => {
    const listener = vi.fn();
    const unsubscribe = terminalActionCoordinator.subscribe(listener);

    const res = terminalActionCoordinator.reserveDispatch(targetA, "live");
    expect(listener).toHaveBeenCalledTimes(1);

    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "terminationRequested", target: targetA, origin: "live" },
      res.attemptToken,
    );
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    terminalActionCoordinator.resetForTests();
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("publishes fresh immutable snapshot references on every mutation for React useSyncExternalStore", () => {
    const snapInitial = terminalActionCoordinator.getAllActions();

    const res = terminalActionCoordinator.reserveDispatch(targetA, "live");
    const snapAfterReserve = terminalActionCoordinator.getAllActions();
    expect(snapAfterReserve).not.toBe(snapInitial);
    expect(snapAfterReserve.get(targetA.terminalId)?.status).toBeUndefined();

    terminalActionCoordinator.recordOutcome(
      targetA,
      { status: "terminationRequested", target: targetA, origin: "live" },
      res.attemptToken,
    );
    const snapAfterOutcome = terminalActionCoordinator.getAllActions();
    expect(snapAfterOutcome).not.toBe(snapAfterReserve);

    terminalActionCoordinator.resetForTests();
    const snapAfterReset = terminalActionCoordinator.getAllActions();
    expect(snapAfterReset).not.toBe(snapAfterOutcome);
    expect(snapAfterReset.size).toBe(0);
  });
});
