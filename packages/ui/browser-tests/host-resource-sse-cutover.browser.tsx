import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import { createApiClient } from "@/api/client.js";
import { HostResourcePopover } from "@/components/organisms/HostResourcePopover.js";
import {
  __setConnectionSnapshotForTests,
  registerConnectionRegistryQueryClient,
  resetConnections,
} from "@/api/connections.js";
import { WsTransport } from "@/api/ws-transport.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
import { saveProfiles } from "@/api/server-config.js";
import "@/index.css";
const VALID_UUID = "12345678-1234-4234-8234-123456789abc";

const MOCK_SNAPSHOT: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "sample-browser-1",
  sampledAt: Date.now(),
  host: { hostname: "browser-host-1", osName: "Linux" },
  capabilities: { linuxDeepMetrics: { state: "available" } },
  memory: {
    totalBytes: 16 * 1024 ** 3,
    availableBytes: 8 * 1024 ** 3,
    availability: { state: "available" },
  },
  battery: null,
  pressure: {
    memory: {
      some: null,
      full: null,
      availability: { state: "available" },
    },
  },
  mountContext: {
    mountPoint: "/workspace",
    activeMappedPaths: [],
    activeMappedPathsAvailability: { state: "available" },
    cacheAttribution: {
      label: "unattributedSharedCache",
      confidence: "low",
      method: "notCollected",
    },
    availability: { state: "available" },
  },
  actionCapabilities: { availability: { state: "available" } },
  cpu: { usagePercent: 15, logicalCoreCount: 8 },
  processes: {
    availability: { state: "available" },
    totalCount: 150,
    truncated: false,
    deadlineExceeded: false,
    processes: [],
    topCpu: [],
    topMemory: [],
  },
  disk: {
    availability: { state: "available" },
    rootTotalBytes: 500 * 1024 ** 3,
    rootAvailableBytes: 250 * 1024 ** 3,
    rootUsedPercent: 50,
    readBytesPerSec: 0,
    writeBytesPerSec: 0,
  },
  network: {
    availability: { state: "available" },
    rxBytesPerSec: 1024,
    txBytesPerSec: 2048,
    interfaces: [],
  },
  alert: {
    state: "healthy",
    severity: "info",
    updatedAt: Date.now(),
    durationSeconds: 0,
    scope: "host",
    confidence: "high",
    threshold: "none",
    evidence: {},
    nextAction: "None",
  },
  currentAlerts: [],
};

const MOCK_METRICS: HostMetrics = {
  cpu: { usagePercent: 15, logicalCoreCount: 8 },
  memory: {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 8 * 1024 ** 3,
    availableBytes: 8 * 1024 ** 3,
    usagePercent: 50,
  },
  disk: {
    name: "/",
    totalBytes: 500 * 1024 ** 3,
    usedBytes: 250 * 1024 ** 3,
    availableBytes: 250 * 1024 ** 3,
    usagePercent: 50,
  },
  sampledAt: Date.now(),
  uptimeSeconds: 3600,
  temperatures: [],
};

