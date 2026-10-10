import { describe, expect, it, vi } from "vitest";
import {
  api,
  decodeAgentFreeStatus,
  decodeClientPresenceStatus,
  decodeConsentDecisionResponse,
  decodeConsentStatus,
  decodeIdleSuspendStatusV1,
  isIdleSuspendStatusV1,
  asIdleSuspendStatusV1,
} from "./client.js";
import { initTransport, type Transport } from "./transport.js";
function makeBaseStatus(): Record<string, unknown> {
  return {
    version: 1,
    statusRevision: 10,
    state: "watching",
    enabled: true,
    timingMutable: true,
    timingMutableReason: null,
    capabilityCode: "systemd",
    currentEpoch: 2,
    quietPeriodSeconds: 900,
    wakeAfterSeconds: 600,
    minQuietPeriodSeconds: 60,
    maxQuietPeriodSeconds: 86400,
    minWakeAfterSeconds: 60,
    maxWakeAfterSeconds: 86400,
    fleetSnapshot: {
      generation: 4,
      liveCount: 1,
      creatingCount: 0,
      restartPendingCount: 0,
      disposing: false,
      handoffActive: false,
    },
    armDeadlineMs: null,
    lastOutcome: null,
    detail: null,
    timestampMs: 1726000000000,
  };
}

