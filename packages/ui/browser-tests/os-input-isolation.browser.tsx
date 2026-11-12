import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useOsNotificationStore } from "@/os/notifications.js";
import "@/index.css";
import "@/os/os.css";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { arbitrateKeyboardEvent } from "@/os/input-arbiter.js";
import {
  __setConnectionSnapshotForTests,
  registerConnectionRegistryQueryClient,
  resetConnections,
} from "@/api/connections.js";
import { createApiClient } from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { saveProfiles } from "@/api/server-config.js";
describe("OS Input Isolation & Cognito Privacy Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession("desk-1", "Main"));
    useCognitoModeStore.getState().reset();
    useOsNotificationStore.getState().clearAll();
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
            browserSessionId: "sess-iso",
            url: "http://localhost:5173/isolated",
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
    vi.unstubAllGlobals();
    resetConnections();
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

  it("blocks all physical keyboard inputs when Cognito privacy mode is active", async () => {
    await renderOsShell();

    // Enable Cognito mode
    act(() => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    const keyEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });

    const disposition = arbitrateKeyboardEvent(keyEvent, {
      isCognitoActive: true,
      isComposing: false,
      isFrameFocused: false,
    });

    expect(disposition).toBe("cognito-blocked");
  });

  it("redacts notification entries immediately when Cognito is activated", async () => {
    useOsNotificationStore.getState().addNotification({
      profileId: "secret-production-server",
      generation: 1,
      title: "Agent OMP failed on /root/secrets.env",
      body: "Bearer token in terminal output",
      source: "agent",
      level: "warning",
      targetProject: "top-secret-project",
    });

    await renderOsShell();

    // Click notifications bell to open NotificationCenter
    const bellBtn = container?.querySelector('button[aria-label^="Notifications"]') as HTMLButtonElement | null;
    expect(bellBtn).not.toBeNull();

    await act(async () => {
      bellBtn?.click();
    });

    let notifTitle = container?.querySelector('[role="article"] span.font-medium');
    expect(notifTitle?.textContent).toBe("Agent OMP failed on /root/secrets.env");

    // Activate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    // Content is immediately redacted in DOM
    notifTitle = container?.querySelector('[role="article"] span.font-medium');
    expect(notifTitle?.textContent).toBe("Notification (Protected)");

    const notifBody = container?.querySelector('[role="article"] p');
    expect(notifBody?.textContent).toBe("Details hidden in Cognito Privacy Mode");
  });

  it("passes through IME composition and AltGr events without chord interference", async () => {
    await renderOsShell();

    const imeEvent = new KeyboardEvent("keydown", {
      key: "Process",
      keyCode: 229,
    });

    const disposition = arbitrateKeyboardEvent(imeEvent, {
      isCognitoActive: false,
      isComposing: true,
      isFrameFocused: false,
    });

    expect(disposition).toBe("ime-passthrough");
  });

  it("DOM keydown listeners suppress command palette trigger when Cognito privacy mode is active", async () => {
    await renderOsShell();

    // Enable Cognito mode
    act(() => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Dispatch physical Ctrl+Alt+K on window
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Command palette MUST NOT open
    const palette = container?.querySelector('[role="dialog"][aria-label="Command Palette"]');
    expect(palette).toBeNull();
  });

  it("DOM listener suppresses focus cycling when modal is active", async () => {
    await renderOsShell();

    // Open command palette
    const paletteTrigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open command palette"]',
    );
    act(() => {
      paletteTrigger?.click();
    });
    expect(
      container?.querySelector('[role="dialog"][aria-label="Command Palette"]'),
    ).not.toBeNull();

    // Dispatch Ctrl+Alt+Escape on window
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    // Palette remains open, focus cycling not intercepted
    expect(
      container?.querySelector('[role="dialog"][aria-label="Command Palette"]'),
    ).not.toBeNull();
  });

  it("isolates browser canvas pointer and input events during Cognito privacy mode", async () => {
    await renderOsShell();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-browser-iso",
        appId: "browser",
        title: "Browser Preview",
        ctx: { profileId: "default" },
        mode: "tile",
        appState: {
          browserStateVersion: 1,
          activeTabId: "tab-iso",
          ownerScope: {
            profileId: "default",
            endpoint: "http://127.0.0.1:4801",
            principal: "dev-user",
            namespace: "dev",
          },
          tabs: [
            {
              tabId: "tab-iso",
              kind: "ordinary",
              phase: "live",
              sessionId: "sess-iso",
              committedUrl: "http://localhost:5173/isolated",
              draft: { value: "http://localhost:5173/isolated", dirty: false },
              actionSequence: 0,
              snapshot: {
                browserSessionId: "sess-iso",
                url: "http://localhost:5173/isolated",
                status: "running",
                profileEpoch: "1",
                viewportEpoch: "1",
                navigationRevision: "1",
              },
            },
          ],
        },
      });
    });

    const streamContainer = document.querySelector(
      '[data-os-browser-window-id="win-browser-iso"]',
    ) as HTMLElement | null;

    // Enable Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle();
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Canvas pointer events are completely disabled and visibility hidden
    expect(streamContainer?.style.pointerEvents).toBe("none");
    expect(streamContainer?.style.visibility).toBe("hidden");

    // Deactivate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle();
    });
    expect(useCognitoModeStore.getState().active).toBe(false);
    await vi.waitFor(() => {
      expect(streamContainer?.style.pointerEvents).toBe("auto");
      expect(streamContainer?.style.visibility).toBe("visible");
    });
  });
});
