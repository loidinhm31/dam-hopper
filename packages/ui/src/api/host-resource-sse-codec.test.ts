import { describe, expect, it } from "vitest";
import {
  computeProjectionFreshness,
  createFreshnessTracker,
  decodeHostResourceEvent,
  validateCanonicalDecimalU64,
  validateUuid,
  type StatusFrame,
} from "./host-resource-sse-codec.js";

const VALID_UUID = "12345678-1234-4234-8234-123456789abc";

const SAMPLE_SNAPSHOT = {
  schemaVersion: 1 as const,
  sampleId: "sample-1",
  sampledAt: Date.now(),
  host: {},
  capabilities: { linuxDeepMetrics: "available" as const },
  memory: { availability: "available" as const },
  pressure: { memory: { some: null, full: null } },
  cpu: { usagePercent: 12.5, logicalCoreCount: 8 },
  processes: {
    availability: "available" as const,
    totalCount: 150,
    topCpu: [],
    topMemory: [],
  },
  disk: {
    availability: "available" as const,
    rootTotalBytes: 1000,
    rootAvailableBytes: 500,
    rootUsedPercent: 50,
    readBytesPerSec: 0,
    writeBytesPerSec: 0,
  },
  network: {
    availability: "available" as const,
    rxBytesPerSec: 0,
    txBytesPerSec: 0,
    interfaces: [],
  },
  currentAlerts: [],
};

