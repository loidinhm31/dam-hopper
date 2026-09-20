import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import type { Transport } from "@/api/transport.js";
import type * as queriesModule from "@/api/queries.js";
import type * as multiResourcesModule from "@/hooks/use-multi-host-resources.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { HostResourcePopoverProps } from "@/components/organisms/HostResourcePopover.js";
import type {
  MultiHostResourceEntry,
  UseMultiHostResourcesResult,
} from "@/hooks/use-multi-host-resources.js";
import type { HostResourceFleetSummary } from "@/lib/host-resource-state.js";
import { resolveHostResourceEntryStatus } from "@/lib/host-resource-state.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
const availability = { state: "available", sampledAt: 1 } as const;
const snapshot: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "sample-1",
  sampledAt: Date.now(),
  host: { hostname: "monitor-host", osName: "Fedora" },
  capabilities: { linuxDeepMetrics: availability },
  memory: { totalBytes: 1_024, availableBytes: 512, availability },
  battery: {
    count: 1,
    capacityPercent: 75,
    status: "discharging",
    remainingEnergyWh: 12.5,
    instantaneousPowerW: 3.25,
    availability,
  },
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

const longValue =
  "unbroken-host-resource-value-abcdefghijklmnopqrstuvwxyz-0123456789-".repeat(
    2,
  );

const longSnapshot: HostResourceSnapshotV1 = {
  ...snapshot,
  host: { hostname: longValue, osName: longValue },
  memory: {
    ...snapshot.memory,
    totalBytes: 4_096,
    availableBytes: 2_048,
    anonBytes: 1_024,
    fileCacheBytes: 1_280,
    reclaimableSlabBytes: 512,
    swapUsedBytes: 256,
  },
  alert: {
    ...snapshot.alert,
    scope: longValue,
    threshold: longValue,
    nextAction: longValue,
  },
  currentAlerts: [
    {
      kind: "disk",
      key: `disk:${longValue}`,
      state: "diskFull",
      severity: "critical",
      incidentId: "long-resource-incident",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 30,
      scope: longValue,
      threshold: longValue,
      nextAction: longValue,
      evidence: {
        diskName: longValue,
        diskMountPoint: `/${longValue}`,
        diskUsagePercent: 95,
      },
    },
  ],
  processes: {
    ...snapshot.processes,
    scannedCount: 1,
    processes: [
      {
        pid: 42,
        name: longValue,
        rssBytes: 512,
        availability,
      },
    ],
  },
  cgroups: [
    {
      path: `/${longValue}`,
      namespace: "host",
      currentBytes: 256,
      maxUnlimited: true,
      highUnlimited: true,
      events: [],
      pressure: { memory: { availability } },
      availability,
    },
  ],
  mountContext: {
    ...snapshot.mountContext,
    mountPoint: `/${longValue}`,
  },
};

const longLegacyMetrics: HostMetrics = {
  ...legacyMetrics,
  disk: {
    ...legacyMetrics.disk,
    name: longValue,
    mountPoint: `/${longValue}`,
  },
  disks: [
    {
      ...legacyMetrics.disk,
      name: longValue,
      mountPoint: `/${longValue}`,
      usagePercent: 95,
    },
  ],
};

let snapshotResult: {
  data?: HostResourceSnapshotV1;
  isLoading: boolean;
  isError: boolean;
};
let legacyMetricsResult: { data?: HostMetrics };
let activeQueryClient: QueryClient;
const { queryMockState } = vi.hoisted(() => ({
  queryMockState: {
    recordedMetrics: [] as Array<{ enabled?: boolean; owner?: unknown }>,
    profileSnapshots: new Map<string, HostResourceSnapshotV1>(),
    boundSnapshots: new Map<string, HostResourceSnapshotV1>(),
    targetOwners: new Map<string, ConnectionRef>(),
    forceSuspendOwners: [] as unknown[],
  },
}));

let mockMultiResourcesResult: UseMultiHostResourcesResult | null = null;

vi.mock("@/hooks/use-multi-host-resources.js", async (importOriginal) => {
  const actual = await importOriginal<typeof multiResourcesModule>();
  return {
    ...actual,
    useMultiHostResources: (options?: unknown) => {
      if (mockMultiResourcesResult) {
        return mockMultiResourcesResult;
      }
      return actual.useMultiHostResources(options);
    },
  };
});
vi.mock("@/api/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof queriesModule>();
  return {
    ...actual,
    resolveTargetOwner: (target?: unknown) => {
      if (
        typeof target === "string" &&
        queryMockState.targetOwners.has(target)
      ) {
        return queryMockState.targetOwners.get(target);
      }
      return target as ConnectionRef | undefined;
    },
    useForceSuspend: (owner?: unknown) => {
      queryMockState.forceSuspendOwners.push(owner);
      return {
        mutateAsync: vi.fn(),
        isPending: false,
      };
    },
    useGlobalConfig: () => ({ data: { ui: {} } }),
    useHostResourceSnapshot: (enabled?: boolean, owner?: unknown) => {
      if (owner && typeof owner === "object" && "profileId" in owner) {
        const pId = (owner as ConnectionRef).profileId;
        if (queryMockState.profileSnapshots.has(pId)) {
          return {
            data: queryMockState.profileSnapshots.get(pId),
            isLoading: false,
            isError: false,
          };
        }
      }
      return snapshotResult;
    },
    useHostResourceAlerts: () => ({ data: [] }),
    useHostMetrics: (enabled?: boolean, owner?: unknown) => {
      queryMockState.recordedMetrics.push({ enabled, owner });
      return legacyMetricsResult;
    },
    useUpdateUiConfig: () => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    }),
    useIdleSuspendStatus: () => ({
      data: {
        version: 1,
        statusRevision: 1,
        state: "watching",
        enabled: true,
        armed: false,
        timing: {
          wakeAfterSeconds: 300,
          inactivityTimeoutSeconds: 900,
          gracePeriodSeconds: 30,
        },
      },
      isLoading: false,
    }),
    getBoundApiClient: (owner: ConnectionRef) => ({
      system: {
        resourceSnapshot: async () => {
          if (queryMockState.boundSnapshots.has(owner.profileId)) {
            return queryMockState.boundSnapshots.get(owner.profileId)!;
          }
          return snapshotResult.data ?? snapshot;
        },
      },
    }),
  };
});

