import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HostResourceSnapshotV1 } from "@/api/client.js";
import { HostResourceDiagnosis } from "./HostResourceDiagnosis.js";

const availability = { state: "available", sampledAt: 1 } as const;

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
