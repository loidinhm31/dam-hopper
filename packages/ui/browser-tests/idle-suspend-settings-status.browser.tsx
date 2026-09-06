import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { IdleSuspendStatusV1 } from "@/api/client.js";
import { ApiRequestError } from "@/api/client.js";
import { SettingsIdleSuspendTimingSection } from "@/components/organisms/SettingsIdleSuspendTimingSection.js";
import { HostIdleSuspendStatus } from "@/components/organisms/HostIdleSuspendStatus.js";
import { ForceSleepDialog } from "@/components/organisms/ForceSleepDialog.js";
import "@/index.css";

const mocks = vi.hoisted(() => ({
  status: undefined as IdleSuspendStatusV1 | undefined,
  isLoading: false,
  isError: false,
  isPending: false,
  mutateAsync: vi.fn(),
  forcePending: false,
  forceMutateAsync: vi.fn(),
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
  useForceSuspend: () => ({
    isPending: mocks.forcePending,
    mutateAsync: mocks.forceMutateAsync,
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
    mocks.forcePending = false;
    mocks.forceMutateAsync.mockReset();
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

  it("renders HostIdleSuspendStatus with correct state badges and action button", async () => {
    mocks.status = mockStatus({
      state: "armed",
      armDeadlineMs: Date.now() + 150_000,
      lastOutcome: {
        type: "resumedSuccessfully",
        resumedAtMs: Date.now() - 300_000,
      },
    });

    await act(async () => {
      root.render(<HostIdleSuspendStatus />);
    });

    expect(container.textContent).toContain("Armed");
    expect(container.textContent).toContain("Timing: 300s / 600s");
    expect(container.textContent).toContain(
      "Fleet: 0 live / 0 creating / 0 restarting",
    );

    const inputs = container.querySelectorAll("input");
    const buttons = container.querySelectorAll("button");
    expect(inputs.length).toBe(0);
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain("Force Machine to Sleep");
    expect(buttons[0].disabled).toBe(true);
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

  it("renders enabled Force Machine to Sleep button when onForceSleep callback is provided and triggers callback", async () => {
    const onForceSleep = vi.fn();
    mocks.status = mockStatus({ state: "watching" });

    await act(async () => {
      root.render(<HostIdleSuspendStatus onForceSleep={onForceSleep} />);
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);

    await act(async () => {
      button?.click();
    });
    expect(onForceSleep).toHaveBeenCalledTimes(1);
    expect(onForceSleep.mock.calls[0][0]).toMatchObject({
      state: "watching",
      quietPeriodSeconds: 300,
      wakeAfterSeconds: 600,
    });
  });

  it("submits wakeAfterSeconds 0 on indefinite default when active count is 0", async () => {
    const onOpenChange = vi.fn();
    mocks.status = mockStatus({
      fleetSnapshot: {
        generation: 1,
        liveCount: 0,
        creatingCount: 0,
        restartPendingCount: 0,
        disposing: false,
        closing: false,
        handoffActive: false,
        quiescent: true,
      },
    });
    mocks.forceMutateAsync.mockResolvedValueOnce({
      version: 1,
      state: "handedOff",
      wakeAfterSeconds: 0,
      forced: false,
    });

    await act(async () => {
      root.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={onOpenChange}
          initialStatus={mocks.status!}
        />,
      );
    });

    const submitButton = page.getByRole("button", {
      name: "Force Machine to Sleep",
    });
    await expect.element(submitButton).toBeVisible();
    await expect.element(submitButton).toBeEnabled();

    await act(async () => userEvent.click(submitButton));

    expect(mocks.forceMutateAsync).toHaveBeenCalledWith({
      wakeAfterSeconds: 0,
      force: false,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("requires explicit confirmation when managed sessions are active before sending force=true", async () => {
    const onOpenChange = vi.fn();
    mocks.status = mockStatus({
      fleetSnapshot: {
        generation: 2,
        liveCount: 1,
        creatingCount: 1,
        restartPendingCount: 0,
        disposing: false,
        closing: false,
        handoffActive: false,
        quiescent: false,
      },
    });
    mocks.forceMutateAsync.mockResolvedValueOnce({
      version: 1,
      state: "handedOff",
      wakeAfterSeconds: 0,
      forced: true,
    });

    await act(async () => {
      root.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={onOpenChange}
          initialStatus={mocks.status!}
        />,
      );
    });

    const submitButton = page.getByRole("button", {
      name: "Force Machine to Sleep",
    });
    await expect.element(submitButton).toBeDisabled();

    const checkbox = page.getByRole("checkbox", {
      name: "Confirm pausing active managed sessions",
    });
    await expect.element(checkbox).toBeVisible();
    await act(async () => userEvent.click(checkbox));

    await expect.element(submitButton).toBeEnabled();
    await act(async () => userEvent.click(submitButton));

    expect(mocks.forceMutateAsync).toHaveBeenCalledWith({
      wakeAfterSeconds: 0,
      force: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("handles 409 conflict by refreshing counts and requiring a new explicit confirmation", async () => {
    const onOpenChange = vi.fn();
    mocks.status = mockStatus({
      fleetSnapshot: {
        generation: 1,
        liveCount: 0,
        creatingCount: 0,
        restartPendingCount: 0,
        disposing: false,
        closing: false,
        handoffActive: false,
        quiescent: true,
      },
    });

    mocks.forceMutateAsync.mockRejectedValueOnce(
      new ApiRequestError(
        "active fleet confirmation required",
        409,
        "idleSuspendActiveFleetConfirmationRequired",
        {
          error: "active fleet confirmation required",
          code: "idleSuspendActiveFleetConfirmationRequired",
          activeSessionCount: 2,
          fleetSnapshot: {
            generation: 2,
            liveCount: 2,
            creatingCount: 0,
            restartPendingCount: 0,
            disposing: false,
            closing: false,
            handoffActive: false,
            quiescent: false,
          },
        },
      ),
    );

    await act(async () => {
      root.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={onOpenChange}
          initialStatus={mocks.status!}
        />,
      );
    });

    const submitButton = page.getByRole("button", {
      name: "Force Machine to Sleep",
    });
    await act(async () => userEvent.click(submitButton));

    expect(onOpenChange).not.toHaveBeenCalled();

    const alert = page.getByRole("alert");
    await expect.element(alert.first()).toBeVisible();

    const checkbox = page.getByRole("checkbox", {
      name: "Confirm pausing active managed sessions",
    });
    await expect.element(checkbox).toBeVisible();
    await expect.element(submitButton).toBeDisabled();

    mocks.forceMutateAsync.mockResolvedValueOnce({
      version: 1,
      state: "handedOff",
      wakeAfterSeconds: 0,
      forced: true,
    });

    await act(async () => userEvent.click(checkbox));
    await expect.element(submitButton).toBeEnabled();
    await act(async () => userEvent.click(submitButton));

    expect(mocks.forceMutateAsync).toHaveBeenLastCalledWith({
      wakeAfterSeconds: 0,
      force: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
