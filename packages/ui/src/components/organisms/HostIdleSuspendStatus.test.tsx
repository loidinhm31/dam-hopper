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

function mockStatus(
  overrides: Partial<IdleSuspendStatusV1> = {},
): IdleSuspendStatusV1 {
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
    automaticPolicy: "empty-fleet",
    activity: null,
    timestampMs: 1725548400000,
    ...overrides,
  };
}

function markup(props?: Parameters<typeof HostIdleSuspendStatus>[0]) {
  return renderToStaticMarkup(<HostIdleSuspendStatus {...props} />);
}

function isButtonDisabled(html: string): boolean {
  return /<button\b[^>]*?\sdisabled(?:=""|(?=[\s>]))/.test(html);
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

  it("renders Force Machine to Sleep button disabled when onForceSleep is not provided", () => {
    const output = markup();
    expect(output).toContain("Force Machine to Sleep");
    expect(isButtonDisabled(output)).toBe(true);
  });

  it("renders Force Machine to Sleep button enabled when onForceSleep is provided", () => {
    const onForceSleep = vi.fn();
    const output = markup({ onForceSleep });
    expect(output).toContain("Force Machine to Sleep");
    expect(isButtonDisabled(output)).toBe(false);
  });

  it("disables button during handedOff state or handoffActive", () => {
    const onForceSleep = vi.fn();
    mocks.status = mockStatus({ state: "handedOff" });
    let output = markup({ onForceSleep });
    expect(isButtonDisabled(output)).toBe(true);

    mocks.status = mockStatus({
      state: "watching",
      fleetSnapshot: {
        generation: 3,
        liveCount: 0,
        creatingCount: 0,
        restartPendingCount: 0,
        quiescent: false,
        disposing: false,
        handoffActive: true,
      },
    });
    output = markup({ onForceSleep });
    expect(isButtonDisabled(output)).toBe(true);
  });

  it("disables button during closing or disposing", () => {
    const onForceSleep = vi.fn();
    mocks.status = mockStatus({
      fleetSnapshot: {
        generation: 3,
        liveCount: 0,
        creatingCount: 0,
        restartPendingCount: 0,
        quiescent: false,
        disposing: true,
        handoffActive: false,
      },
    });
    let output = markup({ onForceSleep });
    expect(isButtonDisabled(output)).toBe(true);

    mocks.status = mockStatus({
      fleetSnapshot: {
        generation: 3,
        liveCount: 0,
        creatingCount: 0,
        restartPendingCount: 0,
        quiescent: false,
        disposing: false,
        closing: true,
        handoffActive: false,
      },
    });
    output = markup({ onForceSleep });
    expect(isButtonDisabled(output)).toBe(true);
  });

  it("disables button when isForceSleepPending is true", () => {
    const onForceSleep = vi.fn();
    const output = markup({ onForceSleep, isForceSleepPending: true });
    expect(isButtonDisabled(output)).toBe(true);
  });

  it("keeps button enabled when automatic idle suspend is disabled", () => {
    const onForceSleep = vi.fn();
    mocks.status = mockStatus({ enabled: false, state: "disabled" });
    const output = markup({ onForceSleep });
    expect(output).toContain("Force Machine to Sleep");
    expect(isButtonDisabled(output)).toBe(false);
  });

  it("renders legacy empty-fleet policy without activity section", () => {
    const output = markup();
    expect(output).toContain("Policy: Legacy empty-fleet");
    expect(output).not.toContain("Activity Observation");
  });

  it("renders agent-activity mode with available state, reason, counts, and notice", () => {
    mocks.status = mockStatus({
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "available",
        reasonCode: "quiet",
        recognizedAgentCount: 3,
        monitoredTerminalCount: 4,
        sampledAtMs: 1725548401000,
        lastActivityAtMs: 1725548400500,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
    });
    const output = markup();
    expect(output).toContain("Policy: Agent Activity");
    expect(output).toContain("Activity Observation");
    expect(output).toContain("Available");
    expect(output).toContain("Quiet (suspend candidate)");
    expect(output).toContain("3");
    expect(output).toContain("4");
    expect(output).toContain("tcp4-tcp6");
    expect(output).toContain("Silence does not prove agent completion");
    expect(output).toContain("measurement covers attributable TCP4/TCP6 only");
    expect(output).toContain("service-only terminals may still be suspended");
  });

  it("renders Unknown for null agent and terminal counts", () => {
    mocks.status = mockStatus({
      automaticPolicy: "agent-activity",
      activity: {
        measurementState: "available",
        reasonCode: "recentNetwork",
        recognizedAgentCount: null,
        monitoredTerminalCount: null,
        sampledAtMs: null,
        lastActivityAtMs: null,
        networkCoverage: "tcp4-tcp6",
        measurementWarning: null,
      },
    });
    const output = markup();
    expect(output).toContain(
      '<span>Recognized agents: </span><span class="font-mono text-[var(--color-text)]">Unknown</span>',
    );
    expect(output).toContain(
      '<span>Monitored terminals: </span><span class="font-mono text-[var(--color-text)]">Unknown</span>',
    );
  });

  it("renders measurement warning with duration, process identities, and truncation note", () => {
    const fakeNow = 1725548450000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);

    mocks.status = mockStatus({
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
          blockedSinceMs: fakeNow - 15000,
          processes: [
            { pid: 1234, executableIdentity: "/usr/bin/codex" },
            { pid: 5678, executableIdentity: null },
          ],
          processesTruncated: true,
        },
      },
    });
    const output = markup();
    expect(output).toContain(
      "Measurement Blocked: Process inspection restricted",
    );
    expect(output).toContain("Blocked for 15s");
    expect(output).toContain("PID 1234: /usr/bin/codex");
    expect(output).toContain("PID 5678: Identity unavailable");
    expect(output).toContain("(examples truncated, list incomplete)");

    vi.restoreAllMocks();
  });

  it("renders Attribution unavailable when warning processes list is empty", () => {
    mocks.status = mockStatus({
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
          blockedSinceMs: 1725548400000,
          processes: [],
          processesTruncated: false,
        },
      },
    });
    const output = markup();
    expect(output).toContain("Attribution unavailable");
  });

  it("renders arm countdown when armDeadlineMs is present", () => {
    const fakeNow = 1725548400000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);

    mocks.status = mockStatus({
      state: "armed",
      armDeadlineMs: fakeNow + 45000,
    });
    const output = markup();
    expect(output).toContain("Arm Countdown:");
    expect(output).toContain("45s");

    vi.restoreAllMocks();
  });

  it("renders disabled agent-activity mode without countdown while force sleep stays enabled", () => {
    const onForceSleep = vi.fn();
    mocks.status = mockStatus({
      state: "disabled",
      enabled: false,
      automaticPolicy: "agent-activity",
      armDeadlineMs: null,
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
          blockedSinceMs: 1725548400000,
          processes: [],
          processesTruncated: false,
        },
      },
    });
    const output = markup({ onForceSleep });
    expect(output).toContain("Disabled");
    expect(output).toContain("Policy: Agent Activity");
    expect(output).toContain("Activity Observation");
    expect(output).not.toContain("Arm Countdown:");
    expect(isButtonDisabled(output)).toBe(false);
  });
});
