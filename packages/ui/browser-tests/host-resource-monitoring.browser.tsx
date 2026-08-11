import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import type { Transport } from "@/api/transport.js";

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
  disks: [
    {
      name: "workspace",
      mountPoint: "/workspace",
      totalBytes: 2_048,
      availableBytes: 102,
      usedBytes: 1_946,
      usagePercent: 95,
    },
    {
      name: "cache",
      mountPoint: "/cache/with/a/long/path",
      totalBytes: 4_096,
      availableBytes: 3_686,
      usedBytes: 410,
      usagePercent: 10,
    },
  ],
  temperatures: [{ label: "Package", source: "pkg", celsius: 61 }],
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
import { resetTransportListeners, useIpc } from "@/hooks/use-sse.js";
import {
  initTransport,
  reconfigureTransport,
  resetTransport,
} from "@/api/transport.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type StatusListener = (
  status: "connected" | "connecting" | "disconnected" | "error",
) => void;

function makeTransport(
  initialStatus: "connected" | "connecting" | "disconnected" | "error",
) {
  const statusListeners = new Set<StatusListener>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  let status = initialStatus;
  const transport = {
    invoke: vi.fn(),
    onTerminalData: vi.fn(),
    onTerminalExit: vi.fn(),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onEvent: vi.fn((channel: string, listener: (payload: unknown) => void) => {
      const listeners = eventListeners.get(channel) ?? new Set();
      listeners.add(listener);
      eventListeners.set(channel, listeners);
      return () => listeners.delete(listener);
    }),
    getStatus: () => status,
    onStatusChange: vi.fn((listener: StatusListener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
  } satisfies Partial<Transport>;

  return {
    transport: transport as Transport,
    emitStatus(next: "connected" | "connecting" | "disconnected" | "error") {
      status = next;
      statusListeners.forEach((listener) => listener(next));
    },
  };
}

function IpcStatus() {
  const { status } = useIpc();
  return <output aria-label="Transport status">{status}</output>;
}

describe("host resource monitoring in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    snapshotResult = { data: snapshot, isLoading: false, isError: false };
    legacyMetricsResult = { data: undefined };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    resetTransportListeners();
    resetTransport();
    queryClient.clear();
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

  it("reveals every disk with pointer and keyboard disclosure", async () => {
    legacyMetricsResult = { data: legacyMetrics };
    await act(async () => root.render(<HostResourcePopover />));
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Host resources: Memory pressure"]',
    );
    await act(async () => trigger?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const storageButton = page.getByRole("button", { name: "Host storage" });
    const storageElement = dialog?.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    const storagePanel = dialog?.querySelector<HTMLElement>(
      `[aria-labelledby="${storageElement?.id}"]`,
    );
    expect(dialog?.textContent).toContain("Package");
    expect(dialog?.textContent).toContain("61°C");
    expect(storageElement?.getAttribute("aria-expanded")).toBe("false");
    expect(storagePanel?.hidden).toBe(true);

    await act(async () => userEvent.click(storageButton));
    expect(storageElement?.getAttribute("aria-expanded")).toBe("true");
    expect(storagePanel?.hidden).toBe(false);
    expect(dialog?.textContent).toContain("/workspace");
    expect(dialog?.textContent).toContain("/cache/with/a/long/path");
    expect(storagePanel?.querySelectorAll('[role="progressbar"]')).toHaveLength(
      2,
    );

    await act(async () => userEvent.click(storageButton));
    expect(storageElement?.getAttribute("aria-expanded")).toBe("false");
    storageElement?.focus();
    await act(async () => userEvent.keyboard("{Enter}"));
    expect(storageElement?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => userEvent.keyboard(" "));
    expect(storageElement?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps an unavailable temperature sensor state explicit", async () => {
    legacyMetricsResult = {
      data: { ...legacyMetrics, temperatures: [] },
    };
    await act(async () => root.render(<HostResourcePopover />));
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Host resources: Memory pressure"]',
    );
    await act(async () => trigger?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Temperature sensors unavailable");
    expect(dialog?.textContent).not.toContain("0°C");
  });

  it("keeps the read-only dialog inside a mobile viewport and restores trigger focus", async () => {
    await page.viewport(320, 700);
    await act(async () => root.render(<HostResourcePopover />));
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Host resources: Memory pressure"]',
    );
    await act(async () => trigger?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const rect = dialog?.getBoundingClientRect();
    expect(rect).toBeDefined();
    expect(rect?.left).toBeGreaterThanOrEqual(0);
    expect(rect?.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect?.top).toBeGreaterThanOrEqual(0);
    expect(rect?.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("moves disconnect/reconnect handling to the replacement profile transport", async () => {
    const first = makeTransport("connected");
    initTransport(first.transport);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <IpcStatus />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("connected"),
    );
    expect(first.transport.onEvent).toHaveBeenCalledWith(
      "host:alertChanged",
      expect.any(Function),
    );

    resetTransportListeners();
    const second = makeTransport("connecting");
    reconfigureTransport(second.transport);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <IpcStatus />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("connecting"),
    );

    await act(async () => first.emitStatus("disconnected"));
    expect(container.textContent).toContain("connecting");

    await act(async () => second.emitStatus("disconnected"));
    await vi.waitFor(() =>
      expect(container.textContent).toContain("disconnected"),
    );
    queryClient.setQueryData(["system", "resource-snapshot"], snapshot);
    queryClient.setQueryData(["system", "resource-alerts"], []);
    await act(async () => second.emitStatus("connected"));
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState(["system", "resource-snapshot"])
          ?.isInvalidated,
      ).toBe(true),
    );
    expect(
      queryClient.getQueryState(["system", "resource-alerts"])?.isInvalidated,
    ).toBe(true);
  });
});
