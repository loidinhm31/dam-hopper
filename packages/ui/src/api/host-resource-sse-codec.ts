/**
 * Host-resource SSE schema, status and freshness codec.
 *
 * Implements strict DTO decoding, canonical unsigned 64-bit BigInt revision
 * validation, exact key assertions, and monotonic projection freshness calculations.
 */

import type { HostMetrics, HostResourceSnapshotV1 } from "./client.js";
import type { HostResourceEventPiece } from "./host-resource-sse-parser.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_U64_REGEX = /^(?:0|[1-9]\d*)$/;
const MAX_U64 = 18446744073709551615n;

const DATA_TOP_LEVEL_KEYS: Record<string, true> = {
  schemaVersion: true,
  serverEpoch: true,
  revision: true,
  snapshot: true,
  metrics: true,
  lightSampleMs: true,
};

const STATUS_TOP_LEVEL_KEYS: Record<string, true> = {
  serverEpoch: true,
  revision: true,
  snapshotAgeMs: true,
  metricsAgeMs: true,
  freshnessTtlMs: true,
};

export interface DataFrame {
  kind: "data";
  schemaVersion: 1;
  serverEpoch: string;
  revision: string;
  revisionBigInt: bigint;
  snapshot: HostResourceSnapshotV1;
  metrics: HostMetrics;
  lightSampleMs: number;
}

export interface StatusFrame {
  kind: "status";
  serverEpoch: string;
  revision: string;
  revisionBigInt: bigint;
  snapshotAgeMs: number | null;
  metricsAgeMs: number | null;
  freshnessTtlMs: number;
}

export interface StreamError {
  kind: "error";
  code: string;
  message: string;
}

export type DecodedHostResourceFrame = DataFrame | StatusFrame | StreamError;

export interface FreshnessTracker {
  serverEpoch: string;
  revision: string;
  snapshotAgeMs: number | null;
  metricsAgeMs: number | null;
  freshnessTtlMs: number;
  localReceivedAt: number;
}

export interface ProjectionFreshness {
  serverEpoch: string | null;
  revision: string | null;
  snapshotAgeMs: number | null;
  metricsAgeMs: number | null;
  freshnessTtlMs: number | null;
  isSnapshotFresh: boolean;
  isMetricsFresh: boolean;
  isFresh: boolean;
}

export function validateUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_REGEX.test(val);
}

export function validateCanonicalDecimalU64(val: unknown): bigint | null {
  if (typeof val !== "string" || !DECIMAL_U64_REGEX.test(val)) {
    return null;
  }
  try {
    const bi = BigInt(val);
    if (bi < 0n || bi > MAX_U64) return null;
    if (bi.toString() !== val) return null;
    return bi;
  } catch {
    return null;
  }
}