describe("decodeIdleSuspendStatusV1", () => {
  it("decodes valid new-server status with empty-fleet policy", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "empty-fleet",
      activity: null,
    };
    const decoded = decodeIdleSuspendStatusV1(raw);
    expect(decoded.automaticPolicy).toBe("empty-fleet");
    expect(decoded.activity).toBeNull();
    expect(isIdleSuspendStatusV1(raw)).toBe(true);
    expect(asIdleSuspendStatusV1(raw)).toEqual(decoded);
  });

  it("decodes valid new-server status with agent-activity policy (available, warning null)", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 2,
        monitoredTerminalCount: 3,
        sampledAtMs: 1726000001000,
        lastActivityAtMs: 1726000000500,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
    };
    const decoded = decodeIdleSuspendStatusV1(raw);
    expect(decoded.automaticPolicy).toBe("agent-activity");
    expect(decoded.activity).not.toBeNull();
    expect(decoded.activity?.measurementState).toBe("available");
    expect(decoded.activity?.reasonCode).toBe("quiet");
    expect(decoded.activity?.recognizedAgentCount).toBe(2);
    expect(decoded.activity?.monitoredTerminalCount).toBe(3);
    expect(decoded.activity?.networkCoverage).toBe("tcp4-tcp6");
    expect(decoded.activity?.measurementWarning).toBeNull();
  });

  it("decodes valid new-server status with agent-activity policy (initializing with warning)", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "initializing",
        reasonCode: "reconciling",
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: {
          reasonCode: "reconciling",
          blockedSinceMs: 1726000000000,
          processes: [
            { pid: 101, executableIdentity: "/usr/bin/codex" },
            { pid: 202, executableIdentity: null },
          ],
          processesTruncated: false,
        },
      },
    };
    const decoded = decodeIdleSuspendStatusV1(raw);
    expect(decoded.automaticPolicy).toBe("agent-activity");
    expect(decoded.activity?.measurementState).toBe("initializing");
    expect(decoded.activity?.recognizedAgentCount).toBeNull();
    expect(decoded.activity?.measurementWarning?.reasonCode).toBe(
      "reconciling",
    );
    expect(decoded.activity?.measurementWarning?.processes).toHaveLength(2);
    expect(decoded.activity?.measurementWarning?.processes[0]).toEqual({
      pid: 101,
      executableIdentity: "/usr/bin/codex",
    });
    expect(decoded.activity?.measurementWarning?.processes[1]).toEqual({
      pid: 202,
      executableIdentity: null,
    });
  });

  it("normalizes old server when both additive properties are omitted", () => {
    const raw = makeBaseStatus();
    expect("automaticPolicy" in raw).toBe(false);
    expect("activity" in raw).toBe(false);

    const decoded = decodeIdleSuspendStatusV1(raw);
    expect(decoded.automaticPolicy).toBe("empty-fleet");
    expect(decoded.activity).toBeNull();
    // transport-owned raw object must not be mutated
    expect("automaticPolicy" in raw).toBe(false);
    expect("activity" in raw).toBe(false);
  });

  it("rejects partial additive fields (automaticPolicy present, activity absent)", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "empty-fleet",
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /partial additive fields/,
    );
    expect(isIdleSuspendStatusV1(raw)).toBe(false);
  });

  it("rejects partial additive fields (activity present, automaticPolicy absent)", () => {
    const raw = {
      ...makeBaseStatus(),
      activity: null,
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /partial additive fields/,
    );
  });

  it("rejects undefined additive fields", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: undefined,
      activity: undefined,
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /additive fields cannot be undefined/,
    );
  });

  it("rejects empty-fleet policy with non-null activity", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "empty-fleet",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 0,
        monitoredTerminalCount: 0,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /activity must be null for empty-fleet policy/,
    );
  });

  it("rejects agent-activity policy with null activity", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: null,
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /activity object required for agent-activity policy/,
    );
  });

  it("rejects unknown automaticPolicy", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "unknown-policy",
      activity: null,
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /unknown automaticPolicy/,
    );
  });

  it("rejects invalid measurementState", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "invalid_state",
        reasonCode: null,
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /invalid measurementState/,
    );
  });

  it("rejects invalid networkCoverage", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 0,
        monitoredTerminalCount: 0,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-only",
        measurementWarning: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /networkCoverage must be 'tcp4-tcp6'/,
    );
  });

  it("rejects available measurement with non-null warning", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 0,
        monitoredTerminalCount: 0,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: {
          reasonCode: "reconciling",
          blockedSinceMs: 1726000000000,
          processes: [],
          processesTruncated: false,
        },
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /measurementWarning must be null when available/,
    );
  });

  it("rejects initializing/unavailable measurement with null warning", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "unavailable",
        reasonCode: "procAccess",
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /measurementWarning required when initializing or unavailable/,
    );
  });

  it("rejects warning with non-strictly-ascending PIDs", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "unavailable",
        reasonCode: "procAccess",
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: {
          reasonCode: "procAccess",
          blockedSinceMs: 1726000000000,
          processes: [
            { pid: 200, executableIdentity: "proc1" },
            { pid: 150, executableIdentity: "proc2" },
          ],
          processesTruncated: false,
        },
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /pids must be strictly ascending/,
    );
  });

  it("rejects warning process with control characters in executableIdentity", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "unavailable",
        reasonCode: "procAccess",
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: {
          reasonCode: "procAccess",
          blockedSinceMs: 1726000000000,
          processes: [{ pid: 100, executableIdentity: "bad\x00proc" }],
          processesTruncated: false,
        },
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /invalid executableIdentity/,
    );
  });

  it("rejects warning process with executableIdentity > 256 UTF-8 bytes", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "unavailable",
        reasonCode: "procAccess",
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: {
          reasonCode: "procAccess",
          blockedSinceMs: 1726000000000,
          processes: [{ pid: 100, executableIdentity: "a".repeat(257) }],
          processesTruncated: false,
        },
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /invalid executableIdentity/,
    );
  });

  it("decodes valid new-server status with agent-free policy (with consent)", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-free",
      activity: null,
      agentFree: {
        phase: "awaitingConsent",
        scope: "managed-terminals",
        inventoryState: "consistent",
        inventoryRevision: 5,
        semanticRevision: 12,
        idleCount: 2,
        blockedCount: 1,
        workingCount: 0,
        unknownCount: 0,
        freeSinceMs: 1726000000000,
        eligibleAtMs: 1726010800000,
        deferredUntilMs: null,
        reasonCode: "allFree",
      },
      clientPresence: {
        connectionCount: 2,
        pendingUpgradeCount: 0,
        revision: 3,
        available: true,
      },
      consent: {
        requestId: "req-abc-123",
        requestRevision: 1,
        state: "pending",
        requestedAtMs: 1726010800000,
        expiresAtMs: 1726010860000,
        decision: null,
        wakeAfterSeconds: 600,
      },
    };
    const decoded = decodeIdleSuspendStatusV1(raw);
    expect(decoded.automaticPolicy).toBe("agent-free");
    expect(decoded.activity).toBeNull();
    expect(decoded.agentFree?.phase).toBe("awaitingConsent");
    expect(decoded.agentFree?.scope).toBe("managed-terminals");
    expect(decoded.agentFree?.inventoryState).toBe("consistent");
    expect(decoded.agentFree?.idleCount).toBe(2);
    expect(decoded.agentFree?.blockedCount).toBe(1);
    expect(decoded.agentFree?.workingCount).toBe(0);
    expect(decoded.clientPresence?.connectionCount).toBe(2);
    expect(decoded.clientPresence?.available).toBe(true);
    expect(decoded.consent?.requestId).toBe("req-abc-123");
    expect(decoded.consent?.decision).toBeNull();
    expect(isIdleSuspendStatusV1(raw)).toBe(true);
    expect(asIdleSuspendStatusV1(raw)).toEqual(decoded);
  });

  it("decodes valid new-server status with agent-free policy (consent null)", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-free",
      activity: null,
      agentFree: {
        phase: "tracking",
        scope: "managed-terminals",
        inventoryState: "consistent",
        inventoryRevision: 1,
        semanticRevision: 1,
        idleCount: 0,
        blockedCount: 0,
        workingCount: 0,
        unknownCount: 0,
        freeSinceMs: 1726000000000,
        eligibleAtMs: 1726010800000,
        deferredUntilMs: null,
        reasonCode: "noAgents",
      },
      clientPresence: {
        connectionCount: 0,
        pendingUpgradeCount: 0,
        revision: 1,
        available: true,
      },
      consent: null,
    };
    const decoded = decodeIdleSuspendStatusV1(raw);
    expect(decoded.automaticPolicy).toBe("agent-free");
    expect(decoded.activity).toBeNull();
    expect(decoded.agentFree?.phase).toBe("tracking");
    expect(decoded.consent).toBeNull();
    expect(isIdleSuspendStatusV1(raw)).toBe(true);
  });

  it("rejects agent-free policy with non-null activity", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-free",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 0,
        monitoredTerminalCount: 0,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
      agentFree: {
        phase: "tracking",
        scope: "managed-terminals",
        inventoryState: "consistent",
        inventoryRevision: 1,
        semanticRevision: 1,
        idleCount: 0,
        blockedCount: 0,
        workingCount: 0,
        unknownCount: 0,
        freeSinceMs: null,
        eligibleAtMs: null,
        deferredUntilMs: null,
        reasonCode: null,
      },
      clientPresence: {
        connectionCount: 1,
        pendingUpgradeCount: 0,
        revision: 1,
        available: true,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /activity must be null for agent-free policy/,
    );
  });

  it("rejects agent-free policy with missing agentFree", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-free",
      activity: null,
      clientPresence: {
        connectionCount: 1,
        pendingUpgradeCount: 0,
        revision: 1,
        available: true,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /agentFree object required for agent-free policy/,
    );
  });

  it("rejects agent-free policy with missing clientPresence", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-free",
      activity: null,
      agentFree: {
        phase: "tracking",
        scope: "managed-terminals",
        inventoryState: "consistent",
        inventoryRevision: 1,
        semanticRevision: 1,
        idleCount: null,
        blockedCount: null,
        workingCount: null,
        unknownCount: null,
        freeSinceMs: null,
        eligibleAtMs: null,
        deferredUntilMs: null,
        reasonCode: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /clientPresence object required for agent-free policy/,
    );
  });

  it("rejects empty-fleet policy with non-null agentFree", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "empty-fleet",
      activity: null,
      agentFree: {
        phase: "tracking",
        scope: "managed-terminals",
        inventoryState: "consistent",
        inventoryRevision: 1,
        semanticRevision: 1,
        idleCount: null,
        blockedCount: null,
        workingCount: null,
        unknownCount: null,
        freeSinceMs: null,
        eligibleAtMs: null,
        deferredUntilMs: null,
        reasonCode: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /agentFree must be null for empty-fleet policy/,
    );
  });

  it("rejects agent-activity policy with non-null agentFree", () => {
    const raw = {
      ...makeBaseStatus(),
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 1,
        monitoredTerminalCount: 1,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
      agentFree: {
        phase: "tracking",
        scope: "managed-terminals",
        inventoryState: "consistent",
        inventoryRevision: 1,
        semanticRevision: 1,
        idleCount: null,
        blockedCount: null,
        workingCount: null,
        unknownCount: null,
        freeSinceMs: null,
        eligibleAtMs: null,
        deferredUntilMs: null,
        reasonCode: null,
      },
    };
    expect(() => decodeIdleSuspendStatusV1(raw)).toThrow(
      /agentFree must be null for agent-activity policy/,
    );
  });

  it("rejects invalid agentFree phase", () => {
    const badPhase = {
      phase: "unknown_phase",
      scope: "managed-terminals",
      inventoryState: "consistent",
      inventoryRevision: 1,
      semanticRevision: 1,
      idleCount: 0,
      blockedCount: 0,
      workingCount: 0,
      unknownCount: 0,
      freeSinceMs: null,
      eligibleAtMs: null,
      deferredUntilMs: null,
      reasonCode: null,
    };
    expect(() => decodeAgentFreeStatus(badPhase)).toThrow(/invalid phase/);
  });

  it("rejects invalid clientPresence connectionCount", () => {
    const badPresence = {
      connectionCount: -1,
      pendingUpgradeCount: 0,
      revision: 1,
      available: true,
    };
    expect(() => decodeClientPresenceStatus(badPresence)).toThrow(/invalid connectionCount/);
  });

  it("rejects invalid consent state", () => {
    const badConsent = {
      requestId: "req-1",
      requestRevision: 1,
      state: "unknownState",
      requestedAtMs: 1726000000000,
      expiresAtMs: 1726000060000,
      decision: null,
      wakeAfterSeconds: 600,
    };
    expect(() => decodeConsentStatus(badConsent)).toThrow(/invalid state/);
  });

  it("rejects invalid consent decision", () => {
    const badDecision = {
      requestId: "req-1",
      requestRevision: 1,
      state: "approved",
      requestedAtMs: 1726000000000,
      expiresAtMs: 1726000060000,
      decision: "maybe",
      wakeAfterSeconds: 600,
    };
    expect(() => decodeConsentStatus(badDecision)).toThrow(/invalid decision/);
  });

  it("rejects invalid agentFree scope", () => {
    expect(() =>
      decodeAgentFreeStatus({
        phase: "tracking",
        scope: "host-wide",
        inventoryState: "consistent",
        inventoryRevision: 1,
        semanticRevision: 1,
        idleCount: 0,
        blockedCount: 0,
        workingCount: 0,
        unknownCount: 0,
        freeSinceMs: null,
        eligibleAtMs: null,
        deferredUntilMs: null,
        reasonCode: null,
      }),
    ).toThrow(/invalid scope/);
  });

  it("rejects empty-fleet or agent-activity policy with non-null clientPresence or consent", () => {
    expect(() =>
      decodeIdleSuspendStatusV1({
        ...makeBaseStatus(),
        automaticPolicy: "empty-fleet",
        activity: null,
        clientPresence: {
          connectionCount: 1,
          pendingUpgradeCount: 0,
          revision: 1,
          available: true,
        },
      }),
    ).toThrow(/clientPresence must be null for empty-fleet policy/);

    expect(() =>
      decodeIdleSuspendStatusV1({
        ...makeBaseStatus(),
        automaticPolicy: "empty-fleet",
        activity: null,
        consent: {
          requestId: "req-1",
          requestRevision: 1,
          state: "pending",
          requestedAtMs: 1726000000000,
          expiresAtMs: 1726000060000,
          decision: null,
          wakeAfterSeconds: 600,
        },
      }),
    ).toThrow(/consent must be null for empty-fleet policy/);
  });
});

