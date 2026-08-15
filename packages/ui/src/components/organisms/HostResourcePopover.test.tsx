import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HostResourceSnapshotV1 } from "@/api/client.js";

const snapshot = {
  host: {},
  memory: {
    availability: { state: "available", sampledAt: 1 },
  },
  alert: {
    state: "healthy",
    severity: "info",
    updatedAt: 1,
    durationSeconds: 0,
    scope: "host",
    confidence: "high",
    threshold: "none",
    evidence: { cgroupOomDelta: false },
    nextAction: "No action required.",
  },
  currentAlerts: [
    {
      kind: "disk",
      key: "disk:/data",
      state: "diskFull",
      severity: "critical",
      incidentId: "disk-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "disk:/data",
      threshold: "usage>=95%",
      nextAction: "Free space.",
      evidence: { diskMountPoint: "/data", diskUsagePercent: 95 },
    },
  ],
} as HostResourceSnapshotV1;

vi.mock("@/api/queries.js", () => ({
  useGlobalConfig: () => ({ data: { ui: {} } }),
  useHostMetrics: () => ({ data: undefined }),
  useHostResourceAlerts: () => ({ data: [] }),
  useHostResourceSnapshot: () => ({ data: snapshot }),
  useUpdateUiConfig: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

import { HostResourcePopover } from "./HostResourcePopover.js";

describe("HostResourcePopover", () => {
  it("keeps an active resource incident visible after acknowledgement", () => {
    const markup = renderToStaticMarkup(<HostResourcePopover />);

    expect(markup).toContain(
      "Host resources: 1 active resource incident; Critical",
    );
    expect(markup).not.toContain("bg-current");
    expect(markup).toContain("Active host incident");
    expect(markup).not.toContain("0 unread");
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>!<\/span>/);
    expect(markup).toContain("text-[var(--color-danger)]");
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeDefined();
    expect(markup).toContain(`id="${describedBy}"`);
  });
});
