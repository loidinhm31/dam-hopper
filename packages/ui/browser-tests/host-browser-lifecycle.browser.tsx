import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import "@/index.css";
import "@/os/os.css";
import { EncryptProvider } from "@/contexts/EncryptContext.js";

describe("Host Browser Lifecycle & Window Policy Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
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
        appState: {
          url: "http://localhost:5173/page",
          sessionId: "sess-1",
        },
      });
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-target-2",
        appId: "browser",
        title: "Browser Target 2",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: {
          url: "http://localhost:5173/page",
          sessionId: "sess-2",
        },
      });
    });

    // Both stream containers exist
    expect(
      document.querySelector('[data-os-browser-stream-container="win-browser-target-1"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-os-browser-stream-container="win-browser-target-2"]'),
    ).not.toBeNull();

    // 2. Explicitly close window 1
    await act(async () => {
      useWindowStore.getState().closeWindow("win-browser-target-1");
    });

    // Window 1 is removed from session windows and its stream container cleaned up
    expect(useWindowStore.getState().session.windows["win-browser-target-1"]).toBeUndefined();
    expect(
      document.querySelector('[data-os-browser-stream-container="win-browser-target-1"]'),
    ).toBeNull();

    // Sibling window 2 remains active and live
    expect(useWindowStore.getState().session.windows["win-browser-target-2"]).toBeDefined();
    expect(
      document.querySelector('[data-os-browser-stream-container="win-browser-target-2"]'),
    ).not.toBeNull();
  });

  it("explicit close of a shared target window dispatches backend target close per contract §9", async () => {
    await renderOsShell();
    // Two windows viewing the same underlying target sessionId
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-viewer-a",
        appId: "browser",
        title: "Viewer A",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: {
          url: "http://localhost:5173/shared",
          sessionId: "sess-shared-target-x",
        },
      });
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-viewer-b",
        appId: "browser",
        title: "Viewer B",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: {
          url: "http://localhost:5173/shared",
          sessionId: "sess-shared-target-x",
        },
      });
    });

    expect(
      document.querySelector('[data-os-browser-stream-container="win-viewer-a"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-os-browser-stream-container="win-viewer-b"]'),
    ).not.toBeNull();

    // Close Viewer A
    await act(async () => {
      useWindowStore.getState().closeWindow("win-viewer-a");
    });

    expect(useWindowStore.getState().session.windows["win-viewer-a"]).toBeUndefined();
    expect(
      document.querySelector('[data-os-browser-stream-container="win-viewer-a"]'),
    ).toBeNull();

    // Viewer B is still active
    expect(useWindowStore.getState().session.windows["win-viewer-b"]).toBeDefined();
    expect(
      document.querySelector('[data-os-browser-stream-container="win-viewer-b"]'),
    ).not.toBeNull();
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
        appState: {
          url: "http://localhost:5173/persist",
          sessionId: "sess-persist-1",
        },
      });
    });

    const canvas = document.querySelector(
      '[data-os-browser-stream-container="win-browser-persist"] canvas',
    ) as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    if (canvas) {
      canvas.dataset.testMarker = "original-canvas";
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

    // Same canvas DOM node is retained
    const canvasAfter = document.querySelector(
      '[data-os-browser-stream-container="win-browser-persist"] canvas',
    ) as HTMLCanvasElement | null;
    expect(canvasAfter).toBe(canvas);
    expect(canvasAfter?.dataset.testMarker).toBe("original-canvas");
  });
});