describe("api.system.idleSuspendStatus", () => {
  it("decodes valid transport response", async () => {
    const mockStatus = {
      ...makeBaseStatus(),
      automaticPolicy: "empty-fleet",
      activity: null,
    };
    const mockTransport = {
      invoke: vi.fn().mockResolvedValue(mockStatus),
    } as unknown as Transport;
    initTransport(mockTransport);

    const result = await api.system.idleSuspendStatus();
    expect(result.automaticPolicy).toBe("empty-fleet");
    expect(result.activity).toBeNull();
    expect(mockTransport.invoke).toHaveBeenCalledWith(
      "system:idleSuspendStatus",
    );
  });

  it("propagates transport rejection without fallback", async () => {
    const mockError = new Error("Network error 500");
    const mockTransport = {
      invoke: vi.fn().mockRejectedValue(mockError),
    } as unknown as Transport;
    initTransport(mockTransport);

    await expect(api.system.idleSuspendStatus()).rejects.toThrow(
      "Network error 500",
    );
  });

  it("rejects malformed response as error", async () => {
    const mockTransport = {
      invoke: vi.fn().mockResolvedValue({ malformed: "data" }),
    } as unknown as Transport;
    initTransport(mockTransport);

    await expect(api.system.idleSuspendStatus()).rejects.toThrow(
      /Invalid idle suspend status/,
    );
  });
});

