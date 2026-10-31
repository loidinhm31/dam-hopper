// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ConnectionRef } from "./ownership";
import {
  sessionChangesQueryKeys,
  useSessionChangesStatus,
  useSessionChangesFiles,
  useSessionChangesFileDetail,
  useSessionChangesRefreshMutation,
  useSessionChangesFromNowMutation,
} from "./session-changes-queries";
import fixture from "../../../../server/tests/fixtures/session-changes-wire.json";

// Mock queries helper getBoundApiClient
vi.mock("./queries", () => {
  return {
    getBoundApiClient: vi.fn().mockImplementation((owner: ConnectionRef) => {
      return {
        transport: {
          invoke: vi.fn().mockImplementation(async (channel: string, data?: unknown) => {
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
            if (channel === "sessionChanges:fromNow") {
              return fixture.valid.statusFromNowReady;
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

  it("executes startFromNow mutation", async () => {
    let mutateFn:
      | ((params: {
          terminalId: string;
          terminalIncarnation: string;
          ompSessionId: string;
          rootId: string;
          requestId: string;
          expectedServerEpoch?: string;
        }) => Promise<Status>)
      | undefined;

    function TestConsumer() {
      const m = useSessionChangesFromNowMutation(owner);
      mutateFn = m.mutateAsync;
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TestConsumer)),
      );
    });

    expect(mutateFn).toBeDefined();
    const status = await mutateFn({
      terminalId: "t1",
      terminalIncarnation: "1",
      ompSessionId: "s1",
      rootId: ".",
      requestId: "r2",
    });

    expect(status.origin).toBe("fromNow");
  });
});
