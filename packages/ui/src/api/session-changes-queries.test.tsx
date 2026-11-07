// @vitest-environment jsdom
import { act, createElement, useState, useCallback, useRef, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ConnectionRef } from "./ownership";
import { SessionChangesClientError } from "./session-changes-client";
import { ApiRequestError } from "./client";
import {
  sessionChangesQueryKeys,
  useSessionChangesStatus,
  useSessionChangesFiles,
  useSessionChangesFileDetail,
  useSessionChangesRefreshMutation,
  matchesReviewTargetQuery,
  cancelReviewQueries,
  removeReviewQueries,
  purgeOwnerReviewQueries,
} from "./session-changes-queries";
import type { ReviewTarget } from "./terminal-session-contract";
import fixture from "../../../../server/tests/fixtures/session-changes-wire.json";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let customInvokeMock: ((channel: string, data?: unknown) => Promise<unknown>) | null = null;

// Mock queries helper getBoundApiClient
vi.mock("./queries", () => {
  return {
    getBoundApiClient: vi.fn().mockImplementation((owner: ConnectionRef) => {
      return {
        transport: {
          invoke: vi.fn().mockImplementation(async (channel: string, data?: unknown) => {
            if (customInvokeMock) {
              return customInvokeMock(channel, data);
            }
            if (channel === "sessionChanges:status") {
              return fixture.valid.statusSessionStartReady;
            }
            if (channel === "sessionChanges:files") {
              return fixture.valid.filePage;
            }
            if (channel === "sessionChanges:file") {
              return fixture.valid.fileDetail;
            }
            if (channel === "sessionChanges:refresh") {
              return fixture.valid.statusSessionStartReady.comparison;
            }
            throw new Error(`Unhandled mock channel: ${channel}`);
          }),
        },
      };
    }),
  };
});

describe("sessionChangesQueryKeys", () => {
  it("builds profile and generation scoped query keys", () => {
    const owner1: ConnectionRef = { profileId: "prof-1", generation: 1 };
    const owner2: ConnectionRef = { profileId: "prof-1", generation: 2 };
    const owner3: ConnectionRef = { profileId: "prof-2", generation: 1 };

    const k1 = sessionChangesQueryKeys.status(owner1, "t1", "1", "s1", ".");
    const k2 = sessionChangesQueryKeys.status(owner2, "t1", "1", "s1", ".");
    const k3 = sessionChangesQueryKeys.status(owner3, "t1", "1", "s1", ".");

    expect(k1).not.toEqual(k2);
    expect(k1).not.toEqual(k3);
    expect(k1).toEqual([
      "profile",
      "prof-1",
      1,
      "session-changes",
      "status",
      "t1",
      "1",
      "s1",
      ".",
    ]);

    const filesKey = sessionChangesQueryKeys.files(
      owner1,
      "t1",
      "1",
      "s1",
      "ep1",
      "base1",
      "1",
      "cur1",
      50,
    );
    expect(filesKey).toEqual([
      "profile",
      "prof-1",
      1,
      "session-changes",
      "files",
      "t1",
      "1",
      "s1",
      "ep1",
      "base1",
      "1",
      "cur1",
      50,
      ".",
    ]);
  });
});

