import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdleSuspendStatusV1 } from "@/api/client.js";
import { HostIdleSuspendStatus } from "./HostIdleSuspendStatus.js";

const mocks = vi.hoisted(() => ({
  status: undefined as IdleSuspendStatusV1 | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock("@/api/queries.js", () => ({
  useIdleSuspendStatus: () => ({
    data: mocks.status,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
  }),
}));

function mockStatus(overrides: Partial<IdleSuspendStatusV1> = {}): IdleSuspendStatusV1 {
  return {
    version: 1,
    statusRevision: 2,
    state: "watching",
    enabled: true,
    timingMutable: true,
    timingMutableReason: null,
    capabilityCode: "systemd",
    currentEpoch: 1,
    quietPeriodSeconds: 300,
    wakeAfterSeconds: 600,
    minQuietPeriodSeconds: 60,
    maxQuietPeriodSeconds: 86400,
    minWakeAfterSeconds: 60,
    maxWakeAfterSeconds: 86400,
    fleetSnapshot: {
      generation: 3,
      liveCount: 2,
      creatingCount: 1,
      restartPendingCount: 0,
      quiescent: false,
      disposing: false,
      handoffActive: false,
    },
    armDeadlineMs: null,
    lastOutcome: null,
    detail: null,
    timestampMs: 1725548400000,
    ...overrides,
  };
}

function markup() {
  return renderToStaticMarkup(<HostIdleSuspendStatus />);
}

describe("HostIdleSuspendStatus", () => {
  beforeEach(() => {
    mocks.status = mockStatus();
    mocks.isLoading = false;
    mocks.isError = false;
  });

  it("renders loading state", () => {
    mocks.isLoading = true;
    const output = markup();
    expect(output).toContain("Loading idle suspend status…");
  });

  it("renders unavailable state", () => {
    mocks.isError = true;
    mocks.status = undefined;
    const output = markup();
    expect(output).toContain("Idle suspend status unavailable");
  });

  it("renders state badge, fleet counts, and timing pair", () => {
    const output = markup();
    expect(output).toContain("Terminal Idle Suspend");
    expect(output).toContain("Watching");
    expect(output).toContain("2 live / 1 creating / 0 restarting");
    expect(output).toContain("300s / 600s");
    expect(output).toContain("Capability: systemd");
  });

  it("renders armed badge when state is armed", () => {
    mocks.status = mockStatus({ state: "armed" });
    const output = markup();
    expect(output).toContain("Armed");
  });

  it("renders handed off badge when state is handedOff", () => {
    mocks.status = mockStatus({ state: "handedOff" });
    const output = markup();
    expect(output).toContain("Handed off");
  });

  it("remains strictly read-only with no inputs or buttons", () => {
    const output = markup();
    expect(output).not.toContain("<input");
    expect(output).not.toContain("<button");
    expect(output).not.toContain("<form");
  });
});
