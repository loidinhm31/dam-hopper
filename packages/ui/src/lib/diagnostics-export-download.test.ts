import { afterEach, describe, expect, it, vi } from "vitest";
import { exportDiagnosticsBundle } from "./diagnostics-export.js";

const snapshot = {
  manifest: {
    schemaVersion: 1,
    storageKey: "damhopper_diagnostics_frontend_v1",
    retentionMinutes: 60,
    maxEntries: 1_000,
    maxStorageBytes: 512 * 1024,
    entryCount: 1,
  },
  logs: [
    {
      timestamp: "2026-07-07T18:29:00.000Z",
      timestampMs: new Date(2026, 6, 7, 18, 29, 0).getTime(),
      type: "log",
      scope: "SettingsPage",
      message: "settings event",
    },
  ],
  browserErrors: [],
  currentRoute: null,
  profile: null,
  transportStatus: null,
} as const;

vi.mock("./diagnostics-client.js", () => ({
  getClientDiagnosticsSnapshot: () => snapshot,
}));

describe("diagnostics-export download path", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the exported bundle through the real JSON download helper", async () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn(() => "blob:diagnostics");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("document", {
      createElement,
      body: {
        appendChild,
        removeChild,
      },
    });
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 7, 18, 29, 5));

    const exporter = vi.fn().mockResolvedValue({
      diagnosticSchemaVersion: 1,
      generatedAt: 1,
      scope: {
        windowMinutes: 60,
        includeTerminalOutput: true,
        terminalTailBytes: 65_536,
        terminalIds: null,
      },
      manifest: {
        backendEventCount: 0,
        terminalSessionCount: 0,
        retentionMinutes: 60,
        storage: "localConfigJsonl",
        droppedPersistEvents: 0,
        persistErrorCount: 0,
      },
      frontend: snapshot,
      backend: { events: [] },
      terminals: { sessions: [], tails: [] },
      system: {
        sampledAt: 1,
        uptimeSeconds: 1,
        cpu: { usagePercent: 0, logicalCoreCount: 1 },
        memory: {
          totalBytes: 1,
          usedBytes: 1,
          availableBytes: 0,
          usagePercent: 100,
        },
        disk: {
          name: "/",
          mountPoint: "/",
          totalBytes: 1,
          availableBytes: 0,
          usedBytes: 1,
          usagePercent: 100,
        },
        disks: [
          {
            name: "/",
            mountPoint: "/",
            totalBytes: 1,
            availableBytes: 0,
            usedBytes: 1,
            usagePercent: 100,
          },
        ],
        temperatures: [],
      },
    });

    const fileName = await exportDiagnosticsBundle(exporter);

    expect(fileName).toBe("dam-hopper-diagnostics-20260707-182905.json");
    expect(exporter).toHaveBeenCalledWith({
      windowMinutes: 60,
      includeTerminalOutput: true,
      terminalTailBytes: 65_536,
      frontend: snapshot,
    });
    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.href).toBe("blob:diagnostics");
    expect(anchor.download).toBe(
      "dam-hopper-diagnostics-20260707-182905.json",
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostics");
  });
});
