import { describe, expect, it, vi } from "vitest";
import { handleIpcStatusChange, handleWorkspaceChanged } from "./use-sse.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getTransport = vi.hoisted(() => vi.fn());

vi.mock("../api/transport.js", () => ({ getTransport }));

import {
  asHostResourceAlertChangedEvent,
  handleIpcStatusChange,
  initTransportListeners,
  invalidateHostResourceQueries,
  resetTransportListeners,
  subscribeIpc,
} from "./use-sse.js";

function validAlertEvent() {
  return {
    type: "host:alertChanged" as const,
    timestamp: 1,
    data: {
      state: "memoryPressure",
      severity: "critical",
      updatedAt: 1,
      durationSeconds: 1,
      scope: "host",
      confidence: "high",
      threshold: "available memory",
      nextAction: "Inspect workload.",
      evidence: { cgroupOomDelta: false, availablePercent: 12 },
    },
  };
}

function eventTransport() {
  const callbacks = new Map<string, (data: unknown) => void>();
  const statusCallbacks = new Set<(status: string) => void>();
  return {
    onEvent: vi.fn((channel: string, callback: (data: unknown) => void) => {
      callbacks.set(channel, callback);
      return () => callbacks.delete(channel);
    }),
    emit(channel: string, data: unknown) {
      callbacks.get(channel)?.(data);
    },
    getStatus: vi.fn(() => "connecting"),
    onStatusChange: vi.fn((callback: (status: string) => void) => {
      statusCallbacks.add(callback);
      return () => statusCallbacks.delete(callback);
    }),
    emitStatus(status: string) {
      statusCallbacks.forEach((callback) => callback(status));
    },
  };
}

beforeEach(() => {
  resetTransportListeners();
  vi.clearAllMocks();
});

afterEach(() => resetTransportListeners());

describe("handleIpcStatusChange", () => {
  it("invalidates terminal sessions on connected status", () => {
    const setStatus = vi.fn();
    const invalidate = vi.fn();

    handleIpcStatusChange("connected", setStatus, invalidate);

    expect(setStatus).toHaveBeenCalledWith("connected");
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("does not invalidate terminal sessions for disconnected status", () => {
    const setStatus = vi.fn();
    const invalidate = vi.fn();

    handleIpcStatusChange("disconnected", setStatus, invalidate);

    expect(setStatus).toHaveBeenCalledWith("disconnected");
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("handleWorkspaceChanged", () => {
  it("removes project language scans before broad invalidation", async () => {
    let resolveReset!: () => void;
    const queryClient = {
      removeQueries: vi.fn(),
      resetQueries: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveReset = resolve;
          }),
      ),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(() => Promise.resolve()),
    };

    const cleanup = handleWorkspaceChanged(queryClient);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    resolveReset();
    await cleanup;

    expect(queryClient.resetQueries).toHaveBeenCalledWith({
      queryKey: ["explorer-language-scan"],
    });
    expect(queryClient.setQueriesData).toHaveBeenCalledWith(
      { queryKey: ["explorer-language-scan"] },
      expect.any(Function),
    );
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ["explorer-language-scan"],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["known-workspaces"],
    });
    expect(queryClient.removeQueries.mock.invocationCallOrder[0]).toBeLessThan(
      queryClient.invalidateQueries.mock.invocationCallOrder[0]!,
    );
  });
});

describe("asHostResourceAlertChangedEvent", () => {
  it("accepts only typed host alert event payloads", () => {
    expect(asHostResourceAlertChangedEvent(validAlertEvent())).not.toBeNull();
    expect(
      asHostResourceAlertChangedEvent({
        ...validAlertEvent(),
        data: {
          ...validAlertEvent().data,
          incidentId: null,
          openedAt: null,
          evidence: {
            cgroupOomDelta: false,
            availablePercent: null,
            reclaimablePercent: null,
            psiSomeAvg10: null,
            psiFullAvg10: null,
          },
        },
      }),
    ).not.toBeNull();
    expect(
      asHostResourceAlertChangedEvent({
        type: "host:alertChanged",
        timestamp: 1,
        data: {},
      }),
    ).toBeNull();
  });

  it("rejects malformed or out-of-scope data before it can refresh resource state", () => {
    for (const event of [
      { ...validAlertEvent(), timestamp: Number.NaN },
      {
        ...validAlertEvent(),
        data: { ...validAlertEvent().data, scope: "container" },
      },
      {
        ...validAlertEvent(),
        data: { ...validAlertEvent().data, confidence: "unknown" },
      },
      {
        ...validAlertEvent(),
        data: { ...validAlertEvent().data, durationSeconds: -1 },
      },
      {
        ...validAlertEvent(),
        data: {
          ...validAlertEvent().data,
          evidence: { cgroupOomDelta: false, psiSomeAvg10: 101 },
        },
      },
      {
        ...validAlertEvent(),
        data: { ...validAlertEvent().data, incidentId: 7 },
      },
      {
        ...validAlertEvent(),
        data: { ...validAlertEvent().data, openedAt: -1 },
      },
      {
        ...validAlertEvent(),
        data: { ...validAlertEvent().data, nextAction: "x".repeat(257) },
      },
    ]) {
      expect(asHostResourceAlertChangedEvent(event)).toBeNull();
    }
  });
});

describe("host resource transport listeners", () => {
  it("moves alert delivery to the replacement profile transport without retaining the old listener", () => {
    const first = eventTransport();
    const second = eventTransport();
    const delivered = vi.fn();
    const unsubscribe = subscribeIpc("host:alertChanged", delivered);

    getTransport.mockReturnValue(first);
    initTransportListeners();
    first.emit("host:alertChanged", validAlertEvent().data);
    expect(delivered).toHaveBeenCalledOnce();

    resetTransportListeners();
    getTransport.mockReturnValue(second);
    initTransportListeners();
    first.emit("host:alertChanged", validAlertEvent().data);
    expect(delivered).toHaveBeenCalledOnce();

    second.emit("host:alertChanged", validAlertEvent().data);
    expect(delivered).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("moves status delivery to the replacement profile transport", () => {
    const first = eventTransport();
    const second = eventTransport();
    const statuses = vi.fn();
    const unsubscribe = subscribeIpc("transport:status", (event) =>
      statuses(event.data),
    );

    getTransport.mockReturnValue(first);
    initTransportListeners();
    expect(statuses).toHaveBeenLastCalledWith("connecting");
    first.emitStatus("connected");
    expect(statuses).toHaveBeenLastCalledWith("connected");

    resetTransportListeners();
    getTransport.mockReturnValue(second);
    initTransportListeners();
    const callsAfterReplacement = statuses.mock.calls.length;
    first.emitStatus("disconnected");
    expect(statuses).toHaveBeenCalledTimes(callsAfterReplacement);

    second.emitStatus("error");
    expect(statuses).toHaveBeenLastCalledWith("error");
    unsubscribe();
  });
});

describe("invalidateHostResourceQueries", () => {
  it("invalidates both cached read-only resource endpoints", () => {
    const invalidateQueries = vi.fn();

    invalidateHostResourceQueries({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["system", "resource-snapshot"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["system", "resource-alerts"],
    });
  });
});