export function decodeHostResourceEvent(
  event: HostResourceEventPiece,
): DecodedHostResourceFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data);
  } catch (err) {
    return {
      kind: "error",
      code: "INVALID_JSON",
      message: err instanceof Error ? err.message : "Malformed event JSON payload",
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      kind: "error",
      code: "INVALID_PAYLOAD_STRUCTURE",
      message: "Event payload must be a non-null object",
    };
  }

  const obj = parsed as Record<string, unknown>;

  if (event.event === "host-resources-error") {
    const code = typeof obj.code === "string" ? obj.code : "UNKNOWN_ERROR";
    const message =
      typeof obj.error === "string" ? obj.error : "Unknown stream error";
    return {
      kind: "error",
      code,
      message,
    };
  }

  if (event.event === "host-resources-status") {
    const keys = Object.keys(obj);
    if (
      keys.length !== 5 ||
      !keys.every((k) => STATUS_TOP_LEVEL_KEYS[k])
    ) {
      return {
        kind: "error",
        code: "INVALID_STATUS_KEYS",
        message: "Status event keys do not match exact expected contract",
      };
    }

    if (!validateUuid(obj.serverEpoch)) {
      return {
        kind: "error",
        code: "INVALID_SERVER_EPOCH",
        message: "serverEpoch must be a valid UUID",
      };
    }

    const revisionBigInt = validateCanonicalDecimalU64(obj.revision);
    if (revisionBigInt === null) {
      return {
        kind: "error",
        code: "INVALID_REVISION",
        message: "revision must be a canonical decimal unsigned 64-bit integer",
      };
    }

    const snapshotAgeMs = obj.snapshotAgeMs;
    if (
      snapshotAgeMs !== null &&
      (!Number.isInteger(snapshotAgeMs) || (snapshotAgeMs as number) < 0)
    ) {
      return {
        kind: "error",
        code: "INVALID_SNAPSHOT_AGE",
        message: "snapshotAgeMs must be null or a non-negative integer",
      };
    }

    const metricsAgeMs = obj.metricsAgeMs;
    if (
      metricsAgeMs !== null &&
      (!Number.isInteger(metricsAgeMs) || (metricsAgeMs as number) < 0)
    ) {
      return {
        kind: "error",
        code: "INVALID_METRICS_AGE",
        message: "metricsAgeMs must be null or a non-negative integer",
      };
    }

    const freshnessTtlMs = obj.freshnessTtlMs;
    if (
      !Number.isInteger(freshnessTtlMs) ||
      (freshnessTtlMs as number) <= 0
    ) {
      return {
        kind: "error",
        code: "INVALID_FRESHNESS_TTL",
        message: "freshnessTtlMs must be a positive integer",
      };
    }

    return {
      kind: "status",
      serverEpoch: obj.serverEpoch as string,
      revision: obj.revision as string,
      revisionBigInt,
      snapshotAgeMs: snapshotAgeMs as number | null,
      metricsAgeMs: metricsAgeMs as number | null,
      freshnessTtlMs: freshnessTtlMs as number,
    };
  }

  if (event.event === "host-resources") {
    const keys = Object.keys(obj);
    if (keys.length !== 6 || !keys.every((k) => DATA_TOP_LEVEL_KEYS[k])) {
      return {
        kind: "error",
        code: "INVALID_DATA_KEYS",
        message: "Data event keys do not match exact expected contract",
      };
    }

    if (obj.schemaVersion !== 1) {
      return {
        kind: "error",
        code: "INVALID_SCHEMA_VERSION",
        message: `schemaVersion must be 1, got ${String(obj.schemaVersion)}`,
      };
    }

    if (!validateUuid(obj.serverEpoch)) {
      return {
        kind: "error",
        code: "INVALID_SERVER_EPOCH",
        message: "serverEpoch must be a valid UUID",
      };
    }

    const revisionBigInt = validateCanonicalDecimalU64(obj.revision);
    if (revisionBigInt === null) {
      return {
        kind: "error",
        code: "INVALID_REVISION",
        message: "revision must be a canonical decimal unsigned 64-bit integer",
      };
    }

    const lightSampleMs = obj.lightSampleMs;
    if (
      !Number.isInteger(lightSampleMs) ||
      (lightSampleMs as number) < 1000 ||
      (lightSampleMs as number) > 60000
    ) {
      return {
        kind: "error",
        code: "INVALID_LIGHT_SAMPLE_MS",
        message: "lightSampleMs must be clamped between 1000 and 60000 ms",
      };
    }

    if (
      typeof obj.snapshot !== "object" ||
      obj.snapshot === null ||
      (obj.snapshot as Record<string, unknown>).schemaVersion !== 1
    ) {
      return {
        kind: "error",
        code: "INVALID_SNAPSHOT_PAYLOAD",
        message: "snapshot must be a valid HostResourceSnapshotV1 object",
      };
    }

    if (
      typeof obj.metrics !== "object" ||
      obj.metrics === null ||
      typeof (obj.metrics as Record<string, unknown>).sampledAt !== "number"
    ) {
      return {
        kind: "error",
        code: "INVALID_METRICS_PAYLOAD",
        message: "metrics must be a valid HostMetrics object",
      };
    }

    return {
      kind: "data",
      schemaVersion: 1,
      serverEpoch: obj.serverEpoch as string,
      revision: obj.revision as string,
      revisionBigInt,
      snapshot: obj.snapshot as HostResourceSnapshotV1,
      metrics: obj.metrics as HostMetrics,
      lightSampleMs: lightSampleMs as number,
    };
  }

  return {
    kind: "error",
    code: "UNSUPPORTED_EVENT_KIND",
    message: `Unsupported event kind: ${event.event}`,
  };
}

export function createFreshnessTracker(
  status: StatusFrame,
  localReceivedAt: number = performance.now(),
): FreshnessTracker {
  return {
    serverEpoch: status.serverEpoch,
    revision: status.revision,
    snapshotAgeMs: status.snapshotAgeMs,
    metricsAgeMs: status.metricsAgeMs,
    freshnessTtlMs: status.freshnessTtlMs,
    localReceivedAt,
  };
}

export function computeProjectionFreshness(
  tracker: FreshnessTracker | null,
  nowMs: number = performance.now(),
): ProjectionFreshness {
  if (!tracker) {
    return {
      serverEpoch: null,
      revision: null,
      snapshotAgeMs: null,
      metricsAgeMs: null,
      freshnessTtlMs: null,
      isSnapshotFresh: false,
      isMetricsFresh: false,
      isFresh: false,
    };
  }

  const elapsed = Math.max(0, Math.floor(nowMs - tracker.localReceivedAt));
  const snapshotAgeMs =
    tracker.snapshotAgeMs !== null ? tracker.snapshotAgeMs + elapsed : null;
  const metricsAgeMs =
    tracker.metricsAgeMs !== null ? tracker.metricsAgeMs + elapsed : null;

  const isSnapshotFresh =
    snapshotAgeMs !== null && snapshotAgeMs <= tracker.freshnessTtlMs;
  const isMetricsFresh =
    metricsAgeMs !== null && metricsAgeMs <= tracker.freshnessTtlMs;
  const isFresh = isSnapshotFresh && isMetricsFresh;

  return {
    serverEpoch: tracker.serverEpoch,
    revision: tracker.revision,
    snapshotAgeMs,
    metricsAgeMs,
    freshnessTtlMs: tracker.freshnessTtlMs,
    isSnapshotFresh,
    isMetricsFresh,
    isFresh,
  };
}
