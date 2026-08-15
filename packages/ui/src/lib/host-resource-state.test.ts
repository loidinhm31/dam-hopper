import { describe, expect, it } from "vitest";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import {
  formatAlertState,
  formatAvailability,
  formatBatteryCapacity,
  formatBatteryEnergy,
  formatBatteryPower,
  formatBatteryStatus,
  formatOptionalBytes,
  formatOptionalPercent,
  normalizeProgressPercent,
  normalizeProgressRatio,
  resolveHostResourceMemory,
  resolveHostResourceStorage,
  resolveHostResourceStatus,
  severityClass,
} from "./host-resource-state.js";

const makeSnapshot = (
  overrides: Partial<{
    alert: HostResourceSnapshotV1["alert"];
    currentAlerts: HostResourceSnapshotV1["currentAlerts"];
    memoryState: HostResourceSnapshotV1["memory"]["availability"]["state"];
  }> = {},
) =>
  ({
    memory: {
      availability: {
        state: overrides.memoryState ?? "available",
        sampledAt: 1,
      },
    },
    alert: overrides.alert,
    currentAlerts: overrides.currentAlerts,
  }) as HostResourceSnapshotV1;

const makeAlert = (severity: "info" | "warning" | "critical") =>
  ({ state: "memoryPressure", severity }) as HostResourceSnapshotV1["alert"];

const makeResource = (
  severity: "info" | "warning" | "critical",
  resolvedAt?: number | null,
) =>
  ({ severity, resolvedAt }) as NonNullable<
    HostResourceSnapshotV1["currentAlerts"]
  >[number];

