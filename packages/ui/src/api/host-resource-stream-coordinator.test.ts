import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "./connections.js";
import type { DataFrame, StatusFrame } from "./host-resource-sse-codec.js";
import {
  canUseResourceRest,
  captureResourceSource,
  cleanupCoordinatorsForQueryClient,
  cleanupCoordinatorsForOwner,
  getHostResourceSource,
  isQueryClientRegistered,
  isResourceSourceCurrent,
  registerConnectionRegistryQueryClient,
  registerHostResourceInterest,
  subscribeHostResourceSource,
  switchToHostResourceFrame,
  HostResourceStreamCoordinator,
  type QueryClient,
} from "./host-resource-stream-coordinator.js";
import { WsTransport } from "./ws-transport.js";

const VALID_UUID = "12345678-1234-4234-8234-123456789abc";

const MOCK_FRAME: DataFrame = {
  kind: "data",
  schemaVersion: 1,
  serverEpoch: VALID_UUID,
  revision: "10",
  revisionBigInt: 10n,
  snapshot: {
    schemaVersion: 1,
    sampleId: "sample-1",
    sampledAt: Date.now(),
    host: {},
    capabilities: { linuxDeepMetrics: "available" },
    memory: { availability: "available" },
    pressure: { memory: { some: null, full: null } },
    cpu: { usagePercent: 10, logicalCoreCount: 4 },
    processes: {
      availability: "available",
      totalCount: 100,
      topCpu: [],
      topMemory: [],
    },
    disk: {
      availability: "available",
      rootTotalBytes: 1000,
      rootAvailableBytes: 500,
      rootUsedPercent: 50,
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
    },
    network: {
      availability: "available",
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      interfaces: [],
    },
    currentAlerts: [],
  },
  metrics: {
    sampledAt: Date.now(),
    uptimeSeconds: 100,
    cpu: { usagePercent: 10, logicalCoreCount: 4 },
    memory: {
      totalBytes: 1000,
      usedBytes: 500,
      availableBytes: 500,
      usagePercent: 50,
    },
    disk: {
      name: "/",
      totalBytes: 1000,
      usedBytes: 500,
      availableBytes: 500,
      usagePercent: 50,
    },
    temperatures: [],
  },
  lightSampleMs: 5000,
};

const MOCK_FRAME_WIRE = {
  schemaVersion: 1,
  serverEpoch: VALID_UUID,
  revision: "10",
  snapshot: MOCK_FRAME.snapshot,
  metrics: MOCK_FRAME.metrics,
  lightSampleMs: 5000,
};

const MOCK_STATUS_WIRE = {
  serverEpoch: VALID_UUID,
  revision: "10",
  snapshotAgeMs: 50,
  metricsAgeMs: 50,
  freshnessTtlMs: 10000,
};

const MOCK_STATUS: StatusFrame = {
  kind: "status",
  serverEpoch: VALID_UUID,
  revision: "10",
  revisionBigInt: 10n,
  snapshotAgeMs: 50,
  metricsAgeMs: 50,
  freshnessTtlMs: 10000,
};

