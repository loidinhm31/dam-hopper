import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import "@/index.css";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
describe("OS Lifecycle Component Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

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
  });

  const renderOsShell = async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <OsShell />
        </EncryptProvider>,
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
    expect(frameB?.style.position).toBe("fixed");
    expect(frameB?.style.width).toBe("100vw");
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

  it("preserves live preview iframe and JavaScript state across tile, float, maximize, and desktop switches", async () => {
    await renderOsShell();

    // Open browser preview window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-1",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: { url: "http://localhost:5173/test-preview" },
      });
    });

    const iframe = document.querySelector(
      'iframe[data-os-preview-iframe="true"]',
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();

    if (iframe) {
      iframe.dataset.domMarker = "same-iframe-node";
    }
    // 1. Move to float
    await act(async () => {
      useWindowStore.getState().setWindowMode("win-browser-1", "float");
    });
    const iframeAfterFloat = document.querySelector(
      'iframe[data-os-preview-iframe="true"]',
    ) as HTMLIFrameElement | null;
    expect(iframeAfterFloat).toBe(iframe);
    expect(iframeAfterFloat?.dataset.domMarker).toBe("same-iframe-node");

    // 2. Maximize and restore
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-browser-1");
    });
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-browser-1");
    });
    const iframeAfterMax = document.querySelector(
      'iframe[data-os-preview-iframe="true"]',
    );
    expect(iframeAfterMax).toBe(iframe);

    // 3. Switch to Desktop 2 then back to Desktop 1
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

    // While on Desktop 2, iframe container is moved offscreen
    const hostContainer = document.querySelector(
      '[data-os-browser-host-window="win-browser-1"]',
    ) as HTMLElement | null;
    expect(hostContainer?.style.visibility).toBe("hidden");

    // Switch back to Desktop 1
    await act(async () => {
      useWindowStore.getState().switchDesktop("desktop-1");
    });
    const iframeAfterDesktopSwitch = document.querySelector(
      'iframe[data-os-preview-iframe="true"]',
    ) as HTMLIFrameElement | null;
    expect(iframeAfterDesktopSwitch).toBe(iframe);
    expect(iframeAfterDesktopSwitch?.dataset.domMarker).toBe("same-iframe-node");
  });

  it("isolates input during Cognito privacy mode", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-cog",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: { url: "http://localhost:5173/cog" },
      });
    });

    // Activate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle();
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    // When Cognito mode is active, the browser host hides/disables pointer events
    const hostContainer = document.querySelector(
      '[data-os-browser-host-window="win-browser-cog"]',
    ) as HTMLElement | null;
    expect(hostContainer?.style.pointerEvents).toBe("none");

    // Deactivate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle();
    });
    expect(useCognitoModeStore.getState().active).toBe(false);
  });
});
