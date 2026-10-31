import { describe, it, expect, vi } from "vitest";
import {
  SessionChangesClient,
  SessionChangesClientError,
} from "./session-changes-client";
import { ApiClient } from "./client";
import fixture from "../../../../server/tests/fixtures/session-changes-wire.json";

function createMockApiClient(invokeFn: (channel: string, data?: unknown) => Promise<unknown>) {
  return {
    transport: {
      invoke: vi.fn().mockImplementation(invokeFn),
    },
  } as unknown as ApiClient;
}

describe("SessionChangesClient", () => {
  it("fetches and decodes status", async () => {
    const mockApi = createMockApiClient(async (channel, data) => {
      expect(channel).toBe("sessionChanges:status");
      return fixture.valid.statusSessionStartReady;
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    const status = await client.getStatus({
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-session-456",
    });

    expect(status.state).toBe("ready");
    expect(status.baselineCoverage?.state).toBe("complete");
    expect(status.comparison?.changedFileCount).toBe(1);
  });

  it("calls startFromNow and decodes result", async () => {
    const mockApi = createMockApiClient(async (channel, data) => {
      expect(channel).toBe("sessionChanges:fromNow");
      return fixture.valid.statusFromNowReady;
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    const status = await client.startFromNow({
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-session-456",
      rootId: ".",
      requestId: "req-1",
    });

    expect(status.origin).toBe("fromNow");
    expect(status.acknowledgment).toBe("notApplicable");
  });

  it("calls refreshComparison and decodes result", async () => {
    const mockApi = createMockApiClient(async (channel, data) => {
      expect(channel).toBe("sessionChanges:refresh");
      return fixture.valid.statusSessionStartReady.comparison;
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    const comp = await client.refreshComparison({
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-session-456",
      serverEpoch: "epoch-uuid-1",
      baselineId: "base-uuid-1",
      requestId: "req-2",
    });

    expect(comp.changedFileCount).toBe(1);
    expect(comp.comparisonRevision).toBe("1");
  });

  it("calls getFiles and getFileDetail", async () => {
    const mockApi = createMockApiClient(async (channel) => {
      if (channel === "sessionChanges:files") {
        return fixture.valid.filePage;
      }
      if (channel === "sessionChanges:file") {
        return fixture.valid.fileDetail;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    const page = await client.getFiles({
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-session-456",
      serverEpoch: "epoch-uuid-1",
      baselineId: "base-uuid-1",
      comparisonRevision: "1",
    });
    expect(page.files.length).toBe(1);

    const detail = await client.getFileDetail({
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-session-456",
      serverEpoch: "epoch-uuid-1",
      baselineId: "base-uuid-1",
      comparisonRevision: "1",
      fileId: "fid-1",
    });
    expect(detail.file.path).toBe("src/main.rs");
    expect(detail.renderable).toBe(true);
  });

  it("translates server ErrorBody into SessionChangesClientError", async () => {
    const mockApi = createMockApiClient(async () => {
      const err = Object.assign(new Error("Request failed"), {
        response: {
          version: 1,
          code: "refreshRequired",
          retryable: true,
          currentRevision: "3",
          reason: "Revision mismatch",
        },
      });
      throw err;
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    await expect(
      client.getFiles({
        terminalId: "term-1",
        terminalIncarnation: "1",
        ompSessionId: "omp-session-456",
        serverEpoch: "epoch-uuid-1",
        baselineId: "base-uuid-1",
        comparisonRevision: "1",
      }),
    ).rejects.toThrow(SessionChangesClientError);
    try {
      await client.getFiles({
        terminalId: "term-1",
        terminalIncarnation: "1",
        ompSessionId: "omp-session-456",
        serverEpoch: "epoch-uuid-1",
        baselineId: "base-uuid-1",
        comparisonRevision: "1",
      });
    } catch (e) {
      const clientErr = e as SessionChangesClientError;
      expect(clientErr.code).toBe("refreshRequired");
      expect(clientErr.retryable).toBe(true);
      expect(clientErr.currentRevision).toBe("3");
    }
  });
});
