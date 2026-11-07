// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_LAUNCH_ATTEMPTS_STORAGE_KEY,
  buildCanonicalIdentityTuple,
  getLaunchAttempt,
  importOsEnvelope,
  reserveTerminalLaunch,
  settleTerminalLaunch,
  type LaunchIdentityParams,
} from "./persistence.js";
import type { TerminalTarget } from "../api/terminal-session-contract.js";

describe("Ordinary Resource-Launch Safety Journal (C3 & C12 Contracts)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const baseParams: LaunchIdentityParams = {
    profileId: "profile-1",
    endpointBinding: "http://127.0.0.1:4803",
    action: "terminal.create",
    targetKind: "workspace",
    workspaceId: "ws-1",
    cwd: "packages/ui",
  };

  it("builds deterministic canonical identity tuple excluding desktop, generation, and mode", () => {
    const key1 = buildCanonicalIdentityTuple(baseParams);
    const key2 = buildCanonicalIdentityTuple({
      ...baseParams,
      // Same parameters in another order or missing optional fields
      projectId: null,
      worktreeId: null,
      authorizedPath: null,
    });
    expect(key1).toBe(key2);

    const tuple = JSON.parse(key1);
    expect(tuple).toEqual([
      1,
      "profile-1",
      "http://127.0.0.1:4803",
      "terminal.create",
      "workspace",
      "ws-1",
      null,
      null,
      null,
      "packages/ui",
    ]);
  });

  it("blocks duplicate reservation for the same destination while unresolved", async () => {
    const res1 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res1.status).toBe("reserved");
    if (res1.status !== "reserved") return;

    // Second reservation with same canonical identity must be blocked
    const res2 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-2", // different desktop must NOT bypass guard
    });
    expect(res2.status).toBe("blocked");
    if (res2.status === "blocked") {
      expect(res2.existingAttemptId).toBe(res1.attemptId);
      expect(res2.reason).toContain("unresolved ordinary launch attempt");
    }
  });

  it("allows distinct destinations to reserve independently and coexist", async () => {
    const res1 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res1.status).toBe("reserved");

    const distinctParams: LaunchIdentityParams = {
      ...baseParams,
      cwd: "server", // distinct folder
    };
    const res2 = await reserveTerminalLaunch(distinctParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res2.status).toBe("reserved");
  });

  it("generates fresh requestedTerminalId and rejects reuse of previously used requested IDs", async () => {
    const res1 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
      explicitRequestedTerminalId: "req-term-custom-1",
    });
    expect(res1.status).toBe("reserved");

    // Settle res1
    if (res1.status === "reserved") {
      const mockTarget: TerminalTarget = {
        profileId: "profile-1",
        generation: 1,
        serverEpoch: "epoch-1",
        terminalId: "term-1",
        incarnation: 1,
      };
      await settleTerminalLaunch(res1.attemptId, {
        kind: "confirmed-success",
        target: mockTarget,
      });
    }

    // Attempting to reuse "req-term-custom-1" in a new reservation must be rejected
    const distinctParams: LaunchIdentityParams = {
      ...baseParams,
      cwd: "other-dir",
    };
    const res2 = await reserveTerminalLaunch(distinctParams, {
      generation: 1,
      desktopId: "desk-1",
      explicitRequestedTerminalId: "req-term-custom-1",
    });
    expect(res2.status).toBe("blocked");
    if (res2.status === "blocked") {
      expect(res2.reason).toContain("has already been used in a previous launch attempt");
    }
  });

  it("settles confirmed-success, stores exact provenance, and permits subsequent launch for that destination", async () => {
    const res = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res.status).toBe("reserved");
    if (res.status !== "reserved") return;

    const mockTarget: TerminalTarget = {
      profileId: "profile-1",
      generation: 1,
      serverEpoch: "epoch-uuid-1",
      terminalId: "term-uuid-1",
      incarnation: 1,
    };

    const settleRes = await settleTerminalLaunch(res.attemptId, {
      kind: "confirmed-success",
      target: mockTarget,
    });
    expect(settleRes.status).toBe("settled");

    // Once authoritatively settled, a new launch for the same destination is permitted
    const res2 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res2.status).toBe("reserved");
  });

  it("settles confirmed-not-created and permits subsequent launch for that destination", async () => {
    const res = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res.status).toBe("reserved");
    if (res.status !== "reserved") return;

    const settleRes = await settleTerminalLaunch(res.attemptId, {
      kind: "confirmed-not-created",
      reason: "Pre-dispatch validation failed: folder does not exist",
    });
    expect(settleRes.status).toBe("settled");

    const res2 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res2.status).toBe("reserved");
  });

  it("uncertain settlement remains unresolved and continues to block compatible creation", async () => {
    const res = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res.status).toBe("reserved");
    if (res.status !== "reserved") return;

    const settleRes = await settleTerminalLaunch(res.attemptId, {
      kind: "uncertain",
      reason: "HTTP request timed out before response received",
    });
    expect(settleRes.status).toBe("uncertain");

    // Must still be blocked!
    const res2 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res2.status).toBe("blocked");
    if (res2.status === "blocked") {
      expect(res2.existingAttemptId).toBe(res.attemptId);
    }
  });

  it("fails closed when launch journal document in storage is corrupt", async () => {
    localStorage.setItem(APP_LAUNCH_ATTEMPTS_STORAGE_KEY, "not valid json {");

    const res = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res.status).toBe("blocked");
    if (res.status === "blocked") {
      expect(res.reason).toContain("unreadable or corrupt state");
    }
  });

  it("preserves safety journal during OS envelope import", async () => {
    const res = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res.status).toBe("reserved");

    const envelopeJson = JSON.stringify({
      version: 1,
      namespaces: {
        dock: ["terminals"],
      },
    });

    const importRes = importOsEnvelope(envelopeJson);
    expect(importRes.success).toBe(true);

    // Journal remains intact and blocks duplicate
    const res2 = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res2.status).toBe("blocked");
  });

  it("strictly enforces settlement immutability against overwriting", async () => {
    const res = await reserveTerminalLaunch(baseParams, {
      generation: 1,
      desktopId: "desk-1",
    });
    expect(res.status).toBe("reserved");
    if (res.status !== "reserved") return;

    // Settle as confirmed-success
    const settle1 = await settleTerminalLaunch(res.attemptId, {
      kind: "confirmed-success",
      target: {
        profileId: "default",
        generation: 1,
        serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
        terminalId: "term-1",
        incarnation: "1",
      },
    });
    expect(settle1.status).toBe("settled");

    // Attempt to overwrite with confirmed-not-created
    const settle2 = await settleTerminalLaunch(res.attemptId, {
      kind: "confirmed-not-created",
      reason: "Malicious or stale overwrite attempt",
    });
    expect(settle2.status).toBe("settled");

    // Document in storage must STILL be confirmed-success
    const doc = JSON.parse(localStorage.getItem(APP_LAUNCH_ATTEMPTS_STORAGE_KEY)!);
    const record = doc.records.find((r: any) => r.attemptId === res.attemptId);
    expect(record.state).toBe("confirmed-success");
    expect(record.provenance.terminalId).toBe("term-1");
  });

  describe("getLaunchAttempt (read-only query)", () => {
    it("returns ok for an existing reserved attempt", async () => {
      const res = await reserveTerminalLaunch(baseParams, {
        generation: 1,
        desktopId: "desk-1",
      });
      expect(res.status).toBe("reserved");
      if (res.status !== "reserved") return;

      const read = getLaunchAttempt(res.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.attemptId).toBe(res.attemptId);
        expect(read.record.state).toBe("reserved-dispatch-capable");
        expect(read.record.requestedTerminalId).toBe(res.requestedTerminalId);
      }
    });

    it("returns missing for an unknown attemptId", () => {
      const read = getLaunchAttempt("non-existent-attempt-id");
      expect(read).toEqual({ status: "missing" });
    });

    it("returns unreadable when storage contains corrupted JSON", () => {
      localStorage.setItem(APP_LAUNCH_ATTEMPTS_STORAGE_KEY, "invalid-json{");
      const read = getLaunchAttempt("any-attempt");
      expect(read.status).toBe("unreadable");
      if (read.status === "unreadable") {
        expect(read.reason).toContain("Corrupted launch journal JSON");
      }
    });

    it("returns unreadable when localStorage throws an error", () => {
      const spy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("QuotaExceeded or SecurityError");
        });
      try {
        const read = getLaunchAttempt("any-attempt");
        expect(read.status).toBe("unreadable");
        if (read.status === "unreadable") {
          expect(read.reason).toContain("QuotaExceeded or SecurityError");
        }
      } finally {
        spy.mockRestore();
      }
    });

    it("never mutates the journal or storage contents", async () => {
      const res = await reserveTerminalLaunch(baseParams, {
        generation: 1,
        desktopId: "desk-1",
      });
      expect(res.status).toBe("reserved");
      if (res.status !== "reserved") return;

      const rawBefore = localStorage.getItem(APP_LAUNCH_ATTEMPTS_STORAGE_KEY);
      const read1 = getLaunchAttempt(res.attemptId);
      expect(read1.status).toBe("ok");
      if (read1.status === "ok") {
        // Mutating the returned record object does not change stored state
        (read1.record as unknown as Record<string, unknown>).state =
          "confirmed-not-created";
      }

      const read2 = getLaunchAttempt(res.attemptId);
      expect(read2.status).toBe("ok");
      if (read2.status === "ok") {
        expect(read2.record.state).toBe("reserved-dispatch-capable");
      }

      const rawAfter = localStorage.getItem(APP_LAUNCH_ATTEMPTS_STORAGE_KEY);
      expect(rawAfter).toBe(rawBefore);
    });
  });
});
