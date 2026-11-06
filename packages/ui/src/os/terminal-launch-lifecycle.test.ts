// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTerminalLaunchIdentity,
  executeTerminalLaunch,
  isLaunchAttemptActive,
  markLaunchAttemptActive,
  markLaunchAttemptInactive,
  reserveAndExecuteTerminalLaunch,
  reserveTrackedTerminalLaunch,
  resetActiveLaunchAttemptsForTests,
  resolveStuckLaunch,
  type TerminalLaunchOutcome,
} from "./terminal-launch-lifecycle.js";
import {
  APP_LAUNCH_ATTEMPTS_STORAGE_KEY,
  getLaunchAttempt,
  reserveTerminalLaunch,
  settleTerminalLaunch,
  type LaunchIdentityParams,
} from "./persistence.js";
import { ApiRequestError } from "@/api/client.js";
import type { TerminalInventoryDetailedObservation } from "@/api/terminal-session-contract.js";

describe("terminal-launch-lifecycle (Phase 04 Contract C3, F8, F9, B3)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetActiveLaunchAttemptsForTests();
  });

  const baseIdentity: LaunchIdentityParams = {
    profileId: "profile-alpha",
    endpointBinding: "default-endpoint",
    action: "terminal.create",
    targetKind: "workspace",
    workspaceId: "profile-alpha",
    projectId: null,
    worktreeId: null,
    authorizedPath: null,
    cwd: null,
  };

  describe("buildTerminalLaunchIdentity", () => {
    it("builds exact identity for workspace target without cwd", () => {
      const identity = buildTerminalLaunchIdentity({
        profileId: "p1",
        target: { kind: "workspace", profileId: "p1" },
        cwd: null,
      });
      expect(identity).toEqual({
        profileId: "p1",
        endpointBinding: "default-endpoint",
        action: "terminal.create",
        targetKind: "workspace",
        workspaceId: "p1",
        projectId: null,
        worktreeId: null,
        cwd: null,
      });
    });

    it("builds exact identity for project target with project and worktree", () => {
      const identity = buildTerminalLaunchIdentity({
        profileId: "p1",
        target: {
          kind: "project",
          profileId: "p1",
          project: "proj-1",
          worktreePath: "/work/tree",
        },
        fallbackProjectId: "fallback-proj",
        fallbackWorktreeId: "fallback-wt",
        cwd: "src",
      });
      expect(identity).toEqual({
        profileId: "p1",
        endpointBinding: "default-endpoint",
        action: "terminal.create",
        targetKind: "project",
        workspaceId: null,
        projectId: "proj-1",
        worktreeId: "/work/tree",
        cwd: "src",
      });
    });

    it("uses fallback project and worktree for non-project target", () => {
      const identity = buildTerminalLaunchIdentity({
        profileId: "p1",
        target: { kind: "workspace", profileId: "p1" },
        fallbackProjectId: "fb-proj",
        fallbackWorktreeId: "fb-wt",
        cwd: null,
      });
      expect(identity.projectId).toBe("fb-proj");
      expect(identity.worktreeId).toBe("fb-wt");
    });
  });

  describe("In-flight registry & tracked reservation", () => {
    it("marks attemptId active on successful reservation", async () => {
      const res = await reserveTrackedTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      expect(res.status).toBe("reserved");
      if (res.status === "reserved") {
        expect(isLaunchAttemptActive(res.attemptId)).toBe(true);
      }
    });

    it("does not mark attempt active when reservation is blocked", async () => {
      await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      const blockedRes = await reserveTrackedTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      expect(blockedRes.status).toBe("blocked");
      if (blockedRes.status === "blocked") {
        expect(isLaunchAttemptActive(blockedRes.existingAttemptId!)).toBe(false);
      }
    });

    it("executeTerminalLaunch keeps attemptId active until settlement completes", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      let wasActiveDuringCreate = false;
      let wasActiveDuringSettle = false;

      const mockClient = {
        terminal: {
          create: vi.fn(async () => {
            wasActiveDuringCreate = isLaunchAttemptActive(res.attemptId);
            return {
              id: res.requestedTerminalId,
              serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
              incarnationExact: "1",
              incarnation: 1,
            };
          }),
        },
      };

      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: { profileId: "profile-alpha", generation: 1 },
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          getApi: () => mockClient,
          settle: async (attemptId, settleOutcome) => {
            wasActiveDuringSettle = isLaunchAttemptActive(attemptId);
            return settleTerminalLaunch(attemptId, settleOutcome);
          },
        },
      );

      expect(outcome.kind).toBe("created");
      expect(wasActiveDuringCreate).toBe(true);
      expect(wasActiveDuringSettle).toBe(true);
      // After settlement returns, finally block cleared active status
      expect(isLaunchAttemptActive(res.attemptId)).toBe(false);
    });

    it("tracks active attemptId and releases upon deactivation", () => {
      expect(isLaunchAttemptActive("att-1")).toBe(false);
      markLaunchAttemptActive("att-1");
      expect(isLaunchAttemptActive("att-1")).toBe(true);
      markLaunchAttemptInactive("att-1");
      expect(isLaunchAttemptActive("att-1")).toBe(false);
    });
  });

  describe("executeTerminalLaunch fence & settlement matrix", () => {
    it("settles confirmed-not-created when profile is not connected pre-send", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => null,
        },
      );

      expect(outcome).toEqual({
        kind: "failed",
        terminalId: res.requestedTerminalId,
        error: "Profile profile-alpha is not connected",
        settlement: "confirmed-not-created",
      });

      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-not-created");
        expect(read.record.failureReason).toContain("is not connected");
      }
    });

    it("settles confirmed-not-created when generation changed before launch", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: { profileId: "profile-alpha", generation: 2 },
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
        },
      );

      expect(outcome).toEqual({
        kind: "failed",
        terminalId: res.requestedTerminalId,
        error: "Connection generation changed before launch",
        settlement: "confirmed-not-created",
      });

      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-not-created");
        expect(read.record.failureReason).toBe("Connection generation changed before launch");
      }
    });

    it("settles confirmed-success on canonical response with exact target", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "bash",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: { profileId: "profile-alpha", generation: 1 },
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          getApi: () => ({
            terminal: {
              create: async () => ({
                id: res.requestedTerminalId,
                incarnationExact: "42",
                incarnation: 42,
                serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
              }),
            },
          }),
        },
      );

      expect(outcome.kind).toBe("created");
      if (outcome.kind === "created") {
        expect(outcome.terminalId).toBe(res.requestedTerminalId);
        expect(outcome.target).toEqual({
          profileId: "profile-alpha",
          generation: 1,
          terminalId: res.requestedTerminalId,
          incarnation: "42",
          serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
        });
        expect(outcome.incarnationExact).toBe("42");
        expect(outcome.serverEpoch).toBe("123e4567-e89b-12d3-a456-426614174000");
      }

      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-success");
        expect(read.record.provenance).toEqual({
          terminalId: res.requestedTerminalId,
          serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
          incarnationExact: "42",
        });
      }
    });

    it("settles uncertain when server response omits canonical epoch or incarnation", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: { profileId: "profile-alpha", generation: 1 },
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          getApi: () => ({
            terminal: {
              create: async () => ({
                id: res.requestedTerminalId,
                // Missing canonical serverEpoch
                serverEpoch: "non-canonical-epoch",
                incarnation: 1,
              }),
            },
          }),
        },
      );

      // Terminal id is ALWAYS returned, but target is undefined
      expect(outcome.kind).toBe("created");
      if (outcome.kind === "created") {
        expect(outcome.terminalId).toBe(res.requestedTerminalId);
        expect(outcome.target).toBeUndefined();
      }

      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("uncertain");
      }
    });

    it("Contract C3 Rule 3: settles confirmed-success when owner changes post-create but returns failed outcome", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      let callCount = 0;
      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => {
            callCount++;
            if (callCount === 1) {
              return {
                status: "connected",
                owner: { profileId: "profile-alpha", generation: 1 },
                intent: true,
                serverUrl: "http://127.0.0.1:4803",
              };
            }
            // Second call (post-create) shows generation changed
            return {
              status: "connected",
              owner: { profileId: "profile-alpha", generation: 2 },
              intent: true,
              serverUrl: "http://127.0.0.1:4803",
            };
          },
          getApi: () => ({
            terminal: {
              create: async () => ({
                id: res.requestedTerminalId,
                incarnationExact: "1",
                incarnation: 1,
                serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
              }),
            },
          }),
        },
      );

      expect(outcome).toEqual({
        kind: "failed",
        terminalId: res.requestedTerminalId,
        error: "Connection owner changed during launch",
        settlement: "confirmed-success",
      });

      // Journal MUST be confirmed-success because create succeeded before owner changed
      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-success");
      }
    });

    it("settles confirmed-not-created on HTTP 400/401/403/404/413/422", async () => {
      for (const status of [400, 401, 403, 404, 413, 422]) {
        localStorage.clear();
        const res = await reserveTerminalLaunch(baseIdentity, {
          generation: 1,
          desktopId: "desk-1",
        });
        if (res.status !== "reserved") throw new Error("Reservation failed");

        const outcome = await executeTerminalLaunch(
          {
            owner: { profileId: "profile-alpha", generation: 1 },
            attemptId: res.attemptId,
            terminalId: res.requestedTerminalId,
            command: "",
          },
          {
            getSnapshot: () => ({
              status: "connected",
              owner: { profileId: "profile-alpha", generation: 1 },
              intent: true,
              serverUrl: "http://127.0.0.1:4803",
            }),
            getApi: () => ({
              terminal: {
                create: async () => {
                  throw new ApiRequestError(`Error ${status}`, status);
                },
              },
            }),
          },
        );

        expect(outcome.kind).toBe("failed");
        if (outcome.kind === "failed") {
          expect(outcome.settlement).toBe("confirmed-not-created");
        }

        const read = getLaunchAttempt(res.attemptId);
        expect(read.status).toBe("ok");
        if (read.status === "ok") {
          expect(read.record.state).toBe("confirmed-not-created");
        }
      }
    });

    it("settles uncertain on network error / 500 error after request sent", async () => {
      const res = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (res.status !== "reserved") throw new Error("Reservation failed");

      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          attemptId: res.attemptId,
          terminalId: res.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: { profileId: "profile-alpha", generation: 1 },
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          getApi: () => ({
            terminal: {
              create: async () => {
                throw new Error("Network timeout / reset");
              },
            },
          }),
        },
      );

      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.settlement).toBe("uncertain");
      }

      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("uncertain");
      }
    });

    it("operates normally without attemptId (no settlement)", async () => {
      const outcome = await executeTerminalLaunch(
        {
          owner: { profileId: "profile-alpha", generation: 1 },
          terminalId: "term-no-attempt",
          command: "",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: { profileId: "profile-alpha", generation: 1 },
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          getApi: () => ({
            terminal: {
              create: async () => ({
                id: "term-no-attempt",
                incarnationExact: "1",
                incarnation: 1,
                serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
              }),
            },
          }),
        },
      );

      expect(outcome.kind).toBe("created");
    });
  });

  describe("reserveAndExecuteTerminalLaunch (Hub / composite helper)", () => {
    it("returns blocked when reservation is blocked", async () => {
      const firstRes = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (firstRes.status !== "reserved") throw new Error("Reservation failed");

      const res = await reserveAndExecuteTerminalLaunch({
        identity: baseIdentity,
        generation: 1,
        desktopId: "desk-1",
        request: {
          owner: { profileId: "profile-alpha", generation: 1 },
          command: "",
        },
      });

      expect(res.kind).toBe("blocked");
      if (res.kind === "blocked") {
        expect(res.existingAttemptId).toBe(firstRes.attemptId);
      }
    });

    it("reserves and executes successfully", async () => {
      const res = await reserveAndExecuteTerminalLaunch({
        identity: baseIdentity,
        generation: 1,
        desktopId: "desk-1",
        request: {
          owner: { profileId: "profile-alpha", generation: 1 },
          command: "",
        },
      }, {
        getSnapshot: () => ({
          status: "connected",
          owner: { profileId: "profile-alpha", generation: 1 },
          intent: true,
          serverUrl: "http://127.0.0.1:4803",
        }),
        getApi: () => ({
          terminal: {
            create: async (params) => ({
              id: params.id,
              incarnationExact: "1",
              incarnation: 1,
              serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
            }),
          },
        }),
      });

      expect(res.kind).toBe("created");
    });
  });

  describe("resolveStuckLaunch (R8, V3, F8, F9)", () => {
    const canonicalOwner = { profileId: "profile-alpha", generation: 1 };
    const canonicalServerEpoch = "123e4567-e89b-12d3-a456-426614174000";

    const makeObservation = (
      sessions: Array<{
        id: string;
        incarnationExact?: string;
        terminationState?: "live" | "restartPending";
        alive?: boolean;
      }>,
    ): TerminalInventoryDetailedObservation => ({
      owner: canonicalOwner,
      termination: {
        version: 1,
        serverEpoch: canonicalServerEpoch,
        reason: null,
      },
      sessions: sessions.map((s) => ({
        id: s.id,
        command: "bash",
        cwd: "/tmp",
        alive: s.alive ?? true,
        terminationState: s.terminationState ?? "live",
        incarnation: Number(s.incarnationExact ?? "1"),
        incarnationExact: s.incarnationExact ?? "1",
        cols: 80,
        rows: 24,
      })),
    });

    it("returns already-resolved for unknown or already settled attempt", async () => {
      const res1 = await resolveStuckLaunch({
        attemptId: "unknown-attempt-id",
        confirmNotCreated: false,
      });
      expect(res1).toEqual({ kind: "already-resolved" });

      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      await settleTerminalLaunch(reserved.attemptId, {
        kind: "confirmed-not-created",
        reason: "Test already resolved",
      });

      const res2 = await resolveStuckLaunch({
        attemptId: reserved.attemptId,
        confirmNotCreated: false,
      });
      expect(res2).toEqual({ kind: "already-resolved" });
    });

    it("returns in-flight if the attempt is active in this page (never settles)", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      markLaunchAttemptActive(reserved.attemptId);

      const res = await resolveStuckLaunch({
        attemptId: reserved.attemptId,
        confirmNotCreated: true,
      });
      expect(res).toEqual({ kind: "in-flight" });

      // Unsettled in journal
      const read = getLaunchAttempt(reserved.attemptId);
      expect(read.status === "ok" && read.record.state).toBe("reserved-dispatch-capable");
    });

    it("returns unknown when profile is disconnected or observe fails", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: false },
        {
          getSnapshot: () => ({
            status: "disconnected",
            owner: canonicalOwner,
            intent: false,
            serverUrl: "http://127.0.0.1:4803",
          }),
        },
      );
      expect(res.kind).toBe("unknown");
    });

    it("returns present-unresolvable when row exists but target is non-canonical or retired", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const badObs: TerminalInventoryDetailedObservation = {
        owner: canonicalOwner,
        termination: {
          version: null, // Non-canonical
          serverEpoch: null,
          reason: "unsupported",
        },
        sessions: [
          {
            id: reserved.requestedTerminalId,
            command: "bash",
            cwd: "/tmp",
            alive: true,
            terminationState: "live",
            incarnation: 1,
            cols: 80,
            rows: 24,
          },
        ],
      };

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: false },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => badObs,
        },
      );

      expect(res.kind).toBe("present-unresolvable");
    });

    it("finds present-canonical row, settles confirmed-success, and returns found", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const obs = makeObservation([
        { id: reserved.requestedTerminalId, incarnationExact: "7" },
      ]);

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: false },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => obs,
        },
      );

      expect(res.kind).toBe("found");
      if (res.kind === "found") {
        expect(res.target.terminalId).toBe(reserved.requestedTerminalId);
        expect(res.target.incarnation).toBe("7");
        expect(res.target.serverEpoch).toBe(canonicalServerEpoch);
      }

      const read = getLaunchAttempt(reserved.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-success");
        expect(read.record.provenance?.incarnationExact).toBe("7");
      }
    });

    it("returns definitely-absent without confirmNotCreated without settling", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const obs = makeObservation([]); // empty

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: false },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => obs,
        },
      );

      expect(res).toEqual({ kind: "definitely-absent" });
      const read = getLaunchAttempt(reserved.attemptId);
      expect(read.status === "ok" && read.record.state).toBe("reserved-dispatch-capable");
    });

    it("settles confirmed-not-created on confirmed definitely-absent, durable re-read verified -> cleared", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const obs = makeObservation([]); // empty

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: true },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => obs,
        },
      );

      expect(res).toEqual({ kind: "cleared" });

      const read = getLaunchAttempt(reserved.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-not-created");
        expect(read.record.failureReason).toBe("Cleared by user");
      }

      // Fresh reservation for the same destination is now UNBLOCKED!
      const freshRes = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      expect(freshRes.status).toBe("reserved");
    });

    it("handles stale negative: present at confirmation time", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      let fetchCount = 0;
      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: true },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => {
            fetchCount++;
            if (fetchCount === 1) {
              return makeObservation([]); // initial fetch absent
            }
            // Confirmation fetch: session appeared!
            return makeObservation([
              { id: reserved.requestedTerminalId, incarnationExact: "9" },
            ]);
          },
        },
      );

      expect(res.kind).toBe("found");
      if (res.kind === "found") {
        expect(res.target.incarnation).toBe("9");
      }
    });

    it("guards against in-flight starting during confirmation fetch", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      let fetchCount = 0;
      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: true },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => {
            fetchCount++;
            if (fetchCount === 2) {
              // Create starts during second fetch
              markLaunchAttemptActive(reserved.attemptId);
            }
            return makeObservation([]);
          },
        },
      );

      expect(res).toEqual({ kind: "in-flight" });
      const read = getLaunchAttempt(reserved.attemptId);
      expect(read.status === "ok" && read.record.state).toBe("reserved-dispatch-capable");
    });

    it("proves that resolution cannot clear an attempt while executeTerminalLaunch remains pending", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const { promise: deferredCreate, resolve: finishCreate } =
        Promise.withResolvers<{
          id: string;
          serverEpoch: string;
          incarnationExact: string;
          incarnation: number;
        }>();

      const launchPromise = executeTerminalLaunch(
        {
          owner: canonicalOwner,
          attemptId: reserved.attemptId,
          terminalId: reserved.requestedTerminalId,
          command: "",
        },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          getApi: () => ({
            terminal: {
              create: () => deferredCreate,
            },
          }),
        },
      );

      // Attempt is actively executing:
      expect(isLaunchAttemptActive(reserved.attemptId)).toBe(true);

      // Attempting to resolve stuck launch while execution is pending MUST return in-flight
      const resWhilePending = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: true },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => makeObservation([]),
        },
      );
      expect(resWhilePending).toEqual({ kind: "in-flight" });

      // Unblock create
      finishCreate({
        id: reserved.requestedTerminalId,
        serverEpoch: canonicalServerEpoch,
        incarnationExact: "1",
        incarnation: 1,
      });

      const outcome = await launchPromise;
      expect(outcome.kind).toBe("created");
      expect(isLaunchAttemptActive(reserved.attemptId)).toBe(false);

      // Succeeded in journal: subsequent stuck resolution reports already-resolved
      const resAfter = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: true },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => makeObservation([]),
        },
      );
      expect(resAfter).toEqual({ kind: "already-resolved" });
    });

    it("returns unavailable when settle fails (e.g. storage error)", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const obs = makeObservation([
        { id: reserved.requestedTerminalId, incarnationExact: "1" },
      ]);

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: false },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => obs,
          settle: async () => ({ status: "uncertain", reason: "Disk write failed" }),
        },
      );

      expect(res).toEqual({ kind: "unavailable", reason: "Disk write failed" });
    });

    it("returns conflict when re-read state does not match expected settlement", async () => {
      const reserved = await reserveTerminalLaunch(baseIdentity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const obs = makeObservation([
        { id: reserved.requestedTerminalId, incarnationExact: "1" },
      ]);

      const res = await resolveStuckLaunch(
        { attemptId: reserved.attemptId, confirmNotCreated: false },
        {
          getSnapshot: () => ({
            status: "connected",
            owner: canonicalOwner,
            intent: true,
            serverUrl: "http://127.0.0.1:4803",
          }),
          isCurrent: () => true,
          observeInventory: async () => obs,
          settle: async () => ({ status: "settled" }), // Pretends settled
          getAttempt: () => ({
            status: "ok",
            record: {
              attemptId: reserved.attemptId,
              canonicalIdentity: "tuple",
              profileId: "profile-alpha",
              endpointBinding: "default-endpoint",
              action: "terminal.create",
              targetKind: "workspace",
              workspaceId: "profile-alpha",
              projectId: null,
              worktreeId: null,
              authorizedPath: null,
              cwd: null,
              requestedTerminalId: reserved.requestedTerminalId,
              ownerGeneration: 1,
              destinationDesktopId: "desk-1",
              state: "uncertain", // Mismatched state!
              createdAt: Date.now(),
            },
          }),
        },
      );

      expect(res).toEqual({ kind: "conflict", state: "uncertain" });
    });
  });
});
