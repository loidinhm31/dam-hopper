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

describe("OS Shell Chrome Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession("desk-1", "Main"));
    useCognitoModeStore.getState().reset();

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

  it("renders banner, navigation dock, desktop switcher, and main canvas landmarks", async () => {
    await renderOsShell();

    const banner = container?.querySelector('header[role="banner"]');
    expect(banner).not.toBeNull();

    const dock = container?.querySelector('aside[role="navigation"]');
    expect(dock).not.toBeNull();

    const main = container?.querySelector('main[role="main"]');
    expect(main).not.toBeNull();

    const switcher = container?.querySelector('nav[role="tablist"][aria-label="Virtual Desktops"]');
    expect(switcher).not.toBeNull();
  });

  it("switches desktops and adds a new virtual desktop from switcher", async () => {
    await renderOsShell();

    // Add Desktop button
    const addBtn = container?.querySelector('button[aria-label="Add Desktop"]') as HTMLButtonElement | null;
    expect(addBtn).not.toBeNull();

    await act(async () => {
      addBtn?.click();
    });

    const desktops = useWindowStore.getState().session.desktops;
    expect(desktops.length).toBe(2);

    // Switch to desktop 2
    const secondDeskTab = container?.querySelectorAll('button[role="tab"]')[1] as HTMLButtonElement | null;
    expect(secondDeskTab).not.toBeNull();

    await act(async () => {
      secondDeskTab?.click();
    });

    expect(useWindowStore.getState().session.activeDesktopId).toBe(desktops[1].id);
  });

  it("launches window from dock and displays running pip indicator", async () => {
    await renderOsShell();

    // Find terminals launcher in dock
    const termLauncher = container?.querySelector('button[aria-label="Launch or focus Terminals"]') as HTMLButtonElement | null;
    expect(termLauncher).not.toBeNull();

    await act(async () => {
      termLauncher?.click();
    });

    const windows = useWindowStore.getState().session.windows;
    const windowIds = Object.keys(windows);
    expect(windowIds.length).toBeGreaterThan(0);

    const launchedWin = Object.values(windows)[0];
    expect(launchedWin.appId).toBe("terminals");

    // Frame rendered
    const frame = container?.querySelector(`[data-os-window-frame="${launchedWin.id}"]`);
    expect(frame).not.toBeNull();
  });

  it("renders 8-way resize handles for floating windows", async () => {
    await renderOsShell();

    // Open a floating window
    act(() => {
      useWindowStore.getState().openWindow({
        id: "win-float-test",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "float",
      });
    });

    await renderOsShell();

    const frame = container?.querySelector('[data-os-window-frame="win-float-test"]');
    expect(frame).not.toBeNull();

    // Check resize handles
    const nwHandle = container?.querySelector('[data-os-resize-handle="nw"]');
    const seHandle = container?.querySelector('[data-os-resize-handle="se"]');
    const nHandle = container?.querySelector('[data-os-resize-handle="n"]');
    const sHandle = container?.querySelector('[data-os-resize-handle="s"]');

    expect(nwHandle).not.toBeNull();
    expect(seHandle).not.toBeNull();
    expect(nHandle).not.toBeNull();
    expect(sHandle).not.toBeNull();
  });
});
