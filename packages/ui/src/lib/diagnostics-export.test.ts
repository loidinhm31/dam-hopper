import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDiagnosticsExportRequest,
  exportDiagnosticsBundle,
} from "./diagnostics-export.js";

const NOW = Date.UTC(2026, 6, 7, 18, 30, 0);
const snapshot = {
  manifest: {
    schemaVersion: 1,
    storageKey: "damhopper_diagnostics_frontend_v1",
    retentionMinutes: 60,
    maxEntries: 1_000,
    maxStorageBytes: 512 * 1024,
    entryCount: 3,
  },
  logs: [
    {
      timestamp: new Date(NOW - 60_000).toISOString(),
      timestampMs: NOW - 60_000,
      type: "log",
      scope: "SettingsPage",
      message: "settings event",
    },
    {
      timestamp: new Date(NOW - 20 * 60_000).toISOString(),
      timestampMs: NOW - 20 * 60_000,
      type: "log",
      scope: "SettingsPage",
      message: "older settings event",
    },
    {
      timestamp: new Date(NOW - 60_000).toISOString(),
      timestampMs: NOW - 60_000,
      type: "log",
      scope: "OtherPage",
      message: "other page event",
    },
  ],
  browserErrors: [],
  currentRoute: null,
  profile: null,
  transportStatus: null,
} as const;
const downloadJsonMock = vi.fn(() => "dam-hopper-diagnostics-20260707-181500.json");

vi.mock("./diagnostics-client.js", () => ({
  getClientDiagnosticsSnapshot: () => snapshot,
}));

vi.mock("./download-json.js", () => ({
  downloadJson: (value: unknown, options: unknown) =>
    downloadJsonMock(value, options),
}));

describe("diagnostics-export", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    downloadJsonMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the default request with the current frontend snapshot", () => {
    expect(buildDiagnosticsExportRequest()).toEqual({
      windowMinutes: 60,
      includeTerminalOutput: true,
      terminalTailBytes: 65_536,
      frontend: snapshot,
    });
  });

  it("filters frontend diagnostics and carries scope metadata", () => {
    expect(
      buildDiagnosticsExportRequest({
        windowMinutes: 5,
        terminalIds: ["terminal:app:_:1"],
        scope: {
          page: "settings",
          route: "/settings",
          terminalIds: ["terminal:app:_:1"],
          frontendScopes: ["SettingsPage"],
        },
      }),
    ).toEqual({
      windowMinutes: 5,
      includeTerminalOutput: true,
      terminalTailBytes: 65_536,
      terminalIds: ["terminal:app:_:1"],
      frontend: {
        ...snapshot,
        manifest: {
          ...snapshot.manifest,
          entryCount: 1,
        },
        logs: [snapshot.logs[0]],
        browserErrors: [],
        exportScope: {
          page: "settings",
          route: "/settings",
          terminalIds: ["terminal:app:_:1"],
          frontendScopes: ["SettingsPage"],
        },
      },
    });
  });

  it("can request a diagnostics bundle with no terminal data", () => {
    expect(
      buildDiagnosticsExportRequest({
        windowMinutes: 10,
        includeTerminalOutput: false,
        terminalIds: [],
        scope: {
          page: "settings",
          route: "/settings",
          terminalIds: [],
          frontendScopes: ["SettingsPage"],
        },
      }),
    ).toEqual({
      windowMinutes: 10,
      includeTerminalOutput: false,
      terminalTailBytes: 65_536,
      terminalIds: [],
      frontend: {
        ...snapshot,
        manifest: {
          ...snapshot.manifest,
          entryCount: 1,
        },
        logs: [snapshot.logs[0]],
        browserErrors: [],
        exportScope: {
          page: "settings",
          route: "/settings",
          terminalIds: [],
          frontendScopes: ["SettingsPage"],
        },
      },
    });
  });

  it("exports the bundle and downloads it with the expected file prefix", async () => {
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

    expect(exporter).toHaveBeenCalledWith({
      windowMinutes: 60,
      includeTerminalOutput: true,
      terminalTailBytes: 65_536,
      frontend: snapshot,
    });
    expect(downloadJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticSchemaVersion: 1 }),
      { filePrefix: "dam-hopper-diagnostics" },
    );
    expect(fileName).toBe("dam-hopper-diagnostics-20260707-181500.json");
  });

  it("propagates exporter failures without attempting a download", async () => {
    const exporter = vi.fn().mockRejectedValue(new Error("export failed"));

    await expect(exportDiagnosticsBundle(exporter)).rejects.toThrow(
      "export failed",
    );
    expect(downloadJsonMock).not.toHaveBeenCalled();
  });
});
