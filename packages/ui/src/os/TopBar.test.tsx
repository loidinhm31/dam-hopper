// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession } from "./window-ops.js";

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
});
