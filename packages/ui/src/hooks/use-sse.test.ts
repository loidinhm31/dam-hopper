import { describe, expect, it, vi } from "vitest";
import {
  asHostResourceAlertChangedEvent,
  handleIpcStatusChange,
  invalidateHostResourceQueries,
} from "./use-sse.js";

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

describe("asHostResourceAlertChangedEvent", () => {
  it("accepts only typed host alert event payloads", () => {
    expect(
      asHostResourceAlertChangedEvent({
        type: "host:alertChanged",
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
          evidence: { cgroupOomDelta: false },
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
