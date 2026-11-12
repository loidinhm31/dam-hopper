import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import "@/index.css";
import "@/os/os.css";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import {
  __setConnectionSnapshotForTests,
  registerConnectionRegistryQueryClient,
  resetConnections,
} from "@/api/connections.js";
import { createApiClient } from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { saveProfiles } from "@/api/server-config.js";
import {
  clearCloseLifecycleForTesting,
  closeBrowserTarget,
} from "@/os/browser/browser-close-lifecycle.js";
import { addClosingGate, isNativeTargetClosing, removeClosingGate } from "@/os/browser/browser-closing-gates.js";
import { commitNativeTargetAdmission } from "@/os/browser/browser-admission-guard.js";
import { createBrowserNativeTargetKey } from "@/os/browser/browser-owner-scope.js";
import type {
  BrowserOwnerScope,
  BrowserWindowState,
} from "@/os/browser/browser-tab-types.js";

const defaultScope: BrowserOwnerScope = {
  profileId: "default",
  endpoint: "http://127.0.0.1:4801",
  principal: "dev-user",
  namespace: "dev",
};

function createCanonicalBrowserState(
  tabId: string,
  sessionId: string,
  url: string,
  scope: BrowserOwnerScope = defaultScope,
): BrowserWindowState {
  return {
    browserStateVersion: 1,
    activeTabId: tabId,
    ownerScope: scope,
    tabs: [
      {
        tabId,
        kind: "ordinary",
        phase: "live",
        sessionId,
        committedUrl: url,
        draft: { value: url, dirty: false },
        actionSequence: 0,
        snapshot: {
          browserSessionId: sessionId,
          url,
          status: "running",
          navigationRevision: "1",
        },
      },
    ],
  };
}