async function renderPopover(
  root: Root,
  element: React.ReactElement = <HostResourcePopover />,
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={activeQueryClient}>
        {element}
      </QueryClientProvider>,
    ),
  );
}
import { HostResourcePopover } from "@/components/organisms/HostResourcePopover.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderOpenPanel(
  root: Root,
  container: HTMLDivElement,
  key: string,
  props: HostResourcePopoverProps = {},
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={activeQueryClient}>
        <HostResourcePopover key={key} {...props} />
      </QueryClientProvider>,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="dialog"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger?.click();
    await nextAnimationFrame();
  });
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return {
    trigger: trigger as HTMLButtonElement,
    dialog: dialog as HTMLElement,
  };
}

function setSafeAreas({
  top,
  right,
  bottom,
  left,
}: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}) {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--safe-area-top", `${top}px`);
  rootStyle.setProperty("--safe-area-right", `${right}px`);
  rootStyle.setProperty("--safe-area-bottom", `${bottom}px`);
  rootStyle.setProperty("--safe-area-left", `${left}px`);
}

function getScrollBody(dialog: HTMLElement): HTMLElement {
  const body = dialog.querySelector<HTMLElement>(".overflow-y-auto");
  expect(body).not.toBeNull();
  return body as HTMLElement;
}

function assertNoHorizontalOverflow(dialog: HTMLElement): void {
  const scrollBody = getScrollBody(dialog);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  expect(scrollBody.scrollWidth).toBeLessThanOrEqual(
    scrollBody.clientWidth + 1,
  );
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth + 1,
  );
  expect(document.body.scrollWidth).toBeLessThanOrEqual(
    document.body.clientWidth + 1,
  );
}

function assertMinimumControlSize(control: HTMLElement): void {
  const rect = control.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
}

type Rgba = { red: number; green: number; blue: number; alpha: number };

function parseRgb(value: string): Rgba | undefined {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return undefined;
  const channels = match[1]
    .trim()
    .split(/[,\s/]+/)
    .map((channel) => Number.parseFloat(channel));
  if (
    channels.length < 3 ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    return undefined;
  }
  return {
    red: channels[0],
    green: channels[1],
    blue: channels[2],
    alpha: channels[3] ?? 1,
  };
}

function getOpaqueBackground(element: HTMLElement): Rgba {
  let current: HTMLElement | null = element;
  while (current) {
    const background = parseRgb(getComputedStyle(current).backgroundColor);
    if (background && background.alpha >= 0.99) return background;
    current = current.parentElement;
  }
  throw new Error(`No opaque background found for ${element.textContent}`);
}

function relativeLuminance(color: Rgba): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.red) +
    0.7152 * channel(color.green) +
    0.0722 * channel(color.blue)
  );
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function assertNormalTextContrast(scope: HTMLElement): void {
  const elements = Array.from(
    scope.querySelectorAll<HTMLElement>("h2,h3,p,span,button"),
  ).filter((element) => {
    const style = getComputedStyle(element);
    return Boolean(element.textContent?.trim()) && style.display !== "none";
  });
  for (const element of elements) {
    const foreground = parseRgb(getComputedStyle(element).color);
    expect(foreground).toBeDefined();
    const background = getOpaqueBackground(element);
    expect(background.alpha).toBe(1);
    const isSecondaryOrBadge =
      Boolean(
        element.closest(
          ".text-\\[var\\(--color-text-muted\\)\\], .text-muted, [class*='text-muted']",
        ),
      ) ||
      element.className.includes("text-[10px]") ||
      element.className.includes("text-[11px]") ||
      element.className.includes("text-[var(--color-text-muted)]") ||
      element.getAttribute("role") === "status";
    const minRatio = isSecondaryOrBadge ? 3.0 : 4.5;
    expect(
      contrastRatio(foreground as Rgba, background),
    ).toBeGreaterThanOrEqual(minRatio);
  }
}

function assertIndicatorContrast(scope: HTMLElement): void {
  const status = scope.querySelector<HTMLElement>(
    '[aria-label^="Host resource status:"]',
  );
  expect(status).not.toBeNull();
  const statusElement = status as HTMLElement;
  const statusBackground = getOpaqueBackground(statusElement);
  const icon = statusElement.querySelector<HTMLElement>("svg");
  expect(icon).not.toBeNull();
  const iconColor = parseRgb(getComputedStyle(icon as HTMLElement).color);
  expect(iconColor).toBeDefined();
  expect(
    contrastRatio(iconColor as Rgba, statusBackground),
  ).toBeGreaterThanOrEqual(3);
  const borderColor = parseRgb(getComputedStyle(statusElement).borderLeftColor);
  expect(borderColor).toBeDefined();
  expect(
    contrastRatio(borderColor as Rgba, statusBackground),
  ).toBeGreaterThanOrEqual(3);

  for (const progress of scope.querySelectorAll<HTMLElement>(
    '[role="progressbar"]',
  )) {
    const track = parseRgb(getComputedStyle(progress).backgroundColor);
    const fill = progress.firstElementChild
      ? parseRgb(
          getComputedStyle(progress.firstElementChild as HTMLElement)
            .backgroundColor,
        )
      : undefined;
    expect(track).toBeDefined();
    expect(fill).toBeDefined();
    expect(contrastRatio(fill as Rgba, track as Rgba)).toBeGreaterThanOrEqual(
      3,
    );
  }
}

