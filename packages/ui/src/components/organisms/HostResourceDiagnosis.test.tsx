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
});
