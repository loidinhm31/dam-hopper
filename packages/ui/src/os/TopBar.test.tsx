// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar.js";
import { saveProfiles } from "@/api/server-config.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession } from "./window-ops.js";
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TopBar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    useLockScreenStore.getState().reset();
    useWindowStore.setState({ session: createDefaultOsSession() });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    queryClient.clear();
  });

  it("renders the Lock button after the notification bell", async () => {
    const onRequestSetupPin = vi.fn();

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <TopBar onRequestSetupPin={onRequestSetupPin} />
        </QueryClientProvider>,
      );
    });

    const lockBtn = container?.querySelector('[data-testid="topbar-lock-button"]');
    expect(lockBtn).not.toBeNull();
    expect(lockBtn?.getAttribute("aria-label")).toBe("Set up lock screen PIN");

    // Click when no PIN configured triggers onRequestSetupPin
    await act(async () => {
      lockBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRequestSetupPin).toHaveBeenCalledTimes(1);
  });

  it("locks the screen immediately when clicked if PIN is configured", async () => {
    await useLockScreenStore.getState().setPin("1234");
    expect(useLockScreenStore.getState().hasPin).toBe(true);

    const onRequestSetupPin = vi.fn();

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <TopBar onRequestSetupPin={onRequestSetupPin} />
        </QueryClientProvider>,
      );
    });

    const lockBtn = container?.querySelector('[data-testid="topbar-lock-button"]');
    expect(lockBtn?.getAttribute("aria-label")).toBe("Lock screen");

    await act(async () => {
      lockBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRequestSetupPin).not.toHaveBeenCalled();
    expect(useLockScreenStore.getState().isLocked).toBe(true);
  });

  it("targets global workspace profiles only without project selection", async () => {
    saveProfiles([
      {
        id: "prof-1",
        name: "Primary Server",
        url: "http://127.0.0.1:4801",
        authType: "none",
        createdAt: 1,
        autoConnect: true,
      },
      {
        id: "prof-2",
        name: "Remote Server",
        url: "http://127.0.0.1:4802",
        authType: "none",
        createdAt: 2,
        autoConnect: false,
      },
    ]);

    const session = createDefaultOsSession();
    session.desktops[0].defaultCtx = {
      profileId: "prof-1",
      projectId: "legacy-project",
    };
    useWindowStore.setState({ session });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <TopBar />
        </QueryClientProvider>,
      );
    });

    const trigger = container?.querySelector(
      '[data-os-nonmodal-trigger="target-selector"]',
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).not.toContain("/legacy-project");
    expect(trigger?.textContent).toContain("Primary Server");

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const menu = container?.querySelector(
      '[data-os-nonmodal-surface="target-selector"]',
    );
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("Global Workspace Target");
    expect(menu?.textContent).not.toContain("Active Project");

    const remoteBtn = Array.from(
      menu?.querySelectorAll('[role="menuitem"]') ?? [],
    ).find((el) => el.textContent?.includes("Remote Server")) as
      | HTMLButtonElement
      | undefined;
    expect(remoteBtn).toBeDefined();

    await act(async () => {
      remoteBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const updatedDefaultCtx =
      useWindowStore.getState().session.desktops[0]?.defaultCtx;
    expect(updatedDefaultCtx).toEqual({
      profileId: "prof-2",
      target: { kind: "workspace", profileId: "prof-2" },
    });
    expect(
      container?.querySelector('[data-os-nonmodal-surface="target-selector"]'),
    ).toBeNull();
  });
});
