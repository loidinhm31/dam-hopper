// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MonitorTray } from "./MonitorTray.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import type { ServerProfile } from "@/api/server-config.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
import type { MultiHostResourceEntry } from "@/lib/host-resource-state.js";

let mockActiveEntry: MultiHostResourceEntry | null = null;
let mockActiveProfile: { id: string; name: string } | null = {
  id: "profile-1",
  name: "Local Host",
};
let mockHostMetrics: { data?: { cpu?: { usagePercent?: number } } } = {
  data: { cpu: { usagePercent: 24 } },
};
let mockIdleStatus: { data?: { state?: string } } = {
  data: { state: "normal" },
};

vi.mock("@/hooks/use-multi-host-resources.js", () => ({
  useMultiHostResources: () => ({
    entries: mockActiveEntry ? [mockActiveEntry] : [],
    summary: {},
    primaryEntry: mockActiveEntry,
  }),
}));

vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => mockActiveProfile,
}));

vi.mock("@/api/queries.js", () => ({
  useHostMetrics: () => mockHostMetrics,
  useIdleSuspendStatus: () => mockIdleStatus,
}));

function createMockEntry(
  battery: MultiHostResourceEntry["snapshot"]["battery"] = null,
  overrides: Partial<MultiHostResourceEntry> = {},
): MultiHostResourceEntry {
  return {
    profile: {
      id: "profile-1",
      name: "Local Host",
      url: "http://localhost:3000",
    } satisfies ServerProfile,
    connected: true,
    isStale: false,
    owner: { profileId: "profile-1", generation: 1 },
    watchReason: "active-profile",
    snapshot: {
      schemaVersion: 1,
      sampleId: "sample-1",
      sampledAt: Date.now(),
      host: { hostname: "hopper-box" },
      capabilities: { linuxDeepMetrics: { state: "available" } },
      memory: {
        totalBytes: 16000000000,
        availableBytes: 8000000000,
        availability: { state: "available" },
      },
      battery,
      pressure: { memory: {} },
      cgroups: [],
    },
    status: { mode: "live" },
    ...overrides,
  };
}