describe("Host Browser Lifecycle & Window Policy Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;
  let unregisterQc: (() => void) | null = null;
  let fetchStub: Mock;

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    clearCloseLifecycleForTesting();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession());
    useCognitoModeStore.getState().reset();

    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    unregisterQc = registerConnectionRegistryQueryClient(queryClient);

    const profile = {
      id: "default",
      name: "Default Profile",
      url: "http://127.0.0.1:4801",
      authType: "none" as const,
      createdAt: 0,
    };
    saveProfiles([profile]);
    const transport = new WsTransport("http://127.0.0.1:4801", () => null);
    const apiClient = createApiClient({ profileId: "default", generation: 1 }, transport);

    __setConnectionSnapshotForTests(
      "default",
      {
        profile,
        serverUrl: "http://127.0.0.1:4801",
        owner: { profileId: "default", generation: 1 },
        status: "connected",
        intent: true,
        transport,
        api: apiClient,
        mfaState: "none",
        sessionTtl: null,
        verifiedBrowserIdentity: {
          principal: "dev-user",
          namespace: "dev",
        },
      },
      transport,
    );

    fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET");

      if (method === "DELETE" && url.includes("/api/browser/sessions/")) {
        return new Response(null, { status: 204 });
      }

      if (url.includes("/api/browser/sessions/")) {
        return new Response(
          JSON.stringify({
            browserSessionId: "mock-sess",
            url: "http://localhost:5173/page",
            status: "running",
            navigationRevision: "1",
            historyIndex: 0,
            canGoBack: false,
            canGoForward: false,
            viewport: { width: 1280, height: 800, dpr: 1 },
            hasController: false,
            isController: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentElement) {
      container.parentElement.removeChild(container);
      container = null;
    }
    unregisterQc?.();
    unregisterQc = null;
    resetConnections();
    clearCloseLifecycleForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderOsShell = async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <OsShell />
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });
  };

  it("explicit close of one target leaves sibling target live", async () => {
    await renderOsShell();

    // 1. Open two browser windows with same URL but independent sessions
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-target-1",
        appId: "browser",
        title: "Browser Target 1",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-1", "sess-1", "http://localhost:5173/page"),
      });
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-target-2",
        appId: "browser",
        title: "Browser Target 2",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-2", "sess-2", "http://localhost:5173/page"),
      });
    });

    // Both stream containers exist
    expect(
      document.querySelector('[data-os-browser-window-id="win-browser-target-1"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-os-browser-window-id="win-browser-target-2"]'),
    ).not.toBeNull();

    // 2. Explicitly close window 1
    await act(async () => {
      useWindowStore.getState().closeWindow("win-browser-target-1");
    });
    // Window 1 is removed from session windows and its stream container cleaned up
    await vi.waitFor(() => {
      expect(useWindowStore.getState().session.windows["win-browser-target-1"]).toBeUndefined();
      expect(
        document.querySelector('[data-os-browser-window-id="win-browser-target-1"]'),
      ).toBeNull();
    });
    // Sibling window 2 remains active and live
    expect(useWindowStore.getState().session.windows["win-browser-target-2"]).toBeDefined();
    expect(
      document.querySelector('[data-os-browser-window-id="win-browser-target-2"]'),
    ).not.toBeNull();
  });

  it("reverses obsolete shared-close expectation: first release issues no DELETE, final close issues one DELETE", async () => {
    await renderOsShell();

    // Two windows viewing the same underlying target sessionId
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-viewer-a",
        appId: "browser",
        title: "Viewer A",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-a", "sess-shared-target-x", "http://localhost:5173/shared"),
      });
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-viewer-b",
        appId: "browser",
        title: "Viewer B",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-b", "sess-shared-target-x", "http://localhost:5173/shared"),
      });
    });

    expect(
      document.querySelector('[data-os-browser-window-id="win-viewer-a"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-os-browser-window-id="win-viewer-b"]'),
    ).not.toBeNull();

    // Close Viewer A: first release must NOT issue remote DELETE
    await act(async () => {
      useWindowStore.getState().closeWindow("win-viewer-a");
    });
    await vi.waitFor(() => {
      expect(useWindowStore.getState().session.windows["win-viewer-a"]).toBeUndefined();
      expect(
        document.querySelector('[data-os-browser-window-id="win-viewer-a"]'),
      ).toBeNull();
    });

    const deletesAfterFirst = fetchStub.mock.calls.filter((c) => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return init?.method === "DELETE" && url.includes("sess-shared-target-x");
    });
    expect(deletesAfterFirst).toHaveLength(0);

    // Viewer B is still active
    expect(useWindowStore.getState().session.windows["win-viewer-b"]).toBeDefined();
    expect(
      document.querySelector('[data-os-browser-window-id="win-viewer-b"]'),
    ).not.toBeNull();

    // Close Viewer B: final release issues remote DELETE
    await act(async () => {
      useWindowStore.getState().closeWindow("win-viewer-b");
    });
    await vi.waitFor(() => {
      expect(useWindowStore.getState().session.windows["win-viewer-b"]).toBeUndefined();
      expect(
        document.querySelector('[data-os-browser-window-id="win-viewer-b"]'),
      ).toBeNull();
    });
    const deletesAfterSecond = fetchStub.mock.calls.filter((c) => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return init?.method === "DELETE" && url.includes("sess-shared-target-x");
    });
    expect(deletesAfterSecond).toHaveLength(1);
  });

  it("handles two profiles on same endpoint/principal/namespace: first close no DELETE, final close one DELETE", async () => {
    // Configure two distinct profiles sharing the same serverUrl, principal, and namespace
    const p1 = {
      id: "prof-1",
      name: "Profile 1",
      url: "http://127.0.0.1:4801",
      authType: "none" as const,
      createdAt: 0,
    };
    const p2 = {
      id: "prof-2",
      name: "Profile 2",
      url: "http://127.0.0.1:4801",
      authType: "none" as const,
      createdAt: 0,
    };
    saveProfiles([p1, p2]);
    const transport1 = new WsTransport("http://127.0.0.1:4801", () => null);
    const transport2 = new WsTransport("http://127.0.0.1:4801", () => null);

    __setConnectionSnapshotForTests(
      "prof-1",
      {
        profile: p1,
        serverUrl: "http://127.0.0.1:4801",
        owner: { profileId: "prof-1", generation: 1 },
        status: "connected",
        intent: true,
        transport: transport1,
        api: createApiClient({ profileId: "prof-1", generation: 1 }, transport1),
        mfaState: "none",
        sessionTtl: null,
        verifiedBrowserIdentity: { principal: "shared-user", namespace: "dev" },
      },
      transport1,
    );

    __setConnectionSnapshotForTests(
      "prof-2",
      {
        profile: p2,
        serverUrl: "http://127.0.0.1:4801",
        owner: { profileId: "prof-2", generation: 1 },
        status: "connected",
        intent: true,
        transport: transport2,
        api: createApiClient({ profileId: "prof-2", generation: 1 }, transport2),
        mfaState: "none",
        sessionTtl: null,
        verifiedBrowserIdentity: { principal: "shared-user", namespace: "dev" },
      },
      transport2,
    );

    const scope1: BrowserOwnerScope = {
      profileId: "prof-1",
      endpoint: "http://127.0.0.1:4801",
      principal: "shared-user",
      namespace: "dev",
    };
    const scope2: BrowserOwnerScope = {
      profileId: "prof-2",
      endpoint: "http://127.0.0.1:4801",
      principal: "shared-user",
      namespace: "dev",
    };

    await renderOsShell();

    // Open window in prof-1
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-prof1",
        appId: "browser",
        title: "Browser P1",
        ctx: { profileId: "prof-1" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-p1", "sess-multi-prof", "http://localhost:5173/multi", scope1),
      });
    });

    // Open window in prof-2 viewing the exact same native target
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-prof2",
        appId: "browser",
        title: "Browser P2",
        ctx: { profileId: "prof-2" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-p2", "sess-multi-prof", "http://localhost:5173/multi", scope2),
      });
    });

    expect(document.querySelector('[data-os-browser-window-id="win-prof1"]')).not.toBeNull();
    expect(document.querySelector('[data-os-browser-window-id="win-prof2"]')).not.toBeNull();

    // Close window in prof-1: census recognizes prof-2 still active, so no DELETE
    await act(async () => {
      useWindowStore.getState().closeWindow("win-prof1");
    });

    const p1Deletes = fetchStub.mock.calls.filter((c) => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return init?.method === "DELETE" && url.includes("sess-multi-prof");
    });
    await vi.waitFor(() => {
      expect(useWindowStore.getState().session.windows["win-prof1"]).toBeUndefined();
      expect(document.querySelector('[data-os-browser-window-id="win-prof1"]')).toBeNull();
    });
    expect(p1Deletes).toHaveLength(0);
    expect(document.querySelector('[data-os-browser-window-id="win-prof2"]')).not.toBeNull();
    // Close window in prof-2: final reference releases and issues DELETE
    await act(async () => {
      useWindowStore.getState().closeWindow("win-prof2");
    });
    await vi.waitFor(() => {
      expect(useWindowStore.getState().session.windows["win-prof2"]).toBeUndefined();
      expect(document.querySelector('[data-os-browser-window-id="win-prof2"]')).toBeNull();
    });

    const finalDeletes = fetchStub.mock.calls.filter((c) => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return init?.method === "DELETE" && url.includes("sess-multi-prof");
    });
    expect(finalDeletes).toHaveLength(1);
  });
  it("racing close/attach gate exclusion and changed endpoint/principal rejection", async () => {
    const scope: BrowserOwnerScope = {
      profileId: "default",
      endpoint: "http://127.0.0.1:4801",
      principal: "dev-user",
      namespace: "dev",
    };
    const targetKey = createBrowserNativeTargetKey(scope, "sess-gated");
    expect(targetKey).not.toBeNull();

    // Racing close/attach gate exclusion: active closing gate blocks admission
    addClosingGate(targetKey!);
    expect(isNativeTargetClosing(targetKey!)).toBe(true);
    let committed = false;
    const admissionBlocked = commitNativeTargetAdmission(scope, "sess-gated", () => {
      committed = true;
    });
    expect(admissionBlocked).toBe(false);
    expect(committed).toBe(false);

    removeClosingGate(targetKey!);
    expect(isNativeTargetClosing(targetKey!)).toBe(false);
    const admissionAllowed = commitNativeTargetAdmission(scope, "sess-gated", () => {
      committed = true;
    });
    expect(admissionAllowed).toBe(true);
    expect(committed).toBe(true);

    // Changed initiating principal or endpoint rejects without I/O
    const mismatchedScope: BrowserOwnerScope = {
      profileId: "default",
      endpoint: "http://foreign-host.local:4801",
      principal: "intruder",
      namespace: "dev",
    };
    const rejectOutcome = await closeBrowserTarget({
      owner: { profileId: "default", generation: 1 },
      scope: mismatchedScope,
      sessionId: "sess-gated",
      windowId: "win-mismatch",
    });
    expect(rejectOutcome.kind).toBe("rejected");

    const mismatchDeletes = fetchStub.mock.calls.filter((c) => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return init?.method === "DELETE" && url.includes("sess-gated");
    });
    expect(mismatchDeletes).toHaveLength(0);

    // Placement-only windows remain blank (no legacy alias)
    await renderOsShell();
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-blank-placement",
        appId: "browser",
        title: "Browser Empty",
        ctx: { profileId: "default" },
        mode: "tile",
      });
    });

    // Placement-only window does not instantiate a live stream container or make remote calls
    expect(document.querySelector('[data-os-browser-window-id="win-blank-placement"] canvas')).toBeNull();
    const placementGets = fetchStub.mock.calls.filter((c) => {
      const url = String(c[0]);
      return url.includes("/api/browser/sessions/win-blank-placement");
    });
    expect(placementGets).toHaveLength(0);
  });

  it("desktop switch and unmount does not destroy session or target", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-persist",
        appId: "browser",
        title: "Persist Browser",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-persist", "sess-persist-1", "http://localhost:5173/persist"),
      });
    });

    const containerEl = document.querySelector(
      '[data-os-browser-window-id="win-browser-persist"]',
    ) as HTMLElement | null;
    expect(containerEl).not.toBeNull();
    if (containerEl) {
      containerEl.dataset.testMarker = "original-container";
    }

    // Switch desktop
    await act(async () => {
      const state = useWindowStore.getState();
      state.setSession({
        ...state.session,
        desktops: [
          ...state.session.desktops,
          {
            id: "desk-2",
            name: "Desktop 2",
            tree: null,
            floatingWindowIds: [],
            focusedWindowId: null,
          },
        ],
      });
      state.switchDesktop("desk-2");
    });

    // Session is NOT deleted, window remains in store
    expect(useWindowStore.getState().session.windows["win-browser-persist"]).toBeDefined();

    // Switch back to desk-1
    await act(async () => {
      useWindowStore.getState().switchDesktop("desktop-1");
    });

    // Same container DOM node is retained
    const containerAfter = document.querySelector(
      '[data-os-browser-window-id="win-browser-persist"]',
    ) as HTMLElement | null;
    expect(containerAfter).toBe(containerEl);
    expect(containerAfter?.dataset.testMarker).toBe("original-container");
  });
});