describe("HostResourceStreamCoordinator (03-I)", () => {
  let mockQc: QueryClient;

  beforeEach(() => {
    resetConnections();
    mockQc = {};
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanupCoordinatorsForQueryClient(mockQc);
    resetConnections();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("registerConnectionRegistryQueryClient reference counts and deregisters at 0", () => {
    expect(isQueryClientRegistered(mockQc)).toBe(false);

    const dispose1 = registerConnectionRegistryQueryClient(mockQc);
    expect(isQueryClientRegistered(mockQc)).toBe(true);

    const dispose2 = registerConnectionRegistryQueryClient(mockQc);
    expect(isQueryClientRegistered(mockQc)).toBe(true);

    dispose1();
    expect(isQueryClientRegistered(mockQc)).toBe(true);

    dispose2();
    expect(isQueryClientRegistered(mockQc)).toBe(false);
  });

  it("shares one coordinator for concurrent fleet and detail observers on the same QC", () => {
    const deregisterQc = registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    const mockTransport = new WsTransport("http://localhost:4800");
    vi.spyOn(mockTransport, "openHostResourceEvents").mockReturnValue(
      Promise.withResolvers<never>().promise,
    );
    __setConnectionSnapshotForTests(
      "p1",
      {
        owner,
        status: "connected",
      },
      mockTransport,
    );

    const unregFleet = registerHostResourceInterest(owner, mockQc, "fleet");
    const unregDetail = registerHostResourceInterest(owner, mockQc, "detailSnapshot");

    const snap1 = getHostResourceSource(owner, mockQc);
    expect(snap1.mode).toBe("STARTING");

    unregFleet();
    // Still has detail interest -> remains active
    const snap2 = getHostResourceSource(owner, mockQc);
    expect(snap2.mode).toBe("STARTING");

    unregDetail();
    // All interest dropped -> transitions to STOPPED
    const snap3 = getHostResourceSource(owner, mockQc);
    expect(snap3.mode).toBe("STOPPED");

    deregisterQc();
  });

  it("canUseResourceRest enforces shared REST predicate conditions", () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    const mockTransport = new WsTransport("http://localhost:4800");
    vi.spyOn(mockTransport, "openHostResourceEvents").mockReturnValue(
      Promise.withResolvers<never>().promise,
    );
    __setConnectionSnapshotForTests(
      "p1",
      {
        owner,
        status: "connected",
      },
      mockTransport,
    );

    // No interest yet -> false
    expect(canUseResourceRest(owner, mockQc)).toBe(false);

    const unreg = registerHostResourceInterest(owner, mockQc, "fleet");
    // Connected, registered QC, visible, interested, mode STARTING, !switching -> true
    expect(canUseResourceRest(owner, mockQc)).toBe(true);

    unreg();
    expect(canUseResourceRest(owner, mockQc)).toBe(false);
  });

  it("switchToHostResourceFrame performs atomic fence bump and transitions to LIVE", async () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    __setConnectionSnapshotForTests("p1", {
      owner,
      status: "connected",
    });

    registerHostResourceInterest(owner, mockQc, "fleet");

    const sourceGenBefore = captureResourceSource(owner, mockQc);
    expect(isResourceSourceCurrent(owner, mockQc, sourceGenBefore)).toBe(true);

    let observedSwitching = false;
    const unsub = subscribeHostResourceSource(owner, mockQc, () => {
      const snap = getHostResourceSource(owner, mockQc);
      if (snap.switching) {
        observedSwitching = true;
      }
    });

    const success = await switchToHostResourceFrame(
      owner,
      mockQc,
      sourceGenBefore,
      MOCK_FRAME,
      MOCK_STATUS,
    );

    expect(success).toBe(true);
    expect(observedSwitching).toBe(true);

    const snapAfter = getHostResourceSource(owner, mockQc);
    expect(snapAfter.mode).toBe("LIVE");
    expect(snapAfter.switching).toBe(false);
    expect(snapAfter.sourceGeneration).toBe(sourceGenBefore + 1);

    // REST predicate is false while in LIVE mode
    expect(canUseResourceRest(owner, mockQc)).toBe(false);

    unsub();
  });

  it("enforces paired pre-data status requirement: comment clears status adjacency", async () => {
    const owner = { profileId: "p1", generation: 1 };
    const coord = new HostResourceStreamCoordinator(owner, mockQc);
    coord["attemptNumber"] = 1;

    // Directly test status and comment handling
    const mockTransport = new WsTransport("http://localhost:4800");

    // 1. Status event arrives
    coord["handleParsedPiece"](
      1,
      {
        kind: "event",
        event: "host-resources-status",
        data: JSON.stringify(MOCK_STATUS_WIRE),
      },
      mockTransport,
    );
    expect(coord["statusAdjacent"]).toBe(true);

    // 2. Interleaved comment arrives -> clears status adjacency!
    coord["handleParsedPiece"](
      1,
      {
        kind: "comment",
        comment: "heartbeat",
      },
      mockTransport,
    );
    expect(coord["statusAdjacent"]).toBe(false);

    // 3. Data event arrives without adjacent status -> rejected!
    coord["handleParsedPiece"](
      1,
      {
        kind: "event",
        event: "host-resources",
        data: JSON.stringify(MOCK_FRAME_WIRE),
      },
      mockTransport,
    );
    // Mode should still be STOPPED (did not transition to LIVE)
    expect(coord.mode).toBe("STOPPED");

    coord.dispose();
    mockTransport.destroy();
  });

  it("accepts paired status and data event when adjacent and matching", async () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    __setConnectionSnapshotForTests("p1", {
      owner,
      status: "connected",
    });

    const coord = new HostResourceStreamCoordinator(owner, mockQc);
    const mockTransport = new WsTransport("http://localhost:4800");

    coord["handleParsedPiece"](
      0,
      {
        kind: "event",
        event: "host-resources-status",
        data: JSON.stringify(MOCK_STATUS_WIRE),
      },
      mockTransport,
    );
    expect(coord["statusAdjacent"]).toBe(true);

    coord["handleParsedPiece"](
      0,
      {
        kind: "event",
        event: "host-resources",
        data: JSON.stringify(MOCK_FRAME_WIRE),
      },
      mockTransport,
    );

    // Mode transitioned to LIVE
    expect(coord.mode).toBe("LIVE");
    expect(coord.getSnapshot().freshness.isFresh).toBe(true);

    coord.dispose();
    mockTransport.destroy();
  });

  it("handles 10 s initial data deadline expiration with retry", () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    const mockTransport = new WsTransport("http://localhost:4800");
    vi.spyOn(mockTransport, "openHostResourceEvents").mockReturnValue(
      Promise.withResolvers<never>().promise,
    );
    __setConnectionSnapshotForTests(
      "p1",
      {
        owner,
        status: "connected",
      },
      mockTransport,
    );

    registerHostResourceInterest(owner, mockQc, "fleet");
    expect(getHostResourceSource(owner, mockQc).mode).toBe("STARTING");

    // Advance 10 s without data
    vi.advanceTimersByTime(10_000);

    // Should transition to RETRY_WAIT
    expect(getHostResourceSource(owner, mockQc).mode).toBe("RETRY_WAIT");
  });

  it("AUTH_UNAVAILABLE sets persistent AUTH_BLOCKED latch across retries", () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    __setConnectionSnapshotForTests("p1", {
      owner,
      status: "connected",
    });

    const coord = new HostResourceStreamCoordinator(owner, mockQc);
    coord.registerInterest("fleet");
    coord["attemptNumber"] = 1;
    coord["handleFiniteResponse"](1, 503, "AUTH_UNAVAILABLE", null);

    expect(coord.mode).toBe("AUTH_BLOCKED");
    expect(coord.isAuthBlockedLatched()).toBe(true);

    // Evaluating lifecycle cannot clear authBlockedLatch
    coord.evaluateLifecycle();
    expect(coord.mode).toBe("AUTH_BLOCKED");

    coord.dispose();
  });

  it("FRAME_TOO_LARGE sets generation-sticky REST_ONLY", () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };
    __setConnectionSnapshotForTests("p1", {
      owner,
      status: "connected",
    });

    const coord = new HostResourceStreamCoordinator(owner, mockQc);
    coord.registerInterest("fleet");
    coord["attemptNumber"] = 1;
    coord["handleFiniteResponse"](1, 503, "FRAME_TOO_LARGE", null);

    expect(coord.mode).toBe("REST_ONLY");
    expect(coord.isRestOnlyLatched()).toBe(true);

    coord.dispose();
  });

  it("delivers streamed data end-to-end through transport -> parser -> codec -> coordinator, and ending ownership cancels stream without further delivery", async () => {
    registerConnectionRegistryQueryClient(mockQc);
    const owner = { profileId: "p1", generation: 1 };

    let streamCancelled = false;
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        streamCancelled = true;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );

    const transport = new WsTransport("http://localhost:4800");
    __setConnectionSnapshotForTests(
      "p1",
      {
        owner,
        status: "connected",
      },
      transport,
    );

    const unreg = registerHostResourceInterest(owner, mockQc, "fleet");
    expect(getHostResourceSource(owner, mockQc).mode).toBe("STARTING");

    // Enqueue paired status and data events through the real stream
    const encoder = new TextEncoder();
    streamController.enqueue(
      encoder.encode(
        `event: host-resources-status\ndata: ${JSON.stringify(MOCK_STATUS_WIRE)}\n\n`,
      ),
    );
    streamController.enqueue(
      encoder.encode(
        `event: host-resources\ndata: ${JSON.stringify(MOCK_FRAME_WIRE)}\n\n`,
      ),
    );

    // Allow read loop and switchToHostResourceFrame to settle
    await vi.waitFor(() => {
      expect(getHostResourceSource(owner, mockQc).mode).toBe("LIVE");
    });

    const liveSnap = getHostResourceSource(owner, mockQc);
    expect(liveSnap.mode).toBe("LIVE");
    expect(liveSnap.freshness.isFresh).toBe(true);

    // Now end ownership by invalidating/disconnecting
    cleanupCoordinatorsForOwner(owner);

    expect(streamCancelled).toBe(true);
    const afterSnap = getHostResourceSource(owner, mockQc);
    expect(afterSnap.mode).toBe("STOPPED");

    unreg();
    transport.destroy();
  });
});
