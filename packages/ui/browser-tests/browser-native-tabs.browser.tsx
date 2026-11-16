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
import { __setConnectionSnapshotForTests, registerConnectionRegistryQueryClient, resetConnections } from "@/api/connections.js";
import { createApiClient } from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { saveProfiles } from "@/api/server-config.js";
import type { BrowserOwnerScope, BrowserWindowState } from "@/os/browser/browser-tab-types.js";

const testScope: BrowserOwnerScope = { profileId: "default", endpoint: "http://127.0.0.1:4801", principal: "dev-user", namespace: "dev" };

describe("Browser Native Tabs Browser Component Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;
  let unregisterQc: (() => void) | null = null;
  let fetchStub: Mock;

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession());
    useCognitoModeStore.getState().reset();

    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    unregisterQc = registerConnectionRegistryQueryClient(queryClient);

    const profile = { id: "default", name: "Default", url: "http://127.0.0.1:4801", authType: "none" as const, createdAt: 0 };
    saveProfiles([profile]);
    const transport = new WsTransport("http://127.0.0.1:4801", () => null);
    __setConnectionSnapshotForTests("default", {
      profile, serverUrl: "http://127.0.0.1:4801", owner: { profileId: "default", generation: 1 },
      status: "connected", intent: true, transport, api: createApiClient({ profileId: "default", generation: 1 }, transport),
      mfaState: "none", sessionTtl: null, verifiedBrowserIdentity: { principal: "dev-user", namespace: "dev" },
    }, transport);

    fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/browser/sessions/")) {
        return new Response(JSON.stringify({
          browserSessionId: "mock-sess", url: "http://example.com/page", status: "running",
          profileEpoch: "1", viewportEpoch: "1", navigationRevision: "1",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    if (root) { act(() => { root?.unmount(); }); root = null; }
    if (container?.parentElement) { container.parentElement.removeChild(container); container = null; }
    unregisterQc?.(); unregisterQc = null; resetConnections(); vi.unstubAllGlobals();
  });

  const renderOsShell = async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider><OsShell /></EncryptProvider>
        </QueryClientProvider>,
      );
    });
  };

  it("supports roving tab focus, ARIA navigation, and tab switching", async () => {
    await renderOsShell();
    const appState: BrowserWindowState = {
      browserStateVersion: 1, activeTabId: "tab-1", ownerScope: testScope,
      tabs: [
        { tabId: "tab-1", kind: "ordinary", phase: "live", sessionId: "s-1", committedUrl: "http://example.com/a", draft: { value: "http://example.com/a", dirty: false }, actionSequence: 0, snapshot: { browserSessionId: "s-1", url: "http://example.com/a", status: "running", profileEpoch: "1", viewportEpoch: "1", navigationRevision: "1" } },
        { tabId: "tab-2", kind: "ordinary", phase: "live", sessionId: "s-2", committedUrl: "http://example.com/b", draft: { value: "http://example.com/b", dirty: false }, actionSequence: 0, snapshot: { browserSessionId: "s-2", url: "http://example.com/b", status: "running", profileEpoch: "1", viewportEpoch: "1", navigationRevision: "1" } },
      ],
    };
    await act(async () => {
      useWindowStore.getState().openWindow({ id: "win-tabs", appId: "browser", title: "Browser", ctx: { profileId: "default" }, mode: "tile", appState });
    });

    const tab1 = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tab-tab-1"]');
    const tab2 = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tab-tab-2"]');
    expect(tab1).not.toBeNull(); expect(tab2).not.toBeNull();
    expect(tab1!.getAttribute("aria-selected")).toBe("true");
    expect(tab2!.getAttribute("aria-selected")).toBe("false");

    tab1!.focus();
    await act(async () => {
      tab1!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(tab2!.getAttribute("aria-selected")).toBe("true");

    await act(async () => { tab1!.click(); });
    expect(tab1!.getAttribute("aria-selected")).toBe("true");
  });

  it("creates in-tab new tab, supports draft input and Escape cancellation", async () => {
    await renderOsShell();
    const appState: BrowserWindowState = {
      browserStateVersion: 1, activeTabId: "tab-1", ownerScope: testScope,
      tabs: [
        { tabId: "tab-1", kind: "ordinary", phase: "live", sessionId: "s-1", committedUrl: "http://example.com/a", draft: { value: "http://example.com/a", dirty: false }, actionSequence: 0 },
      ],
    };
    await act(async () => {
      useWindowStore.getState().openWindow({ id: "win-nt", appId: "browser", title: "Browser", ctx: { profileId: "default" }, mode: "tile", appState });
    });

    const newTabBtn = container!.querySelector<HTMLButtonElement>('[data-testid="browser-new-tab-btn"]')!;
    await act(async () => { newTabBtn.click(); });

    const addrInput = container!.querySelector<HTMLInputElement>('[data-testid="browser-address-input"]')!;
    expect(addrInput).not.toBeNull();
    await act(async () => {
      addrInput.focus();
      addrInput.value = "https://typed-draft.local";
      addrInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(addrInput.value).toBe("https://typed-draft.local");

    await act(async () => {
      addrInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(addrInput.value).toBe("");
  });

  it("falls back to sibling tab on close, and provides blank tab when closing last tab", async () => {
    await renderOsShell();
    const appState: BrowserWindowState = {
      browserStateVersion: 1, activeTabId: "tab-1", ownerScope: testScope,
      tabs: [
        { tabId: "tab-1", kind: "ordinary", phase: "live", committedUrl: "http://example.com/1", draft: { value: "", dirty: false }, actionSequence: 0 },
        { tabId: "tab-2", kind: "ordinary", phase: "live", committedUrl: "http://example.com/2", draft: { value: "", dirty: false }, actionSequence: 0 },
      ],
    };
    await act(async () => {
      useWindowStore.getState().openWindow({ id: "win-close", appId: "browser", title: "Browser", ctx: { profileId: "default" }, mode: "tile", appState });
    });

    const closeTab1 = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tab-close-tab-1"]')!;
    await act(async () => { closeTab1.click(); });

    const tab2 = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tab-tab-2"]')!;
    expect(tab2).not.toBeNull();
    expect(tab2.getAttribute("aria-selected")).toBe("true");

    const closeTab2 = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tab-close-tab-2"]')!;
    await act(async () => { closeTab2.click(); });

    const fallbackTab = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tab-strip-win-close"] [role="tab"]')!;
    expect(fallbackTab).not.toBeNull();
    expect(fallbackTab.textContent).toContain("New Tab");
  });

  it("toggles tools & recovery panel and enforces Cognito owner privacy masking", async () => {
    await renderOsShell();
    const appState: BrowserWindowState = {
      browserStateVersion: 1, activeTabId: "tab-1", ownerScope: testScope,
      tabs: [
        { tabId: "tab-1", kind: "ordinary", phase: "live", committedUrl: "http://secret-domain.local/auth", draft: { value: "http://secret-domain.local/auth", dirty: false }, actionSequence: 0 },
      ],
    };
    await act(async () => {
      useWindowStore.getState().openWindow({ id: "win-tools", appId: "browser", title: "Browser", ctx: { profileId: "default" }, mode: "tile", appState });
    });

    const toolsBtn = container!.querySelector<HTMLButtonElement>('[data-testid="browser-tools-toggle-btn"]')!;
    await act(async () => { toolsBtn.click(); });
    expect(container!.querySelector('[data-testid="browser-tools-panel"]')).not.toBeNull();

    await act(async () => { useCognitoModeStore.getState().toggle(); });
    expect(useCognitoModeStore.getState().active).toBe(true);
    const addr = container!.querySelector<HTMLInputElement>('[data-testid="browser-address-input"]')!;
    expect(addr.value).toBe("●●●●●●");
    expect(addr.readOnly).toBe(true);
  });
});