describe("MonitorTray Battery Display", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useCognitoModeStore.getState().reset();
    useHostResourceAlertPresentationStore.getState().reset();
    mockActiveProfile = { id: "profile-1", name: "Local Host" };
    mockHostMetrics = { data: { cpu: { usagePercent: 24 } } };
    mockIdleStatus = { data: { state: "normal" } };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderTray(onOpenMonitor?: (profileId?: string, incidentId?: string) => void) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MonitorTray onOpenMonitor={onOpenMonitor} />
        </QueryClientProvider>,
      );
    });
  }

  it("renders battery percentage and updates aria-label/title when valid battery is present", () => {
    mockActiveEntry = createMockEntry({
      count: 1,
      capacityPercent: 88,
      status: "discharging",
      availability: { state: "available" },
    });

    renderTray();

    const batEl = container.querySelector(
      '[data-testid="os-monitor-tray-battery"]',
    );
    expect(batEl).not.toBeNull();
    expect(batEl?.textContent).toBe("B:88%");
    expect(
      container.querySelector('[data-testid="os-monitor-tray-battery-charging"]'),
    ).toBeNull();

    const mainBtn = container.querySelector(
      '[data-testid="os-monitor-tray"] button:last-child',
    );
    expect(mainBtn?.getAttribute("aria-label")).toContain("BAT 88%");
    expect(mainBtn?.getAttribute("title")).toContain("BAT 88%");
  });

  it("renders charging icon and label when battery is charging", () => {
    mockActiveEntry = createMockEntry({
      count: 1,
      capacityPercent: 92,
      status: "charging",
      availability: { state: "available" },
    });

    renderTray();

    const batEl = container.querySelector(
      '[data-testid="os-monitor-tray-battery"]',
    );
    expect(batEl).not.toBeNull();
    expect(batEl?.textContent).toContain("B:⚡92%");

    const chargingIcon = container.querySelector(
      '[data-testid="os-monitor-tray-battery-charging"]',
    );
    expect(chargingIcon).not.toBeNull();
    expect(chargingIcon?.textContent).toBe("⚡");

    const mainBtn = container.querySelector(
      '[data-testid="os-monitor-tray"] button:last-child',
    );
    expect(mainBtn?.getAttribute("aria-label")).toContain("BAT 92% (Charging)");
    expect(mainBtn?.getAttribute("title")).toContain("BAT 92% (Charging)");
  });

  it("renders full status in aria-label and title when battery status is full", () => {
    mockActiveEntry = createMockEntry({
      count: 1,
      capacityPercent: 100,
      status: "full",
      availability: { state: "available" },
    });

    renderTray();

    const batEl = container.querySelector(
      '[data-testid="os-monitor-tray-battery"]',
    );
    expect(batEl?.textContent).toBe("B:100%");

    const mainBtn = container.querySelector(
      '[data-testid="os-monitor-tray"] button:last-child',
    );
    expect(mainBtn?.getAttribute("aria-label")).toContain("BAT 100% (Full)");
    expect(mainBtn?.getAttribute("title")).toContain("BAT 100% (Full)");
  });

  it("renders 0% correctly without false omission", () => {
    mockActiveEntry = createMockEntry({
      count: 1,
      capacityPercent: 0,
      status: "discharging",
      availability: { state: "available" },
    });

    renderTray();

    const batEl = container.querySelector(
      '[data-testid="os-monitor-tray-battery"]',
    );
    expect(batEl).not.toBeNull();
    expect(batEl?.textContent).toBe("B:0%");
  });

  describe("threshold color classes and boundaries", () => {
    it("applies danger color and font-bold when battery is < 20%", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 19,
        status: "discharging",
        availability: { state: "available" },
      });

      renderTray();

      const batEl = container.querySelector(
        '[data-testid="os-monitor-tray-battery"]',
      );
      const valSpan = batEl?.querySelector("span:last-child");
      expect(valSpan?.className).toContain("text-[var(--color-danger)]");
      expect(valSpan?.className).toContain("font-bold");
    });

    it("applies danger color even when charging if < 20%", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 15,
        status: "charging",
        availability: { state: "available" },
      });

      renderTray();

      const batEl = container.querySelector(
        '[data-testid="os-monitor-tray-battery"]',
      );
      const valSpan = batEl?.querySelector("span:last-child");
      expect(valSpan?.className).toContain("text-[var(--color-danger)]");
      expect(valSpan?.className).toContain("font-bold");
    });

    it("applies warning color and font-bold at exact 20% boundary", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 20,
        status: "discharging",
        availability: { state: "available" },
      });

      renderTray();

      const batEl = container.querySelector(
        '[data-testid="os-monitor-tray-battery"]',
      );
      const valSpan = batEl?.querySelector("span:last-child");
      expect(valSpan?.className).toContain("text-[var(--color-warning)]");
      expect(valSpan?.className).toContain("font-bold");
    });

    it("applies warning color and font-bold at 29%", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 29,
        status: "discharging",
        availability: { state: "available" },
      });

      renderTray();

      const batEl = container.querySelector(
        '[data-testid="os-monitor-tray-battery"]',
      );
      const valSpan = batEl?.querySelector("span:last-child");
      expect(valSpan?.className).toContain("text-[var(--color-warning)]");
      expect(valSpan?.className).toContain("font-bold");
    });

    it("applies normal color at exact 30% boundary", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 30,
        status: "discharging",
        availability: { state: "available" },
      });

      renderTray();

      const batEl = container.querySelector(
        '[data-testid="os-monitor-tray-battery"]',
      );
      const valSpan = batEl?.querySelector("span:last-child");
      expect(valSpan?.className).toContain("text-[var(--color-text)]");
      expect(valSpan?.className).not.toContain("font-bold");
      expect(valSpan?.className).not.toContain("text-[var(--color-danger)]");
      expect(valSpan?.className).not.toContain("text-[var(--color-warning)]");
    });
  });

  describe("stale battery state", () => {
    it("renders dimmed styling and (Stale) annotation when battery availability is stale", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 75,
        status: "discharging",
        availability: { state: "stale" },
      });

      renderTray();

      const batEl = container.querySelector(
        '[data-testid="os-monitor-tray-battery"]',
      );
      expect(batEl).not.toBeNull();
      expect(batEl?.getAttribute("data-stale")).toBe("true");
      expect(batEl?.className).toContain("opacity-60");

      const mainBtn = container.querySelector(
        '[data-testid="os-monitor-tray"] button:last-child',
      );
      expect(mainBtn?.getAttribute("aria-label")).toContain("BAT 75% (Stale)");
      expect(mainBtn?.getAttribute("title")).toContain("BAT 75% (Stale)");
    });
  });

  describe("omission of battery when unsupported, absent, or invalid", () => {
    it("omits B: meter completely when battery is null or undefined", () => {
      mockActiveEntry = createMockEntry(null);
      renderTray();

      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
      const mainBtn = container.querySelector(
        '[data-testid="os-monitor-tray"] button:last-child',
      );
      expect(mainBtn?.getAttribute("aria-label")).not.toContain("BAT");
      expect(mainBtn?.getAttribute("title")).not.toContain("BAT");

      mockActiveEntry = createMockEntry(undefined);
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
    });

    it("omits B: meter when count is 0", () => {
      mockActiveEntry = createMockEntry({
        count: 0,
        capacityPercent: 80,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();

      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
    });

    it("omits B: meter when count is negative or fractional", () => {
      mockActiveEntry = createMockEntry({
        count: -1,
        capacityPercent: 80,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1.5,
        capacityPercent: 80,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
    });

    it("omits B: meter when availability state is unsupported or unavailable", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 80,
        status: "discharging",
        availability: { state: "unsupported" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 80,
        status: "discharging",
        availability: { state: "unavailable" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
    });

    it("omits B: meter when capacityPercent is null, NaN, or out of [0, 100] bounds", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: null,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: NaN,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: -1,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 101,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 100.4,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();

      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: Infinity,
        status: "discharging",
        availability: { state: "available" },
      });
      renderTray();
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
    });
  });

  describe("Cognito mode masking", () => {
    it("masks battery along with CPU/MEM and hides telemetry from title/aria-label", () => {
      mockActiveEntry = createMockEntry({
        count: 1,
        capacityPercent: 85,
        status: "discharging",
        availability: { state: "available" },
      });

      renderTray();

      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).not.toBeNull();

      // Dynamically toggle Cognito mode ON
      act(() => {
        useCognitoModeStore.getState().toggle("KeyC");
      });

      const mainBtn = container.querySelector(
        '[data-testid="os-monitor-tray"] button:last-child',
      );
      expect(mainBtn?.textContent).toContain("PROTECTED");
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
      expect(mainBtn?.getAttribute("aria-label")).toBe(
        "System Monitor Tray (Protected)",
      );
      expect(mainBtn?.getAttribute("title")).toBe("System Monitor: Protected");

      // Dynamically toggle Cognito mode OFF
      act(() => {
        useCognitoModeStore.getState().toggle("KeyC");
      });

      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).not.toBeNull();
      expect(mainBtn?.getAttribute("aria-label")).toContain("BAT 85%");
    });
  });

  describe("disconnected host handling", () => {
    it("preserves offline label and does not render meters when disconnected", () => {
      mockActiveEntry = createMockEntry(
        {
          count: 1,
          capacityPercent: 85,
          status: "discharging",
          availability: { state: "available" },
        },
        { connected: false },
      );

      renderTray();

      const mainBtn = container.querySelector(
        '[data-testid="os-monitor-tray"] button:last-child',
      );
      expect(mainBtn?.textContent).toContain("Offline");
      expect(
        container.querySelector('[data-testid="os-monitor-tray-battery"]'),
      ).toBeNull();
      expect(mainBtn?.getAttribute("aria-label")).not.toContain("BAT");
      expect(mainBtn?.getAttribute("title")).not.toContain("BAT");
    });
  });
});
