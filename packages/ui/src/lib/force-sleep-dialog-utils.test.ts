import { describe, expect, it } from "vitest";
import { ApiRequestError, type IdleSuspendStatusV1 } from "@/api/client.js";
import {
  formatDurationText,
  getActiveSessionCount,
  getForceSleepErrorMessage,
  getInitialTimedWakeSeconds,
} from "./force-sleep-dialog-utils.js";

function mockStatus(overrides: Partial<IdleSuspendStatusV1> = {}): IdleSuspendStatusV1 {
  return {
    version: 1,
    statusRevision: 4,
    state: "watching",
    enabled: true,
    timingMutable: true,
    capabilityCode: "systemdLogindRtc",
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
      disposing: false,
      handoffActive: false,
    },
    timestampMs: Date.now(),
    ...overrides,
  };
}

describe("force-sleep-dialog-utils", () => {
  it("calculates active session count as live + creating + restarting", () => {
    expect(
      getActiveSessionCount({
        generation: 1,
        liveCount: 2,
        creatingCount: 1,
        restartPendingCount: 3,
        disposing: false,
        handoffActive: false,
      }),
    ).toBe(6);
    expect(
      getActiveSessionCount({
        generation: 1,
        liveCount: 0,
        creatingCount: 0,
        restartPendingCount: 0,
        disposing: false,
        handoffActive: false,
      }),
    ).toBe(0);
  });

  it("formats duration text without rounding ambiguity", () => {
    expect(formatDurationText(0)).toBe("0 seconds");
    expect(formatDurationText(45)).toBe("45 seconds");
    expect(formatDurationText(60)).toBe("1 minute");
    expect(formatDurationText(600)).toBe("10 minutes");
    expect(formatDurationText(90)).toBe("1 minute 30 seconds");
  });

  it("clamps initial timed wake seconds to advertised bounds", () => {
    const status = mockStatus({
      wakeAfterSeconds: 30,
      minWakeAfterSeconds: 60,
      maxWakeAfterSeconds: 3600,
    });
    expect(getInitialTimedWakeSeconds(status)).toBe(60);

    const highStatus = mockStatus({
      wakeAfterSeconds: 7200,
      minWakeAfterSeconds: 60,
      maxWakeAfterSeconds: 3600,
    });
    expect(getInitialTimedWakeSeconds(highStatus)).toBe(3600);
  });

  it("maps error codes to user-friendly messages", () => {
    expect(
      getForceSleepErrorMessage(
        new ApiRequestError("conflict", 409, "idleSuspendActiveFleetConfirmationRequired"),
      ),
    ).toContain("Active managed sessions require explicit confirmation");
    expect(
      getForceSleepErrorMessage(
        new ApiRequestError("conflict", 409, "idleSuspendHandoffInProgress"),
      ),
    ).toContain("Host suspend handoff is already in progress");
    expect(
      getForceSleepErrorMessage(
        new ApiRequestError("no-auth", 403, "idleSuspendDisabledNoAuth"),
      ),
    ).toContain("disabled in --no-auth");
    expect(
      getForceSleepErrorMessage(
        new ApiRequestError("disabled", 403, "actorDisabled"),
      ),
    ).toContain("account is disabled");
    expect(
      getForceSleepErrorMessage(
        new ApiRequestError("unauthorized", 401, "unauthorized"),
      ),
    ).toContain("Authentication expired or required");
  });
});