describe("session-changes React Query hooks", () => {
  const owner: ConnectionRef = { profileId: "prof-1", generation: 1 };
  let qc: QueryClient;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    customInvokeMock = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    qc.clear();
  });

  it("fetches status via useSessionChangesStatus", async () => {
    let capturedData: unknown = undefined;

    function TestConsumer() {
      const q = useSessionChangesStatus(owner, "t1", "1", "s1", ".");
      if (q.isSuccess) {
        capturedData = q.data;
      }
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    await vi.waitFor(() => {
      expect(capturedData).toBeDefined();
    });

    const status = capturedData as { state: string; origin: string };
    expect(status.state).toBe("ready");
    expect(status.origin).toBe("sessionStart");
  });

  it("fetches files page via useSessionChangesFiles", async () => {
    let capturedData: unknown = undefined;

    function TestConsumer() {
      const q = useSessionChangesFiles(owner, "t1", "1", "s1", "ep1", "b1", "1");
      if (q.isSuccess) {
        capturedData = q.data;
      }
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    await vi.waitFor(() => {
      expect(capturedData).toBeDefined();
    });

    const page = capturedData as { files: Array<{ path: string }> };
    expect(page.files.length).toBe(1);
    expect(page.files[0].path).toBe("src/main.rs");
  });

  it("fetches file detail via useSessionChangesFileDetail", async () => {
    let capturedData: unknown = undefined;

    function TestConsumer() {
      const q = useSessionChangesFileDetail(
        owner,
        "t1",
        "1",
        "s1",
        "ep1",
        "b1",
        "1",
        "fid-1",
      );
      if (q.isSuccess) {
        capturedData = q.data;
      }
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    await vi.waitFor(() => {
      expect(capturedData).toBeDefined();
    });

    const detail = capturedData as { file: { path: string }; renderable: boolean };
    expect(detail.file.path).toBe("src/main.rs");
    expect(detail.renderable).toBe(true);
  });

  it("executes refresh mutation", async () => {
    let mutateFn:
      | ((params: {
          terminalId: string;
          terminalIncarnation: string;
          ompSessionId: string;
          serverEpoch: string;
          baselineId: string;
          requestId: string;
        }) => Promise<Comparison>)
      | undefined;

    function TestConsumer() {
      const m = useSessionChangesRefreshMutation(owner);
      mutateFn = m.mutateAsync;
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    expect(mutateFn).toBeDefined();
    const comp = await mutateFn({
      terminalId: "t1",
      terminalIncarnation: "1",
      ompSessionId: "s1",
      serverEpoch: "ep1",
      baselineId: "b1",
      requestId: "r1",
    });

    expect(comp.changedFileCount).toBe(1);
  });

  it("fetches files page lazily without revision and passes rootId", async () => {
    let capturedData: unknown = undefined;

    function TestConsumer() {
      const q = useSessionChangesFiles(
        owner,
        "t1",
        "1",
        "s1",
        "ep1",
        "b1",
        null,
        null,
        200,
        "src",
      );
      if (q.isSuccess) {
        capturedData = q.data;
      }
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(TestConsumer),
        ),
      );
    });
    await vi.waitFor(() => {
      expect(capturedData).toBeDefined();
    });
  });

  it("cooperates across stale files error, refresh mutation, invalidation, and revision advancement without loop", async () => {
    let filesCalls = 0;
    let refreshCalls = 0;
    let shouldFailStale = true;

    customInvokeMock = async (channel: string) => {
      if (channel === "sessionChanges:files") {
        filesCalls++;
        if (shouldFailStale) {
          throw new ApiRequestError("Revision is stale", 409, "refreshRequired", {
            version: 1,
            code: "refreshRequired",
            reason: "Revision is stale",
            retryable: false,
            currentRevision: "2",
          });
        }
        return {
          ...fixture.valid.filePage,
          comparison: {
            ...fixture.valid.filePage.comparison,
            comparisonRevision: "2",
          },
        };
      }
      if (channel === "sessionChanges:refresh") {
        refreshCalls++;
        shouldFailStale = false;
        return {
          ...fixture.valid.statusSessionStartReady.comparison,
          comparisonRevision: "2",
        };
      }
      return fixture.valid.statusSessionStartReady;
    };

    function TestLifecycleConsumer() {
      const [rev, setRev] = useState<string | null>("1");
      const filesQuery = useSessionChangesFiles(owner, "t1", "1", "s1", "ep1", "b1", rev);
      const refreshMutation = useSessionChangesRefreshMutation(owner);
      const { mutateAsync } = refreshMutation;
      const lastRecoveredKeyRef = useRef<string | null>(null);
      const handleRefresh = useCallback(async () => {
        const comp = await mutateAsync({
          terminalId: "t1",
          terminalIncarnation: "1",
          ompSessionId: "s1",
          serverEpoch: "ep1",
          baselineId: "b1",
          requestId: "req-1",
        });
        setRev(comp.comparisonRevision);
      }, [mutateAsync]);

      useEffect(() => {
        if (
          filesQuery.error instanceof SessionChangesClientError &&
          filesQuery.error.code === "refreshRequired"
        ) {
          const requestedRev = rev ?? "bootstrap";
          const key = `ep1:b1:${requestedRev}`;
          if (lastRecoveredKeyRef.current === key) return;
          lastRecoveredKeyRef.current = key;
          queueMicrotask(() => {
            void handleRefresh();
          });
        }
      }, [filesQuery.error, handleRefresh, rev]);

      return createElement("div", {
        "data-testid": "lifecycle-state",
        "data-rev": rev,
        "data-success": String(filesQuery.isSuccess),
      });
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(TestLifecycleConsumer),
        ),
      );
    });

    // Wait for auto-recovery cycle to settle
    await vi.waitFor(() => {
      expect(refreshCalls).toBe(1);
      expect(filesCalls).toBeGreaterThanOrEqual(2);
    }, { timeout: 2000 });

    // Extra rerender
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(TestLifecycleConsumer),
        ),
      );
    });

    // Refresh calls strictly bounded to 1
    expect(refreshCalls).toBe(1);
  });
});

