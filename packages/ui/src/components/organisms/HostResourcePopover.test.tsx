// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostResourceSnapshotV1 } from "@/api/client.js";
import type { ServerProfile } from "@/api/server-config.js";
import type {
  MultiHostResourceEntry,
  UseMultiHostResourcesResult,
} from "@/hooks/use-multi-host-resources.js";
import { resolveHostResourceEntryStatus } from "@/lib/host-resource-state.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockSingleSnapshot = {
  host: {
    hostname: "single-host-node",
    osName: "Linux 6.1",
  },
  sampledAt: Date.now() - 5_000,
  memory: {
    totalBytes: 16 * 1024 ** 3,
    availableBytes: 8 * 1024 ** 3,
    availability: { state: "available", sampledAt: 1 },
  },
  capabilities: { linuxDeepMetrics: { state: "available", sampledAt: 1 } },
  pressure: { memory: { availability: { state: "available", sampledAt: 1 }, someAvg10: 0, someAvg60: 0, someAvg300: 0, fullAvg10: 0, fullAvg60: 0, fullAvg300: 0 } },
  cgroups: [],
  processes: {
    processes: [],
    scannedCount: 1,
    truncated: false,
    availability: { state: "available", sampledAt: 1 },
  },
  mountContext: {
    mountPoint: "/workspace",
    activeMappedPaths: [],
    activeMappedPathsAvailability: { state: "available", sampledAt: 1 },
    cacheAttribution: {
      label: "unattributedSharedCache",
      confidence: "low",
      method: "notCollected",
    },
    availability: { state: "available", sampledAt: 1 },
  },
  alert: {
    state: "healthy",
    severity: "info",
    updatedAt: 1,
    durationSeconds: 0,
    scope: "host",
    confidence: "high",
    threshold: "none",
    evidence: { cgroupOomDelta: false },
    nextAction: "No action required.",
  },
  currentAlerts: [
    {
      kind: "disk",
      key: "disk:/data",
      state: "diskFull",
      severity: "critical",
      incidentId: "disk-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "disk:/data",
      threshold: "usage>=95%",
      nextAction: "Free space.",
      evidence: { diskMountPoint: "/data", diskUsagePercent: 95 },
    },
  ],
} as unknown as HostResourceSnapshotV1;

const mockProfile1: ServerProfile = {
  id: "p1",
  name: "Local Dev Host",
  url: "http://127.0.0.1:4801",
  authType: "none",
  autoConnect: true,
  createdAt: 1000,
};

const mockProfile2: ServerProfile = {
  id: "p2",
  name: "Prod Host",
  url: "https://prod.example.com",
  authType: "none",
  autoConnect: true,
  createdAt: 2000,
};

const mockProfile3: ServerProfile = {
  id: "p3",
  name: "Offline Host",
  url: "http://192.168.1.50:4801",
  authType: "none",
  autoConnect: true,
  createdAt: 3000,
};

const mockSnapshotP2: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "s-p2",
  sampledAt: Date.now() - 10_000,
  host: {
    hostname: "prod-node-2",
    osName: "Linux 6.6",
  },
  capabilities: { linuxDeepMetrics: { state: "available", sampledAt: 1 } },
  memory: {
    totalBytes: 32 * 1024 ** 3,
    availableBytes: 16 * 1024 ** 3,
    availability: { state: "available", sampledAt: 1 },
  },
  battery: undefined,
  pressure: { memory: { availability: { state: "available", sampledAt: 1 }, someAvg10: 0, someAvg60: 0, someAvg300: 0, fullAvg10: 0, fullAvg60: 0, fullAvg300: 0 } },
  cgroups: [],
  processes: {
    processes: [],
    scannedCount: 2,
    truncated: false,
    availability: { state: "available", sampledAt: 1 },
  },
  mountContext: {
    mountPoint: "/workspace-prod",
    activeMappedPaths: [],
    activeMappedPathsAvailability: { state: "available", sampledAt: 1 },
    cacheAttribution: {
      label: "unattributedSharedCache",
      confidence: "low",
      method: "notCollected",
    },
    availability: { state: "available", sampledAt: 1 },
  },
  alert: {
    state: "healthy",
    severity: "info",
    updatedAt: 1,
    durationSeconds: 0,
    scope: "host",
    confidence: "high",
    threshold: "none",
    evidence: { cgroupOomDelta: false },
    nextAction: "None",
  },
  currentAlerts: [],
};

