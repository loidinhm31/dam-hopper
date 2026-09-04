import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostResourceSnapshotV1 } from "../api/client.js";
import { useEditorStore } from "@/stores/editor.js";
import { useProjectTargetStore } from "@/stores/project-target.js";

const getTransport = vi.hoisted(() => vi.fn());

vi.mock("../api/transport.js", () => ({ getTransport }));

import {
  applyHostResourceAlert,
  asHostResourceAlertChangedEvent,
  handleIpcStatusChange,
  initTransportListeners,
  invalidateHostResourceQueries,
  resetTransportListeners,
  subscribeIpc,
  handleWorkspaceChanged,
  handleTerminalTargetUnavailable,
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

function validTemperatureAlertEvent() {
  return {
    type: "host:alertChanged" as const,
    timestamp: 1,
    data: {
      kind: "temperature",
      key: "temperature:thermal_zone0",
      state: "temperatureHigh",
      severity: "critical",
      incidentId: "host-resource-incident-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "temperature:thermal_zone0",
      threshold: "celsius>60C for 5 minutes",
      nextAction: "Inspect cooling.",
      evidence: {
        temperatureSource: "thermal_zone0",
        temperatureLabel: "package",
        temperatureCelsius: 60.1,
      },
    },
  };
}

function validDiskAlertEvent() {
  return {
    type: "host:alertChanged" as const,
    timestamp: 1,
    data: {
      kind: "disk",
      key: "disk:/data",
      state: "diskFull",
      severity: "critical",
      incidentId: "host-resource-incident-2",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "disk:/data",
      threshold: "usage>=95%",
      nextAction: "Free space.",
      evidence: {
        diskMountPoint: "/data",
        diskName: "data",
        diskUsagePercent: 95,
      },
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

describe("handleTerminalTargetUnavailable", () => {
  beforeEach(() => {
    useProjectTargetStore.getState().resetTarget("demo");
    useEditorStore.getState().closeAll("demo");
  });

  it("reconciles the shared editor/target state and rejects malformed payloads", () => {
    const markTargetUnavailable = vi.spyOn(
      useEditorStore.getState(),
      "markTargetUnavailable",
    );
    const target = { project: "demo", worktreePath: "/tmp/demo-feature" };
    expect(
      handleTerminalTargetUnavailable({
        ...target,
        sessionId: "terminal:demo:1",
        incarnation: 11,
        targetUnavailable: true,
        willRestart: false,
      }),
    ).toBe(true);
    expect(markTargetUnavailable).toHaveBeenCalledWith(target);
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ demo: ["/tmp/demo-feature"] });
    expect(handleTerminalTargetUnavailable({ project: "demo" })).toBe(false);
    expect(
      handleTerminalTargetUnavailable({
        ...target,
        sessionId: "terminal:demo:missing-marker",
        incarnation: 12,
      }),
    ).toBe(false);
    expect(
      handleTerminalTargetUnavailable({
        ...target,
        sessionId: "terminal:demo:restarting",
        incarnation: 13,
        targetUnavailable: true,
        willRestart: true,
      }),
    ).toBe(false);
    markTargetUnavailable.mockRestore();
  });

  it("ignores a delayed target-loss event from an older incarnation", () => {
    const markTargetUnavailable = vi.spyOn(
      useEditorStore.getState(),
      "markTargetUnavailable",
    );
    const sessionId = "terminal:incarnation-race";

    expect(
      handleTerminalTargetUnavailable({
        sessionId,
        incarnation: 11,
        project: "demo",
        worktreePath: "/tmp/newer-target",
        targetUnavailable: true,
        willRestart: false,
      }),
    ).toBe(true);
    expect(
      handleTerminalTargetUnavailable({
        sessionId,
        incarnation: 10,
        project: "demo",
        worktreePath: "/tmp/older-target",
        targetUnavailable: true,
        willRestart: false,
      }),
    ).toBe(false);
    expect(markTargetUnavailable).toHaveBeenCalledOnce();
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ demo: ["/tmp/newer-target"] });
    markTargetUnavailable.mockRestore();
  });

  it("starts a fresh incarnation namespace after a transport replacement", () => {
    const markTargetUnavailable = vi.spyOn(
      useEditorStore.getState(),
      "markTargetUnavailable",
    );
    const sessionId = "terminal:profile-switch";
    const target = {
      sessionId,
      project: "demo",
      worktreePath: "/tmp/profile-target",
      targetUnavailable: true,
      willRestart: false,
    };

    expect(
      handleTerminalTargetUnavailable({ ...target, incarnation: 100 }),
    ).toBe(true);
    resetTransportListeners();
    expect(handleTerminalTargetUnavailable({ ...target, incarnation: 1 })).toBe(
      true,
    );
    expect(markTargetUnavailable).toHaveBeenCalledTimes(2);
    markTargetUnavailable.mockRestore();
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

  it("accepts a complete additive temperature event and rejects invalid nested evidence", () => {
    expect(
      asHostResourceAlertChangedEvent(validTemperatureAlertEvent()),
    ).not.toBeNull();
    for (const data of [
      { ...validTemperatureAlertEvent().data, key: "" },
      {
        ...validTemperatureAlertEvent().data,
        evidence: {
          temperatureSource: "thermal_zone0",
          temperatureCelsius: NaN,
        },
      },
      {
        ...validTemperatureAlertEvent().data,
        evidence: {
          ...validTemperatureAlertEvent().data.evidence,
          unexpected: "untrusted",
        },
      },
    ]) {
      expect(
        asHostResourceAlertChangedEvent({
          ...validTemperatureAlertEvent(),
          data,
        }),
      ).toBeNull();
    }
  });

  it("accepts a complete additive disk event", () => {
    expect(
      asHostResourceAlertChangedEvent(validDiskAlertEvent()),
    ).not.toBeNull();
  });

  it.each([
    ["unexpected evidence key", { unexpected: "untrusted" }],
    ["negative usage", { diskUsagePercent: -1 }],
    ["over-cap usage", { diskUsagePercent: 101 }],
    ["non-finite usage", { diskUsagePercent: Number.NaN }],
    ["invalid disk name", { diskName: 1 }],
    ["empty disk name", { diskName: "" }],
  ])("rejects disk evidence with %s", (_reason, invalidEvidence) => {
    expect(
      asHostResourceAlertChangedEvent({
        ...validDiskAlertEvent(),
        data: {
          ...validDiskAlertEvent().data,
          evidence: {
            ...validDiskAlertEvent().data.evidence,
            ...invalidEvidence,
          },
        },
      }),
    ).toBeNull();
  });

  it("rejects disk evidence with missing mount", () => {
    expect(
      asHostResourceAlertChangedEvent({
        ...validDiskAlertEvent(),
        data: {
          ...validDiskAlertEvent().data,
          evidence: { diskName: "data", diskUsagePercent: 95 },
        },
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

describe("resource alert cache updates", () => {
  it("keeps concurrent target alerts and removes only the recovered target", () => {
    const temperature = validTemperatureAlertEvent().data;
    const disk = {
      ...temperature,
      kind: "disk" as const,
      key: "disk:/data",
      state: "diskFull" as const,
      incidentId: "host-resource-incident-2",
      scope: "disk:/data",
      evidence: {
        diskMountPoint: "/data",
        diskName: "data",
        diskUsagePercent: 95,
      },
    };
    const snapshot = { currentAlerts: [] } as HostResourceSnapshotV1;
    const withTemperature = applyHostResourceAlert(snapshot, temperature)!;
    const withBoth = applyHostResourceAlert(withTemperature, disk)!;
    expect(withBoth.currentAlerts).toHaveLength(2);

    const recovered = applyHostResourceAlert(withBoth, {
      ...temperature,
      resolvedAt: 0,
    })!;
    expect(recovered.currentAlerts).toEqual([disk]);
  });

  it("caps valid resource alert cache updates", () => {
    const updated = Array.from({ length: 51 }, (_, index) => index).reduce(
      (snapshot, index) =>
        applyHostResourceAlert(snapshot, {
          ...validTemperatureAlertEvent().data,
          incidentId: `host-resource-incident-${index}`,
          key: `temperature:thermal_zone${index}`,
          scope: `temperature:thermal_zone${index}`,
        })!,
      { currentAlerts: [] } as HostResourceSnapshotV1,
    );

    expect(updated.currentAlerts).toHaveLength(50);
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
