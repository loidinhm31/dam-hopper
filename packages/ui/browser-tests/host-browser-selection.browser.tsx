import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  __setConnectionSnapshotForTests,
  registerConnectionRegistryQueryClient,
  resetConnections,
} from "@/api/connections.js";
import { createApiClient } from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { saveProfiles } from "@/api/server-config.js";
import { BrowserApp } from "@/os/apps/BrowserApp.js";
import { WindowContextProvider } from "@/os/window-context.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import type { OsWindow } from "@/os/types.js";
import type { BrowserOwnerScope, BrowserWindowState } from "@/os/browser/browser-tab-types.js";
import "@/index.css";
import "@/os/os.css";
describe("Host Browser Selection Preview and Atomic Terminal Handoff in Chromium", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;
  let unregisterQc: (() => void) | null = null;
  let fetchStub: Mock;

  const owner = { profileId: "prof-sel", generation: 1 };

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession());
    useCognitoModeStore.getState().reset();

    container = document.createElement("div");
    container.style.width = "1024px";
    container.style.height = "768px";
    document.body.appendChild(container);
    root = createRoot(container);

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    unregisterQc = registerConnectionRegistryQueryClient(queryClient);

    const profile = {
      id: owner.profileId,
      name: "Selection Host",
      url: "http://127.0.0.1:4801",
      authType: "none" as const,
      createdAt: 0,
    };
    saveProfiles([profile]);
    const transport = new WsTransport("http://127.0.0.1:4801", () => null);
    const apiClient = createApiClient(owner, transport);

    __setConnectionSnapshotForTests(
      owner.profileId,
      {
        profile,
        serverUrl: "http://127.0.0.1:4801",
        owner,
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
    fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container?.parentElement) {
      container.parentElement.removeChild(container);
      container = null;
    }
    unregisterQc?.();
    unregisterQc = null;
    resetConnections();
    vi.unstubAllGlobals();
  });

  function openBrowserAndTerminalWindows(terminalIncarnation = 42): OsWindow {
    useWindowStore.getState().openWindow({
      id: "win-term-1",
      appId: "terminals",
      title: "Shell Alpha",
      ctx: { profileId: owner.profileId },
      mode: "tile",
      runtimeIdentity: {
        kind: "terminal",
        target: {
          profileId: owner.profileId,
          generation: owner.generation,
          serverEpoch: "11111111-1111-4111-8111-111111111111",
          terminalId: "shell:alpha",
          incarnation: String(terminalIncarnation),
        },
      },
      appState: {
        sessionId: "shell:alpha",
        incarnation: terminalIncarnation,
        incarnationExact: String(terminalIncarnation),
      },
    });

    useWindowStore.getState().openWindow({
      id: "win-browser-1",
      appId: "browser",
      title: "Browser",
      ctx: { profileId: owner.profileId },
      mode: "tile",
      appState: {
        browserStateVersion: 1,
        activeTabId: "tab-sel-1",
        ownerScope: {
          profileId: owner.profileId,
          endpoint: "http://127.0.0.1:4801",
          principal: "dev-user",
          namespace: "dev",
        },
        tabs: [
          {
            tabId: "tab-sel-1",
            kind: "ordinary",
            phase: "live",
            sessionId: "bsess-1",
            committedUrl: "http://example.com",
            draft: { value: "http://example.com", dirty: false },
            actionSequence: 1,
            isController: true,
            leaseToken: "lease-token-1",
            snapshot: {
              browserSessionId: "bsess-1",
              url: "http://example.com",
              status: "running",
              navigationRevision: "1",
            },
          },
        ],
      },
    });
    return useWindowStore.getState().session.windows["win-browser-1"]!;
  }

  function ReactiveBrowserHarness() {
    const win = useWindowStore((s) => s.session.windows["win-browser-1"]);
    const [, setTick] = useState(0);
    if (!win) return null;
    return (
      <QueryClientProvider client={queryClient}>
        <WindowContextProvider window={win} isFocused isActiveDesktop>
          <BrowserApp window={win} />
          <button
            type="button"
            data-testid="force-rerender"
            onClick={() => setTick((t) => t + 1)}
          />
        </WindowContextProvider>
      </QueryClientProvider>
    );
  }

  async function openToolsPanel() {
    const toolsBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="browser-tools-toggle-btn"]',
    );
    if (toolsBtn) {
      await act(async () => {
        toolsBtn.click();
      });
    }
  }
  it("selects element via CDP preview, prepares ManagedBrowser PNG artifact, and hands off to exact terminal", async () => {
    openBrowserAndTerminalWindows(42);

    const previewSelection = {
      version: 1,
      tag: "button",
      role: "button",
      accessibleName: "Save Settings",
      text: "Save Settings",
      attributes: { id: "save-btn", "data-testid": "save-settings" },
      locator: "form > button#save-btn",
      bounds: { x: 10, y: 20, width: 120, height: 36 },
    };

    const handoffCalls: string[] = [];

    fetchStub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal/detailed")) {
        return Response.json([
          {
            id: "shell:alpha",
            incarnation: 42,
            incarnationExact: "42",
            alive: true,
            title: "Shell Alpha",
          },
        ]);
      }

      if (url.endsWith("/api/browser/sessions/bsess-1/selection/start")) {
        return new Response(
          JSON.stringify({
            selectionActive: true,
            navigationRevision: 1,
            selectionRevision: 2,
            preview: null,
          }),
          { status: 200 },
        );
      }

      if (method === "GET" && url.endsWith("/api/browser/sessions/bsess-1")) {
        return new Response(
          JSON.stringify({
            browserSessionId: "bsess-1",
            navigationRevision: "1",
            status: "running",
            selection: {
              active: false,
              selectionRevision: 3,
              navigationRevision: 1,
              preview: previewSelection,
            },
          }),
          { status: 200 },
        );
      }

      if (url.endsWith("/api/browser/sessions/bsess-1/selection/artifacts")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body.terminalId).toBe("shell:alpha");
        expect(body.terminalIncarnation).toBe("42");
        expect(body.selectionRevision).toBe(3);
        expect(body.source).toBeUndefined();
        return new Response(
          JSON.stringify({
            artifactId: "art-managed-1",
            terminalId: "shell:alpha",
            terminalIncarnation: 42,
            expiresAt: Date.now() + 600_000,
            jsonPath: "/tmp/private/art-managed-1.json",
            jsonSize: 220,
            jsonSha256: "deadbeef",
            pngPath: "/tmp/private/art-managed-1.png",
            pngSize: 1024,
            pngSha256: "cafebabe",
            selectionRevision: 3,
            navigationRevision: 1,
          }),
          { status: 201 },
        );
      }

      if (url.endsWith("/api/browser-debug/artifacts/art-managed-1/handoff")) {
        handoffCalls.push(url);
        return Response.json({ inserted: true }, { status: 200 });
      }

      return Response.json({}, { status: 200 });
    });

    await act(async () => {
      root?.render(<ReactiveBrowserHarness />);
    });
    await openToolsPanel();
    const selectBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="browser-select-element-btn"]',
    );
    expect(selectBtn).not.toBeNull();

    await act(async () => {
      selectBtn!.click();
    });

    // Wait for poll to receive preview
    await vi.waitFor(() => {
      const card = container!.querySelector('[data-testid="browser-selection-preview-card"]');
      expect(card).not.toBeNull();
      expect(card!.textContent).toContain("<button>");
      expect(card!.textContent).toContain("Save Settings");
    });

    // Prepare artifact
    const prepareBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="browser-selection-prepare-btn"]',
    );
    expect(prepareBtn).not.toBeNull();

    await act(async () => {
      prepareBtn!.click();
    });

    await vi.waitFor(() => {
      const refEl = container!.querySelector('[data-testid="browser-selection-artifact-ref"]');
      expect(refEl).not.toBeNull();
      expect(refEl!.textContent).toContain("/tmp/private/art-managed-1.json");
      expect(refEl!.textContent).toContain("/tmp/private/art-managed-1.png");
      const pngStatus = container!.querySelector(
        '[data-testid="browser-selection-artifact-png-status"]',
      );
      expect(pngStatus!.textContent).toBe("PNG attached");
    });
    expect(handoffCalls).toHaveLength(0);

    // Click Insert to Terminal
    const handoffBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="browser-selection-handoff-btn"]',
    );
    await act(async () => {
      handoffBtn!.click();
    });

    await vi.waitFor(() => {
      expect(handoffCalls).toHaveLength(1);
      expect(handoffBtn!.textContent).toBe("Inserted");
    });
  });

  it("blocks handoff when terminal incarnation changes and discards unclaimed artifact on navigation", async () => {
    openBrowserAndTerminalWindows(42);

    const previewSelection = {
      version: 1,
      tag: "div",
      role: null,
      accessibleName: null,
      text: "Status Card",
      attributes: {},
      locator: "div#status",
      bounds: { x: 0, y: 0, width: 100, height: 50 },
    };

    let currentIncarnation = 42;
    const deletedIds: string[] = [];
    const handoffCalls: string[] = [];

    fetchStub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal/detailed")) {
        return Response.json([
          {
            id: "shell:alpha",
            incarnation: currentIncarnation,
            incarnationExact: String(currentIncarnation),
            alive: true,
            title: "Shell Alpha",
          },
        ]);
      }
      if (url.endsWith("/api/browser/sessions/bsess-1/selection/start")) {
        return new Response(
          JSON.stringify({
            selectionActive: false,
            navigationRevision: 1,
            selectionRevision: 2,
            preview: previewSelection,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/browser/sessions/bsess-1/selection/artifacts")) {
        return new Response(
          JSON.stringify({
            artifactId: "art-race-1",
            terminalId: "shell:alpha",
            terminalIncarnation: 42,
            expiresAt: Date.now() + 600_000,
            jsonPath: "/tmp/private/art-race-1.json",
            jsonSize: 150,
            jsonSha256: "abc",
            selectionRevision: 2,
            navigationRevision: 1,
          }),
          { status: 201 },
        );
      }
      if (method === "DELETE" && url.includes("/api/browser-debug/artifacts/")) {
        deletedIds.push(url);
        return new Response(null, { status: 204 });
      }
      if (url.includes("/handoff")) {
        handoffCalls.push(url);
        return new Response(JSON.stringify({ inserted: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    await act(async () => {
      root?.render(<ReactiveBrowserHarness />);
    });
    await openToolsPanel();
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="browser-select-element-btn"]')!
        .click();
    });

    await vi.waitFor(() => {
      expect(
        container!.querySelector('[data-testid="browser-selection-prepare-btn"]'),
      ).not.toBeNull();
    });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="browser-selection-prepare-btn"]')!
        .click();
    });

    await vi.waitFor(() => {
      expect(
        container!.querySelector('[data-testid="browser-selection-handoff-btn"]'),
      ).not.toBeNull();
    });

    // Replace terminal incarnation in window store and mock inventory (42 -> 99)
    currentIncarnation = 99;
    await act(async () => {
      useWindowStore.getState().updateAppState("win-term-1", {
        sessionId: "shell:alpha",
        incarnation: 99,
        incarnationExact: "99",
      });
      // Update runtimeIdentity too
      const cur = useWindowStore.getState().session;
      useWindowStore.getState().setSession({
        ...cur,
        windows: {
          ...cur.windows,
          "win-term-1": {
            ...cur.windows["win-term-1"]!,
            runtimeIdentity: {
              kind: "terminal",
              target: {
                profileId: owner.profileId,
                generation: owner.generation,
                serverEpoch: "11111111-1111-4111-8111-111111111111",
                terminalId: "shell:alpha",
                incarnation: "99",
              },
            },
          },
        },
      });
    });

    // Attempt handoff -> must fail closed and discard artifact without calling /handoff
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="browser-selection-handoff-btn"]')!
        .click();
    });

    await vi.waitFor(() => {
      const err = container!.querySelector('[data-testid="browser-selection-error"]');
      expect(err).not.toBeNull();
      expect(err!.textContent).toContain("closed or replaced");
    });
    expect(handoffCalls).toHaveLength(0);
    expect(deletedIds.length).toBeGreaterThanOrEqual(1);

    // Advance navigationRevision -> clears selection preview completely
    await act(async () => {
      useWindowStore.getState().updateAppState("win-browser-1", {
        navigationRevision: 2,
      });
    });

    await vi.waitFor(() => {
      expect(
        container!.querySelector('[data-testid="browser-selection-preview-card"]'),
      ).toBeNull();
    });
  });

  it("syncs navigationRevision on 409 and clears preview when background navigation advances during inspect", async () => {
    let serverNavRev = 1;
    let serverUrl = "http://example.com";
    const discarded: string[] = [];

    fetchStub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/terminal/detailed")) {
        return Response.json([
          {
            id: "shell:alpha",
            incarnation: 42,
            incarnationExact: "42",
            alive: true,
            title: "Shell Alpha",
          },
        ]);
      }
      if (url.endsWith("/api/browser/sessions/bsess-1") && method === "GET") {
        return new Response(
          JSON.stringify({
            id: "bsess-1",
            url: serverUrl,
            navigationRevision: String(serverNavRev),
            status: "active",
            selection: { active: false, selectionRevision: 1, navigationRevision: serverNavRev, preview: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/api/browser/sessions/bsess-1/selection/start") && method === "POST") {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { navigationRevision?: string | number };
        if (String(parsed.navigationRevision) !== String(serverNavRev)) {
          return new Response(
            JSON.stringify({ error: "stale navigationRevision", kind: "conflict" }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            selectionActive: false,
            selectionRevision: 1,
            preview: {
              version: 1,
              tag: "button",
              accessibleName: "Continue",
              text: "Continue",
              locator: "role=button[name='Continue']",
              bounds: { x: 1, y: 2, width: 80, height: 30 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/api/browser/sessions/bsess-1/selection/artifacts") && method === "POST") {
        return new Response(
          JSON.stringify({
            artifactId: "art-bg-nav-1",
            terminalId: "shell:alpha",
            terminalIncarnation: 42,
            expiresAt: Date.now() + 600_000,
            jsonPath: "/tmp/private/art-bg-nav-1.json",
            jsonSize: 120,
            jsonSha256: "deadbeef",
            selectionRevision: 1,
            navigationRevision: 2,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/browser-debug/artifacts/art-bg-nav-1") && method === "DELETE") {
        discarded.push("art-bg-nav-1");
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    openBrowserAndTerminalWindows(42);
    // Server navigated ahead to revision 2 before Select Element was clicked
    serverNavRev = 2;
    serverUrl = "http://example.com/step-2";

    await act(async () => {
      root?.render(<ReactiveBrowserHarness />);
    });
    await openToolsPanel();
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="browser-select-element-btn"]')!
        .click();
    });

    await vi.waitFor(() => {
      expect(
        container!.querySelector('[data-testid="browser-selection-prepare-btn"]'),
      ).not.toBeNull();
    });
    const appState = useWindowStore.getState().session.windows["win-browser-1"]?.appState as unknown as BrowserWindowState | undefined;
    expect(
      String(appState?.tabs?.[0]?.snapshot?.navigationRevision ?? ""),
    ).toBe("2");
    // Prepare artifact, then simulate native server navigation to revision 3 while preview/artifact are open
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="browser-selection-prepare-btn"]')!
        .click();
    });
    await vi.waitFor(() => {
      expect(
        container!.querySelector('[data-testid="browser-selection-handoff-btn"]'),
      ).not.toBeNull();
    });

    serverNavRev = 3;
    serverUrl = "http://example.com/step-3";

    await vi.waitFor(
      () => {
        expect(
          container!.querySelector('[data-testid="browser-selection-preview-card"]'),
        ).toBeNull();
      },
      { timeout: 2500 },
    );
    const finalAppState = useWindowStore.getState().session.windows["win-browser-1"]?.appState as unknown as BrowserWindowState | undefined;
    expect(
      String(finalAppState?.tabs?.[0]?.snapshot?.navigationRevision ?? ""),
    ).toBe("3");
    expect(discarded).toContain("art-bg-nav-1");
  });
});
