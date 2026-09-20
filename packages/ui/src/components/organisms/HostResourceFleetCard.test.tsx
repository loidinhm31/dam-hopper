// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostResourceSnapshotV1 } from "@/api/client.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { MultiHostResourceEntry } from "@/hooks/use-multi-host-resources.js";
import { resolveHostResourceEntryStatus } from "@/lib/host-resource-state.js";
import { HostResourceFleetCard } from "./HostResourceFleetCard.js";
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

async function render(element: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
  return container;
}

const mockProfile: ServerProfile = {
  id: "profile-1",
  name: "Local Dev Host",
  url: "http://127.0.0.1:4801",
  authType: "none",
  autoConnect: true,
  createdAt: 1000,
};

const mockSnapshot: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "s-1",
  sampledAt: Date.now() - 30_000,
  host: {
    hostname: "hopper-node-1",
    osName: "Linux 6.1",
  },
  capabilities: { linuxDeepMetrics: { state: "available", sampledAt: 1 } },
  memory: {
    totalBytes: 16 * 1024 ** 3,
    availableBytes: 12 * 1024 ** 3,
    availability: { state: "available", sampledAt: 1 },
  },
  battery: {
    count: 1,
    capacityPercent: 88,
    status: "discharging",
  },
  pressure: {
    memory: { someAvg10: 0, someAvg60: 0, someAvg300: 0, fullAvg10: 0, fullAvg60: 0, fullAvg300: 0 },
  },
  cgroups: [],
  processes: { processes: [] },
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

function createEntry(overrides: Partial<MultiHostResourceEntry> = {}): MultiHostResourceEntry {
  const connected = overrides.connected ?? true;
  const connectionStatus = overrides.connectionStatus ?? (connected ? "connected" : "offline");
  const snapshot = overrides.snapshot !== undefined ? overrides.snapshot : mockSnapshot;
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
    profile: overrides.profile ?? mockProfile,
    owner: { profileId: overrides.profile?.id ?? mockProfile.id, generation: 1 },
    connectionStatus,
    connected,
    watchReason: overrides.watchReason ?? (connected ? "connected" : "auto-connect"),
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

describe("HostResourceFleetCard", () => {
  it("renders a connected card with inspect button and 44px touch target", async () => {
    const onInspect = vi.fn();
    const entry = createEntry({ connected: true });

    const dom = await render(
      <HostResourceFleetCard entry={entry} onInspect={onInspect} />,
    );

    const button = dom.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toContain(
      "Inspect host resources for Local Dev Host: Healthy",
    );
    expect(button?.className).toContain("min-h-11");

    expect(dom.textContent).toContain("Local Dev Host");
    expect(dom.textContent).toContain("http://127.0.0.1:4801");
    expect(dom.textContent).toContain("Connected");
    expect(dom.textContent).toContain("Healthy");
    expect(dom.textContent).toContain("hopper-node-1 · Linux 6.1");
    expect(dom.textContent).toContain("Memory: 25%");
    expect(dom.textContent).toContain("Battery: 88% · Discharging");

    act(() => {
      button?.click();
    });
    expect(onInspect).toHaveBeenCalledWith("profile-1");
  });

  it("renders a non-connected card as a non-interactive article with explanation", async () => {
    const onInspect = vi.fn();
    const entry = createEntry({
      connected: false,
      connectionStatus: "offline",
      watchReason: "auto-connect",
      snapshot: undefined,
    });

    const dom = await render(
      <HostResourceFleetCard entry={entry} onInspect={onInspect} />,
    );

    const button = dom.querySelector("button");
    expect(button).toBeNull();
    expect(dom.querySelector("[role='button']")).toBeNull();

    expect(dom.textContent).toContain("Offline · Auto-connect");
    expect(dom.textContent).toContain("Connect profile to inspect live resources");
  });

  it("prefixes sample age and status with 'Last known' when disconnected with cached snapshot", () => {
    const entry = createEntry({
      connected: false,
      connectionStatus: "offline",
      watchReason: "auto-connect",
      snapshot: mockSnapshot,
    });

    const markup = renderToStaticMarkup(
      <HostResourceFleetCard entry={entry} onInspect={vi.fn()} />,
    );

    expect(markup).toContain("Last known · sampled");
    expect(markup).toContain("last known (offline)");
  });

  it("omits memory and battery when unavailable without showing false zeros", () => {
    const snapshotWithoutMetrics: HostResourceSnapshotV1 = {
      ...mockSnapshot,
      memory: {
        totalBytes: null,
        availableBytes: null,
        availability: { state: "unsupported" },
      },
      battery: null,
    };

    const entry = createEntry({
      snapshot: snapshotWithoutMetrics,
    });

    const markup = renderToStaticMarkup(
      <HostResourceFleetCard entry={entry} onInspect={vi.fn()} />,
    );

    expect(markup).not.toContain("Memory:");
    expect(markup).not.toContain("Battery:");
    expect(markup).not.toContain("0%");
  });

  it("displays unread count badge when unread incidents exist", () => {
    const entry = createEntry({
      unreadCount: 3,
    });

    const markup = renderToStaticMarkup(
      <HostResourceFleetCard entry={entry} onInspect={vi.fn()} />,
    );

    expect(markup).toContain("3 unread");
  });

  it("applies selected ring when selected prop is true", () => {
    const entry = createEntry();

    const unselectedMarkup = renderToStaticMarkup(
      <HostResourceFleetCard entry={entry} selected={false} onInspect={vi.fn()} />,
    );
    expect(unselectedMarkup).not.toContain("ring-2");

    const selectedMarkup = renderToStaticMarkup(
      <HostResourceFleetCard entry={entry} selected={true} onInspect={vi.fn()} />,
    );
    expect(selectedMarkup).toContain("ring-2");
    expect(selectedMarkup).toContain("border-[var(--color-primary)]");
  });

  it("safely handles long unbroken profile names and URLs with text wrapping", () => {
    const longProfile: ServerProfile = {
      id: "long-id-1234567890",
      name: "VeryLongServerProfileNameWithoutSpacesThatCouldOverflowAContainer",
      url: "https://extremely-long-domain-name-subdomain-something.region.service.example.internal:8080",
      authType: "none",
      createdAt: 1000,
    };
    const entry = createEntry({ profile: longProfile });

    const markup = renderToStaticMarkup(
      <HostResourceFleetCard entry={entry} onInspect={vi.fn()} />,
    );

    expect(markup).toContain("[overflow-wrap:anywhere]");
    expect(markup).toContain("break-words");
    expect(markup).toContain(longProfile.name);
    expect(markup).toContain(longProfile.url);
  });
});
