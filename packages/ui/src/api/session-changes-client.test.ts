import { describe, it, expect, vi } from "vitest";
import {
  SessionChangesClient,
  SessionChangesClientError,
} from "./session-changes-client";
import { ApiClient, ApiRequestError } from "./client";
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

  it("calls getFiles without revision for lazy bootstrap and passes rootId", async () => {
    let capturedData: unknown = null;
    const mockApi = createMockApiClient(async (channel, data) => {
      expect(channel).toBe("sessionChanges:files");
      capturedData = data;
      return fixture.valid.filePage;
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    const page = await client.getFiles({
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-session-456",
      rootId: "src",
      serverEpoch: "epoch-uuid-1",
      baselineId: "base-uuid-1",
    });

    expect(page.version).toBe(1);
    expect(page.comparison.comparisonRevision).toBe("1");
    expect((capturedData as Record<string, unknown>).rootId).toBe("src");
    expect((capturedData as Record<string, unknown>).comparisonRevision).toBeUndefined();
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

  it("translates ApiRequestError with details into SessionChangesClientError", async () => {
    const mockApi = createMockApiClient(async () => {
      const err = new ApiRequestError(
        "Revision mismatch",
        409,
        "CONFLICT",
        {
          version: 1,
          code: "refreshRequired",
          retryable: true,
          currentRevision: "3",
          reason: "Revision mismatch",
        },
      );
      throw err;
    });

    const client = new SessionChangesClient({ apiClient: mockApi });
    try {
      await client.getFiles({
        terminalId: "term-1",
        terminalIncarnation: "1",
        ompSessionId: "omp-session-456",
        serverEpoch: "epoch-uuid-1",
        baselineId: "base-uuid-1",
        comparisonRevision: "1",
      });
      expect.fail("Expected getFiles to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SessionChangesClientError);
      const clientErr = e as SessionChangesClientError;
      expect(clientErr.code).toBe("refreshRequired");
      expect(clientErr.retryable).toBe(true);
      expect(clientErr.currentRevision).toBe("3");
    }
  });
});