describe("targeted ReviewTarget query cancellation and owner purge", () => {
  const targetA: ReviewTarget = {
    profileId: "prof-1",
    generation: 1,
    terminalId: "term-A",
    terminalIncarnation: "1",
    ompSessionId: "omp-A",
    serverEpoch: "epoch-A",
    rootId: "root-A",
    baselineId: "base-A",
  };

  const targetB: ReviewTarget = {
    profileId: "prof-1", // Same profile & generation!
    generation: 1,
    terminalId: "term-B",
    terminalIncarnation: "1",
    ompSessionId: "omp-B",
    serverEpoch: "epoch-B",
    rootId: "root-B",
    baselineId: "base-B",
  };

  it("matchesReviewTargetQuery correctly discriminates status, files, and fileDetail queries", () => {
    const owner: ConnectionRef = { profileId: targetA.profileId, generation: targetA.generation };

    const statusKeyA = sessionChangesQueryKeys.status(
      owner,
      targetA.terminalId,
      targetA.terminalIncarnation,
      targetA.ompSessionId,
      targetA.rootId,
    );
    const statusKeyB = sessionChangesQueryKeys.status(
      owner,
      targetB.terminalId,
      targetB.terminalIncarnation,
      targetB.ompSessionId,
      targetB.rootId,
    );

    const filesKeyA = sessionChangesQueryKeys.files(
      owner,
      targetA.terminalId,
      targetA.terminalIncarnation,
      targetA.ompSessionId,
      targetA.serverEpoch,
      targetA.baselineId,
      "rev-1",
      null,
      null,
      targetA.rootId,
    );

    expect(matchesReviewTargetQuery(statusKeyA, targetA)).toBe(true);
    expect(matchesReviewTargetQuery(statusKeyB, targetA)).toBe(false);
    expect(matchesReviewTargetQuery(filesKeyA, targetA)).toBe(true);
    expect(matchesReviewTargetQuery(filesKeyA, targetB)).toBe(false);
  });

  it("removeReviewQueries removes only target queries and preserves sibling review caches under same owner", () => {
    const qc = new QueryClient();
    const owner: ConnectionRef = { profileId: targetA.profileId, generation: targetA.generation };

    const statusKeyA = sessionChangesQueryKeys.status(
      owner,
      targetA.terminalId,
      targetA.terminalIncarnation,
      targetA.ompSessionId,
      targetA.rootId,
    );
    const statusKeyB = sessionChangesQueryKeys.status(
      owner,
      targetB.terminalId,
      targetB.terminalIncarnation,
      targetB.ompSessionId,
      targetB.rootId,
    );

    qc.setQueryData(statusKeyA, { state: "ready", session: "A" });
    qc.setQueryData(statusKeyB, { state: "ready", session: "B" });

    // Single-view close targeted removal for targetA
    removeReviewQueries(qc, targetA);

    // Target A queries are removed
    expect(qc.getQueryData(statusKeyA)).toBeUndefined();
    // Sibling target B queries remain intact!
    expect(qc.getQueryData(statusKeyB)).toEqual({ state: "ready", session: "B" });
  });

  it("purgeOwnerReviewQueries removes all review queries under retired owner", async () => {
    const qc = new QueryClient();
    const owner: ConnectionRef = { profileId: targetA.profileId, generation: targetA.generation };

    const statusKeyA = sessionChangesQueryKeys.status(
      owner,
      targetA.terminalId,
      targetA.terminalIncarnation,
      targetA.ompSessionId,
      targetA.rootId,
    );
    const statusKeyB = sessionChangesQueryKeys.status(
      owner,
      targetB.terminalId,
      targetB.terminalIncarnation,
      targetB.ompSessionId,
      targetB.rootId,
    );

    qc.setQueryData(statusKeyA, { state: "ready", session: "A" });
    qc.setQueryData(statusKeyB, { state: "ready", session: "B" });

    await purgeOwnerReviewQueries(qc, owner);

    expect(qc.getQueryData(statusKeyA)).toBeUndefined();
    expect(qc.getQueryData(statusKeyB)).toBeUndefined();
  });
});
