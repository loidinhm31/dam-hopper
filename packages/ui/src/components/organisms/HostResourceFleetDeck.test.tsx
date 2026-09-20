// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostResourceSnapshotV1 } from "@/api/client.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { MultiHostResourceEntry } from "@/hooks/use-multi-host-resources.js";
import { resolveHostResourceEntryStatus } from "@/lib/host-resource-state.js";
import { HostResourceFleetDeck } from "./HostResourceFleetDeck.js";

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

const mockSnapshot: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "s-1",
  sampledAt: Date.now() - 10_000,
  host: { hostname: "host-1", osName: "Linux" },
  capabilities: { linuxDeepMetrics: { state: "available", sampledAt: 1 } },
  memory: {
    totalBytes: 8 * 1024 ** 3,
    availableBytes: 6 * 1024 ** 3,
    availability: { state: "available", sampledAt: 1 },
  },
  pressure: { memory: { someAvg10: 0, someAvg60: 0, someAvg300: 0, fullAvg10: 0, fullAvg60: 0, fullAvg300: 0 } },
  cgroups: [],
  processes: { processes: [] },
  alert: { state: "healthy", severity: "info", updatedAt: 1, durationSeconds: 0, scope: "host", confidence: "high", threshold: "none", evidence: { cgroupOomDelta: false }, nextAction: "None" },
  currentAlerts: [],
};

function createEntry(id: string, name: string, overrides: Partial<MultiHostResourceEntry> = {}): MultiHostResourceEntry {
  const profile: ServerProfile = {
    id,
    name,
    url: `http://${id}.local:4801`,
    authType: "none",
    createdAt: 1000,
  };
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
    profile,
    owner: { profileId: id, generation: 1 },
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

describe("HostResourceFleetDeck", () => {
  it("renders empty state when no entries are provided", () => {
    const markup = renderToStaticMarkup(
      <HostResourceFleetDeck entries={[]} onInspect={vi.fn()} />,
    );

    expect(markup).toContain("Fleet Overview");
    expect(markup).toContain("0 watched profiles");
    expect(markup).toContain("No connected or auto-connect profiles to watch.");
  });

  it("renders ordered list of watched profile cards matching entries order", async () => {
    const onInspect = vi.fn();
    const entry1 = createEntry("p-1", "Alpha Node");
    const entry2 = createEntry("p-2", "Beta Node");
    const entry3 = createEntry("p-3", "Gamma Node");

    const dom = await render(
      <HostResourceFleetDeck
        entries={[entry1, entry2, entry3]}
        selectedProfileId="p-2"
        onInspect={onInspect}
      />,
    );

    expect(dom.textContent).toContain("3 watched profiles");

    const listItems = dom.querySelectorAll("ul[role='list'] > li");
    expect(listItems.length).toBe(3);

    expect(listItems[0]?.textContent).toContain("Alpha Node");
    expect(listItems[1]?.textContent).toContain("Beta Node");
    expect(listItems[2]?.textContent).toContain("Gamma Node");

    // Check selected state applied to Beta Node
    const betaCard = listItems[1]?.querySelector("article");
    expect(betaCard?.className).toContain("ring-2");
    expect(betaCard?.className).toContain("border-[var(--color-primary)]");

    const alphaCard = listItems[0]?.querySelector("article");
    expect(alphaCard?.className).not.toContain("ring-2");

    // Clicking inspect on Alpha Node calls onInspect with p-1
    const alphaButton = listItems[0]?.querySelector("button");
    act(() => {
      alphaButton?.click();
    });
    expect(onInspect).toHaveBeenCalledWith("p-1");
  });

  it("coexists healthy, warning, and offline cards without cross-profile interference", () => {
    const healthyEntry = createEntry("p-1", "Healthy Host", { connected: true });
    const offlineEntry = createEntry("p-2", "Offline Host", {
      connected: false,
      connectionStatus: "offline",
      watchReason: "auto-connect",
      snapshot: undefined,
    });

    const markup = renderToStaticMarkup(
      <HostResourceFleetDeck
        entries={[healthyEntry, offlineEntry]}
        onInspect={vi.fn()}
      />,
    );

    expect(markup).toContain("2 watched profiles");
    expect(markup).toContain("Healthy Host");
    expect(markup).toContain("Connected");
    expect(markup).toContain("Offline Host");
    expect(markup).toContain("Offline · Auto-connect");
    expect(markup).toContain("Connect profile to inspect live resources");
  });
});
