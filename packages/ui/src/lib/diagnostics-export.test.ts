import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDiagnosticsExportRequest,
  exportDiagnosticsBundle,
} from "./diagnostics-export.js";

const snapshot = { manifest: { entryCount: 1 } };
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
    downloadJsonMock.mockClear();
  });

  it("builds the default request with the current frontend snapshot", () => {
    expect(buildDiagnosticsExportRequest()).toEqual({
      windowMinutes: 60,
      includeTerminalOutput: true,
      terminalTailBytes: 65_536,
      frontend: snapshot,
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
