import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import { HostResourceDiagnosis } from "./HostResourceDiagnosis.js";

const availability = { state: "available", sampledAt: 1 } as const;

const legacyMetrics: HostMetrics = {
  sampledAt: 1,
  uptimeSeconds: 1,
  cpu: { usagePercent: 42, logicalCoreCount: 4 },
  memory: {
    totalBytes: 1_024,
    usedBytes: 512,
    availableBytes: 512,
    usagePercent: 50,
  },
  disk: {
    name: "root",
    mountPoint: "/",
    totalBytes: 1_024,
    availableBytes: 256,
    usedBytes: 768,
    usagePercent: 75,
  },
  temperatures: [],
};

const snapshot: HostResourceSnapshotV1 = {
  schemaVersion: 1,
  sampleId: "sample-1",
  sampledAt: Date.now(),
  host: { hostname: "monitor-host", osName: "Fedora" },
  capabilities: { linuxDeepMetrics: availability },
  memory: {
    totalBytes: 1_024,
    availableBytes: 512,
    availability,
  },
  pressure: { memory: { availability } },
  cgroups: [],
  processes: {
    processes: [],
    scannedCount: 0,
    truncated: false,
    deadlineExceeded: false,
    skippedCount: 0,
    permissionDeniedCount: 0,
    invalidUtf8Count: 0,
    malformedCount: 0,
    disappearedCount: 0,
    availability,
  },
  mountContext: {
    mountPoint: "/workspace",
    activeMappedPaths: [],
    activeMappedPathsAvailability: availability,
    cacheAttribution: {
      label: "unattributedSharedCache",
      confidence: "low",
      method: "notCollected",
    },
    availability,
  },
  actionCapabilities: { availability },
  alert: {
    state: "limitedData",
    severity: "warning",
    updatedAt: 1,
    durationSeconds: 30,
    scope: "host",
    confidence: "low",
    threshold: "source unavailable",
    evidence: { cgroupOomDelta: false },
    nextAction: "Inspect source availability.",
  },
};

