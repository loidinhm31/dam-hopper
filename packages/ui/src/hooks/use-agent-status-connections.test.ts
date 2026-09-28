import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client.js";
import type { AgentStatusSnapshotV1 } from "@/api/agent-status-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";

const deliver = vi.hoisted(() => vi.fn());
vi.mock("@/lib/terminal-agent-notification-integration.js", () => ({
  deliverSemanticAgentAttention: deliver,
}));

import { watchAgentStatusConnection } from "./use-agent-status-connections.js";

const owner: ConnectionRef = { profileId: "profile", generation: 3 };
const row = (attentionRevision = 0) => ({
  id: "terminal",
  incarnation: 2,
  agentKind: "omp" as const,
  agentSessionId: "agent",
  reporterEpoch: 1,
  state: "idle" as const,
  attentionRevision,
});
const snapshot = (
  revision: number,
  attentionRevision = 0,
): AgentStatusSnapshotV1 => ({
  version: 1,
  serverEpoch: 42,
  revision,
  availability: "ready",
  terminals: [row(attentionRevision)],
});
const push = (revision: number, attentionRevision: number) => ({
  serverEpoch: 42,
  revision,
  row: row(attentionRevision),
  attention: {
    id: `42:terminal:2:${attentionRevision}`,
    kind: "turn-ended",
    terminalId: "terminal",
    incarnation: 2,
    agentKind: "omp",
    agentSessionId: "agent",
    attentionRevision,
    timestampMs: 123,
    outcome: "ended",
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function events() {
  const subscriptions = new Map<string, (payload: unknown) => void>();
  return {
    subscriptions,
    onEvent: (channel: string, cb: (payload: unknown) => void) => {
      subscriptions.set(channel, cb);
      return () => {
        subscriptions.delete(channel);
      };
    },
    send: (kind: string, payload: unknown) => {
      subscriptions.get(kind)?.(payload);
    },
  };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  deliver.mockClear();
  useAgentStatusStore.setState({ profiles: new Map() });
});
afterEach(() => vi.useRealTimers());

describe("app-root agent status watcher", () => {
  it("subscribes before snapshot; ignores baseline attention and delivers strictly newer buffered attention", async () => {
    const pending = deferred<AgentStatusSnapshotV1>();
    const bus = events();
    const getSnapshot = vi.fn(() => pending.promise);
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: getSnapshot },
      bus,
      () => true,
    );
    expect(bus.subscriptions.size).toBe(3);
    bus.send("terminal:agentStatusChanged", push(5, 1));
    bus.send("terminal:agentStatusChanged", push(6, 2));
    pending.resolve(snapshot(5, 1));
    await settle();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(
      useAgentStatusStore.getState().profiles.get("profile")?.revision,
    ).toBe(6);
    stop();
    expect(bus.subscriptions.size).toBe(0);
  });

  it("recovers immediately on gaps and invalid pushes without replaying buffered attention", async () => {
    const bus = events();
    const recovery = deferred<AgentStatusSnapshotV1>();
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1))
      .mockImplementationOnce(() => recovery.promise)
      .mockResolvedValue(snapshot(3, 2));
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: getSnapshot },
      bus,
      () => true,
    );
    await settle();
    bus.send("terminal:agentStatusChanged", push(3, 1)); // revision 2 was lost
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    bus.send("terminal:agentStatusChanged", push(4, 3));
    recovery.resolve(snapshot(3, 2));
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    bus.send("terminal:agentStatusChanged", push(5, 4));
    expect(deliver).toHaveBeenCalledTimes(1);
    bus.send("terminal:agentStatusChanged", {
      ...push(6, 5),
      attention: { ...push(6, 5).attention, id: "forged" },
    });
    expect(getSnapshot).toHaveBeenCalledTimes(3);
    stop();
  });

  it("recovers immediately from stream invalidation with a silent snapshot", async () => {
    const bus = events();
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1))
      .mockResolvedValue(snapshot(2, 1));
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: getSnapshot },
      bus,
      () => true,
    );
    await settle();
    bus.send("terminal:agentStatusInvalidated", {
      serverEpoch: 42,
      revision: 2,
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    expect(
      useAgentStatusStore.getState().profiles.get("profile")?.revision,
    ).toBe(2);
    stop();
  });

  it("bounds the subscribe-before-snapshot race buffer at 256 and silently rebaselines after overflow", async () => {
    const pending = deferred<AgentStatusSnapshotV1>();
    const bus = events();
    const getSnapshot = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(snapshot(2, 1));
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: getSnapshot },
      bus,
      () => true,
    );
    for (let index = 0; index <= 256; index++) {
      bus.send("terminal:agentStatusChanged", push(2, 1));
    }
    pending.resolve(snapshot(1));
    await settle();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(deliver).not.toHaveBeenCalled();
    bus.send("terminal:agentStatusChanged", push(3, 2));
    expect(deliver).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not commit a retired generation's delayed snapshot or deliver its buffered events", async () => {
    const pending = deferred<AgentStatusSnapshotV1>();
    let live = true;
    const bus = events();
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: () => pending.promise },
      bus,
      () => live,
    );
    bus.send("terminal:agentStatusChanged", push(2, 1));
    live = false;
    stop();
    pending.resolve(snapshot(1));
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    expect(
      useAgentStatusStore.getState().profiles.get("profile")?.availability,
    ).toBe("unavailable");
  });

  it("holds 404 as unsupported through periodic reconciliation until a new generation", async () => {
    const bus = events();
    const getSnapshot = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("missing", 404));
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: getSnapshot },
      bus,
      () => true,
    );
    await settle();
    expect(
      useAgentStatusStore.getState().profiles.get("profile")?.availability,
    ).toBe("unsupported");
    await vi.advanceTimersByTimeAsync(30_000);
    bus.send("terminal:agentStatusInvalidated", {
      serverEpoch: 42,
      revision: 3,
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    stop();
    const next = { ...owner, generation: 4 };
    const stopNext = watchAgentStatusConnection(
      next,
      { agentStatusSnapshot: () => Promise.resolve(snapshot(1)) },
      events(),
      () => true,
    );
    await settle();
    expect(
      useAgentStatusStore.getState().profiles.get("profile")?.availability,
    ).toBe("ready");
    stopNext();
  });

  it("reconciles every 15 seconds even with no mounted terminal", async () => {
    const getSnapshot = vi.fn().mockResolvedValue(snapshot(1));
    const stop = watchAgentStatusConnection(
      owner,
      { agentStatusSnapshot: getSnapshot },
      events(),
      () => true,
    );
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    stop();
  });
});
