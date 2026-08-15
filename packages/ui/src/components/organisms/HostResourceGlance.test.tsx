import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import { HostResourceGlance } from "./HostResourceGlance.js";

const metrics = {
  sampledAt: 1,
  uptimeSeconds: 10,
  cpu: { usagePercent: 42, logicalCoreCount: 8 },
  memory: {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 4 * 1024 ** 3,
    availableBytes: 12 * 1024 ** 3,
    usagePercent: 25,
  },
  disk: {
    name: "workspace",
    mountPoint: "/workspace",
    totalBytes: 100,
    availableBytes: 25,
    usedBytes: 75,
    usagePercent: 75,
  },
  disks: [
    {
      name: "workspace",
      mountPoint: "/workspace",
      totalBytes: 100,
      availableBytes: 25,
      usedBytes: 75,
      usagePercent: 75,
    },
    {
      name: "data",
      mountPoint: "/data",
      totalBytes: 100,
      availableBytes: 60,
      usedBytes: 40,
      usagePercent: 40,
    },
  ],
  temperatures: [
    { label: "Package <one>", source: "pkg", celsius: 63.4 },
    { label: "", source: "sensor-2", celsius: Number.NaN },
  ],
} as HostMetrics;

const snapshot = {
  memory: {
    totalBytes: 8 * 1024 ** 3,
    availableBytes: 2 * 1024 ** 3,
    availability: { state: "stale", sampledAt: 1 },
  },
  battery: {
    count: 1,
    capacityPercent: 62,
    status: "charging",
    instantaneousPowerW: 12.5,
    availability: { state: "available", sampledAt: 1 },
  },
} as HostResourceSnapshotV1;

describe("HostResourceGlance", () => {
  it("keeps the requested order and exposes only bounded values as meters", () => {
    const markup = renderToStaticMarkup(
      <HostResourceGlance
        metrics={metrics}
        snapshot={snapshot}
        pinnedMount="/data"
      />,
    );

    expect(markup.indexOf("Memory used")).toBeLessThan(markup.indexOf(">CPU<"));
    expect(markup.indexOf(">CPU<")).toBeLessThan(
      markup.indexOf("Storage used"),
    );
    expect(markup.indexOf("Storage used")).toBeLessThan(
      markup.indexOf("Temperatures"),
    );
    expect(markup.indexOf("Temperatures")).toBeLessThan(
      markup.indexOf(">Battery<"),
    );
    expect(markup).toContain("40%");
    expect(markup).toContain("(overall 75%)");
    expect(markup).toContain("63°C");
    expect(markup).toContain("sensor-2");
    expect(markup).toContain("unavailable");
    expect(markup).toContain("12.5 W");
    expect((markup.match(/<meter\b/g) ?? []).length).toBe(4);
    expect(markup).not.toContain('role="meter"');
    expect(markup).toContain("Package &lt;one&gt;");
    expect(markup).not.toContain("Package <one>");
  });

  it("uses deep memory only when compatibility memory is absent", () => {
    const withoutCompatibility = renderToStaticMarkup(
      <HostResourceGlance snapshot={snapshot} />,
    );
    expect(withoutCompatibility).toContain("75%");
    expect(withoutCompatibility).toContain("Stale data");

    const invalidCompatibility = renderToStaticMarkup(
      <HostResourceGlance
        metrics={{
          ...metrics,
          memory: { ...metrics.memory, totalBytes: Number.NaN },
        }}
        snapshot={snapshot}
      />,
    );
    expect(invalidCompatibility).toContain(
      "Compatibility memory reading is invalid",
    );
    expect(invalidCompatibility).not.toContain("derived from deep total");
  });

  it("keeps a missing pin explicit without silently selecting the default disk", () => {
    const markup = renderToStaticMarkup(
      <HostResourceGlance metrics={metrics} pinnedMount="/missing" />,
    );

    expect(markup).toContain("Unavailable");
    expect(markup).toContain("/missing · missing · (overall 75%)");
    expect(markup).not.toContain('value="75"');
  });

  it("labels compatibility values when the sample is stale or refresh failed", () => {
    const staleMarkup = renderToStaticMarkup(
      <HostResourceGlance metrics={metrics} metricsStale />,
    );
    expect(staleMarkup).toContain("Compatibility metrics are stale");

    const errorMarkup = renderToStaticMarkup(
      <HostResourceGlance metrics={metrics} metricsError />,
    );
    expect(errorMarkup).toContain(
      "Compatibility metrics refresh failed; showing last sample",
    );
  });
});
