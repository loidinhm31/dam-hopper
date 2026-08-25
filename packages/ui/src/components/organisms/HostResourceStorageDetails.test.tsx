import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HostMetrics } from "@/api/client.js";
import { HostResourceStorageDetails } from "./HostResourceStorageDetails.js";

const metrics = {
  sampledAt: 1,
  disk: {
    name: "root",
    mountPoint: "/",
    totalBytes: 100,
    availableBytes: 25,
    usedBytes: 75,
    usagePercent: 75,
  },
  disks: [
    {
      name: "root",
      mountPoint: "/",
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
} as HostMetrics;

describe("HostResourceStorageDetails", () => {
  it("marks only the exact saved mount as current", () => {
    const markup = renderToStaticMarkup(
      <HostResourceStorageDetails
        metrics={metrics}
        pinnedMount="/data"
        onPin={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Unpin storage mount /data"');
    expect(markup).toContain('aria-label="Pin storage mount /"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("keeps a missing saved mount explicit and offers a null clear", () => {
    const markup = renderToStaticMarkup(
      <HostResourceStorageDetails
        metrics={metrics}
        pinnedMount="/missing"
        onPin={vi.fn()}
      />,
    );

    expect(markup).toContain("Saved mount /missing is missing");
    expect(markup).toContain("Clear saved storage pin /missing");
    expect(markup).not.toContain('aria-label="Unpin storage mount');
  });

  it("keeps the clear action available when inventory is unavailable", () => {
    const markup = renderToStaticMarkup(
      <HostResourceStorageDetails pinnedMount="/missing" onPin={vi.fn()} />,
    );

    expect(markup).toContain("cannot be verified without storage inventory");
    expect(markup).toContain("Clear saved storage pin /missing");
  });
});
