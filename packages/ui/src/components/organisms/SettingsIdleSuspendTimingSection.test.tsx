import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdleSuspendStatusV1 } from "@/api/client.js";
import { SettingsIdleSuspendTimingSection } from "./SettingsIdleSuspendTimingSection.js";

const mocks = vi.hoisted(() => ({
  status: undefined as IdleSuspendStatusV1 | undefined,
  isLoading: false,
  isError: false,
  isPending: false,
  mutateAsync: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  useIdleSuspendStatus: () => ({
    data: mocks.status,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
  }),
  useUpdateIdleSuspendTiming: () => ({
    isPending: mocks.isPending,
    mutateAsync: mocks.mutateAsync,
  }),
}));

function mockStatus(overrides: Partial<IdleSuspendStatusV1> = {}): IdleSuspendStatusV1 {
  return {
    version: 1,
    statusRevision: 4,
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
      generation: 1,
      liveCount: 0,
      creatingCount: 0,
      restartPendingCount: 0,
      quiescent: true,
      disposing: false,
      handoffActive: false,
    },
    armDeadlineMs: null,
    lastOutcome: null,
    detail: null,
    timestampMs: Date.now(),
    ...overrides,
  };
}

function markup() {
  return renderToStaticMarkup(<SettingsIdleSuspendTimingSection />);
}

describe("SettingsIdleSuspendTimingSection", () => {
  beforeEach(() => {
    mocks.status = mockStatus();
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.isPending = false;
    mocks.mutateAsync.mockReset();
  });

  it("renders loading state", () => {
    mocks.isLoading = true;
    const output = markup();
    expect(output).toContain("Loading idle suspend configuration…");
  });

  it("renders error state when fetch fails", () => {
    mocks.isError = true;
    mocks.status = undefined;
    const output = markup();
    expect(output).toContain("Failed to load idle suspend status");
  });

  it("renders form with values and advertised bounds", () => {
    const output = markup();
    expect(output).toContain("Quiet Period (seconds)");
    expect(output).toContain("Wake Duration (seconds)");
    expect(output).toContain("60s – 86400s");
    expect(output).toContain('value="300"');
    expect(output).toContain('value="600"');
    expect(output).toContain("Save Timing");
  });

  it("displays operator disabled notice when enabled is false", () => {
    mocks.status = mockStatus({ enabled: false, state: "disabled" });
    const output = markup();
    expect(output).toContain("Idle suspend is disabled at startup");
  });

  it("displays handoff in progress banner when state is handedOff", () => {
    mocks.status = mockStatus({
      state: "handedOff",
      timingMutable: false,
      timingMutableReason: "handoffInProgress",
    });
    const output = markup();
    expect(output).toContain("Host suspend handoff is in progress");
    expect(output).toContain("disabled");
  });
});