describe("host resource monitoring in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(async () => {
    await page.viewport(1280, 800);
    setSafeAreas({ top: 0, right: 0, bottom: 0, left: 0 });
    document.documentElement.style.removeProperty("--top-nav-height");
    document.documentElement.style.removeProperty("zoom");
    document.body.style.removeProperty("overflow");
    window.scrollTo(0, 0);
    useHostResourceAlertPresentationStore.getState().reset();
    snapshotResult = { data: snapshot, isLoading: false, isError: false };
    legacyMetricsResult = { data: undefined };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    activeQueryClient = queryClient;
    queryMockState.recordedMetrics = [];
    queryMockState.profileSnapshots.clear();
    queryMockState.boundSnapshots.clear();
    queryMockState.targetOwners.clear();
    queryMockState.forceSuspendOwners = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await page.viewport(1280, 800);
    setSafeAreas({ top: 0, right: 0, bottom: 0, left: 0 });
    document.documentElement.style.removeProperty("--top-nav-height");
    document.documentElement.style.removeProperty("zoom");
    document.body.style.removeProperty("overflow");
    window.scrollTo(0, 0);
    useHostResourceAlertPresentationStore.getState().reset();
    resetTransportListeners();
    resetTransport();
    mockMultiResourcesResult = null;
    queryClient.clear();
    queryMockState.recordedMetrics = [];
    queryMockState.profileSnapshots.clear();
    queryMockState.boundSnapshots.clear();
    queryMockState.targetOwners.clear();
    queryMockState.forceSuspendOwners = [];
    container.remove();
  });

  function createEntry(
    profile: ServerProfile,
    overrides: Partial<MultiHostResourceEntry> = {},
  ): MultiHostResourceEntry {
    const connected = overrides.connected ?? true;
    const connectionStatus =
      overrides.connectionStatus ?? (connected ? "connected" : "offline");
    const snap =
      overrides.snapshot !== undefined ? overrides.snapshot : snapshot;
    const unreadCount = overrides.unreadCount ?? 0;
    const status =
      overrides.status ??
      resolveHostResourceEntryStatus({
        snapshot: snap,
        connectionStatus,
        connected,
        unreadCount,
      });
    return {
      profile,
      owner: { profileId: profile.id, generation: 1 },
      connectionStatus,
      connected,
      watchReason: overrides.watchReason ?? "connected",
      snapshot: snap,
      status,
      unreadCount,
      isLoading: false,
      isFetching: false,
      isError: false,
      isStale: false,
      ...overrides,
    };
  }

  function setupMultiProfileFixture({
    profiles,
    entries,
    summaryOverrides,
  }: {
    profiles: ServerProfile[];
    entries: MultiHostResourceEntry[];
    summaryOverrides?: Partial<HostResourceFleetSummary>;
  }) {
    for (const entry of entries) {
      queryMockState.targetOwners.set(entry.profile.id, entry.owner);
      if (entry.snapshot) {
        queryMockState.profileSnapshots.set(entry.profile.id, entry.snapshot);
      }
    }
    mockMultiResourcesResult = {
      configuredProfileCount: profiles.length,
      entries,
      summary: {
        watchedCount: entries.filter((e) => e.watchReason).length,
        connectedCount: entries.filter((e) => e.connected).length,
        attentionCount: 0,
        unavailableCount: entries.filter((e) => !e.connected).length,
        unreadCount: entries.reduce((acc, e) => acc + (e.unreadCount ?? 0), 0),
        presentation: {
          baseLabel: "Fleet resources",
          label: `Fleet resources: ${entries.filter((e) => e.connected).length}/${entries.length} connected`,
          statusClassName:
            "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]",
          statusIconClassName: "text-[var(--color-success)]",
          triggerClassName: "text-[var(--color-success)]",
          badgeClassName:
            "bg-[var(--color-success)] text-[var(--color-surface)]",
          icon: "healthy",
          rank: 0,
          mode: "current",
        },
        ...summaryOverrides,
      },
    };
  }

  it("opens a keyboard-dismissible read-only diagnosis panel", async () => {
    await renderPopover(root);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Host resources: Memory pressure; Critical · resource alert status unavailable",
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("1 unread host incidents");

    await act(async () => {
      trigger?.click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);
    const disclosure = page.getByRole("button", {
      name: "Diagnostics and storage controls",
    });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Tab",
          shiftKey: true,
        }),
      );
    });
    expect(document.activeElement).toBe(disclosure.element());
    expect(disclosure.element().getAttribute("aria-expanded")).toBe("false");
    expect(dialog?.textContent).toContain("Monitoring, diagnosis, and host sleep control");
    expect(dialog?.textContent).toContain("Operator guidance");
    await act(async () => userEvent.click(disclosure));
    const battery = page.getByRole("region", { name: "Battery", exact: true });
    await expect.element(battery).toHaveTextContent("Remaining energy");
    await expect.element(battery).toHaveTextContent("12.5 Wh");
    await expect.element(battery).toHaveTextContent("Instantaneous power");
    await expect.element(battery).toHaveTextContent("3.25 W");
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
      data: undefined,
      isLoading: false,
      isError: true,
    };
    legacyMetricsResult = { data: legacyMetrics };
    await renderPopover(root);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
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

  it("omits battery measurements the host did not report", async () => {
    snapshotResult = {
      data: {
        ...snapshot,
        battery: {
          count: 1,
          status: "charging",
          remainingEnergyWh: 12.5,
          instantaneousPowerW: null,
          availability,
        },
      },
      isLoading: false,
      isError: false,
    };
    await renderPopover(root);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    await act(async () => trigger?.click());

    const disclosure = page.getByRole("button", {
      name: "Diagnostics and storage controls",
    });
    await act(async () => userEvent.click(disclosure));
    const battery = page.getByRole("region", { name: "Battery", exact: true });
    await expect.element(battery).toHaveTextContent("12.5 Wh");
    await expect.element(battery).not.toHaveTextContent("Instantaneous power");
  });

  it("reveals every disk with pointer and keyboard disclosure", async () => {
    legacyMetricsResult = { data: legacyMetrics };
    await renderPopover(root);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    await act(async () => trigger?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const storageButton = page.getByRole("button", {
      name: "Diagnostics and storage controls",
    });
    const storageElement = storageButton.element() as HTMLButtonElement;
    const storagePanel = dialog?.querySelector<HTMLElement>(
      `#${storageElement.getAttribute("aria-controls")}`,
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
    expect(storagePanel?.querySelectorAll("meter")).toHaveLength(2);

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
    await renderPopover(root);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    await act(async () => trigger?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Temperature sensors unavailable");
    expect(dialog?.textContent).not.toContain("0°C");
  });

  it("keeps the read-only dialog inside a mobile viewport and restores trigger focus", async () => {
    await page.viewport(320, 700);
    await renderPopover(root);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
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

  it("hands off from popover to Radix ForceSleepDialog and restores trigger focus on close", async () => {
    legacyMetricsResult = { data: legacyMetrics };
    await renderPopover(root);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    await act(async () => trigger?.click());

    const forceButton = page.getByRole("button", {
      name: "Force Machine to Sleep",
    });
    await expect.element(forceButton).toBeVisible();

    await act(async () => userEvent.click(forceButton));

    expect(
      container.querySelector("header h2")?.textContent,
    ).not.toBe("Host resources");

    const forceDialog = page.getByRole("dialog");
    await expect.element(forceDialog).toBeVisible();
    await expect.element(forceDialog).toHaveTextContent("Force Machine to Sleep");
    await expect.element(forceDialog).toHaveTextContent(
      "Sleep indefinitely (default)",
    );

    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await act(async () => userEvent.click(cancelButton));

    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("contains keyboard focus and keeps interactive targets at least 44px", async () => {
    legacyMetricsResult = { data: legacyMetrics };
    const { trigger, dialog } = await renderOpenPanel(
      root,
      container,
      "focus-and-targets",
    );
    const closeButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close host resources"]',
    );
    const forceButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Force Machine to Sleep"]',
    );
    const storageButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-controls$="-diagnosis"]',
    );
    expect(closeButton).not.toBeNull();
    expect(forceButton).not.toBeNull();
    expect(storageButton).not.toBeNull();
    assertMinimumControlSize(trigger);
    assertMinimumControlSize(closeButton as HTMLButtonElement);
    assertMinimumControlSize(forceButton as HTMLButtonElement);
    assertMinimumControlSize(storageButton as HTMLButtonElement);

    await act(async () => userEvent.keyboard("{Tab}"));
    expect(document.activeElement).toBe(closeButton);
    const focusStyle = getComputedStyle(closeButton as HTMLButtonElement);
    expect(focusStyle.outlineStyle).not.toBe("none");
    const focusColor = parseRgb(focusStyle.outlineColor);
    expect(focusColor).toBeDefined();
    expect(
      contrastRatio(
        focusColor as Rgba,
        getOpaqueBackground(closeButton as HTMLButtonElement),
      ),
    ).toBeGreaterThanOrEqual(3);

    await act(async () => userEvent.keyboard("{Tab}"));
    expect(document.activeElement).toBe(forceButton);

    await act(async () => userEvent.keyboard("{Tab}"));
    expect(document.activeElement).toBe(storageButton);
    expect(storageButton?.className).toContain("focus-visible:outline-2");
    expect(
      getComputedStyle(storageButton as HTMLButtonElement).outlineStyle,
    ).not.toBe("none");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(document.activeElement).toBe(closeButton);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      );
    });
    expect(document.activeElement).toBe(storageButton);

    await act(async () => {
      await userEvent.click(closeButton as HTMLButtonElement);
      await nextAnimationFrame();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps resource-only critical status after acknowledgement", async () => {
    snapshotResult = {
      data: {
        ...snapshot,
        alert: { ...snapshot.alert, state: "healthy", severity: "info" },
        currentAlerts: [
          {
            kind: "disk",
            key: "disk:/workspace",
            state: "diskFull",
            severity: "critical",
            incidentId: "resource-critical",
            openedAt: 1,
            updatedAt: 1,
            durationSeconds: 30,
            scope: "disk:/workspace",
            threshold: "usage>=95%",
            nextAction: "Free space.",
            evidence: {
              diskName: "workspace",
              diskMountPoint: "/workspace",
              diskUsagePercent: 95,
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
    };
    const { trigger, dialog } = await renderOpenPanel(
      root,
      container,
      "resource-only-critical",
    );
    expect(trigger.getAttribute("aria-label")).toBe(
      "Host resources: 1 active resource incident; Critical",
    );
    expect(trigger.className).toContain("text-[var(--color-danger)]");
    expect(trigger.className).not.toContain("bg-current");
    expect(dialog.textContent).toContain("Critical");
    expect(container.textContent).not.toContain("0 unread");
    expect(container.textContent).not.toContain("1 unread host incidents");
    expect(
      container.querySelector('span[aria-hidden="true"]')?.textContent,
    ).toBe("!");
  });

  it("keeps text and meaningful indicators above the contrast thresholds", async () => {
    const healthy = {
      data: {
        ...snapshot,
        alert: { ...snapshot.alert, state: "healthy", severity: "info" },
        currentAlerts: [],
      },
      isLoading: false,
      isError: false,
    };
    const info = {
      data: {
        ...healthy.data,
        currentAlerts: [
          {
            kind: "temperature" as const,
            key: "temperature:package",
            state: "temperatureHigh" as const,
            severity: "info" as const,
            incidentId: "info-incident",
            openedAt: 1,
            updatedAt: 1,
            durationSeconds: 1,
            scope: "package",
            threshold: "90",
            nextAction: "Inspect",
            evidence: { temperatureSource: "pkg", temperatureCelsius: 90 },
          },
        ],
      },
      isLoading: false,
      isError: false,
    };
    const warning = {
      data: {
        ...healthy.data,
        alert: { ...snapshot.alert, state: "limitedData", severity: "warning" },
      },
      isLoading: false,
      isError: false,
    };
    const unavailable = {
      data: {
        ...healthy.data,
        memory: {
          ...snapshot.memory,
          availability: {
            state: "temporarilyUnavailable" as const,
            sampledAt: 1,
          },
        },
      },
      isLoading: false,
      isError: false,
    };
    const loading = { data: undefined, isLoading: true, isError: false };

    for (const [name, result] of [
      ["healthy", healthy],
      ["info", info],
      ["warning", warning],
      ["critical", { data: snapshot, isLoading: false, isError: false }],
      ["unavailable", unavailable],
      ["loading", loading],
    ] as const) {
      snapshotResult = result;
      const { dialog } = await renderOpenPanel(
        root,
        container,
        `contrast-${name}`,
      );
      assertNormalTextContrast(dialog);
      assertIndicatorContrast(dialog);
      const badge = container.querySelector<HTMLElement>(
        'span[aria-hidden="true"]',
      );
      if (badge?.textContent?.trim()) {
        const foreground = parseRgb(getComputedStyle(badge).color);
        expect(foreground).toBeDefined();
        expect(
          contrastRatio(foreground as Rgba, getOpaqueBackground(badge)),
        ).toBeGreaterThanOrEqual(4.5);
      }
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await nextAnimationFrame();
      });
    }
  });

  it("keeps safe-area edges and panel-owned scrolling inside a mobile viewport", async () => {
    await page.viewport(320, 700);
    setSafeAreas({ top: 18, right: 22, bottom: 26, left: 20 });
    snapshotResult = { data: longSnapshot, isLoading: false, isError: false };
    legacyMetricsResult = { data: longLegacyMetrics };
    const { dialog } = await renderOpenPanel(
      root,
      container,
      "safe-area-and-scroll",
    );
    const rect = dialog.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(19);
    expect(rect.right).toBeLessThanOrEqual(320 - 22 + 1);
    expect(rect.top).toBeGreaterThanOrEqual(17);
    expect(rect.bottom).toBeLessThanOrEqual(700 - 26 + 1);
    assertNoHorizontalOverflow(dialog);

    const scrollBody = getScrollBody(dialog);
    expect(getComputedStyle(scrollBody).overscrollBehaviorY).toBe("contain");
    expect(scrollBody.scrollHeight).toBeGreaterThan(scrollBody.clientHeight);
    const documentScrollTop = document.documentElement.scrollTop;
    scrollBody.scrollTop = scrollBody.scrollHeight;
    expect(scrollBody.scrollTop).toBeGreaterThan(0);
    expect(document.documentElement.scrollTop).toBe(documentScrollTop);
    expect(document.body.scrollTop).toBe(0);
  });

  it("wraps long diagnostic values without ellipsis or horizontal overflow", async () => {
    await page.viewport(320, 700);
    snapshotResult = { data: longSnapshot, isLoading: false, isError: false };
    legacyMetricsResult = { data: longLegacyMetrics };
    const { dialog } = await renderOpenPanel(root, container, "long-values");
    const storageButton = dialog.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    expect(storageButton).not.toBeNull();
    await act(async () => userEvent.click(storageButton as HTMLButtonElement));
    expect(dialog.textContent).toContain(longValue);
    expect(dialog.textContent).toContain(`/${longValue}`);

    const targets = Array.from(dialog.querySelectorAll<HTMLElement>("*"))
      .filter((element) => element.children.length === 0)
      .filter((element) => element.textContent?.includes(longValue));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const style = getComputedStyle(target);
      expect(style.whiteSpace).not.toBe("nowrap");
      expect(style.overflowWrap).toMatch(/anywhere|break-word/);
      expect(style.textOverflow).not.toBe("ellipsis");
    }
    const wrapped = targets.find((target) => {
      const style = getComputedStyle(target);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return target.getBoundingClientRect().height > lineHeight * 1.5;
    });
    expect(wrapped).toBeDefined();
    assertNoHorizontalOverflow(dialog);
  });

  it("keeps the critical fixture header and expanded diagnostics reachable at desktop width", async () => {
    await page.viewport(1280, 800);
    setSafeAreas({ top: 0, right: 0, bottom: 0, left: 0 });
    snapshotResult = { data: snapshot, isLoading: false, isError: false };
    legacyMetricsResult = { data: undefined };
    const { dialog } = await renderOpenPanel(
      root,
      container,
      "desktop-density",
    );
    const disclosure = dialog.querySelector<HTMLButtonElement>(
      'button[aria-controls$="-diagnosis"]',
    );
    expect(disclosure).not.toBeNull();
    await act(async () => userEvent.click(disclosure as HTMLButtonElement));
    const body = getScrollBody(dialog);
    body.scrollTop = 0;
    const bodyRect = body.getBoundingClientRect();
    expect(
      dialog.querySelector('[aria-label^="Host resource status: Critical"]'),
    ).not.toBeNull();
    for (const label of [
      "Memory available",
      "File cache",
      "Anonymous memory",
      "Reclaimable slab",
      "Swap used",
      "PSI memory",
    ]) {
      const labelElement = Array.from(
        dialog.querySelectorAll<HTMLElement>("span"),
      ).find((element) => element.textContent?.trim() === label);
      const card = labelElement?.closest<HTMLElement>("section");
      expect(card).not.toBeNull();
      const cardRect = (card as HTMLElement).getBoundingClientRect();
      expect(cardRect.top).toBeGreaterThanOrEqual(bodyRect.top);
    }
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
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

  it("switches views between Fleet deck and profile drilldowns with focus restoration", async () => {
    const profiles: ServerProfile[] = [
      {
        id: "profile-a",
        name: "Alpha Host",
        url: "http://127.0.0.1:4801",
        authType: "none",
        autoConnect: true,
        createdAt: 1000,
      },
      {
        id: "profile-b",
        name: "Beta Host",
        url: "http://127.0.0.1:4802",
        authType: "none",
        autoConnect: true,
        createdAt: 2000,
      },
      {
        id: "profile-c",
        name: "Gamma Offline",
        url: "http://127.0.0.1:4803",
        authType: "none",
        autoConnect: true,
        createdAt: 3000,
      },
    ];
    const alphaSnapshot: HostResourceSnapshotV1 = {
      ...snapshot,
      host: { hostname: "alpha-machine", osName: "Fedora" },
    };
    const betaSnapshot: HostResourceSnapshotV1 = {
      ...snapshot,
      host: { hostname: "beta-machine", osName: "Debian" },
    };
    const entries: MultiHostResourceEntry[] = [
      createEntry(profiles[0], {
        snapshot: alphaSnapshot,
        connected: true,
      }),
      createEntry(profiles[1], {
        snapshot: betaSnapshot,
        connected: true,
      }),
      createEntry(profiles[2], {
        snapshot: null,
        connected: false,
        connectionStatus: "offline",
        watchReason: "autoConnect",
      }),
    ];
    setupMultiProfileFixture({ profiles, entries });

    await renderPopover(root);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-label")).toContain(
      "watched hosts connected",
    );

    await act(async () => trigger?.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const fleetPill = page.getByRole("button", { name: "Fleet" });
    await expect.element(fleetPill).toBeVisible();
    expect(fleetPill.element().getAttribute("aria-pressed")).toBe("true");

    const alphaPill = page.getByRole("button", { name: /^Alpha Host:/ });
    await expect.element(alphaPill).toBeVisible();
    expect(alphaPill.element().getAttribute("aria-pressed")).toBe("false");

    const betaPill = page.getByRole("button", { name: /^Beta Host:/ });
    await expect.element(betaPill).toBeVisible();
    expect(betaPill.element().getAttribute("aria-pressed")).toBe("false");

    expect(dialog?.textContent).toContain("Gamma Offline");
    expect(dialog?.textContent).toContain("alpha-machine");
    expect(dialog?.textContent).toContain("beta-machine");
    expect(dialog?.textContent).toContain("Offline");

    const inspectAlpha = page.getByRole("button", {
      name: /^Inspect host resources for Alpha Host/,
    });
    await expect.element(inspectAlpha).toBeVisible();
    const inspectBeta = page.getByRole("button", {
      name: /^Inspect host resources for Beta Host/,
    });
    await expect.element(inspectBeta).toBeVisible();

    // Inspect Alpha
    await act(async () => userEvent.click(inspectAlpha));
    expect(fleetPill.element().getAttribute("aria-pressed")).toBe("false");
    expect(alphaPill.element().getAttribute("aria-pressed")).toBe("true");
    expect(dialog?.textContent).toContain("alpha-machine");

    const disclosure = page.getByRole("button", {
      name: "Diagnostics and storage controls",
    });
    await expect.element(disclosure).toBeVisible();
    await act(async () => userEvent.click(disclosure));
    expect(disclosure.element().getAttribute("aria-expanded")).toBe("true");

    // Return to Fleet
    await act(async () => userEvent.click(fleetPill));
    expect(fleetPill.element().getAttribute("aria-pressed")).toBe("true");
    expect(alphaPill.element().getAttribute("aria-pressed")).toBe("false");
    await expect.element(inspectBeta).toBeVisible();

    // Inspect Beta via pill
    betaPill.element().focus();
    await act(async () => userEvent.keyboard("{Enter}"));
    expect(betaPill.element().getAttribute("aria-pressed")).toBe("true");
    expect(fleetPill.element().getAttribute("aria-pressed")).toBe("false");
    expect(dialog?.textContent).toContain("beta-machine");

    // Close via Escape
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await nextAnimationFrame();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("proves 1s host metrics polling is enabled only for the visible connected drilldown", async () => {
    const profiles: ServerProfile[] = [
      {
        id: "profile-a",
        name: "Alpha Host",
        url: "http://127.0.0.1:4801",
        authType: "none",
        autoConnect: true,
        createdAt: 1000,
      },
      {
        id: "profile-b",
        name: "Beta Host",
        url: "http://127.0.0.1:4802",
        authType: "none",
        autoConnect: true,
        createdAt: 2000,
      },
    ];
    const entries: MultiHostResourceEntry[] = [
      createEntry(profiles[0], { connected: true }),
      createEntry(profiles[1], { connected: true }),
    ];
    setupMultiProfileFixture({ profiles, entries });

    const { trigger } = await renderOpenPanel(
      root,
      container,
      "tiered-polling-flow",
    );

    // In Fleet Deck, no 1s metrics enabled
    expect(
      queryMockState.recordedMetrics.some((call) => call.enabled === true),
    ).toBe(false);

    // Inspect Alpha
    const inspectAlpha = page.getByRole("button", {
      name: /^Inspect host resources for Alpha Host/,
    });
    await act(async () => userEvent.click(inspectAlpha));
    const lastCallAlpha =
      queryMockState.recordedMetrics[queryMockState.recordedMetrics.length - 1];
    expect(lastCallAlpha.enabled).toBe(true);
    expect((lastCallAlpha.owner as ConnectionRef)?.profileId).toBe("profile-a");

    // Switch to Beta
    const betaPill = page.getByRole("button", { name: /^Beta Host:/ });
    await act(async () => userEvent.click(betaPill));
    const lastCallBeta =
      queryMockState.recordedMetrics[queryMockState.recordedMetrics.length - 1];
    expect(lastCallBeta.enabled).toBe(true);
    expect((lastCallBeta.owner as ConnectionRef)?.profileId).toBe("profile-b");

    // Switch back to Fleet
    const fleetPill = page.getByRole("button", { name: "Fleet" });
    await act(async () => userEvent.click(fleetPill));
    const lastCallFleet =
      queryMockState.recordedMetrics[queryMockState.recordedMetrics.length - 1];
    expect(lastCallFleet.enabled).toBe(false);

    // Inspect Alpha again, then simulate disconnect
    await act(async () => userEvent.click(inspectAlpha));
    const disconnectedEntries = [
      createEntry(profiles[0], {
        connected: false,
        connectionStatus: "disconnected",
      }),
      entries[1],
    ];
    setupMultiProfileFixture({ profiles, entries: disconnectedEntries });
    await act(async () => {
      useWorkbenchSelectionsStore.setState({ settingsProfileId: "refresh" });
      await nextAnimationFrame();
    });
    await act(async () => {
      useWorkbenchSelectionsStore.setState({ settingsProfileId: null });
      await nextAnimationFrame();
    });

    const lastCallDisconnected =
      queryMockState.recordedMetrics[queryMockState.recordedMetrics.length - 1];
    expect(lastCallDisconnected.enabled).toBe(false);
    expect(fleetPill.element().getAttribute("aria-pressed")).toBe("true");

    // Close popover
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await nextAnimationFrame();
    });
    const lastCallClosed =
      queryMockState.recordedMetrics[queryMockState.recordedMetrics.length - 1];
    expect(lastCallClosed.enabled).toBe(false);
  });

  it("maintains independent per-profile unread state when opening fleet and inspecting a single host", async () => {
    const profiles: ServerProfile[] = [
      {
        id: "profile-a",
        name: "Alpha Host",
        url: "http://127.0.0.1:4801",
        authType: "none",
        autoConnect: true,
        createdAt: 1000,
      },
      {
        id: "profile-b",
        name: "Beta Host",
        url: "http://127.0.0.1:4802",
        authType: "none",
        autoConnect: true,
        createdAt: 2000,
      },
    ];
    const alphaSnapshot: HostResourceSnapshotV1 = {
      ...snapshot,
      alert: {
        incidentId: "inc-shared",
        state: "memoryPressure",
        severity: "warning",
        updatedAt: 1,
        durationSeconds: 1,
        scope: "host",
        confidence: "high",
        threshold: "memory",
        evidence: {},
        nextAction: "Inspect",
      },
      currentAlerts: [
        {
          kind: "disk",
          key: "disk:/a",
          state: "diskFull",
          severity: "warning",
          incidentId: "inc-shared",
          openedAt: 1,
          updatedAt: 1,
          durationSeconds: 1,
          scope: "disk:/a",
          threshold: "90%",
          nextAction: "Free space",
          evidence: {},
        },
      ],
    };
    const betaSnapshot: HostResourceSnapshotV1 = {
      ...snapshot,
      alert: {
        incidentId: "inc-shared",
        state: "oomRisk",
        severity: "critical",
        updatedAt: 1,
        durationSeconds: 1,
        scope: "host",
        confidence: "high",
        threshold: "memory",
        evidence: {},
        nextAction: "Inspect",
      },
      currentAlerts: [
        {
          kind: "disk",
          key: "disk:/b",
          state: "diskFull",
          severity: "critical",
          incidentId: "inc-shared",
          openedAt: 1,
          updatedAt: 1,
          durationSeconds: 1,
          scope: "disk:/b",
          threshold: "95%",
          nextAction: "Free space",
          evidence: {},
        },
      ],
    };
    const store = useHostResourceAlertPresentationStore.getState();
    store.recordSnapshotAlerts(
      alphaSnapshot.alert,
      alphaSnapshot.currentAlerts,
      "profile-a",
    );
    store.recordSnapshotAlerts(
      betaSnapshot.alert,
      betaSnapshot.currentAlerts,
      "profile-b",
    );

    const entries: MultiHostResourceEntry[] = [
      createEntry(profiles[0], {
        snapshot: alphaSnapshot,
        connected: true,
        unreadCount: 1,
      }),
      createEntry(profiles[1], {
        snapshot: betaSnapshot,
        connected: true,
        unreadCount: 1,
      }),
    ];
    setupMultiProfileFixture({ profiles, entries });

    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-a"]
        ?.unreadIds.length,
    ).toBe(1);
    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-b"]
        ?.unreadIds.length,
    ).toBe(1);

    // Opening Fleet deck leaves unread alerts untouched
    await renderOpenPanel(root, container, "unread-isolation");
    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-a"]
        ?.unreadIds.length,
    ).toBe(1);
    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-b"]
        ?.unreadIds.length,
    ).toBe(1);

    // Inspecting Alpha clears Alpha only
    const inspectAlpha = page.getByRole("button", {
      name: /^Inspect host resources for Alpha Host/,
    });
    await act(async () => userEvent.click(inspectAlpha));

    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-a"]
        ?.unreadIds.length,
    ).toBe(0);
    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-b"]
        ?.unreadIds.length,
    ).toBe(1);

    // Return to Fleet Deck
    const fleetPill = page.getByRole("button", { name: "Fleet" });
    await act(async () => userEvent.click(fleetPill));
    expect(
      useHostResourceAlertPresentationStore.getState().byProfile["profile-b"]
        ?.unreadIds.length,
    ).toBe(1);
  });

  it("keeps multi-card fleet deck within 320x700 and 1280x800 viewports without overflow and satisfies accessibility", async () => {
    const profiles: ServerProfile[] = [
      {
        id: "profile-a",
        name: "Alpha Host",
        url: "http://127.0.0.1:4801",
        authType: "none",
        autoConnect: true,
        createdAt: 1000,
      },
      {
        id: "profile-b",
        name: "Beta Host",
        url: "http://127.0.0.1:4802",
        authType: "none",
        autoConnect: true,
        createdAt: 2000,
      },
      {
        id: "profile-c",
        name: "Gamma Offline",
        url: "http://127.0.0.1:4803",
        authType: "none",
        autoConnect: true,
        createdAt: 3000,
      },
    ];
    const entries: MultiHostResourceEntry[] = [
      createEntry(profiles[0], { connected: true }),
      createEntry(profiles[1], { connected: true }),
      createEntry(profiles[2], {
        snapshot: null,
        connected: false,
        connectionStatus: "offline",
        watchReason: "autoConnect",
      }),
    ];
    setupMultiProfileFixture({ profiles, entries });

    // Mobile viewport
    await page.viewport(320, 700);
    const { dialog, trigger } = await renderOpenPanel(
      root,
      container,
      "mobile-fleet-deck",
    );
    assertNoHorizontalOverflow(dialog);
    assertNormalTextContrast(dialog);

    const fleetPill = page.getByRole("button", { name: "Fleet" });
    const alphaPill = page.getByRole("button", { name: /^Alpha Host:/ });
    const inspectAlpha = page.getByRole("button", {
      name: /^Inspect host resources for Alpha Host/,
    });
    const closeBtn = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close host resources"]',
    );

    expect(closeBtn).not.toBeNull();
    assertMinimumControlSize(trigger);
    assertMinimumControlSize(inspectAlpha.element() as HTMLButtonElement);
    assertMinimumControlSize(closeBtn as HTMLButtonElement);
    expect(
      fleetPill.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(24);
    expect(
      alphaPill.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(24);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await nextAnimationFrame();
    });

    // Desktop viewport
    await page.viewport(1280, 800);
    const desktopPanel = await renderOpenPanel(
      root,
      container,
      "desktop-fleet-deck",
    );
    assertNoHorizontalOverflow(desktopPanel.dialog);
    assertNormalTextContrast(desktopPanel.dialog);
  });

  it("escapes markup in profile/host strings and excludes action controls from offline cards", async () => {
    const profiles: ServerProfile[] = [
      {
        id: "profile-xss",
        name: '<script>alert("xss")</script>',
        url: "http://127.0.0.1:4801",
        authType: "none",
        autoConnect: true,
        createdAt: 1000,
      },
      {
        id: "profile-offline",
        name: "Offline Box",
        url: "http://127.0.0.1:4802",
        authType: "none",
        autoConnect: true,
        createdAt: 2000,
      },
    ];
    const xssSnapshot: HostResourceSnapshotV1 = {
      ...snapshot,
      host: {
        hostname: '<img src=x onerror=alert(1)>',
        osName: "Linux",
      },
    };
    const entries: MultiHostResourceEntry[] = [
      createEntry(profiles[0], {
        snapshot: xssSnapshot,
        connected: true,
      }),
      createEntry(profiles[1], {
        snapshot: null,
        connected: false,
        connectionStatus: "offline",
        watchReason: "autoConnect",
      }),
    ];
    setupMultiProfileFixture({ profiles, entries });

    const { dialog } = await renderOpenPanel(root, container, "security-flow");

    // Assert raw tags are not created as DOM elements
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.querySelector("img[onerror]")).toBeNull();

    // Assert literal strings exist in textContent
    expect(dialog.textContent).toContain('<script>alert("xss")</script>');
    expect(dialog.textContent).toContain('<img src=x onerror=alert(1)>');

    // Assert offline card has no inspect or suspend controls
    expect(
      dialog.querySelector(
        'button[aria-label="Inspect host resources for Offline Box"]',
      ),
    ).toBeNull();
    expect(dialog.textContent).toContain("Offline");

    // Inspect profile-xss and trigger force suspend
    const inspectXss = page.getByRole("button", {
      name: 'Inspect host resources for <script>alert("xss")</script>',
    });
    await act(async () => userEvent.click(inspectXss));

    const forceBtn = page.getByRole("button", {
      name: "Force Machine to Sleep",
    });
    await expect.element(forceBtn).toBeVisible();
    await act(async () => userEvent.click(forceBtn));

    // Verify force suspend owner was bound to inspected profile
    expect(queryMockState.forceSuspendOwners.length).toBeGreaterThan(0);
    expect(
      (queryMockState.forceSuspendOwners[0] as ConnectionRef)?.profileId,
    ).toBe("profile-xss");
  });
});
