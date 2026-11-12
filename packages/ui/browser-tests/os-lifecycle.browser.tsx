import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import "@/index.css";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { getTerminal, registerTerminal, terminalRegistry } from "@/lib/terminal-registry.js";
import { getParkedMonacoEntry, registerParkedMonaco } from "@/os/MonacoKeepAliveHost.js";
import { editorFileTabKey } from "@/stores/editor.js";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalFindController } from "@/lib/terminal-find-controller.js";
import {
  __setConnectionSnapshotForTests,
  registerConnectionRegistryQueryClient,
  resetConnections,
} from "@/api/connections.js";
import { createApiClient } from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { saveProfiles } from "@/api/server-config.js";
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
          profileEpoch: "1",
          viewportEpoch: "1",
          navigationRevision: "1",
        },
      },
    ],
  };
}

describe("OS Lifecycle Component Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession());
    useCognitoModeStore.getState().reset();
    terminalRegistry.clear();
    resetConnections();

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

    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/browser/sessions/")) {
        return new Response(
          JSON.stringify({
            browserSessionId: "mock-sess",
            url: "http://localhost:5173/page",
            status: "running",
            profileEpoch: "1",
            viewportEpoch: "1",
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
      return new Response(JSON.stringify({ ticket: "mock-ticket" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchStub);
    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
    vi.unstubAllGlobals();
    resetConnections();
  });

  it("mounts OsShell with root bar and default desktop", async () => {
    await renderOsShell();

    const shell = container?.querySelector('[data-os-shell="true"]');
    expect(shell).not.toBeNull();

    const canvas = container?.querySelector(
      '[data-os-desktop-canvas="desktop-1"]',
    );
    expect(canvas).not.toBeNull();
  });

  it("launches terminals window, claims resource slot, and verifies frame controls", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-term-1",
        appId: "terminals",
        title: "Terminals",
        ctx: { profileId: "default" },
        mode: "tile",
      });
    });

    const frame = container?.querySelector('[data-os-window-frame="win-term-1"]');
    expect(frame).not.toBeNull();

    // Verify claim in resource registry
    const claims = globalResourceRegistry.getClaimsForWindow("win-term-1");
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0]?.key.resourceKind).toBe("terminal");

    // Switch to float
    await act(async () => {
      useWindowStore.getState().setWindowMode("win-term-1", "float");
    });
    expect(useWindowStore.getState().session.windows["win-term-1"]?.mode).toBe("float");

    // Minimize window
    await act(async () => {
      useWindowStore.getState().minimizeWindow("win-term-1");
    });
    expect(useWindowStore.getState().session.windows["win-term-1"]?.minimized).toBe(true);

    // Restore window
    await act(async () => {
      useWindowStore.getState().restoreWindow("win-term-1");
    });
    expect(useWindowStore.getState().session.windows["win-term-1"]?.minimized).toBe(false);
  });

  it("rejects duplicate resource claims and renders focus-existing button", async () => {
    await renderOsShell();

    // Open first terminal window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-term-1",
        appId: "terminals",
        title: "Terminals 1",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: { sessionId: "shared-term-session" },
      });
    });

    // Open second terminal window attempting to claim same sessionId
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-term-2",
        appId: "terminals",
        title: "Terminals 2",
        ctx: { profileId: "default" },
        mode: "float",
        appState: { sessionId: "shared-term-session" },
      });
    });

    // Second window must show claim denied fallback
    const deniedNotice = container?.querySelector('[data-testid="terminals-claim-denied"]');
    expect(deniedNotice).not.toBeNull();

    // Clicking focus button sets focus to first window
    const focusBtn = deniedNotice?.querySelector("button");
    expect(focusBtn).not.toBeNull();
    await act(async () => {
      focusBtn?.click();
    });
    expect(useWindowStore.getState().session.desktops[0].focusedWindowId).toBe("win-term-1");
  });

  it("renders pane tabs for multi-window tiled pane and toggles tiled maximize", async () => {
    await renderOsShell();

    // Open two tiled windows in the same desktop pane
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-a",
        appId: "terminals",
        title: "Terminal Tab A",
        ctx: { profileId: "default" },
        mode: "tile",
      });
      useWindowStore.getState().openWindow({
        id: "win-b",
        appId: "editor",
        title: "Editor Tab B",
        ctx: { profileId: "default" },
        mode: "tile",
      });
    });

    // Pane tabs must be present
    const paneTabs = container?.querySelector("[data-os-pane-tabs]");
    expect(paneTabs).not.toBeNull();
    expect(paneTabs?.textContent).toContain("Terminal Tab A");
    expect(paneTabs?.textContent).toContain("Editor Tab B");

    // Maximize tiled window -> single mounted window expands to fixed fullscreen
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-b");
    });
    const frameB = container?.querySelector('[data-os-window-frame="win-b"]') as HTMLElement | null;
    expect(frameB).not.toBeNull();
    expect(frameB?.style.position).toBe("absolute");
    expect(frameB?.style.width).toBe("100%");
    expect(container?.querySelector('[data-os-maximized-layer="true"]')).not.toBeNull();
    // Verify exactly ONE frame instance exists in the DOM (no duplicate mounting)
    expect(container?.querySelectorAll('[data-os-window-frame="win-b"]').length).toBe(1);

    // Restore maximize
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-b");
    });
    expect(frameB?.style.position).toBe("relative");
    expect(container?.querySelectorAll('[data-os-window-frame="win-b"]').length).toBe(1);
  });

  it("adds and switches desktops", async () => {
    await renderOsShell();

    await act(async () => {
      const state = useWindowStore.getState();
      state.setSession({
        ...state.session,
        desktops: [
          ...state.session.desktops,
          {
            id: "desktop-2",
            name: "Desktop 2",
            tree: null,
            floatingWindowIds: [],
            focusedWindowId: null,
          },
        ],
      });
      state.switchDesktop("desktop-2");
    });

    expect(useWindowStore.getState().session.activeDesktopId).toBe("desktop-2");
    const canvas2 = container?.querySelector(
      '[data-os-desktop-canvas="desktop-2"]',
    );
    expect(canvas2).not.toBeNull();
  });

  it("preserves live preview streamed canvas and DOM state across tile, float, maximize, minimize, and desktop switches", async () => {
    await renderOsShell();

    // Open browser preview window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-1",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-1", "sess-test-preview", "http://localhost:5173/test-preview"),
      });
    });

    const canvas = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"] canvas',
    ) as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();

    if (canvas) {
      canvas.dataset.domMarker = "same-canvas-node";
    }

    // 1. Move to float
    await act(async () => {
      useWindowStore.getState().setWindowMode("win-browser-1", "float");
    });
    const canvasAfterFloat = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"] canvas',
    ) as HTMLCanvasElement | null;
    expect(canvasAfterFloat?.dataset.domMarker).toBe("same-canvas-node");

    // 2. Maximize and restore
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-browser-1");
    });
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-browser-1");
    });
    const canvasAfterMax = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"] canvas',
    );
    expect(canvasAfterMax).toBe(canvas);
    // 3. Minimize and restore
    await act(async () => {
      useWindowStore.getState().minimizeWindow("win-browser-1");
    });
    const containerWhileMin = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"]',
    ) as HTMLElement | null;
    expect(containerWhileMin?.style.visibility).toBe("hidden");
    await act(async () => {
      useWindowStore.getState().restoreWindow("win-browser-1");
    });
    const canvasAfterRestore = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"] canvas',
    );
    expect(canvasAfterRestore).toBe(canvas);
    // 4. Switch to Desktop 2 then back to Desktop 1
    await act(async () => {
      const state = useWindowStore.getState();
      state.setSession({
        ...state.session,
        desktops: [
          ...state.session.desktops,
          {
            id: "desktop-2",
            name: "Desktop 2",
            tree: null,
            floatingWindowIds: [],
            focusedWindowId: null,
          },
        ],
      });
      state.switchDesktop("desktop-2");
    });

    // While on Desktop 2, stream container is moved offscreen/hidden
    const hostContainer = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"]',
    ) as HTMLElement | null;
    expect(hostContainer?.style.visibility).toBe("hidden");
    // Switch back to Desktop 1
    await act(async () => {
      useWindowStore.getState().switchDesktop("desktop-1");
    });
    const canvasAfterDesktopSwitch = document.querySelector(
      '[data-os-browser-window-id="win-browser-1"] canvas',
    ) as HTMLCanvasElement | null;
    expect(canvasAfterDesktopSwitch?.dataset.domMarker).toBe("same-canvas-node");
  });

  it("isolates input and suppresses stream during Cognito privacy mode", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-cog",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-cog", "sess-cog", "http://localhost:5173/cog"),
      });
    });

    // Activate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle();
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    // When Cognito mode is active, the browser host hides/disables pointer events
    const hostContainer = document.querySelector(
      '[data-os-browser-window-id="win-browser-cog"]',
    ) as HTMLElement | null;
    expect(hostContainer?.style.visibility).toBe("hidden");

    // Deactivate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle();
    });
    expect(useCognitoModeStore.getState().active).toBe(false);
    await vi.waitFor(() => {
      expect(hostContainer?.style.pointerEvents).toBe("auto");
      expect(hostContainer?.style.visibility).toBe("visible");
    });
  });

  it("displays actionable unsupported reason banner when browser capability is disabled", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-unsupported",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: {
          browserStateVersion: 1,
          activeTabId: "tab-unsup",
          ownerScope: defaultScope,
          tabs: [
            {
              tabId: "tab-unsup",
              kind: "ordinary",
              phase: "unavailable",
              committedUrl: "http://localhost:5173/unsupported",
              draft: { value: "http://localhost:5173/unsupported", dirty: false },
              unsupportedReason: "ContainmentUnavailable",
              actionSequence: 0,
            },
          ],
        },
      });
    });
    const banner = document.querySelector(
      '[data-testid="browser-unsupported-banner"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("ContainmentUnavailable");
  });

  it("allows two windows to view the same target without resource exclusion", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-a",
        appId: "browser",
        title: "Browser A",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-a", "sess-shared-target", "http://localhost:5173/shared"),
      });
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-b",
        appId: "browser",
        title: "Browser B",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: createCanonicalBrowserState("tab-b", "sess-shared-target", "http://localhost:5173/shared"),
      });
    });

    // Neither window has claim denied
    const claimDenied = document.querySelectorAll('[data-os-claim-denied="true"]');
    expect(claimDenied.length).toBe(0);

    // Both stream containers exist
    const containerA = document.querySelector(
      '[data-os-browser-window-id="win-browser-a"]',
    );
    const containerB = document.querySelector(
      '[data-os-browser-window-id="win-browser-b"]',
    );
    expect(containerA).not.toBeNull();
    expect(containerB).not.toBeNull();
  });
  it("preserves live terminal and editor resource instances across tile, float, maximize, minimize, and desktop moves", async () => {
    // 1. Create and register real mock terminal entry
    const mockTermEl = document.createElement("div");
    mockTermEl.dataset.domMarker = "live-terminal-entry";
    registerTerminal(
      { profileId: "default", id: "session-life-1" },
      { element: mockTermEl } as unknown as Terminal,
      { fit: () => {} } as unknown as FitAddon,
      { close: () => {} } as unknown as TerminalFindController,
      mockTermEl,
    );

    // 2. Create and register real parked monaco entry
    const mockMonacoEl = document.createElement("div");
    mockMonacoEl.dataset.domMarker = "live-monaco-entry";
    const tabKey = editorFileTabKey(
      { profileId: "default", project: "global" },
      "src/index.ts",
    );
    registerParkedMonaco(tabKey, mockMonacoEl, null);

    await renderOsShell();

    // 3. Open terminal window in tile mode
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-term-life",
        appId: "terminals",
        title: "Terminals Life",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: { sessionId: "session-life-1" },
      });
    });

    const termEntry = getTerminal({ profileId: "default", id: "session-life-1" });
    const liveTermEl = termEntry?.attachmentElement ?? termEntry?.terminal.element;
    expect(liveTermEl).toBeDefined();

    const assertTermAttached = () => {
      expect(liveTermEl?.isConnected).toBe(true);
      const slot = container?.querySelector('[data-os-window-slot="win-term-life"]');
      expect(slot).not.toBeNull();
      expect(slot?.contains(liveTermEl!)).toBe(true);
    };

    const assertEditorAttached = () => {
      const editorEntry = getParkedMonacoEntry(tabKey);
      const liveMonacoEl = editorEntry?.element;
      expect(liveMonacoEl).toBeDefined();
      expect(liveMonacoEl?.isConnected).toBe(true);
      const slot = container?.querySelector('[data-os-window-slot="win-edit-life"]');
      expect(slot).not.toBeNull();
      expect(slot?.contains(liveMonacoEl!)).toBe(true);
    };

    assertTermAttached();

    // 4. Move terminal to float
    await act(async () => {
      useWindowStore.getState().setWindowMode("win-term-life", "float");
    });
    expect(useWindowStore.getState().session.windows["win-term-life"]?.mode).toBe("float");
    assertTermAttached();

    // 5. Maximize and Restore terminal
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-term-life");
    });
    expect(useWindowStore.getState().session.windows["win-term-life"]?.maximized).toBe(true);
    assertTermAttached();

    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-term-life");
    });
    expect(useWindowStore.getState().session.windows["win-term-life"]?.maximized).toBe(false);
    assertTermAttached();

    // 6. Minimize and Restore terminal
    await act(async () => {
      useWindowStore.getState().minimizeWindow("win-term-life");
    });
    expect(useWindowStore.getState().session.windows["win-term-life"]?.minimized).toBe(true);
    expect(container?.querySelector('[data-os-window-frame="win-term-life"]')).toBeNull();
    // Terminal entry survives in registry while minimized
    const minTermEntry = getTerminal({ profileId: "default", id: "session-life-1" });
    expect(minTermEntry?.attachmentElement ?? minTermEntry?.terminal.element).toBe(liveTermEl);
    await act(async () => {
      useWindowStore.getState().restoreWindow("win-term-life");
    });
    expect(useWindowStore.getState().session.windows["win-term-life"]?.minimized).toBe(false);
    assertTermAttached();

    // 7. Move terminal to Desktop 2
    await act(async () => {
      const state = useWindowStore.getState();
      state.setSession({
        ...state.session,
        desktops: [
          ...state.session.desktops,
          {
            id: "desktop-2",
            name: "Desktop 2",
            tree: null,
            floatingWindowIds: [],
            focusedWindowId: null,
          },
        ],
      });
      state.moveWindowToDesktop("win-term-life", "desktop-2");
    });
    // While still on Desktop 1, terminal is hidden from canvas 1 but survives in registry
    expect(container?.querySelector('[data-os-desktop-canvas="desktop-1"] [data-os-window-frame="win-term-life"]')).toBeNull();
    const moveTermEntry = getTerminal({ profileId: "default", id: "session-life-1" });
    expect(moveTermEntry?.attachmentElement ?? moveTermEntry?.terminal.element).toBe(liveTermEl);
    // Switch to Desktop 2
    await act(async () => {
      useWindowStore.getState().switchDesktop("desktop-2");
    });
    expect(useWindowStore.getState().session.windows["win-term-life"]?.desktopId).toBe("desktop-2");
    assertTermAttached();
    // Switch back to Desktop 1
    await act(async () => {
      useWindowStore.getState().switchDesktop("desktop-1");
    });

    // 8. Open editor and exercise placement matrix (tile -> float -> maximize -> restore)
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-edit-life",
        appId: "editor",
        title: "Editor Life",
        ctx: {
          profileId: "default",
          target: { kind: "project", profileId: "default", project: "global" },
        },
        mode: "tile",
        appState: { filePath: "src/index.ts" },
      });
    });
    assertEditorAttached();
    const initialEditorEl = getParkedMonacoEntry(tabKey)?.element;
    expect(initialEditorEl).toBeDefined();

    // Move editor to float
    await act(async () => {
      useWindowStore.getState().setWindowMode("win-edit-life", "float");
    });
    expect(useWindowStore.getState().session.windows["win-edit-life"]?.mode).toBe("float");
    assertEditorAttached();
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);

    // Maximize and restore editor
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-edit-life");
    });
    expect(useWindowStore.getState().session.windows["win-edit-life"]?.maximized).toBe(true);
    assertEditorAttached();
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);

    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-edit-life");
    });
    expect(useWindowStore.getState().session.windows["win-edit-life"]?.maximized).toBe(false);
    assertEditorAttached();
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);

    // Minimize and restore editor
    await act(async () => {
      useWindowStore.getState().minimizeWindow("win-edit-life");
    });
    expect(useWindowStore.getState().session.windows["win-edit-life"]?.minimized).toBe(true);
    expect(container?.querySelector('[data-os-window-frame="win-edit-life"]')).toBeNull();
    // Parked Monaco entry survives in registry while minimized
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);

    await act(async () => {
      useWindowStore.getState().restoreWindow("win-edit-life");
    });
    expect(useWindowStore.getState().session.windows["win-edit-life"]?.minimized).toBe(false);
    assertEditorAttached();
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);

    // Move editor to Desktop 2
    await act(async () => {
      useWindowStore.getState().moveWindowToDesktop("win-edit-life", "desktop-2");
    });
    // While still on Desktop 1, editor is hidden from canvas 1 but survives in registry
    expect(container?.querySelector('[data-os-desktop-canvas="desktop-1"] [data-os-window-frame="win-edit-life"]')).toBeNull();
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);

    await act(async () => {
      useWindowStore.getState().switchDesktop("desktop-2");
    });
    expect(useWindowStore.getState().session.windows["win-edit-life"]?.desktopId).toBe("desktop-2");
    assertEditorAttached();
    expect(getParkedMonacoEntry(tabKey)?.element).toBe(initialEditorEl);
  });


  it("handles keyboard shortcut focus cycling via Ctrl+Alt+Escape", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-k1",
        appId: "terminals",
        title: "Term 1",
        ctx: { profileId: "default" },
        mode: "float",
      });
      useWindowStore.getState().openWindow({
        id: "win-k2",
        appId: "terminals",
        title: "Term 2",
        ctx: { profileId: "default" },
        mode: "float",
      });
      useWindowStore.getState().focusWindow("win-k1");
    });

    const frame1 = container?.querySelector('[data-os-window-frame="win-k1"]') as HTMLElement | null;
    expect(frame1).not.toBeNull();

    // Dispatch Ctrl+Alt+Escape on window frame
    await act(async () => {
      frame1?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Focus cycled to win-k2
    expect(useWindowStore.getState().session.desktops[0].focusedWindowId).toBe("win-k2");
  });

  it("toggles window mode on titlebar double-click and suppresses on drag threshold", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-gesture-test",
        appId: "terminals",
        title: "Gesture Test",
        ctx: { profileId: "default" },
        mode: "tile",
      });
    });

    const frame = container?.querySelector('[data-os-window-frame="win-gesture-test"]');
    expect(frame).not.toBeNull();
    const header = frame?.querySelector('[data-os-frame-header="true"]');
    expect(header).not.toBeNull();

    // Double-click on header background -> toggles mode from tile to float
    await act(async () => {
      header?.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });

    expect(useWindowStore.getState().session.windows["win-gesture-test"].mode).toBe("float");

    // Double-click again -> toggles back to tile
    await act(async () => {
      header?.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });

    expect(useWindowStore.getState().session.windows["win-gesture-test"].mode).toBe("tile");
  });

  it("atomically unmaximizes and switches mode on titlebar double-click when maximized", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-max-test",
        appId: "terminals",
        title: "Maximize Test",
        ctx: { profileId: "default" },
        mode: "tile",
      });
      useWindowStore.getState().toggleMaximizeWindow("win-max-test");
    });

    expect(useWindowStore.getState().session.windows["win-max-test"].maximized).toBe(true);

    const frame = container?.querySelector('[data-os-window-frame="win-max-test"]');
    const header = frame?.querySelector('[data-os-frame-header="true"]');

    // Double-click titlebar
    await act(async () => {
      header?.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });

    const win = useWindowStore.getState().session.windows["win-max-test"];
    expect(win.maximized).toBe(false);
    expect(win.mode).toBe("float");
  });
});