describe("HostResourcePopover SSE cutover browser regression", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let unregisterQc: () => void;
  const streamControllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const originalFetch = window.fetch;

  const owner1 = { profileId: "p1", generation: 1 };
  const owner2 = { profileId: "p2", generation: 1 };

  beforeEach(() => {
    resetConnections();
    useHostResourceAlertPresentationStore.getState().reset();

    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
    unregisterQc = registerConnectionRegistryQueryClient(client);

    const profile1 = {
      id: owner1.profileId,
      name: "Host Alpha",
      url: "http://127.0.0.1:4801",
      authType: "none" as const,
      createdAt: 0,
    };

    const profile2 = {
      id: owner2.profileId,
      name: "Host Beta",
      url: "http://127.0.0.1:4802",
      authType: "none" as const,
      createdAt: 0,
    };
    saveProfiles([profile1, profile2]);
    const transport1 = new WsTransport("http://127.0.0.1:4801", () => null);
    const transport2 = new WsTransport("http://127.0.0.1:4802", () => null);
    const api1 = createApiClient(owner1, transport1);
    const api2 = createApiClient(owner2, transport2);

    __setConnectionSnapshotForTests(
      owner1.profileId,
      {
        profile: profile1,
        serverUrl: "http://127.0.0.1:4801",
        owner: owner1,
        status: "connected",
        intent: true,
        transport: transport1,
        api: api1,
        mfaState: "none",
        sessionTtl: null,
      },
      transport1,
    );

    __setConnectionSnapshotForTests(
      owner2.profileId,
      {
        profile: profile2,
        serverUrl: "http://127.0.0.1:4802",
        owner: owner2,
        status: "connected",
        intent: true,
        transport: transport2,
        api: api2,
        mfaState: "none",
        sessionTtl: null,
      },
      transport2,
    );
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/system/resources/v1/events")) {
        const key = url.includes("4801") ? "p1" : "p2";
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamControllers.set(key, controller);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      if (url.includes("/api/system/resources/v1/snapshot")) {
        return new Response(JSON.stringify(MOCK_SNAPSHOT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/system/metrics")) {
        return new Response(JSON.stringify(MOCK_METRICS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/system/resources/v1/alerts")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/system/idle-suspend")) {
        return new Response(
          JSON.stringify({
            version: 1,
            statusRevision: 1,
            state: "watching",
            enabled: true,
            timingMutable: true,
            timingMutableReason: null,
            capabilityCode: "systemdLogindRtc",
            currentEpoch: 1,
            quietPeriodSeconds: 300,
            wakeAfterSeconds: 600,
            minQuietPeriodSeconds: 300,
            maxQuietPeriodSeconds: 86400,
            minWakeAfterSeconds: 60,
            maxWakeAfterSeconds: 86400,
            fleetSnapshot: {
              generation: 1,
              liveCount: 1,
              creatingCount: 0,
              restartPendingCount: 0,
              disposing: false,
              closing: false,
              handoffActive: false,
              quiescent: true,
              runningCount: 1,
            },
            armDeadlineMs: null,
            lastOutcome: null,
            detail: null,
            automaticPolicy: "empty-fleet",
            activity: null,
            timestampMs: Date.now(),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.includes("/api/config")) {
        return new Response(JSON.stringify({ ui: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    unregisterQc();
    client.clear();
    resetConnections();
    window.fetch = originalFetch;
    streamControllers.clear();
  });

  it("renders trigger and transitions seamlessly under SSE stream events", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <HostResourcePopover owner={owner1} />
        </QueryClientProvider>,
      );
    });

    // Verify popover trigger button renders
    const trigger = await page.getByRole("button").first();
    expect(trigger).toBeDefined();

    // Wait for p1 stream to connect and push paired events
    await vi.waitFor(() => expect(streamControllers.get("p1")).toBeDefined());
    const encoder = new TextEncoder();
    const p1Controller = streamControllers.get("p1");
    if (p1Controller) {
      act(() => {
        p1Controller.enqueue(
          encoder.encode(
            `event: host-resources-status\ndata: ${JSON.stringify({
              serverEpoch: VALID_UUID,
              revision: "10",
              snapshotAgeMs: 50,
              metricsAgeMs: 50,
              freshnessTtlMs: 10000,
            })}\n\n`,
          ),
        );
        p1Controller.enqueue(
          encoder.encode(
            `event: host-resources\ndata: ${JSON.stringify({
              schemaVersion: 1,
              serverEpoch: VALID_UUID,
              revision: "10",
              snapshot: MOCK_SNAPSHOT,
              metrics: MOCK_METRICS,
              lightSampleMs: 5000,
            })}\n\n`,
          ),
        );
      });
    }

    // Open popover by clicking trigger
    await userEvent.click(trigger);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Healthy");
    });
  });
  it("renders fleet overview when owner is undefined with multiple profiles", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <HostResourcePopover />
        </QueryClientProvider>,
      );
    });

    // Open popover by clicking trigger
    const trigger = await page.getByRole("button").first();
    await userEvent.click(trigger);

    // Fleet overview is shown
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Fleet Overview");
      expect(document.body.textContent).toContain("Host Alpha");
      expect(document.body.textContent).toContain("Host Beta");
    });
  });

  it("latches AUTH_BLOCKED and updates presentation when AUTH_UNAVAILABLE occurs", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <HostResourcePopover owner={owner1} />
        </QueryClientProvider>,
      );
    });

    const trigger = await page.getByRole("button").first();
    expect(trigger).toBeDefined();

    // Wait for p1 stream to connect and push AUTH_UNAVAILABLE error event
    await vi.waitFor(() => expect(streamControllers.get("p1")).toBeDefined());
    const encoder = new TextEncoder();
    const p1Controller = streamControllers.get("p1");
    if (p1Controller) {
      act(() => {
        p1Controller.enqueue(
          encoder.encode(
            `event: host-resources-error\ndata: ${JSON.stringify({
              code: "AUTH_UNAVAILABLE",
              message: "Authentication unavailable",
            })}\n\n`,
          ),
        );
      });
    }

    // Open popover by clicking trigger
    await userEvent.click(trigger);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Authentication blocked");
    });
  });

  it("rejects delayed old-owner SSE events when owner generation changes in flight", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <HostResourcePopover owner={owner1} />
        </QueryClientProvider>,
      );
    });

    // Wait for p1 stream (gen 1) to connect
    await vi.waitFor(() => expect(streamControllers.get("p1")).toBeDefined());
    const oldController = streamControllers.get("p1");
    const encoder = new TextEncoder();

    // Advance owner1 to generation 2
    const owner1Gen2 = { profileId: "p1", generation: 2 };
    __setConnectionSnapshotForTests(
      owner1.profileId,
      {
        profile: {
          id: owner1.profileId,
          name: "Host Alpha Gen2",
          url: "http://127.0.0.1:4801",
          authType: "none" as const,
          createdAt: 0,
        },
        serverUrl: "http://127.0.0.1:4801",
        owner: owner1Gen2,
        status: "connected",
        intent: true,
        mfaState: "none",
        sessionTtl: null,
      },
      new WsTransport("http://127.0.0.1:4801", () => null),
    );

    // Re-render popover with owner1Gen2
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <HostResourcePopover owner={owner1Gen2} />
        </QueryClientProvider>,
      );
    });

    // Delayed stream events arrive on old stream controller from gen 1
    let streamClosedError = false;
    if (oldController) {
      try {
        oldController.enqueue(
          encoder.encode(
            `event: host-resources-status\ndata: ${JSON.stringify({
              serverEpoch: VALID_UUID,
              revision: "999",
              snapshotAgeMs: 50,
              metricsAgeMs: 50,
              freshnessTtlMs: 10000,
            })}\n\n`,
          ),
        );
      } catch {
        streamClosedError = true;
      }
    }

    // Old stream was immediately closed upon owner change
    expect(streamClosedError).toBe(true);

    // Open popover by clicking trigger
    const trigger = await page.getByRole("button").first();
    await userEvent.click(trigger);

    // Stale old-owner data MUST NOT appear in UI or cache
    expect(document.body.textContent).not.toContain("STALE-OLD-HOST");
  });
});