describe("api.system.submitConsentDecision", () => {
  it("decodes valid consent decision response and rejects malformed payload", async () => {
    const validResp = {
      version: 1,
      requestId: "req-123",
      decision: "approve",
      statusRevision: 14,
      settled: true,
    };
    const mockTransport = {
      invoke: vi.fn().mockResolvedValueOnce(validResp).mockResolvedValueOnce({ version: 2 }),
    } as unknown as Transport;
    initTransport(mockTransport);

    const res = await api.system.submitConsentDecision({
      requestId: "req-123",
      requestRevision: 2,
      connectionId: "conn-1",
      decisionCapability: "cap-secret",
      decision: "approve",
    });
    expect(res).toEqual(validResp);
    expect(mockTransport.invoke).toHaveBeenCalledWith(
      "system:submitConsentDecision",
      expect.objectContaining({
        requestId: "req-123",
        decision: "approve",
      }),
    );

    await expect(
      api.system.submitConsentDecision({
        requestId: "req-123",
        requestRevision: 2,
        connectionId: "conn-1",
        decisionCapability: "cap-secret",
        decision: "approve",
      }),
    ).rejects.toThrow(/Invalid consent decision response/);
    expect(() => decodeConsentDecisionResponse(null)).toThrow(/expected plain object/);
  });
});
