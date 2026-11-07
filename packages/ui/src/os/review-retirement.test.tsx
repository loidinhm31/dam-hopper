// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewRetirementGuard } from "./review-retirement.js";
import { useWindowStore } from "./window-store.js";
import type { OsWindow, OsSessionV1 } from "./types.js";
import type { ReviewTarget } from "@/api/terminal-session-contract.js";

const mockTracking = vi.hoisted(() => ({
  enabled: true,
  isLoading: false,
  error: null as unknown,
}));

vi.mock("@/api/session-changes-queries.js", () => ({
  cancelReviewQueries: vi.fn(),
  removeReviewQueries: vi.fn(),
  purgeOwnerReviewQueries: vi.fn(),
  useSessionChangesEnabled: () => ({
    enabled: mockTracking.enabled,
    isLoading: mockTracking.isLoading,
    error: mockTracking.error,
  }),
}));

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (profileId: string) => ({
    status: "connected",
    serverUrl: "http://localhost:3000",
    owner: { profileId, generation: 1 },
  }),
  subscribeConnections: () => () => {},
}));

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => [{ id: "test-prof", name: "Test" }],
  subscribeToProfileChanges: () => () => {},
}));

describe("ReviewRetirementGuard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let qc: QueryClient;

  const validTarget: ReviewTarget = {
    profileId: "test-prof",
    generation: 1,
    terminalId: "term-1",
    terminalIncarnation: "1",
    ompSessionId: "omp-1",
    serverEpoch: "epoch-1",
    rootId: "root-sha",
    baselineId: "base-sha",
  };

  const initialWindow: OsWindow = {
    id: "win-review-1",
    appId: "session-changes",
    title: "Session Changes",
    desktopId: "d1",
    ctx: { profileId: "test-prof" },
    mode: "float",
    minimized: true, // Hidden / minimized window
    runtimeIdentity: {
      kind: "review",
      target: validTarget,
    },
    appState: {
      target: validTarget,
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-1",
      serverEpoch: "epoch-1",
      rootId: "root-sha",
      baselineId: "base-sha",
      generation: 1,
    },
  };

  beforeEach(() => {
    qc = new QueryClient();
    mockTracking.enabled = true;
    mockTracking.isLoading = false;
    mockTracking.error = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const testSession: OsSessionV1 = {
      version: 1,
      activeDesktopId: "d1",
      desktops: [{ id: "d1", name: "Desk 1", tree: null, floatingWindowIds: ["win-review-1"] }],
      windows: {
        "win-review-1": initialWindow,
      },
    };
    useWindowStore.getState().setSession(testSession);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  it("retires hidden review window and strips tuple when tracking is disabled", async () => {
    function Host(): ReactElement {
      const win = useWindowStore((state) => state.session.windows["win-review-1"]);
      if (!win) return createElement("div", null, "no-window");
      return createElement(ReviewRetirementGuard, { window: win });
    }

    await act(async () => {
      root?.render(
        createElement(QueryClientProvider, { client: qc }, createElement(Host)),
      );
    });

    // Initially window retains target
    let win = useWindowStore.getState().session.windows["win-review-1"];
    expect(win.runtimeIdentity).toBeDefined();
    expect(win.appState?.target).toEqual(validTarget);

    // Disable tracking
    await act(async () => {
      mockTracking.enabled = false;
      root?.render(
        createElement(QueryClientProvider, { client: qc }, createElement(Host)),
      );
    });

    // Window must be retired: runtimeIdentity stripped, appState target stripped
    win = useWindowStore.getState().session.windows["win-review-1"];
    expect(win.runtimeIdentity).toBeUndefined();
    expect(win.appState?.target).toBeUndefined();
    expect(win.appState?.retiredReason).toBe("tracking_disabled");

    // Re-enabling tracking must NOT resurrect the stripped authority
    await act(async () => {
      mockTracking.enabled = true;
      root?.render(
        createElement(QueryClientProvider, { client: qc }, createElement(Host)),
      );
    });

    win = useWindowStore.getState().session.windows["win-review-1"];
    expect(win.runtimeIdentity).toBeUndefined();
    expect(win.appState?.target).toBeUndefined();
    expect(win.appState?.retiredReason).toBe("tracking_disabled");
  });
});
