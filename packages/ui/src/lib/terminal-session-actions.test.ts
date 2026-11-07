import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client.js";
import type {
  TerminalInventoryObservation,
  TerminalInventoryRow,
  TerminalTarget,
  TerminationState,
} from "@/api/terminal-session-contract.js";
import {
  captureTerminalTarget,
  reconcileTermination,
  requestGuardedTermination,
  type GuardedTerminationClient,
} from "./terminal-session-actions.js";

describe("terminal-session-actions", () => {
  const baseTarget: TerminalTarget = {
    profileId: "prof-1",
    generation: 1,
    serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
    terminalId: "term-1",
    incarnation: "100",
  };

  describe("captureTerminalTarget", () => {
    it("captures valid live session target and origin", () => {
      const row: TerminalInventoryRow = {
        id: "term-1",
        command: "bash",
        cwd: "/home",
        type: "terminal",
        startedAt: 100,
        alive: true,
        incarnation: 100,
        incarnationExact: "100",
        terminationState: "live",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
        },
        sessions: [row],
      };

      const captured = captureTerminalTarget(obs, "term-1");
      expect(captured).not.toBeNull();
      expect(captured?.status).toBe("captured");
      expect(captured?.origin).toBe("live");
      expect(captured?.target).toEqual(baseTarget);
    });

    it("captures valid restartPending session target and origin", () => {
      const row: TerminalInventoryRow = {
        id: "term-1",
        command: "bash",
        cwd: "/home",
        type: "terminal",
        startedAt: 100,
        alive: false,
        incarnation: 100,
        incarnationExact: "100",
        terminationState: "restartPending",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
        },
        sessions: [row],
      };

      const captured = captureTerminalTarget(obs, "term-1");
      expect(captured).not.toBeNull();
      expect(captured?.origin).toBe("restartPending");
      expect(captured?.target).toEqual(baseTarget);
    });

    it("rejects capturing target when session is not eligible or state is terminal", () => {
      const terminalRow: TerminalInventoryRow = {
        id: "term-1",
        command: "bash",
        cwd: "/home",
        type: "terminal",
        startedAt: 100,
        alive: false,
        incarnation: 100,
        incarnationExact: "100",
        terminationState: "exited",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
        },
        sessions: [terminalRow],
      };

      expect(captureTerminalTarget(obs, "term-1")).toBeNull();
    });
  });

  describe("requestGuardedTermination", () => {
    it("fails immediately before dispatch when connection is stale", async () => {
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn(),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "live",
        client,
        () => false, // not current
      );

      expect(state.status).toBe("failed");
      expect(state.error?.category).toBe("abort");
      expect(client.terminal.terminateSessionGuarded).not.toHaveBeenCalled();
    });

    it("dispatches live termination and returns terminationRequested on 202", async () => {
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn().mockResolvedValue({
            version: 1,
            serverEpoch: baseTarget.serverEpoch,
            terminalId: baseTarget.terminalId,
            incarnation: baseTarget.incarnation,
            outcome: "terminationRequested",
          }),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "live",
        client,
        () => true,
      );

      expect(state.status).toBe("terminationRequested");
      expect(state.origin).toBe("live");
    });

    it("dispatches restartPending cancellation and returns restartCancelled on 200", async () => {
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn().mockResolvedValue({
            version: 1,
            serverEpoch: baseTarget.serverEpoch,
            terminalId: baseTarget.terminalId,
            incarnation: baseTarget.incarnation,
            outcome: "restartCancelled",
          }),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "restartPending",
        client,
        () => true,
      );

      expect(state.status).toBe("restartCancelled");
      expect(state.origin).toBe("restartPending");
    });

    it("transitions to outcomeUnknown if connection owner retires after await", async () => {
      let isCurrent = true;
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn().mockImplementation(async () => {
            isCurrent = false; // connection changes during dispatch
            return {
              version: 1,
              serverEpoch: baseTarget.serverEpoch,
              terminalId: baseTarget.terminalId,
              incarnation: baseTarget.incarnation,
              outcome: "terminationRequested",
            };
          }),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "live",
        client,
        () => isCurrent,
      );

      expect(state.status).toBe("outcomeUnknown");
      expect(state.error?.category).toBe("abort");
    });

    it("maps 409 ApiRequestError to refused status", async () => {
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn().mockRejectedValue(
            new ApiRequestError(
              "Incarnation mismatch",
              409,
              "TERMINATION_INCARNATION_MISMATCH",
            ),
          ),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "live",
        client,
        () => true,
      );

      expect(state.status).toBe("refused");
      expect((state as { error: { code: string } }).error.code).toBe(
        "TERMINATION_INCARNATION_MISMATCH",
      );
    });

    it("maps 500 ApiRequestError to failed status", async () => {
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn().mockRejectedValue(
            new ApiRequestError(
              "Signal failed",
              500,
              "TERMINATION_SIGNAL_FAILED",
            ),
          ),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "live",
        client,
        () => true,
      );

      expect(state.status).toBe("failed");
      expect(state.error?.category).toBe("signal_dispatch_failed");
    });

    it("maps network errors to outcomeUnknown status", async () => {
      const client: GuardedTerminationClient = {
        terminal: {
          terminateSessionGuarded: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
        },
      };

      const state = await requestGuardedTermination(
        baseTarget,
        "live",
        client,
        () => true,
      );

      expect(state.status).toBe("outcomeUnknown");
      expect(state.error?.category).toBe("network_error");
    });
  });

  describe("reconcileTermination", () => {
    it("reconciles live origin loss when subsequent observation shows exact exited row", () => {
      const action: TerminationState = {
        status: "outcomeUnknown",
        target: baseTarget,
        origin: "live",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: baseTarget.serverEpoch,
        },
        sessions: [
          {
            id: baseTarget.terminalId,
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: false,
            incarnationExact: baseTarget.incarnation,
            terminationState: "exited",
          },
        ],
      };

      const reconciled = reconcileTermination(action, obs);
      expect(reconciled.status).toBe("ended");
    });

    it("reconciles pending origin loss when subsequent observation shows exact restartCancelled row", () => {
      const action: TerminationState = {
        status: "outcomeUnknown",
        target: baseTarget,
        origin: "restartPending",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: baseTarget.serverEpoch,
        },
        sessions: [
          {
            id: baseTarget.terminalId,
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: false,
            incarnationExact: baseTarget.incarnation,
            terminationState: "restartCancelled",
          },
        ],
      };

      const reconciled = reconcileTermination(action, obs);
      expect(reconciled.status).toBe("restartCancelled");
    });

    it("leaves pending origin loss unresolved when observation shows ordinary exited row", () => {
      const action: TerminationState = {
        status: "outcomeUnknown",
        target: baseTarget,
        origin: "restartPending",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: baseTarget.serverEpoch,
        },
        sessions: [
          {
            id: baseTarget.terminalId,
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: false,
            incarnationExact: baseTarget.incarnation,
            terminationState: "exited", // ordinary exited, not restartCancelled
          },
        ],
      };

      const reconciled = reconcileTermination(action, obs);
      expect(reconciled.status).toBe("outcomeUnknown");
    });

    it("leaves loss unresolved when observation belongs to a different serverEpoch", () => {
      const action: TerminationState = {
        status: "outcomeUnknown",
        target: baseTarget,
        origin: "live",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: {
          version: 1,
          serverEpoch: "00000000-0000-0000-0000-000000000000", // different epoch
        },
        sessions: [
          {
            id: baseTarget.terminalId,
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: false,
            incarnationExact: baseTarget.incarnation,
            terminationState: "exited",
          },
        ],
      };

      const reconciled = reconcileTermination(action, obs);
      expect(reconciled.status).toBe("outcomeUnknown");
    });
  });
});