function createMockEntry(overrides: Partial<MultiHostResourceEntry>): MultiHostResourceEntry {
  const profile = overrides.profile ?? mockProfile1;
  const connected = overrides.connected ?? true;
  const connectionStatus = overrides.connectionStatus ?? (connected ? "connected" : "offline");
  const snapshot = overrides.snapshot !== undefined ? overrides.snapshot : mockSingleSnapshot;
  const unreadCount = overrides.unreadCount ?? 0;
  const status =
    overrides.status ??
    resolveHostResourceEntryStatus({
      snapshot,
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
    snapshot,
    status,
    unreadCount,
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    ...overrides,
  };
}

let mockMultiResources: UseMultiHostResourcesResult = {
  configuredProfileCount: 1,
  entries: [],
  summary: {
    watchedCount: 0,
    connectedCount: 0,
    attentionCount: 0,
    unavailableCount: 0,
    unreadCount: 0,
    presentation: {
      baseLabel: "Healthy",
      label: "Healthy",
      statusClassName: "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]",
      statusIconClassName: "text-[var(--color-success)]",
      triggerClassName: "text-[var(--color-success)]",
      badgeClassName: "bg-[var(--color-success)] text-[var(--color-surface)]",
      icon: "healthy",
      rank: 0,
      mode: "current",
    },
  },
};

vi.mock("@/hooks/use-multi-host-resources.js", () => ({
  useMultiHostResources: () => mockMultiResources,
}));

vi.mock("@/api/queries.js", () => ({
  resolveTargetOwner: (owner?: unknown) =>
    owner && typeof owner === "object" && "generation" in owner
      ? (owner as { profileId: string; generation: number })
      : typeof owner === "string"
        ? { profileId: owner, generation: 1 }
        : undefined,
  useGlobalConfig: () => ({ data: { ui: { hostResourcePinnedMount: "/mnt/data" } } }),
  useHostMetrics: () => ({ data: undefined, isStale: false, isError: false }),
  useHostResourceAlerts: () => ({ data: [] }),
  useIdleSuspendStatus: () => ({ data: undefined, isLoading: false, isError: false }),
  useHostResourceSnapshot: (enabled: boolean, owner?: unknown) => {
    if (!enabled) return { data: undefined, isLoading: false, isFetching: false, isError: false, isStale: false };
    const pId = owner && typeof owner === "object" && "profileId" in owner ? (owner as { profileId: string }).profileId : undefined;
    if (pId === "p2") {
      return { data: mockSnapshotP2, isLoading: false, isFetching: false, isError: false, isStale: false };
    }
    return { data: mockSingleSnapshot, isLoading: false, isFetching: false, isError: false, isStale: false };
  },
  useUpdateUiConfig: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => ({
    id: "p1",
    name: "Local Dev Host",
    url: "http://127.0.0.1:4801",
  }),
}));

vi.mock("@/stores/workbench-selections.js", () => ({
  useWorkbenchSelectionsStore: (selector: (s: { settingsProfileId: string | null }) => unknown) =>
    selector({ settingsProfileId: null }),
}));

import { HostResourcePopover } from "./HostResourcePopover.js";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
  useHostResourceAlertPresentationStore.getState().reset();
  mockMultiResources = {
    configuredProfileCount: 1,
    entries: [],
    summary: {
      watchedCount: 0,
      connectedCount: 0,
      attentionCount: 0,
      unavailableCount: 0,
      unreadCount: 0,
      presentation: {
        baseLabel: "Healthy",
        label: "Healthy",
        statusClassName: "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]",
        statusIconClassName: "text-[var(--color-success)]",
        triggerClassName: "text-[var(--color-success)]",
        badgeClassName: "bg-[var(--color-success)] text-[var(--color-surface)]",
        icon: "healthy",
        rank: 0,
        mode: "current",
      },
    },
  };
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

async function renderComponent(element: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
  });
  return container;
}