describe("HostResourceDiagnosis", () => {
  it("renders complete battery telemetry with explicit units and mixed status", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 2,
            capacityPercent: 62.5,
            status: "mixed",
            remainingEnergyWh: 42.5,
            instantaneousPowerW: 8.125,
            availability,
          },
        }}
        alerts={[]}
      />,
    );

    expect(markup).toContain('aria-label="Battery"');
    expect(markup).toContain("Batteries");
    expect(markup).toContain("Mixed");
    expect(markup).toContain("62.5%");
    expect(markup).toContain("Remaining energy");
    expect(markup).toContain("42.5 Wh");
    expect(markup).toContain("Instantaneous power");
    expect(markup).toContain("8.13 W");
    expect(markup).not.toContain("current Wh");
  });

  it("shows only the trustworthy measurement when battery fields are partial", () => {
    const energyMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 1,
            capacityPercent: null,
            status: null,
            remainingEnergyWh: 12.5,
            instantaneousPowerW: null,
            availability,
          },
        }}
        alerts={[]}
      />,
    );
    expect(energyMarkup).toContain("12.5 Wh");
    expect(energyMarkup).not.toContain("Instantaneous power");
    expect(energyMarkup).not.toContain("Capacity");

    const powerMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 1,
            status: "charging",
            remainingEnergyWh: null,
            instantaneousPowerW: 3.25,
            availability,
          },
        }}
        alerts={[]}
      />,
    );
    expect(powerMarkup).toContain("Charging");
    expect(powerMarkup).toContain("3.25 W");
    expect(powerMarkup).not.toContain("Remaining energy");
  });

  it("hides absent, unsupported, and empty battery sections", () => {
    const oldServerMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis snapshot={snapshot} alerts={[]} />,
    );
    expect(oldServerMarkup).not.toContain('aria-label="Battery"');

    const unsupportedMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 1,
            status: "full",
            remainingEnergyWh: 10,
            availability: { state: "unsupported", sampledAt: 1 },
          },
        }}
        alerts={[]}
      />,
    );
    expect(unsupportedMarkup).not.toContain('aria-label="Battery"');

    const emptyMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 0,
            capacityPercent: null,
            status: null,
            remainingEnergyWh: null,
            instantaneousPowerW: null,
            availability,
          },
        }}
        alerts={[]}
      />,
    );
    expect(emptyMarkup).not.toContain('aria-label="Battery"');
  });

  it("hides battery fields when the reported count is invalid", () => {
    const negativeMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: -1,
            remainingEnergyWh: 12.5,
            availability,
          },
        }}
        alerts={[]}
      />,
    );
    const fractionalMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 1.5,
            remainingEnergyWh: 12.5,
            availability,
          },
        }}
        alerts={[]}
      />,
    );

    expect(negativeMarkup).not.toContain('aria-label="Battery"');
    expect(fractionalMarkup).not.toContain('aria-label="Battery"');
    expect(negativeMarkup).not.toContain("12.5 Wh");
    expect(fractionalMarkup).not.toContain("12.5 Wh");
  });

  it("keeps stale availability beside retained values and rejects invalid values", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 1,
            capacityPercent: 101,
            status: "notCharging",
            remainingEnergyWh: Number.NaN,
            instantaneousPowerW: -1,
            availability: { state: "stale", sampledAt: 1 },
          },
        }}
        alerts={[]}
      />,
    );
    expect(markup).toContain("Not charging");
    expect(markup).toContain("Stale data");
    expect(markup).not.toContain("101%");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).not.toContain("-1 W");

    const degradedMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          battery: {
            count: 1,
            remainingEnergyWh: 2,
            availability: {
              state: "temporarilyUnavailable",
              sampledAt: 1,
            },
          },
        }}
        alerts={[]}
      />,
    );
    expect(degradedMarkup).toContain("2 Wh");
    expect(degradedMarkup).toContain("Temporarily unavailable");
  });

  it("renders legacy temperatures and keeps storage collapsed by default", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={snapshot}
        alerts={[]}
        legacyMetrics={{
          ...legacyMetrics,
          temperatures: [{ label: "Package", source: "pkg", celsius: 61 }],
          disks: [
            {
              ...legacyMetrics.disk,
              name: "workspace",
              mountPoint: "/workspace",
              usagePercent: 95,
            },
            {
              ...legacyMetrics.disk,
              name: "cache",
              mountPoint: "/cache",
              usagePercent: 10,
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Package");
    expect(markup).toContain("61°C");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("hidden");
    expect(markup).toContain("/workspace");
    expect(markup).toContain("/cache");
  });

  it("shows unavailable state for empty temperatures", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={snapshot}
        alerts={[]}
        legacyMetrics={legacyMetrics}
      />,
    );

    expect(markup).toContain("Temperature sensors unavailable");
    expect(markup).not.toContain("0°C");
  });

  it("renders additive current resource evidence", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          currentAlerts: [
            {
              kind: "disk",
              key: "disk:/workspace",
              state: "diskFull",
              severity: "critical",
              incidentId: "disk-1",
              openedAt: 1,
              updatedAt: 1,
              durationSeconds: 30,
              scope: "disk:/workspace",
              evidence: {
                diskName: "workspace",
                diskMountPoint: "/workspace",
                diskUsagePercent: 95,
              },
              threshold: "usage>=95%",
              nextAction: "Free space.",
            },
          ],
        }}
        alerts={[]}
      />,
    );

    expect(markup).toContain("Current resource incidents");
    expect(markup).toContain("workspace · /workspace · 95% used");
    expect(markup).toContain("Disk nearly full");
  });

  it("keeps unavailable values explicit and exposes only read-only guidance", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis snapshot={snapshot} alerts={[]} />,
    );

    expect(markup).toContain("Limited data");
    expect(markup).toContain("Operator guidance: Inspect source availability.");
    expect(markup).toContain("Threshold");
    expect(markup).toContain("Reclaimable slab");
    expect(markup).toContain("File cache");
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("password");
  });

  it("renders a zero-timestamp resolved incident as resolved", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={snapshot}
        alerts={[
          {
            incidentId: "incident-1",
            state: "limitedData",
            severity: "warning",
            openedAt: 0,
            updatedAt: 0,
            resolvedAt: 0,
            durationSeconds: 30,
            scope: "host",
            confidence: "low",
            threshold: "source unavailable",
            evidence: { cgroupOomDelta: false },
            nextAction: "Inspect source availability.",
          },
        ]}
      />,
    );

    expect(markup).toContain("resolved");
  });

  it("does not represent unavailable cgroups as a real zero", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          capabilities: {
            linuxDeepMetrics: {
              state: "unsupported",
              sampledAt: 1,
            },
          },
        }}
        alerts={[]}
      />,
    );

    expect(markup).toContain("Unsupported on this host");
    expect(markup).not.toContain("0 visible");
  });

  it("starts with incident evidence, keeps metadata in the popover, and consolidates the metric note", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          currentAlerts: [
            {
              kind: "disk",
              key: "disk:/workspace",
              state: "diskFull",
              severity: "critical",
              incidentId: "disk-1",
              openedAt: 1,
              updatedAt: 1,
              durationSeconds: 30,
              scope: "disk:/workspace",
              evidence: {
                diskName: "workspace",
                diskMountPoint: "/workspace",
                diskUsagePercent: 95,
              },
              threshold: "usage>=95%",
              nextAction: "Free space.",
            },
          ],
        }}
        alerts={[]}
      />,
    );

    expect(markup.indexOf("Current host alert")).toBeLessThan(
      markup.indexOf("Current resource incidents"),
    );
    expect(markup.indexOf("Current resource incidents")).toBeLessThan(
      markup.indexOf("Memory available"),
    );
    expect(markup).toContain(
      "Memory categories are reported separately and are not additive;",
    );
    expect(markup).not.toContain("monitor-host");
    expect(markup).not.toContain("usage&gt;=95%");
    expect(markup).not.toContain("Free space.");
    expect(markup).not.toContain("disk-1");
  });

  it("preserves visible diagnostics while keeping incident metadata hidden", () => {
    const markup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          memory: {
            ...snapshot.memory,
            totalBytes: 4_096,
            availableBytes: 2_048,
            anonBytes: 1_024,
            fileCacheBytes: 1_280,
            reclaimableSlabBytes: 512,
            swapUsedBytes: 256,
          },
          pressure: {
            memory: {
              availability,
              some: { avg10: 1.2, avg60: 1.1, avg300: 1, totalMicros: 10 },
              full: { avg10: 0.4, avg60: 0.3, avg300: 0.2, totalMicros: 4 },
            },
          },
          processes: {
            ...snapshot.processes,
            scannedCount: 2,
            processes: [
              {
                pid: 42,
                name: "worker-process",
                rssBytes: 512,
                availability,
              },
            ],
          },
          cgroups: [
            {
              path: "/user.slice/workload.slice",
              namespace: "host",
              currentBytes: 256,
              maxUnlimited: true,
              highUnlimited: true,
              events: [],
              pressure: { memory: { availability } },
              availability,
            },
          ],
          mountContext: {
            ...snapshot.mountContext,
            mountPoint: "/workspace/project",
            cacheAttribution: {
              ...snapshot.mountContext.cacheAttribution,
              bytes: 768,
            },
          },
          currentAlerts: [
            {
              kind: "temperature",
              key: "temperature:cpu-package",
              state: "temperatureHigh",
              severity: "warning",
              incidentId: "resource-incident-hidden",
              openedAt: 1,
              updatedAt: 1,
              durationSeconds: 4,
              scope: "cpu-package",
              threshold: "temperature>=90",
              nextAction: "Inspect thermal source.",
              evidence: {
                temperatureLabel: "CPU package",
                temperatureSource: "coretemp",
                temperatureCelsius: 91,
              },
            },
          ],
        }}
        alerts={[
          {
            incidentId: "history-incident-hidden",
            state: "limitedData",
            severity: "info",
            openedAt: 1,
            updatedAt: 1,
            resolvedAt: 2,
            durationSeconds: 1,
            scope: "host",
            confidence: "low",
            threshold: "hidden threshold",
            evidence: { cgroupOomDelta: false },
            nextAction: "hidden guidance",
          },
        ]}
        legacyMetrics={legacyMetrics}
      />,
    );

    expect(markup).toContain("Memory available");
    expect(markup).toContain("File cache");
    expect(markup).toContain("Anonymous memory");
    expect(markup).toContain("Reclaimable slab");
    expect(markup).toContain("Swap used");
    expect(markup).toContain("PSI memory");
    expect(markup).toContain("CPU package · 91°C");
    expect(markup).toContain("/user.slice/workload.slice");
    expect(markup).toContain("worker-process · 42");
    expect(markup).toContain("resolved");
    expect(markup).not.toContain("resource-incident-hidden");
    expect(markup).not.toContain("temperature>=90");
    expect(markup).not.toContain("Inspect thermal source.");
    expect(markup).not.toContain("hidden threshold");
    expect(markup).not.toContain("hidden guidance");
  });

  it("uses one normalized result for valid, stale, zero, invalid, and over-total meters", () => {
    const zeroMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          memory: {
            ...snapshot.memory,
            availableBytes: 0,
            totalBytes: 1_024,
          },
        }}
        alerts={[]}
      />,
    );
    expect(zeroMarkup).toContain('aria-valuenow="0"');
    expect(zeroMarkup).toContain('aria-label="Memory available percentage"');

    const staleMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          memory: {
            ...snapshot.memory,
            availableBytes: 512,
            totalBytes: 1_024,
            availability: { state: "stale", sampledAt: 1 },
          },
        }}
        alerts={[]}
      />,
    );
    expect(staleMarkup).toContain('aria-valuenow="50"');
    expect(staleMarkup).toContain("Stale data");

    const invalidMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          memory: {
            ...snapshot.memory,
            availableBytes: -1,
            totalBytes: 1_024,
            availability: { state: "stale", sampledAt: 1 },
          },
        }}
        alerts={[]}
        legacyMetrics={{
          ...legacyMetrics,
          disk: { ...legacyMetrics.disk, usagePercent: -1 },
        }}
      />,
    );
    expect(invalidMarkup).not.toContain('role="progressbar"');
    expect(invalidMarkup).toContain("Unavailable");
    expect(invalidMarkup).toContain("Stale data");

    const overTotalMarkup = renderToStaticMarkup(
      <HostResourceDiagnosis
        snapshot={{
          ...snapshot,
          memory: {
            ...snapshot.memory,
            availableBytes: 2_048,
            totalBytes: 1_024,
          },
        }}
        alerts={[]}
        legacyMetrics={{
          ...legacyMetrics,
          disk: { ...legacyMetrics.disk, usagePercent: 125 },
        }}
      />,
    );
    expect(overTotalMarkup).toContain('aria-valuenow="100"');
    expect(overTotalMarkup).toContain("100%");
  });
});
