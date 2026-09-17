// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdleSuspendStatusV1 } from "@/api/client.js";
import { ForceSleepDialog } from "./ForceSleepDialog.js";

const mocks = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
  connectionSnapshot: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  resolveTargetOwner: (owner?: unknown) =>
    owner && typeof owner === "object" && "generation" in owner
      ? (owner as { profileId: string; generation: number })
      : undefined,
  useForceSuspend: () => ({
    isPending: mocks.isPending,
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (id: string) => mocks.connectionSnapshot(id),
}));

let root: Root | null = null;

function mockStatus(overrides: Partial<IdleSuspendStatusV1> = {}): IdleSuspendStatusV1 {
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
      closing: false,
      handoffActive: false,
    },
    timestampMs: Date.now(),
    ...overrides,
  };
}


describe("ForceSleepDialog", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.isPending = false;
    mocks.mutateAsync.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("renders nothing when closed", async () => {
    await act(async () => {
      root?.render(
        <ForceSleepDialog
          open={false}
          onOpenChange={vi.fn()}
          initialStatus={mockStatus()}
        />,
      );
    });
    expect(document.body.textContent).toBe("");
  });

  it("renders dialog with indefinite sleep default when activeCount is 0", async () => {
    await act(async () => {
      root?.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={vi.fn()}
          initialStatus={mockStatus()}
        />,
      );
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Force Machine to Sleep");
    expect(bodyText).toContain("Running work is paused, not killed");
    expect(bodyText).toContain("Sleep indefinitely (default)");
    expect(bodyText).toContain("Wake automatically");
    expect(bodyText).not.toContain("Active managed terminals/builds in progress");
    expect(bodyText).toContain("Cancel");
  });

  it("renders warning and breakdown when activeCount > 0", async () => {
    const status = mockStatus({
      fleetSnapshot: {
        generation: 2,
        liveCount: 3,
        creatingCount: 1,
        restartPendingCount: 2,
        quiescent: false,
        disposing: false,
        handoffActive: false,
      },
    });

    await act(async () => {
      root?.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={vi.fn()}
          initialStatus={status}
        />,
      );
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Active managed terminals/builds in progress");
    expect(bodyText).toContain("6 active managed sessions");
    expect(bodyText).toContain("3 live, 1 creating, 2 restarting");
    expect(bodyText).toContain("Confirm pausing active managed sessions");
  });

  it("renders target host label and revision in dialog description", async () => {
    const status = mockStatus({ statusRevision: 7 });
    await act(async () => {
      root?.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={vi.fn()}
          initialStatus={status}
          endpointLabel="prod-host-1 (https://prod.internal:4800)"
        />,
      );
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Target host: prod-host-1 (https://prod.internal:4800) (rev 7)");
  });

  it("detects stale connection generation and disables force sleep execution", async () => {
    const owner = { profileId: "profile-1", generation: 1 };
    mocks.connectionSnapshot.mockReturnValue({
      owner: { profileId: "profile-1", generation: 2 }, // generation bumped from 1 to 2
      status: "connected",
      serverUrl: "https://prod.internal:4800",
    });

    await act(async () => {
      root?.render(
        <ForceSleepDialog
          open={true}
          onOpenChange={vi.fn()}
          initialStatus={mockStatus()}
          owner={owner}
        />,
      );
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Server connection or generation changed while reviewing");

    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Force Machine to Sleep"),
    );
    expect(submitBtn?.hasAttribute("disabled")).toBe(true);
  });
});
