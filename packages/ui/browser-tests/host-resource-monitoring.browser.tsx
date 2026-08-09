import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";

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

const legacyMetrics: HostMetrics = {
  sampledAt: 1,
  hostname: "monitor-host",
  osName: "Fedora",
  uptimeSeconds: 1,
  cpu: { usagePercent: 42, logicalCoreCount: 4 },
  memory: {
    totalBytes: 1_024,
    usedBytes: 512,
    availableBytes: 512,
    usagePercent: 50,
  },
  disk: {
    name: "root",
    mountPoint: "/",
    totalBytes: 1_024,
    availableBytes: 256,
    usedBytes: 768,
    usagePercent: 75,
  },
  disks: [],
  temperatures: [],
};

let snapshotResult: {
  data?: HostResourceSnapshotV1;
  isLoading: boolean;
  isError: boolean;
};
let legacyMetricsResult: { data?: HostMetrics };

vi.mock("@/api/queries.js", () => ({
  useHostResourceSnapshot: () => snapshotResult,
  useHostResourceAlerts: () => ({ data: [] }),
  useHostMetrics: () => legacyMetricsResult,
}));

import { HostResourcePopover } from "@/components/organisms/HostResourcePopover.js";
import "@/index.css";

describe("host resource monitoring in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    snapshotResult = { data: snapshot, isLoading: false, isError: false };
    legacyMetricsResult = { data: undefined };
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

  it("keeps compatible basic metrics visible when the deep snapshot fails", async () => {
    snapshotResult = {
      data: { ...snapshot, alert: undefined },
      isLoading: false,
      isError: true,
    };
    legacyMetricsResult = { data: legacyMetrics };
    await act(async () => root.render(<HostResourcePopover />));

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Host resources: Sampling host"]',
    );
    await act(async () => trigger?.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Resource snapshot unavailable");
    expect(dialog?.textContent).toContain(
      "Deep metrics unavailable; showing compatible basic metrics.",
    );
    expect(dialog?.textContent).toContain("42%");
    expect(dialog?.textContent).toContain("75%");
    expect(dialog?.textContent).not.toContain("Memory available");
    expect(dialog?.textContent).not.toContain("Approve");
  });
});
