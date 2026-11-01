// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { SessionChangesPanel } from "./SessionChangesPanel";
import { SessionChangesClientError } from "@/api/session-changes-client";
import type { ConnectionRef } from "@/api/ownership";
import type { Status, Comparison, FilePage } from "@/api/session-changes-types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const owner: ConnectionRef = { profileId: "p1", generation: 1 };

let mockStatus: Status | undefined;
let mockFilesError: unknown = null;
let mockFilesData: FilePage | undefined;
let mockDetailError: unknown = null;
let mockRefreshMutateAsync: Mock;
let mockRefreshIsPending = false;
let mockRefreshData: Comparison | null = null;
let mockRefreshError: Error | null = null;

vi.mock("./ReadonlyMonacoDiffViewer", () => ({
  ReadonlyMonacoDiffViewer: () => <div data-testid="mock-diff-viewer" />,
}));

vi.mock("./SessionChangedFilesList", () => ({
  SessionChangedFilesList: () => <div data-testid="mock-files-list" />,
}));

vi.mock("@/api/session-changes-queries", () => {
  return {
    useSessionChangesStatus: vi.fn(() => ({
      data: mockStatus,
      isLoading: false,
      isError: false,
      error: null,
    })),
    useSessionChangesFiles: vi.fn(() => ({
      data: mockFilesData,
      isLoading: false,
      isError: Boolean(mockFilesError),
      error: mockFilesError,
    })),
    useSessionChangesFileDetail: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: Boolean(mockDetailError),
      error: mockDetailError,
    })),
    useSessionChangesRefreshMutation: vi.fn(() => ({
      mutateAsync: mockRefreshMutateAsync,
      isPending: mockRefreshIsPending,
      data: mockRefreshData,
      error: mockRefreshError,
      variables: mockRefreshMutateAsync?.mock?.calls?.[0]?.[0] ?? null,
    })),
  };
});

describe("SessionChangesPanel Stale Revision Recovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    mockRefreshMutateAsync = vi.fn().mockImplementation(async () => {
      return {
        serverEpoch: "epoch-1",
        baselineId: "base-1",
        comparisonRevision: "2",
        comparedAtMs: Date.now(),
        currentCoverage: {
          state: "complete",
          inventoryComplete: true,
          absenceProofComplete: true,
          provenanceEntries: 1,
          eligibleEntries: 1,
          capturedEntries: 1,
          omittedEntries: null,
          rawBytes: 100,
          reasons: [],
        },
        changedFileCount: 1,
        additions: 1,
        deletions: 0,
        countsComplete: true,
        settledTurnId: "turn-1",
      };
    });

    mockStatus = {
      version: 1,
      serverEpoch: "epoch-1",
      terminalIncarnation: "1",
      ompSessionId: "s1",
      rootId: ".",
      baselineId: "base-1",
      origin: "sessionStart",
      state: "ready",
      acknowledgment: "received",
      capturedAtMs: Date.now(),
      baselineCoverage: {
        state: "complete",
        inventoryComplete: true,
        absenceProofComplete: true,
        provenanceEntries: 1,
        eligibleEntries: 1,
        capturedEntries: 1,
        omittedEntries: null,
        rawBytes: 100,
        reasons: [],
      },
      comparison: {
        serverEpoch: "epoch-1",
        baselineId: "base-1",
        comparisonRevision: "1",
        comparedAtMs: Date.now(),
        currentCoverage: {
          state: "complete",
          inventoryComplete: true,
          absenceProofComplete: true,
          provenanceEntries: 1,
          eligibleEntries: 1,
          capturedEntries: 1,
          omittedEntries: null,
          rawBytes: 100,
          reasons: [],
        },
        changedFileCount: 1,
        additions: 1,
        deletions: 0,
        countsComplete: true,
        settledTurnId: "turn-1",
      },
      reason: null,
      sharedWriters: true,
    };

    mockFilesError = null;
    mockFilesData = undefined;
    mockDetailError = null;
    mockRefreshIsPending = false;
    mockRefreshData = null;
    mockRefreshError = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("triggers exactly one automatic refresh recovery per stale revision and does not loop on rerender", async () => {
    // 1. Files query returns stale error for revision 1
    mockFilesError = new SessionChangesClientError(
      "Revision is stale",
      "refreshRequired",
      false,
      "1",
    );

    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    // Exactly one refresh request triggered for revision 1
    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(1);

    // 2. Re-render multiple times while the error remains active
    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });
    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    // Still exactly 1 call (no endless refresh loop)
    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(1);

    // 3. Simulate new comparison revision 2 arriving from refresh
    mockFilesError = null;
    mockStatus = {
      ...mockStatus!,
      comparison: {
        ...mockStatus!.comparison!,
        comparisonRevision: "2",
      },
    };

    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    // 4. Now revision 2 later encounters a refreshRequired error
    mockFilesError = new SessionChangesClientError(
      "Revision 2 is stale",
      "refreshRequired",
      false,
      "2",
    );

    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    // Genuinely new stale revision 2 triggers exactly one more recovery!
    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(2);

    // Rerendering while revision 2 error remains does NOT retrigger
    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });
    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("does not loop when automatic recovery refresh fails", async () => {
    mockRefreshMutateAsync = vi.fn().mockRejectedValue(new Error("Network failure"));
    mockFilesError = new SessionChangesClientError(
      "Revision is stale",
      "refreshRequired",
      false,
      "1",
    );

    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(1);

    // Rerender after failure does not retry endlessly
    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate recovery when failing request for revision 1 receives advancing server revision hints (2 and then 3)", async () => {
    // 1. Files request for revision 1 fails with server hint "2"
    mockFilesError = new SessionChangesClientError(
      "Revision is stale",
      "refreshRequired",
      false,
      "2",
    );

    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(1);

    // 2. Server advances hint to "3" while the request remains for revision 1
    mockFilesError = new SessionChangesClientError(
      "Revision is stale",
      "refreshRequired",
      false,
      "3",
    );

    await act(async () => {
      root.render(
        <SessionChangesPanel
          owner={owner}
          terminalId="t1"
          terminalIncarnation="1"
          ompSessionId="s1"
        />,
      );
    });

    // Still exactly 1 refresh call because the requested revision (1) was already recovered!
    expect(mockRefreshMutateAsync).toHaveBeenCalledTimes(1);
  });
});
