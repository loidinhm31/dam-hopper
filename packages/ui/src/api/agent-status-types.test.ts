import { describe, expect, it } from "vitest";
import {
  AGENT_STATUS_PROTOCOL_VERSION,
  MAX_SAFE_INTEGER,
  decodeAgentAttentionEvent,
  decodeAgentStatusChangedPayload,
  decodeAgentStatusInvalidatedPayload,
  decodeAgentStatusRemovedPayload,
  decodeAgentStatusSnapshot,
  decodeTerminalAgentStatusRow,
} from "./agent-status-types.js";

describe("agent-status-types", () => {
  it("decodes a valid terminal agent status row", () => {
    const raw = {
      id: "term-1",
      incarnation: 1,
      agentKind: "omp",
      agentSessionId: "sess-abc",
      reporterEpoch: 2,
      state: "working",
      turnId: "turn-42",
      attentionRevision: 0,
    };
    const row = decodeTerminalAgentStatusRow(raw);
    expect(row.id).toBe("term-1");
    expect(row.incarnation).toBe(1);
    expect(row.agentKind).toBe("omp");
    expect(row.state).toBe("working");
    expect(row.turnId).toBe("turn-42");
    expect(row.reason).toBeUndefined();
    expect(row.lastOutcome).toBeUndefined();
  });

  it("decodes a blocked row with reason", () => {
    const raw = {
      id: "term-1",
      incarnation: 1,
      agentKind: "omp",
      agentSessionId: "sess-abc",
      reporterEpoch: 2,
      state: "blocked",
      reason: "approval",
      attentionRevision: 1,
    };
    const row = decodeTerminalAgentStatusRow(raw);
    expect(row.state).toBe("blocked");
    expect(row.reason).toBe("approval");
  });

  it("rejects unknown state or invalid reason", () => {
    expect(() =>
      decodeTerminalAgentStatusRow({
        id: "term-1",
        incarnation: 1,
        agentKind: "omp",
        agentSessionId: "sess-abc",
        reporterEpoch: 2,
        state: "sleeping", // invalid
        attentionRevision: 0,
      }),
    ).toThrow(/invalid 'state'/);

    expect(() =>
      decodeTerminalAgentStatusRow({
        id: "term-1",
        incarnation: 1,
        agentKind: "omp",
        agentSessionId: "sess-abc",
        reporterEpoch: 2,
        state: "blocked",
        reason: "arbitrary-text", // invalid
        attentionRevision: 0,
      }),
    ).toThrow(/invalid 'reason'/);
  });

  it("rejects safe integer overflow", () => {
    expect(() =>
      decodeTerminalAgentStatusRow({
        id: "term-1",
        incarnation: MAX_SAFE_INTEGER + 1,
        agentKind: "omp",
        agentSessionId: "sess-abc",
        reporterEpoch: 1,
        state: "idle",
        attentionRevision: 0,
      }),
    ).toThrow(/invalid 'incarnation'/);
  });

  it("decodes a valid agent attention event", () => {
    const raw = {
      id: "100:term-1:1:1",
      kind: "turn-ended",
      terminalId: "term-1",
      incarnation: 1,
      agentKind: "omp",
      agentSessionId: "sess-abc",
      turnId: "turn-1",
      outcome: "ended",
      attentionRevision: 1,
      timestampMs: 123456789,
    };
    const ev = decodeAgentAttentionEvent(raw);
    expect(ev.id).toBe("100:term-1:1:1");
    expect(ev.kind).toBe("turn-ended");
    expect(ev.outcome).toBe("ended");
  });

  it("decodes a complete agent status snapshot", () => {
    const raw = {
      version: AGENT_STATUS_PROTOCOL_VERSION,
      serverEpoch: 12345,
      revision: 1,
      availability: "ready",
      terminals: [
        {
          id: "term-1",
          incarnation: 1,
          agentKind: "omp",
          agentSessionId: "sess-1",
          reporterEpoch: 1,
          state: "idle",
          attentionRevision: 0,
        },
      ],
    };
    const snapshot = decodeAgentStatusSnapshot(raw);
    expect(snapshot.version).toBe(1);
    expect(snapshot.serverEpoch).toBe(12345);
    expect(snapshot.availability).toBe("ready");
    expect(snapshot.terminals).toHaveLength(1);
    expect(snapshot.terminals[0].id).toBe("term-1");
  });

  it("rejects wrong protocol version", () => {
    expect(() =>
      decodeAgentStatusSnapshot({
        version: 99,
        serverEpoch: 123,
        revision: 1,
        availability: "ready",
        terminals: [],
      }),
    ).toThrow(/Unsupported agent status version/);
  });

  it("decodes push payloads", () => {
    const changed = decodeAgentStatusChangedPayload({
      serverEpoch: 123,
      revision: 2,
      row: {
        id: "term-1",
        incarnation: 1,
        agentKind: "omp",
        agentSessionId: "sess-1",
        reporterEpoch: 1,
        state: "working",
        attentionRevision: 0,
      },
    });
    expect(changed.revision).toBe(2);
    expect(changed.row.state).toBe("working");

    const removed = decodeAgentStatusRemovedPayload({
      serverEpoch: 123,
      revision: 3,
      terminalId: "term-1",
      incarnation: 1,
    });
    expect(removed.terminalId).toBe("term-1");

    const invalidated = decodeAgentStatusInvalidatedPayload({
      serverEpoch: 123,
      revision: 4,
    });
    expect(invalidated.revision).toBe(4);
  });
});

describe("agent status attention identity", () => {
  it("rejects attention that does not belong to the changed row and server epoch", () => {
    const row = {
      id: "term-1",
      incarnation: 2,
      agentKind: "omp",
      agentSessionId: "session-1",
      reporterEpoch: 3,
      state: "idle",
      attentionRevision: 4,
    };
    const attention = {
      id: "8:term-1:2:4",
      kind: "turn-ended",
      terminalId: "term-1",
      incarnation: 2,
      agentKind: "omp",
      agentSessionId: "session-1",
      outcome: "ended",
      attentionRevision: 4,
      timestampMs: 100,
    };
    const valid = { serverEpoch: 8, revision: 5, row, attention };
    expect(decodeAgentStatusChangedPayload(valid).attention?.id).toBe(
      attention.id,
    );
    expect(() =>
      decodeAgentStatusChangedPayload({
        ...valid,
        attention: { ...attention, id: "9:term-1:2:4" },
      }),
    ).toThrow(/inconsistent attention/);
    expect(() =>
      decodeAgentStatusChangedPayload({
        ...valid,
        attention: { ...attention, agentSessionId: "other-session" },
      }),
    ).toThrow(/inconsistent attention/);
  });
});
