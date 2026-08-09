import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostResourceSnapshotV1 } from "@/api/client.js";

const availability = { state: "available", sampledAt: 1 } as const;
const snapshot: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "sample-1",
  sampledAt: Date.now(),
  host: { hostname: "monitor-host", osName: "Fedora" },
  capabilities: { linuxDeepMetrics: availability },
  memory: { totalBytes: 1_024, availableBytes: 512, availability },
  pressure: { memory: { availability } },
  cgroups: [],
  processes: {
    processes: [],
    scannedCount: 0,
    truncated: false,
    deadlineExceeded: false,
    skippedCount: 0,
    permissionDeniedCount: 0,
    invalidUtf8Count: 0,
    malformedCount: 0,
    disappearedCount: 0,
    availability,
  },
  mountContext: {
    mountPoint: "/workspace",
    activeMappedPaths: [],
    activeMappedPathsAvailability: availability,
    cacheAttribution: {
      label: "unattributedSharedCache",
      confidence: "low",
      method: "notCollected",
    },
    availability,
  },
  actionCapabilities: { availability },
  alert: {
    incidentId: "incident-1",
    state: "memoryPressure",
    severity: "critical",
    updatedAt: 1,
    durationSeconds: 30,
    scope: "host",
    confidence: "high",
    threshold: "available memory",
    evidence: { cgroupOomDelta: false },
    nextAction: "Inspect the affected workload.",
  },
};

vi.mock("@/api/queries.js", () => ({
  useHostResourceSnapshot: () => ({
    data: snapshot,
    isLoading: false,
    isError: false,
  }),
  useHostResourceAlerts: () => ({ data: [] }),
  useHostMetrics: () => ({ data: undefined }),
}));

import { HostResourcePopover } from "@/components/organisms/HostResourcePopover.js";
import "@/index.css";

describe("host resource monitoring in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens a keyboard-dismissible read-only diagnosis panel", async () => {
    await act(async () => root.render(<HostResourcePopover />));
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Host resources: Memory pressure"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector('[aria-label="1 unread host incidents"]'),
    ).not.toBeNull();

    await act(async () => trigger?.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Read-only monitoring and diagnosis");
    expect(dialog?.textContent).toContain("Operator guidance");
    expect(dialog?.textContent).not.toContain("password");
    expect(dialog?.textContent).not.toContain("Approve");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => trigger?.click());
    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    outside.remove();
  });
});
