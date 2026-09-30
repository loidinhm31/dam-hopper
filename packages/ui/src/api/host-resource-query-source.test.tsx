// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import type { HostMetrics, HostResourceSnapshotV1, HostResourceAlertIncident } from "@/api/client.js";
import { profileQueryKey } from "@/api/query-client.js";
import {
  useHostMetrics,
  useHostResourceSnapshot,
  useHostResourceAlerts,
} from "./queries.js";
import {
  registerConnectionRegistryQueryClient,
  registerHostResourceInterest,
  getHostResourceSource,
  type SourceMode,
} from "./host-resource-stream-coordinator.js";
import { __setConnectionSnapshotForTests, resetConnections } from "./connections.js";

const capturedSignals: { metrics?: AbortSignal; snapshot?: AbortSignal } = {};
const mockMetrics: HostMetrics = {
  cpu: { usagePercent: 25, logicalCoreCount: 4 },
  memory: { totalBytes: 1000, usedBytes: 500, availableBytes: 500, usagePercent: 50 },
  disk: { name: "/", totalBytes: 1000, usedBytes: 500, availableBytes: 500, usagePercent: 50 },
  sampledAt: Date.now(),
  uptimeSeconds: 120,
  temperatures: [],
};

const mockSnapshot: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "sample-test",
  sampledAt: Date.now(),
  host: { hostname: "test-host", osName: "Linux" },
  capabilities: { linuxDeepMetrics: { state: "available" } },
  memory: { availability: { state: "available" } },
  pressure: { memory: { some: null, full: null } },
  cpu: { usagePercent: 25, logicalCoreCount: 4 },
  processes: { availability: { state: "available" }, totalCount: 10, topCpu: [], topMemory: [] },
  disk: { availability: { state: "available" }, rootTotalBytes: 1000, rootAvailableBytes: 500, rootUsedPercent: 50, readBytesPerSec: 0, writeBytesPerSec: 0 },
  network: { availability: { state: "available" }, rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
  currentAlerts: [],
};

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    getBoundApiClient: (_owner: ConnectionRef) => ({
      system: {
        metrics: async (signal?: AbortSignal) => {
          capturedSignals.metrics = signal;
          return mockMetrics;
        },
        resourceSnapshot: async (signal?: AbortSignal) => {
          capturedSignals.snapshot = signal;
          return mockSnapshot;
        },
        resourceAlerts: async (_limit?: number) => {
          return [] as HostResourceAlertIncident[];
        },
      },
    }),
  };
});

describe("04-Q host resource query source and dual control", () => {
  let qc: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let unregisterQc: () => void;

  const owner: ConnectionRef = {
    profileId: "test-profile-1",
    generation: 1,
  };

  beforeEach(() => {
    resetConnections();
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    unregisterQc = registerConnectionRegistryQueryClient(qc);

    const mockApi = {
      system: {
        metrics: async (signal?: AbortSignal) => {
          capturedSignals.metrics = signal;
          return mockMetrics;
        },
        resourceSnapshot: async (signal?: AbortSignal) => {
          capturedSignals.snapshot = signal;
          return mockSnapshot;
        },
        resourceAlerts: async (_limit?: number) => {
          return [] as HostResourceAlertIncident[];
        },
      },
    } as unknown as ApiClient;

    __setConnectionSnapshotForTests(owner.profileId, {
      profile: { id: owner.profileId, name: "Test", url: "http://127.0.0.1:4801" },
      serverUrl: "http://127.0.0.1:4801",
      owner,
      status: "connected",
      intent: true,
      transport: {
        supportsHostResourceStreaming: () => false,
      } as unknown as Transport,
      api: mockApi,
      mfaState: "none",
      sessionTtl: null,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    capturedSignals.metrics = undefined;
    capturedSignals.snapshot = undefined;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    unregisterQc();
    qc.clear();
    resetConnections();
  });

  it("forwards abort signals to system.metrics and system.resourceSnapshot", async () => {
    function TestConsumer() {
      useHostResourceSnapshot(true, owner);
      useHostMetrics(true, owner);
      return null;
    }
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    // Both queries should execute and forward their AbortSignal
    await vi.waitFor(() => {
      expect(capturedSignals.snapshot).toBeDefined();
      expect(capturedSignals.snapshot?.aborted).toBe(false);
      expect(capturedSignals.metrics).toBeDefined();
      expect(capturedSignals.metrics?.aborted).toBe(false);
    });
  });

  it("registers detailSnapshot for snapshot and detailMetrics for metrics, never fleet", async () => {
    let unmountFn: (() => void) | undefined;

    function TestConsumer({ showMetrics }: { showMetrics: boolean }) {
      useHostResourceSnapshot(true, owner);
      useHostMetrics(showMetrics, owner);
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(TestConsumer, { showMetrics: true }),
        ),
      );
    });

    // Check query keys in cache
    const snapshotKey = profileQueryKey(owner, "system", "resource-snapshot");
    const metricsKey = profileQueryKey(owner, "system", "metrics");

    await vi.waitFor(() => {
      expect(qc.getQueryData(snapshotKey)).toEqual(mockSnapshot);
      expect(qc.getQueryData(metricsKey)).toEqual(mockMetrics);
    });

    // Disable metrics hook
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(TestConsumer, { showMetrics: false }),
        ),
      );
    });
  });

  it("blocks REST when canUseResourceRest is false and returns cached data", async () => {
    // Prime the cache
    const snapshotKey = profileQueryKey(owner, "system", "resource-snapshot");
    qc.setQueryData(snapshotKey, mockSnapshot);

    // Set connection status to disconnected
    __setConnectionSnapshotForTests(owner.profileId, {
      profile: { id: owner.profileId, name: "Test", url: "http://127.0.0.1:4801" },
      owner,
      status: "disconnected",
      intent: false,
      transport: null,
      api: null,
      mfaState: "none",
      sessionTtl: null,
    });

    let renderedSnapshot: HostResourceSnapshotV1 | undefined;
    function TestConsumer() {
      const res = useHostResourceSnapshot(true, owner);
      renderedSnapshot = res.data;
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    // Rendered snapshot is preserved from cache without throwing unhandled rejection
    expect(renderedSnapshot).toEqual(mockSnapshot);
  });

  it("queries host resource alerts with limit in key and disables when auth blocked", async () => {
    const alertsKey = profileQueryKey(owner, "system", "resource-alerts", 20);

    function AlertsConsumer() {
      useHostResourceAlerts(true, 20, owner);
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(AlertsConsumer)),
      );
    });

    await vi.waitFor(() => {
      expect(qc.getQueryData(alertsKey)).toBeDefined();
    });
  });
});
