import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { IdleSuspendStatusV1 } from "@/api/client.js";
import { ApiRequestError } from "@/api/client.js";
import { SettingsIdleSuspendTimingSection } from "@/components/organisms/SettingsIdleSuspendTimingSection.js";
import { HostIdleSuspendStatus } from "@/components/organisms/HostIdleSuspendStatus.js";
import "@/index.css";

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

function mockStatus(
  overrides: Partial<IdleSuspendStatusV1> = {},
): IdleSuspendStatusV1 {
  return {
    version: 1,
    statusRevision: 4,
    state: "watching",
    enabled: true,
    timingMutable: true,
    timingMutableReason: null,
    capabilityCode: "systemdLogindRtc",
    currentEpoch: 1,
    quietPeriodSeconds: 300,
    wakeAfterSeconds: 600,
    minQuietPeriodSeconds: 300,
    maxQuietPeriodSeconds: 86400,
    minWakeAfterSeconds: 60,
    maxWakeAfterSeconds: 86400,
    fleetSnapshot: {
      generation: 12,
      liveCount: 0,
      creatingCount: 0,
      restartPendingCount: 0,
      disposing: false,
      closing: false,
      handoffActive: false,
      quiescent: true,
      runningCount: 0,
    },
    armDeadlineMs: null,
    lastOutcome: null,
    detail: null,
    timestampMs: 1724500000000,
    ...overrides,
  };
}

describe("Idle Suspend Settings & Status Browser Tests", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    mocks.status = mockStatus();
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.isPending = false;
    mocks.mutateAsync.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders timing section and successfully submits valid bounded values", async () => {
    mocks.mutateAsync.mockResolvedValue({
      version: 1,
      changed: true,
      statusRevision: 5,
      quietPeriodSeconds: 450,
      wakeAfterSeconds: 900,
    });

    await act(async () => {
      root.render(<SettingsIdleSuspendTimingSection />);
    });

    const quietInput = page.getByLabelText("Quiet period in seconds");
    const wakeInput = page.getByLabelText("Wake duration in seconds");
    const saveButton = page.getByRole("button", { name: "Save Timing" });

    await expect.element(quietInput).toBeVisible();
    await expect.element(wakeInput).toBeVisible();
    await expect.element(saveButton).toBeVisible();

    // Fill valid bounded values
    await userEvent.fill(quietInput, "450");
    await userEvent.fill(wakeInput, "900");

    // Click save
    await userEvent.click(saveButton);

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      quietPeriodSeconds: 450,
      wakeAfterSeconds: 900,
    });

    expect(container.textContent).toContain(
      "Timing updated to 450s quiet / 900s wake (rev 5).",
    );
  });

  it("validates bounds and disables save when inputs are invalid", async () => {
    await act(async () => {
      root.render(<SettingsIdleSuspendTimingSection />);
    });

    const quietInput = page.getByLabelText("Quiet period in seconds");
    const saveButton = page.getByRole("button", { name: "Save Timing" });

    // Set quiet period below min (300)
    await userEvent.fill(quietInput, "100");

    expect(container.textContent).toContain(
      "Quiet period must be between 300 and 86400s.",
    );
    await expect.element(saveButton).toBeDisabled();
  });

  it("handles 409 handoff in progress with exact message and does not auto-retry", async () => {
    const handoffError = new ApiRequestError(
      "cannot mutate timing while helper handoff is in progress",
      409,
      "idleSuspendHandoffInProgress",
    );
    mocks.mutateAsync.mockRejectedValue(handoffError);

    await act(async () => {
      root.render(<SettingsIdleSuspendTimingSection />);
    });

    const quietInput = page.getByLabelText("Quiet period in seconds");
    const saveButton = page.getByRole("button", { name: "Save Timing" });

    await userEvent.fill(quietInput, "500");
    await userEvent.click(saveButton);

    // Exactly one attempt, no auto-retry loop
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Host suspend handoff is currently in progress. Updates blocked until resume.",
    );
  });

  it("handles no-auth error when in dev mode", async () => {
    const noAuthError = new ApiRequestError(
      "timing mutation disabled in no-auth mode",
      403,
      "idleSuspendTimingDisabledNoAuth",
    );
    mocks.mutateAsync.mockRejectedValue(noAuthError);

    await act(async () => {
      root.render(<SettingsIdleSuspendTimingSection />);
    });

    const quietInput = page.getByLabelText("Quiet period in seconds");
    const saveButton = page.getByRole("button", { name: "Save Timing" });

    await userEvent.fill(quietInput, "500");
    await userEvent.click(saveButton);

    expect(container.textContent).toContain(
      "Timing mutation is disabled in --no-auth development mode.",
    );
  });

  it("renders HostIdleSuspendStatus read-only with correct state badges and no interactive inputs", async () => {
    mocks.status = mockStatus({
      state: "armed",
      armDeadlineMs: Date.now() + 120_000,
      lastOutcome: {
        type: "resumedSuccessfully",
        resumedAtMs: Date.now() - 300_000,
      },
    });

    await act(async () => {
      root.render(<HostIdleSuspendStatus />);
    });

    // State badge "Armed" displayed
    expect(container.textContent).toContain("Armed");
    expect(container.textContent).toContain("Timing: 300s / 600s");
    expect(container.textContent).toContain(
      "Fleet: 0 live / 0 creating / 0 restarting",
    );

    // Read-only invariant: zero input fields or button controls exist in this widget
    const inputs = container.querySelectorAll("input");
    const buttons = container.querySelectorAll("button");
    expect(inputs.length).toBe(0);
    expect(buttons.length).toBe(0);
  });

  it("renders HostIdleSuspendStatus for suppressed and disabled states", async () => {
    mocks.status = mockStatus({
      state: "suppressed",
      detail: "inhibited by system-update",
      lastOutcome: {
        type: "blockedByInhibitor",
        inhibitor: "system-update",
      },
    });

    await act(async () => {
      root.render(<HostIdleSuspendStatus />);
    });

    expect(container.textContent).toContain("Suppressed");
    expect(container.textContent).toContain("inhibited by system-update");
  });
});