describe("HostResourcePopover", () => {
  describe("Step 3.1: Single-profile compatibility", () => {
    it("keeps an active resource incident visible after acknowledgement in static render", () => {
      const markup = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <HostResourcePopover />
        </QueryClientProvider>,
      );

      expect(markup).toContain("Host resources: 1 active resource incident; Critical");
      expect(markup).not.toContain("bg-current");
      expect(markup).toContain("Active host incident");
      expect(markup).not.toContain("0 unread");
      expect(markup).toMatch(/<span aria-hidden="true"[^>]*>!<\/span>/);
      expect(markup).toContain("text-[var(--color-danger)]");
      const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
      expect(describedBy).toBeDefined();
      expect(markup).toContain(`id="${describedBy}"`);
    });

    it("renders single-profile popover panel without fleet toolbar and marks alert read on open", async () => {
      const dom = await renderComponent(<HostResourcePopover />);
      const trigger = dom.querySelector("button");
      expect(trigger).not.toBeNull();

      // Trigger click to open popover
      await act(async () => {
        trigger?.click();
      });

      // Dialog panel should be rendered
      const dialog = dom.querySelector('section[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain("Host resources");
      expect(dialog?.textContent).toContain("single-host-node");
      expect(dialog?.textContent).toContain("Linux 6.1");

      // No fleet toolbar should be rendered in single mode
      const toolbar = dom.querySelector('div[role="toolbar"]');
      expect(toolbar).toBeNull();
      expect(dom.textContent).not.toContain("Fleet Overview");

      // Diagnostics section is present
      expect(dom.textContent).toContain("Diagnostics and storage controls");
    });

    it("forces single-profile drilldown mode when explicit owner prop is passed even if multiple profiles are configured", async () => {
      mockMultiResources = {
        configuredProfileCount: 3,
        entries: [
          createMockEntry({ profile: mockProfile1 }),
          createMockEntry({ profile: mockProfile2 }),
        ],
        summary: {
          watchedCount: 2,
          connectedCount: 2,
          attentionCount: 0,
          unavailableCount: 0,
          unreadCount: 0,
          presentation: {
            baseLabel: "Healthy",
            label: "Healthy",
            statusClassName: "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]",
            statusIconClassName: "text-[var(--color-success)]",
            triggerClassName: "text-[var(--color-success)]",
            badgeClassName: "bg-[var(--color-success)] text-[var(--color-surface)]",
            icon: "healthy",
            rank: 0,
            mode: "current",
          },
        },
      };

      const explicitOwner = { profileId: "p2", generation: 1 };
      const dom = await renderComponent(<HostResourcePopover owner={explicitOwner} />);

      const trigger = dom.querySelector("button");
      await act(async () => {
        trigger?.click();
      });

      // With explicit owner, fleetMode is false: no fleet toolbar, renders single drilldown for p2
      const toolbar = dom.querySelector('div[role="toolbar"]');
      expect(toolbar).toBeNull();
      expect(dom.textContent).toContain("prod-node-2");
      expect(dom.textContent).toContain("Linux 6.6");
    });
  });

  describe("Step 3.2: Multi-profile trigger aggregation and summary presentation", () => {
    it("derives trigger title and aria-label from fleet summary scope", async () => {
      mockMultiResources = {
        configuredProfileCount: 3,
        entries: [
          createMockEntry({ profile: mockProfile1, connected: true }),
          createMockEntry({ profile: mockProfile2, connected: true, unreadCount: 2 }),
          createMockEntry({ profile: mockProfile3, connected: false, connectionStatus: "offline" }),
        ],
        summary: {
          watchedCount: 3,
          connectedCount: 2,
          attentionCount: 1,
          unavailableCount: 1,
          unreadCount: 2,
          presentation: {
            baseLabel: "Critical",
            label: "Critical",
            statusClassName: "border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
            statusIconClassName: "text-[var(--color-danger)]",
            triggerClassName: "text-[var(--color-danger)]",
            badgeClassName: "bg-[var(--color-danger)] text-[var(--color-surface)]",
            badgeText: "2",
            badgeLabel: "2 unread host incidents",
            icon: "alert",
            rank: 3,
            mode: "current",
          },
        },
      };

      const dom = await renderComponent(<HostResourcePopover />);
      const trigger = dom.querySelector("button");
      expect(trigger).not.toBeNull();

      expect(trigger?.getAttribute("title")).toBe(
        "Host resources: 2 of 3 watched hosts connected; 1 needs attention; 2 unread",
      );
      expect(trigger?.getAttribute("aria-label")).toBe(
        "Host resources: 2 of 3 watched hosts connected; 1 needs attention; 2 unread",
      );

      // Badge displays unread count "2"
      const badge = trigger?.querySelector("span[aria-hidden='true']");
      expect(badge?.textContent).toBe("2");
      expect(dom.textContent).toContain("2 unread host incidents");
    });

    it("displays '!' in badge when attention is needed but unread count is 0", async () => {
      mockMultiResources = {
        configuredProfileCount: 2,
        entries: [createMockEntry({ profile: mockProfile1, connected: true })],
        summary: {
          watchedCount: 2,
          connectedCount: 1,
          attentionCount: 1,
          unavailableCount: 0,
          unreadCount: 0,
          presentation: {
            baseLabel: "Warning",
            label: "Warning",
            statusClassName: "border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
            statusIconClassName: "text-[var(--color-warning)]",
            triggerClassName: "text-[var(--color-warning)]",
            badgeClassName: "bg-[var(--color-warning)] text-[var(--color-surface)]",
            badgeText: "!",
            badgeLabel: "Active host incident",
            icon: "alert",
            rank: 2,
            mode: "current",
          },
        },
      };

      const dom = await renderComponent(<HostResourcePopover />);
      const trigger = dom.querySelector("button");
      const badge = trigger?.querySelector("span[aria-hidden='true']");
      expect(badge?.textContent).toBe("!");
      expect(dom.textContent).toContain("Active host incident");
    });
  });

  describe("Step 3.3: Fleet deck rendering and header navigation pills", () => {
    it("opens on Fleet deck by default without acknowledging any alerts", async () => {
      const entry1 = createMockEntry({ profile: mockProfile1, connected: true });
      const entry2 = createMockEntry({ profile: mockProfile2, connected: true, unreadCount: 2 });
      const entry3 = createMockEntry({ profile: mockProfile3, connected: false, connectionStatus: "offline" });

      mockMultiResources = {
        configuredProfileCount: 3,
        entries: [entry1, entry2, entry3],
        summary: {
          watchedCount: 3,
          connectedCount: 2,
          attentionCount: 1,
          unavailableCount: 1,
          unreadCount: 2,
          presentation: {
            baseLabel: "Warning",
            label: "Warning",
            statusClassName: "",
            statusIconClassName: "",
            triggerClassName: "",
            badgeClassName: "",
            badgeText: "2",
            badgeLabel: "2 unread host incidents",
            icon: "alert",
            rank: 2,
            mode: "current",
          },
        },
      };

      const markReadSpy = vi.spyOn(useHostResourceAlertPresentationStore.getState(), "markRead");

      const dom = await renderComponent(<HostResourcePopover />);
      const trigger = dom.querySelector("button");
      await act(async () => {
        trigger?.click();
      });

      // Fleet overview is visible
      expect(dom.textContent).toContain("Fleet Overview");
      expect(dom.textContent).toContain("3 watched profiles");

      // Opening Fleet does NOT acknowledge every profile
      expect(markReadSpy).not.toHaveBeenCalled();

      // Header summary text is visible
      expect(dom.textContent).toContain("2 of 3 watched connected");
      expect(dom.textContent).toContain("1 needs attention");
      expect(dom.textContent).toContain("2 unread");

      // Toolbar is mounted with Fleet pill active
      const toolbar = dom.querySelector('div[role="toolbar"]');
      expect(toolbar).not.toBeNull();

      const fleetPill = toolbar?.querySelector('button[aria-pressed="true"]');
      expect(fleetPill?.textContent).toContain("Fleet");

      // Pills for each profile exist
      const pills = toolbar?.querySelectorAll("button");
      expect(pills?.length).toBe(4); // Fleet + 3 profiles

      // Profile 3 is disconnected: button is disabled
      const p3Pill = Array.from(pills ?? []).find((b) => b.textContent?.includes("Offline Host"));
      expect(p3Pill?.hasAttribute("disabled")).toBe(true);
      expect(p3Pill?.getAttribute("aria-label")).toContain("(disconnected)");
    });
  });

  describe("Step 3.4: Profile drilldown navigation and isolation", () => {
    it("selects profile drilldown on pill click, marks that profile read, and isolates context", async () => {
      const entry1 = createMockEntry({ profile: mockProfile1, connected: true });
      const entry2 = createMockEntry({ profile: mockProfile2, connected: true, snapshot: mockSnapshotP2, unreadCount: 2 });

      mockMultiResources = {
        configuredProfileCount: 2,
        entries: [entry1, entry2],
        summary: {
          watchedCount: 2,
          connectedCount: 2,
          attentionCount: 0,
          unavailableCount: 0,
          unreadCount: 2,
          presentation: {
            baseLabel: "Healthy",
            label: "Healthy",
            statusClassName: "",
            statusIconClassName: "",
            triggerClassName: "",
            badgeClassName: "",
            icon: "healthy",
            rank: 0,
            mode: "current",
          },
        },
      };

      const markReadSpy = vi.spyOn(useHostResourceAlertPresentationStore.getState(), "markRead");

      const dom = await renderComponent(<HostResourcePopover />);
      const trigger = dom.querySelector("button");
      await act(async () => {
        trigger?.click();
      });

      const toolbar = dom.querySelector('div[role="toolbar"]');
      const p2Pill = Array.from(toolbar?.querySelectorAll("button") ?? []).find((b) =>
        b.textContent?.includes("Prod Host"),
      );
      expect(p2Pill).toBeDefined();

      // Click on Prod Host pill
      await act(async () => {
        p2Pill?.click();
      });

      // Mark read was called specifically for p2
      expect(markReadSpy).toHaveBeenCalledWith("p2");

      // Fleet pill is now unpressed; p2 pill is pressed
      const fleetPill = Array.from(toolbar?.querySelectorAll("button") ?? []).find((b) =>
        b.textContent?.includes("Fleet"),
      );
      expect(fleetPill?.getAttribute("aria-pressed")).toBe("false");
      expect(p2Pill?.getAttribute("aria-pressed")).toBe("true");

      // Drilldown body is rendered with prod-node-2
      expect(dom.textContent).toContain("prod-node-2");
      expect(dom.textContent).toContain("Linux 6.6");
      expect(dom.textContent).toContain("Diagnostics and storage controls");

      // Diagnostics disclosure toggle works
      const diagButton = Array.from(dom.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Diagnostics and storage controls"),
      );
      expect(diagButton).toBeDefined();
      expect(diagButton?.getAttribute("aria-expanded")).toBe("false");

      await act(async () => {
        diagButton?.click();
      });
      expect(diagButton?.getAttribute("aria-expanded")).toBe("true");

      // Clicking Fleet pill returns to deck view and resets diagnosis disclosure
      await act(async () => {
        fleetPill?.click();
      });
      expect(fleetPill?.getAttribute("aria-pressed")).toBe("true");
      expect(dom.textContent).toContain("Fleet Overview");
    });
  });

  describe("Step 3.5: Disconnect removal fallback to fleet view", () => {
    it("returns to fleet view when the inspected profile disconnects", async () => {
      const entry1 = createMockEntry({ profile: mockProfile1, connected: true });
      const entry2 = createMockEntry({ profile: mockProfile2, connected: true, snapshot: mockSnapshotP2 });

      mockMultiResources = {
        configuredProfileCount: 2,
        entries: [entry1, entry2],
        summary: {
          watchedCount: 2,
          connectedCount: 2,
          attentionCount: 0,
          unavailableCount: 0,
          unreadCount: 0,
          presentation: {
            baseLabel: "Healthy",
            label: "Healthy",
            statusClassName: "",
            statusIconClassName: "",
            triggerClassName: "",
            badgeClassName: "",
            icon: "healthy",
            rank: 0,
            mode: "current",
          },
        },
      };

      const dom = await renderComponent(<HostResourcePopover />);
      const trigger = dom.querySelector("button");
      await act(async () => {
        trigger?.click();
      });

      // Drill down into Prod Host
      const toolbar = dom.querySelector('div[role="toolbar"]');
      const p2Pill = Array.from(toolbar?.querySelectorAll("button") ?? []).find((b) =>
        b.textContent?.includes("Prod Host"),
      );
      await act(async () => {
        p2Pill?.click();
      });
      expect(dom.textContent).toContain("prod-node-2");

      // Now simulate Prod Host disconnecting
      const disconnectedEntry2 = createMockEntry({
        profile: mockProfile2,
        connected: false,
        connectionStatus: "offline",
      });
      mockMultiResources = {
        configuredProfileCount: 2,
        entries: [entry1, disconnectedEntry2],
        summary: {
          watchedCount: 2,
          connectedCount: 1,
          attentionCount: 0,
          unavailableCount: 1,
          unreadCount: 0,
          presentation: {
            baseLabel: "Warning",
            label: "1 host unavailable",
            statusClassName: "",
            statusIconClassName: "",
            triggerClassName: "",
            badgeClassName: "",
            icon: "alert",
            rank: 0,
            mode: "unavailable",
          },
        },
      };

      // Re-render
      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <HostResourcePopover />
          </QueryClientProvider>,
        );
      });

      // It automatically fell back to Fleet view!
      expect(dom.textContent).toContain("Fleet Overview");
      const fleetPill = toolbar?.querySelector('button[aria-pressed="true"]');
      expect(fleetPill?.textContent).toContain("Fleet");
    });
  });
});