const SAMPLE_METRICS = {
  sampledAt: Date.now(),
  uptimeSeconds: 3600,
  cpu: { usagePercent: 10, logicalCoreCount: 8 },
  memory: {
    totalBytes: 16000,
    usedBytes: 8000,
    availableBytes: 8000,
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
};

describe("host-resource-sse-codec (03-D)", () => {
  describe("validateCanonicalDecimalU64", () => {
    it("accepts valid canonical decimal u64 strings", () => {
      expect(validateCanonicalDecimalU64("0")).toBe(0n);
      expect(validateCanonicalDecimalU64("1")).toBe(1n);
      expect(validateCanonicalDecimalU64("100")).toBe(100n);
      expect(validateCanonicalDecimalU64("18446744073709551615")).toBe(
        18446744073709551615n,
      );
    });

    it("rejects non-canonical or out-of-range revision strings", () => {
      expect(validateCanonicalDecimalU64("00")).toBeNull();
      expect(validateCanonicalDecimalU64("01")).toBeNull();
      expect(validateCanonicalDecimalU64("-1")).toBeNull();
      expect(validateCanonicalDecimalU64("+1")).toBeNull();
      expect(validateCanonicalDecimalU64("1.5")).toBeNull();
      expect(validateCanonicalDecimalU64("18446744073709551616")).toBeNull();
      expect(validateCanonicalDecimalU64("abc")).toBeNull();
      expect(validateCanonicalDecimalU64(42)).toBeNull();
      expect(validateCanonicalDecimalU64(null)).toBeNull();
    });
  });

  describe("validateUuid", () => {
    it("validates RFC 4122 UUID strings case-insensitively", () => {
      expect(validateUuid(VALID_UUID)).toBe(true);
      expect(validateUuid("ABCDEF01-2345-4789-ABCD-EF0123456789")).toBe(true);
      expect(validateUuid("invalid-uuid")).toBe(false);
      expect(validateUuid("")).toBe(false);
      expect(validateUuid(null)).toBe(false);
    });
  });

  describe("decodeHostResourceEvent data frame", () => {
    it("decodes a valid full data event", () => {
      const payload = {
        schemaVersion: 1,
        serverEpoch: VALID_UUID,
        revision: "42",
        snapshot: SAMPLE_SNAPSHOT,
        metrics: SAMPLE_METRICS,
        lightSampleMs: 5000,
      };

      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources",
        data: JSON.stringify(payload),
      });

      expect(result.kind).toBe("data");
      if (result.kind === "data") {
        expect(result.schemaVersion).toBe(1);
        expect(result.serverEpoch).toBe(VALID_UUID);
        expect(result.revision).toBe("42");
        expect(result.revisionBigInt).toBe(42n);
        expect(result.lightSampleMs).toBe(5000);
        expect(result.snapshot.sampleId).toBe("sample-1");
        expect(result.metrics.uptimeSeconds).toBe(3600);
      }
    });

    it("rejects data events with extra top-level keys", () => {
      const payload = {
        schemaVersion: 1,
        serverEpoch: VALID_UUID,
        revision: "42",
        snapshot: SAMPLE_SNAPSHOT,
        metrics: SAMPLE_METRICS,
        lightSampleMs: 5000,
        extraUnexpectedKey: true,
      };

      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources",
        data: JSON.stringify(payload),
      });

      expect(result).toMatchObject({
        kind: "error",
        code: "INVALID_DATA_KEYS",
      });
    });

    it("rejects data events with out-of-range lightSampleMs", () => {
      const payload = {
        schemaVersion: 1,
        serverEpoch: VALID_UUID,
        revision: "42",
        snapshot: SAMPLE_SNAPSHOT,
        metrics: SAMPLE_METRICS,
        lightSampleMs: 500, // Below 1000 ms clamp minimum
      };

      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources",
        data: JSON.stringify(payload),
      });

      expect(result).toMatchObject({
        kind: "error",
        code: "INVALID_LIGHT_SAMPLE_MS",
      });
    });

    it("rejects non-1 schemaVersion", () => {
      const payload = {
        schemaVersion: 2,
        serverEpoch: VALID_UUID,
        revision: "42",
        snapshot: SAMPLE_SNAPSHOT,
        metrics: SAMPLE_METRICS,
        lightSampleMs: 5000,
      };

      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources",
        data: JSON.stringify(payload),
      });

      expect(result).toMatchObject({
        kind: "error",
        code: "INVALID_SCHEMA_VERSION",
      });
    });
  });

  describe("decodeHostResourceEvent status frame", () => {
    it("decodes a valid status event with null and numeric ages", () => {
      const payload = {
        serverEpoch: VALID_UUID,
        revision: "100",
        snapshotAgeMs: null,
        metricsAgeMs: 250,
        freshnessTtlMs: 11500,
      };

      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources-status",
        data: JSON.stringify(payload),
      });

      expect(result.kind).toBe("status");
      if (result.kind === "status") {
        expect(result.serverEpoch).toBe(VALID_UUID);
        expect(result.revision).toBe("100");
        expect(result.revisionBigInt).toBe(100n);
        expect(result.snapshotAgeMs).toBeNull();
        expect(result.metricsAgeMs).toBe(250);
        expect(result.freshnessTtlMs).toBe(11500);
      }
    });

    it("rejects status events with extra top-level keys", () => {
      const payload = {
        serverEpoch: VALID_UUID,
        revision: "100",
        snapshotAgeMs: 0,
        metricsAgeMs: 0,
        freshnessTtlMs: 10000,
        extraKey: "bad",
      };

      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources-status",
        data: JSON.stringify(payload),
      });

      expect(result).toMatchObject({
        kind: "error",
        code: "INVALID_STATUS_KEYS",
      });
    });

    it("rejects negative ages or non-positive TTL", () => {
      expect(
        decodeHostResourceEvent({
          kind: "event",
          event: "host-resources-status",
          data: JSON.stringify({
            serverEpoch: VALID_UUID,
            revision: "100",
            snapshotAgeMs: -1,
            metricsAgeMs: 0,
            freshnessTtlMs: 10000,
          }),
        }),
      ).toMatchObject({ kind: "error", code: "INVALID_SNAPSHOT_AGE" });

      expect(
        decodeHostResourceEvent({
          kind: "event",
          event: "host-resources-status",
          data: JSON.stringify({
            serverEpoch: VALID_UUID,
            revision: "100",
            snapshotAgeMs: 0,
            metricsAgeMs: 0,
            freshnessTtlMs: 0,
          }),
        }),
      ).toMatchObject({ kind: "error", code: "INVALID_FRESHNESS_TTL" });
    });
  });

  describe("decodeHostResourceEvent error frame", () => {
    it("decodes host-resources-error controls", () => {
      const result = decodeHostResourceEvent({
        kind: "event",
        event: "host-resources-error",
        data: JSON.stringify({
          code: "AUTH_UNAVAILABLE",
          error: "Authentication backend unavailable",
        }),
      });

      expect(result).toEqual({
        kind: "error",
        code: "AUTH_UNAVAILABLE",
        message: "Authentication backend unavailable",
      });
    });
  });

  describe("monotonic projection freshness helper", () => {
    it("computes freshness accurately based on elapsed time against freshnessTtlMs", () => {
      const status: StatusFrame = {
        kind: "status",
        serverEpoch: VALID_UUID,
        revision: "50",
        revisionBigInt: 50n,
        snapshotAgeMs: 200,
        metricsAgeMs: 100,
        freshnessTtlMs: 1000,
      };

      const tracker = createFreshnessTracker(status, 10000);

      // 500 ms later: snapshot age is 200+500=700 (<=1000), metrics age is 100+500=600 (<=1000)
      const freshResult = computeProjectionFreshness(tracker, 10500);
      expect(freshResult.isSnapshotFresh).toBe(true);
      expect(freshResult.isMetricsFresh).toBe(true);
      expect(freshResult.isFresh).toBe(true);
      expect(freshResult.snapshotAgeMs).toBe(700);
      expect(freshResult.metricsAgeMs).toBe(600);

      // 900 ms later: snapshot age is 200+900=1100 (>1000), metrics age is 1000 (<=1000)
      const staleResult = computeProjectionFreshness(tracker, 10900);
      expect(staleResult.isSnapshotFresh).toBe(false);
      expect(staleResult.isMetricsFresh).toBe(true);
      expect(staleResult.isFresh).toBe(false);
    });

    it("handles null ages gracefully and null tracker returns not-fresh default", () => {
      const nullTracker = computeProjectionFreshness(null);
      expect(nullTracker.isFresh).toBe(false);
      expect(nullTracker.isSnapshotFresh).toBe(false);
      expect(nullTracker.isMetricsFresh).toBe(false);

      const statusWithNull: StatusFrame = {
        kind: "status",
        serverEpoch: VALID_UUID,
        revision: "1",
        revisionBigInt: 1n,
        snapshotAgeMs: null,
        metricsAgeMs: 100,
        freshnessTtlMs: 5000,
      };
      const tracker = createFreshnessTracker(statusWithNull, 1000);
      const res = computeProjectionFreshness(tracker, 1500);
      expect(res.isSnapshotFresh).toBe(false);
      expect(res.isMetricsFresh).toBe(true);
      expect(res.isFresh).toBe(false);
    });
  });
});