describe("host resource state formatting", () => {
  it("keeps alert and limited-data states explicit", () => {
    expect(formatAlertState("reclaimableCacheHigh")).toBe(
      "High reclaimable cache",
    );
    expect(formatAlertState("limitedData")).toBe("Limited data");
  });

  it("never turns unavailable source data into a number", () => {
    expect(
      formatAvailability({
        state: "stale",
        sampledAt: 1,
        detailCode: "monitorStale",
      }),
    ).toBe("Stale data (monitorStale)");
    expect(formatOptionalBytes(undefined)).toBe("Unavailable");
    expect(formatOptionalPercent(undefined)).toBe("Unavailable");
    expect(formatOptionalBytes(null)).toBe("Unavailable");
    expect(formatOptionalPercent(null)).toBe("Unavailable");
  });

  it("maps severity to the existing semantic color tokens", () => {
    expect(severityClass("critical")).toContain("color-danger");
    expect(severityClass("warning")).toContain("color-warning");
  });

  it("formats finite battery measurements with stable explicit units", () => {
    expect(formatBatteryStatus("notCharging")).toBe("Not charging");
    expect(formatBatteryStatus(null)).toBeUndefined();
    expect(formatBatteryStatus("BROKEN" as never)).toBeUndefined();
    expect(formatBatteryCapacity(62.5)).toBe("62.5%");
    expect(formatBatteryCapacity(101)).toBeUndefined();
    expect(formatBatteryEnergy(12.5)).toBe("12.5 Wh");
    expect(formatBatteryPower(3.256)).toBe("3.26 W");
    expect(formatBatteryEnergy(Number.NaN)).toBeUndefined();
    expect(formatBatteryPower(-1)).toBeUndefined();
  });

  it.each([
    ["critical legacy plus info resource", "critical", ["info"], "Critical"],
    ["info legacy plus critical resource", "info", ["critical"], "Critical"],
    [
      "warning resources in first order",
      undefined,
      ["warning", "info"],
      "Warning",
    ],
    [
      "warning resources in reverse order",
      undefined,
      ["info", "warning"],
      "Warning",
    ],
    ["single info resource", undefined, ["info"], "Advisory"],
    ["single warning resource", undefined, ["warning"], "Warning"],
    ["single critical resource", undefined, ["critical"], "Critical"],
  ])(
    "uses maximum severity independent of source order: %s",
    (_name, legacySeverity, resourceSeverities, expected) => {
      const legacy = legacySeverity
        ? makeAlert(legacySeverity as "info" | "warning" | "critical")
        : undefined;
      const snapshot = makeSnapshot({
        alert: legacy,
        currentAlerts: (
          resourceSeverities as Array<"info" | "warning" | "critical">
        ).map((severity) => makeResource(severity)),
      });
      const result = resolveHostResourceStatus({ snapshot });
      expect(result.label).toBe(expected);
    },
  );

  it("keeps healthy, monitoring, authoritative empty, and resolved states distinct", () => {
    expect(
      resolveHostResourceStatus({
        snapshot: makeSnapshot({
          alert: { state: "healthy" } as HostResourceSnapshotV1["alert"],
          currentAlerts: [],
        }),
      }).label,
    ).toBe("Healthy");
    expect(
      resolveHostResourceStatus({
        snapshot: makeSnapshot({ currentAlerts: [] }),
      }).label,
    ).toBe("Monitoring");
    expect(
      resolveHostResourceStatus({
        snapshot: makeSnapshot({
          alert: undefined,
          currentAlerts: [makeResource("critical", 1)],
        }),
      }).label,
    ).toBe("Monitoring");
    expect(
      resolveHostResourceStatus({
        snapshot: makeSnapshot({ alert: makeAlert("warning") }),
      }).label,
    ).toBe("Warning · resource alert status unavailable");
  });

  it("applies query precedence and preserves cached incident severity", () => {
    expect(
      resolveHostResourceStatus({ isError: true, isLoading: true }).label,
    ).toBe("Snapshot unavailable");
    expect(resolveHostResourceStatus({ isLoading: true }).label).toBe(
      "Sampling host",
    );
    expect(resolveHostResourceStatus({}).label).toBe("Snapshot unavailable");

    const cachedCritical = makeSnapshot({
      alert: makeAlert("critical"),
      currentAlerts: [],
    });
    for (const input of [
      { isError: true },
      { memoryState: "unsupported" as const },
      { memoryState: "temporarilyUnavailable" as const },
      { currentAlerts: undefined },
      { isStale: true, isFetching: true },
      { isStale: true },
      { isFetching: true },
    ]) {
      const snapshot = makeSnapshot({
        ...input,
        alert: cachedCritical.alert,
        currentAlerts: "currentAlerts" in input ? undefined : [],
      });
      const result = resolveHostResourceStatus({
        snapshot,
        isError: input.isError,
        isFetching: input.isFetching,
        isStale: input.isStale,
      });
      expect(result.label).toMatch(/^Critical · /);
      expect(result.rank).toBe(3);
      expect(result.tone).toBe("critical");
    }
  });

  it.each([
    [
      "critical incident",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
        }),
      },
      {
        label: "Critical",
        mode: "current",
        rank: 3,
        tone: "critical",
        icon: "alert",
        triggerClassName: "text-[var(--color-danger)]",
        badgeClassName:
          "bg-[var(--color-danger)] text-[var(--color-background)]",
        statusClassName:
          "border-[var(--color-danger)] bg-[var(--color-background)]",
        statusIconClassName: "text-[var(--color-danger)]",
        badgeLabel: "Active host incident",
        badgeText: "!",
      },
    ],
    [
      "degraded core data",
      {
        snapshot: makeSnapshot({
          currentAlerts: [],
          memoryState: "temporarilyUnavailable",
        }),
      },
      {
        label: "Monitoring · core data unavailable",
        mode: "unavailable",
        rank: 0,
        tone: "warning",
        icon: "alert",
        triggerClassName: "text-[var(--color-warning)]",
        badgeClassName:
          "bg-[var(--color-warning)] text-[var(--color-background)]",
        statusClassName:
          "border-[var(--color-warning)] bg-[var(--color-background)]",
        statusIconClassName: "text-[var(--color-warning)]",
      },
    ],
    [
      "sampling",
      { isLoading: true },
      {
        label: "Sampling host",
        mode: "sampling",
        rank: 0,
        tone: "info",
        icon: "activity",
        triggerClassName: "text-[var(--color-primary)]",
        badgeClassName:
          "bg-[var(--color-primary)] text-[var(--color-background)]",
        statusClassName:
          "border-[var(--color-primary)] bg-[var(--color-background)]",
        statusIconClassName: "text-[var(--color-primary)]",
      },
    ],
    [
      "healthy",
      {
        snapshot: makeSnapshot({
          alert: { state: "healthy" } as HostResourceSnapshotV1["alert"],
          currentAlerts: [],
        }),
      },
      {
        label: "Healthy",
        mode: "current",
        rank: 0,
        tone: "success",
        icon: "healthy",
        triggerClassName: "text-[var(--color-success)]",
        badgeClassName:
          "bg-[var(--color-success)] text-[var(--color-background)]",
        statusClassName:
          "border-[var(--color-success)] bg-[var(--color-background)]",
        statusIconClassName: "text-[var(--color-success)]",
      },
    ],
    [
      "terminal unavailable",
      { isError: true },
      {
        label: "Snapshot unavailable",
        mode: "terminal-unavailable",
        rank: 0,
        tone: "danger",
        icon: "alert",
        triggerClassName: "text-[var(--color-danger)]",
        badgeClassName:
          "bg-[var(--color-danger)] text-[var(--color-background)]",
        statusClassName:
          "border-[var(--color-danger)] bg-[var(--color-background)]",
        statusIconClassName: "text-[var(--color-danger)]",
      },
    ],
  ])("returns complete literal variants for %s", (_name, input, expected) => {
    expect(resolveHostResourceStatus(input)).toMatchObject(expected);
  });

  it.each([
    [
      "cached refresh error",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
        }),
        isError: true,
      },
      {
        label: "Critical · refresh failed",
        mode: "refresh-error",
        tone: "critical",
      },
    ],
    [
      "cached core unavailable",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
          memoryState: "permissionDenied",
        }),
      },
      {
        label: "Critical · core data unavailable",
        mode: "unavailable",
        tone: "critical",
      },
    ],
    [
      "older server resource status",
      { snapshot: makeSnapshot({ alert: makeAlert("critical") }) },
      {
        label: "Critical · resource alert status unavailable",
        mode: "unavailable",
        tone: "critical",
      },
    ],
    [
      "stale while refreshing",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
          memoryState: "stale",
        }),
        isStale: true,
        isFetching: true,
      },
      {
        label: "Critical · stale, refreshing",
        mode: "stale-refreshing",
        tone: "critical",
      },
    ],
    [
      "stale retained data",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
          memoryState: "stale",
        }),
        isStale: true,
      },
      { label: "Critical · stale", mode: "stale", tone: "critical" },
    ],
    [
      "background refresh",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
        }),
        isFetching: true,
      },
      {
        label: "Critical · refreshing",
        mode: "background-loading",
        tone: "critical",
      },
    ],
    [
      "current snapshot",
      {
        snapshot: makeSnapshot({
          alert: makeAlert("critical"),
          currentAlerts: [],
        }),
      },
      { label: "Critical", mode: "current", tone: "critical" },
    ],
  ])(
    "adds deterministic freshness qualifiers without hiding active severity: %s",
    (_name, input, expected) => {
      expect(resolveHostResourceStatus(input)).toMatchObject(expected);
      expect(resolveHostResourceStatus(input).rank).toBe(3);
    },
  );

  it("does not let unread count change rank, tone, or literal variants", () => {
    const snapshot = makeSnapshot({
      alert: makeAlert("critical"),
      currentAlerts: [],
    });
    const read = resolveHostResourceStatus({ snapshot, unreadCount: 0 });
    const unread = resolveHostResourceStatus({ snapshot, unreadCount: 3 });
    expect(unread.label).toBe(read.label);
    expect(unread.rank).toBe(read.rank);
    expect(unread.tone).toBe(read.tone);
    expect(unread.triggerClassName).toBe(read.triggerClassName);
    expect(unread.badgeClassName).toBe(
      "bg-[var(--color-danger)] text-[var(--color-background)]",
    );
    expect(unread.badgeLabel).toBe("3 unread host incidents");
    expect(read.badgeLabel).toBe("Active host incident");
    expect(unread.badgeClassName).not.toContain("bg-current");
  });

  it.each([
    ["missing", undefined, undefined],
    ["non-number", "50", undefined],
    ["NaN", Number.NaN, undefined],
    ["positive infinity", Number.POSITIVE_INFINITY, undefined],
    ["negative infinity", Number.NEGATIVE_INFINITY, undefined],
    ["negative", -1, undefined],
    ["zero", 0, 0],
    ["in range", 42.5, 42.5],
    ["over 100", 125, 100],
  ])("normalizes direct progress: %s", (_name, input, expected) => {
    const result = normalizeProgressPercent(input);
    expect(result?.value).toBe(expected);
  });

  it.each([
    ["missing part", undefined, 100, undefined],
    ["nonfinite part", Number.NaN, 100, undefined],
    ["infinite part", Number.POSITIVE_INFINITY, 100, undefined],
    ["negative part", -1, 100, undefined],
    ["zero", 0, 100, 0],
    ["in range", 25, 100, 25],
    ["part over total", 125, 100, 100],
    ["zero total", 0, 0, undefined],
    ["negative total", 1, -1, undefined],
    ["nonfinite total", 1, Number.POSITIVE_INFINITY, undefined],
  ])("normalizes ratio progress: %s", (_name, part, total, expected) => {
    const result = normalizeProgressRatio(part, total);
    expect(result?.value).toBe(expected);
  });

  it("resolves used memory from compatibility first and deep data only as fallback", () => {
    const metrics = {
      memory: { usedBytes: 25, totalBytes: 100 },
    } as HostMetrics;
    expect(resolveHostResourceMemory(metrics).value).toBe(25);
    expect(
      resolveHostResourceMemory(undefined, {
        memory: {
          totalBytes: 100,
          availableBytes: 25,
          availability: { state: "stale", sampledAt: 1 },
        },
      } as HostResourceSnapshotV1),
    ).toMatchObject({ value: 75, source: "deep" });
    expect(
      resolveHostResourceMemory(undefined, {
        memory: {
          totalBytes: 100,
          availableBytes: 25,
          availability: { state: "unsupported", sampledAt: 1 },
        },
      } as HostResourceSnapshotV1).value,
    ).toBeUndefined();
  });

  it("resolves exact storage pins and falls back to the overall disk", () => {
    const metrics = {
      disk: { mountPoint: "/data", usagePercent: 20 },
      disks: [
        { mountPoint: "/data", usagePercent: 20 },
        { mountPoint: "/data2", usagePercent: 40 },
      ],
    } as HostMetrics;
    expect(resolveHostResourceStorage(metrics, null).state).toBe("default");
    expect(resolveHostResourceStorage(metrics, "/data2")).toMatchObject({
      state: "pinned",
      selected: { mountPoint: "/data2" },
    });
    expect(resolveHostResourceStorage(metrics, "/missing")).toMatchObject({
      state: "missing",
      savedMount: "/missing",
    });
    expect(
      resolveHostResourceStorage({ ...metrics, disks: [] }, "/data"),
    ).toMatchObject({
      state: "pinned",
      selected: { mountPoint: "/data" },
    });
    expect(
      resolveHostResourceStorage({ ...metrics, disks: [] }, "/"),
    ).toMatchObject({ state: "missing", savedMount: "/" });
  });
});
