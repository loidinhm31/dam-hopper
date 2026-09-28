import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentStatusChangedPayload,
  AgentStatusSnapshotV1,
} from "@/api/agent-status-types.js";
import type { ConnectionRef } from "@/api/ownership.js";

const deliver = vi.hoisted(() => vi.fn());
vi.mock("@/lib/terminal-agent-notification-integration.js", () => ({
  deliverSemanticAgentAttention: deliver,
}));

import {
  applyAgentStatusChanged,
  applyAgentStatusRemoved,
  beginAgentStatusConnection,
  disconnectAgentStatusConnection,
  installAgentStatusSnapshot,
  removeAgentStatusProfile,
  unsupportedAgentStatusConnection,
  useAgentStatusStore,
} from "./agent-status.js";

const owner = (profileId: string, generation = 1): ConnectionRef => ({
  profileId,
  generation,
});
const row = (incarnation = 1, attentionRevision = 0) => ({
  id: "same-terminal",
  incarnation,
  agentKind: "omp" as const,
  agentSessionId: "agent",
  reporterEpoch: 1,
  state: "idle" as const,
  attentionRevision,
});
const snapshot = (
  revision = 1,
  epoch = 7,
  incarnation = 1,
  attentionRevision = 0,
): AgentStatusSnapshotV1 => ({
  version: 1,
  serverEpoch: epoch,
  revision,
  availability: "ready",
  terminals: [row(incarnation, attentionRevision)],
});
const changed = (
  revision: number,
  attentionRevision: number,
  incarnation = 1,
): AgentStatusChangedPayload => ({
  serverEpoch: 7,
  revision,
  row: row(incarnation, attentionRevision),
  attention: {
    id: `7:same-terminal:${incarnation}:${attentionRevision}`,
    kind: "turn-ended",
    terminalId: "same-terminal",
    incarnation,
    agentKind: "omp",
    agentSessionId: "agent",
    turnId: `turn-${attentionRevision}`,
    outcome: "ended",
    attentionRevision,
    timestampMs: 10,
  },
});

beforeEach(() => {
  useAgentStatusStore.setState({ profiles: new Map() });
  deliver.mockClear();
});

describe("semantic agent status ownership and attention", () => {
  it("C09: keeps identical terminal IDs isolated by profile and dedupes accepted attention", () => {
    const a = owner("a"),
      b = owner("b");
    for (const ref of [a, b]) {
      beginAgentStatusConnection(ref);
      installAgentStatusSnapshot(ref, snapshot());
    }
    expect(applyAgentStatusChanged(a, changed(2, 1))).toBe("applied");
    expect(applyAgentStatusChanged(a, changed(2, 1))).toBe("ignored");
    expect(applyAgentStatusChanged(b, changed(2, 1))).toBe("applied");
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(useAgentStatusStore.getState().profiles.get("a")?.revision).toBe(2);
    expect(useAgentStatusStore.getState().profiles.get("b")?.revision).toBe(2);
    expect(
      applyAgentStatusRemoved(a, {
        serverEpoch: 7,
        revision: 3,
        terminalId: "same-terminal",
        incarnation: 1,
      }),
    ).toBe("applied");
    expect(useAgentStatusStore.getState().profiles.get("a")?.rows.size).toBe(0);
    expect(useAgentStatusStore.getState().profiles.get("b")?.rows.size).toBe(1);
  });

  it("C10: reconnect baselines are silent even when the last turn ended; old generation cannot deliver", () => {
    const first = owner("a"),
      second = owner("a", 2);
    beginAgentStatusConnection(first);
    installAgentStatusSnapshot(first, snapshot(4, 7, 1, 3));
    disconnectAgentStatusConnection(first);
    beginAgentStatusConnection(second);
    installAgentStatusSnapshot(second, snapshot(5, 7, 1, 4));
    expect(deliver).not.toHaveBeenCalled();
    expect(applyAgentStatusChanged(first, changed(6, 5))).toBe("ignored");
    expect(applyAgentStatusChanged(second, changed(6, 4))).toBe("applied");
    expect(deliver).not.toHaveBeenCalled();
    expect(applyAgentStatusChanged(second, changed(7, 5))).toBe("applied");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("C11: revision gaps and stale incarnations cannot deliver; removal retires cursor", () => {
    const ref = owner("a");
    beginAgentStatusConnection(ref);
    installAgentStatusSnapshot(ref, snapshot());
    expect(applyAgentStatusChanged(ref, changed(3, 1))).toBe("gap");
    expect(applyAgentStatusChanged(ref, changed(2, 1, 0))).toBe("gap");
    expect(deliver).not.toHaveBeenCalled();
    expect(
      applyAgentStatusRemoved(ref, {
        serverEpoch: 7,
        revision: 2,
        terminalId: "same-terminal",
        incarnation: 1,
      }),
    ).toBe("applied");
    expect(applyAgentStatusChanged(ref, changed(3, 1, 2))).toBe("applied");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("C12: unsupported preserves known rows, profile removal clears them, epoch replacement resets cursors", () => {
    const ref = owner("a");
    beginAgentStatusConnection(ref);
    installAgentStatusSnapshot(ref, snapshot(3, 7, 1, 2));
    unsupportedAgentStatusConnection(ref);
    expect(useAgentStatusStore.getState().profiles.get("a")?.availability).toBe(
      "unsupported",
    );
    expect(useAgentStatusStore.getState().profiles.get("a")?.rows.size).toBe(1);
    beginAgentStatusConnection(owner("a", 2));
    installAgentStatusSnapshot(owner("a", 2), snapshot(1, 8, 1, 0));
    const profile = useAgentStatusStore.getState().profiles.get("a");
    expect(profile?.epoch).toBe(8);
    expect(profile?.cursors.get("same-terminal")?.revision).toBe(0);
    removeAgentStatusProfile("a");
    expect(useAgentStatusStore.getState().profiles.has("a")).toBe(false);
  });
});
