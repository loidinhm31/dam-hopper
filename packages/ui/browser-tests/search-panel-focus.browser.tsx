import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppZoomProvider } from "@/contexts/AppZoomContext.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { AndroidChromeInputPolicyProvider } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { useSearchUiStore } from "@/stores/search-ui.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import WorkspacePage from "@/components/pages/WorkspacePage.js";

// Mock transport
vi.mock(import("@/api/transport.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTransport: () => ({
      invoke: vi.fn(async () => ({ query: "", matches: [], truncated: false })),
      fsRead: vi.fn(),
      fsWriteFile: vi.fn(),
      terminalWrite: vi.fn(),
    }),
    getTransportGeneration: () => 0,
    subscribeTransportChanges: () => () => {},
  };
});

vi.mock(import("@/api/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      projects: {
        list: async () => [{ name: "demo-project" }],
      },
    },
  };
});

describe("SearchPanel focus retention in Chromium", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useWorkspaceStore.setState({
      activeProject: "demo-project",
      activeProjectRevision: 0,
      selectedProject: { project: "demo-project" },
    });

    useSearchUiStore.setState({
      open: false,
      mode: "content",
      queries: { content: "", filename: "" },
      selectOnOpen: false,
      scope: "project",
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
  });

  async function renderWorkspaceAndWait() {
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AppZoomProvider>
              <EncryptProvider>
                <AndroidChromeInputPolicyProvider>
                  <WorkspacePage />
                </AndroidChromeInputPolicyProvider>
              </EncryptProvider>
            </AppZoomProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });

    // Wait for initial render and lazy components
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 300);
      await promise;
    });
  }

  async function openSearchDialog() {
    await act(async () => {
      useSearchUiStore.getState().openWith("content");
    });

    // Poll until dialog search input mounts
    let searchInput: HTMLInputElement | null = null;
    for (let i = 0; i < 20; i++) {
      searchInput = document.querySelector<HTMLInputElement>(
        ".dialog-viewport-fit input[placeholder*='Search']",
      );
      if (searchInput) break;
      await act(async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      });
    }
    return searchInput;
  }

  it("retains search input focus on keystrokes in compact workspace", async () => {
    container!.style.width = "1024px";
    container!.style.height = "768px";
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 768 });

    await renderWorkspaceAndWait();
    const searchInput = await openSearchDialog();
    expect(searchInput).not.toBeNull();

    searchInput!.focus();
    expect(document.activeElement).toBe(searchInput);

    // Type first character
    await act(async () => {
      searchInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true }));
      useSearchUiStore.getState().setQuery("content", "a");
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput!.dispatchEvent(new Event("change", { bubbles: true }));
      searchInput!.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", bubbles: true }));
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    });

    const activeAfterFirst = document.activeElement as HTMLInputElement | null;
    expect(activeAfterFirst).toBe(searchInput);
    expect(activeAfterFirst?.value).toBe("a");

    // Type second character
    await act(async () => {
      searchInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }));
      useSearchUiStore.getState().setQuery("content", "ab");
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput!.dispatchEvent(new Event("change", { bubbles: true }));
      searchInput!.dispatchEvent(new KeyboardEvent("keyup", { key: "b", code: "KeyB", bubbles: true }));
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    });

    const activeAfterSecond = document.activeElement as HTMLInputElement | null;
    expect(activeAfterSecond).toBe(searchInput);
    expect(activeAfterSecond?.value).toBe("ab");
  });

  it("retains search input focus on keystrokes in desktop workspace", async () => {
    container!.style.width = "1440px";
    container!.style.height = "900px";
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 900 });

    await renderWorkspaceAndWait();
    const searchInput = await openSearchDialog();
    expect(searchInput).not.toBeNull();

    searchInput!.focus();
    expect(document.activeElement).toBe(searchInput);

    // Type first character
    await act(async () => {
      searchInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "KeyX", bubbles: true }));
      useSearchUiStore.getState().setQuery("content", "x");
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput!.dispatchEvent(new Event("change", { bubbles: true }));
      searchInput!.dispatchEvent(new KeyboardEvent("keyup", { key: "x", code: "KeyX", bubbles: true }));
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    });

    const activeAfterFirst = document.activeElement as HTMLInputElement | null;
    expect(activeAfterFirst).toBe(searchInput);
    expect(activeAfterFirst?.value).toBe("x");
  });
});
