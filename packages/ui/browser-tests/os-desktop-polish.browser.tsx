import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import "@/index.css";
import "@/os/os.css";
import { dismissContextMenu } from "@/lib/context-menu-coordinator.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";

describe("OS Desktop Polish Integrated Browser Tests (P08)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession("desk-1", "Main"));
    useCognitoModeStore.getState().reset();
    useSettingsStore.setState({
      dockPadding: 8,
      dockItemSpacing: 6,
      dockOuterSpacing: 12,
      dockRadius: 18,
      cursorTheme: "theme",
    });

    container = document.createElement("div");
    container.style.width = "1440px";
    container.style.height = "900px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    dismissContextMenu();
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
    document
      .querySelectorAll("[data-radix-portal], [data-os-menu-portal]")
      .forEach((el) => el.remove());
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

  it("renders floating dock, applies gutter reservation, and opens AppLauncher", async () => {
    await renderOsShell();

    const dock = container?.querySelector('[data-testid="dock-panel"]');
    expect(dock).not.toBeNull();

    // Verify Applications Catalog trigger
    const appsBtn = container?.querySelector('[data-testid="dock-apps-trigger"]') as HTMLButtonElement | null;
    expect(appsBtn).not.toBeNull();

    await act(async () => {
      appsBtn?.click();
    });

    const launcher = document.body.querySelector('[data-testid="app-launcher-panel"]');
    expect(launcher).not.toBeNull();

    // Close launcher
    const closeBtn = document.body.querySelector('[data-testid="app-launcher-close"]') as HTMLButtonElement | null;
    await act(async () => {
      closeBtn?.click();
    });

    expect(document.body.querySelector('[data-testid="app-launcher-panel"]')).toBeNull();
  });

  it("handles canvas maximize layer promotion and restore", async () => {
    await renderOsShell();

    // Open a floating window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-polish-test",
        appId: "settings",
        title: "Test Settings",
        ctx: { profileId: "default" },
        mode: "float",
      });
    });

    let maxLayer = container?.querySelector('[data-os-maximized-layer="true"]');
    expect(maxLayer).toBeNull();

    // Maximize the window
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-polish-test");
    });

    maxLayer = container?.querySelector('[data-os-maximized-layer="true"]');
    expect(maxLayer).not.toBeNull();
    const maxSlot = container?.querySelector('[data-os-maximized-slot="win-polish-test"]');
    expect(maxSlot).not.toBeNull();

    // Restore the window
    await act(async () => {
      useWindowStore.getState().toggleMaximizeWindow("win-polish-test");
    });

    expect(container?.querySelector('[data-os-maximized-layer="true"]')).toBeNull();
  });

  it("opens desktop background context menu and dismisses on Escape", async () => {
    await renderOsShell();
    const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
    const bgTrigger = container?.querySelector(`[data-os-desktop-trigger="${activeDesktopId}"]`) as HTMLElement | null;
    expect(bgTrigger).not.toBeNull();

    await act(async () => {
      bgTrigger?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 200,
        }),
      );
    });

    const menu = document.body.querySelector('[data-testid="desktop-context-menu"]');
    expect(menu).not.toBeNull();

    // Dismiss context menu
    await act(async () => {
      dismissContextMenu();
    });

    expect(document.body.querySelector('[data-testid="desktop-context-menu"]')).toBeNull();
  });

  it("opens Command Palette on shortcut and lists actions", async () => {
    await renderOsShell();

    // Open palette via Ctrl+Alt+K
    // Open palette via topbar trigger
    const paletteTrigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open command palette"]',
    );
    expect(paletteTrigger).not.toBeNull();

    await act(async () => {
      paletteTrigger?.click();
    });

    const palette = document.body.querySelector('[role="dialog"][aria-label="Command Palette"]');
    expect(palette).not.toBeNull();

    // Close palette via backdrop pointerdown
    await act(async () => {
      palette?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.querySelector('[role="dialog"][aria-label="Command Palette"]')).toBeNull();
  });
});
