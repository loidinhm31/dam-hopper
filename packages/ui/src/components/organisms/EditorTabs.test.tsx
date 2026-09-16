vi.mock("@/lib/monaco-setup.js", () => ({}));
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const reconcileTabFreshnessMock = vi.fn().mockResolvedValue(undefined);
const loadContentMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/editor.js", async () => {
  const actual = await vi.importActual<typeof import("@/stores/editor.js")>(
    "@/stores/editor.js",
  );
  return {
    ...actual,
    useEditorStore: (selector?: (s: unknown) => unknown) => {
      const state = {
        tabs: testState.tabs,
        activeKeys: testState.activeKeys,
        reconcileTabFreshness: reconcileTabFreshnessMock,
        loadContent: loadContentMock,
        openDiff: vi.fn(),
        close: vi.fn(),
        closeOthers: vi.fn(),
        closeAll: vi.fn(),
        setContent: vi.fn(),
        save: vi.fn(),
        saveViewState: vi.fn(),
        forceOverwrite: vi.fn(),
        reloadTab: vi.fn(),
        clearConflict: vi.fn(),
        clearStale: vi.fn(),
        markSaved: vi.fn(),
        markTargetUnavailable: vi.fn(),
        beginAsyncRequest: vi.fn(),
        isCurrentAsyncRequest: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
  };
});

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({ isEncryptEnabled: () => false }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ data: undefined }),
  useGitFileDiff: () => ({ data: undefined }),
}));
vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({
    onStatusChange: vi.fn(() => vi.fn()),
  }),
}));

vi.mock("@/components/organisms/MonacoHost.js", () => ({
  MonacoHost: () => <div data-testid="monaco-host">Monaco</div>,
}));

import { editorFileTabKey, type Tab } from "@/stores/editor.js";
import { EditorTabs } from "./EditorTabs.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const testState = {
  tabs: [] as Tab[],
  activeKeys: {} as Record<string, string | null>,
};

function makeTab(project: string, path: string, overrides?: Partial<Tab>): Tab {
  const target = { project } as const;
  return {
    key: editorFileTabKey(target, path),
    project,
    target,
    targetKey: "root",
    targetAvailable: true,
    path,
    name: path.split("/").pop() ?? path,
    mtime: 100,
    size: 10,
    tier: "normal",
    content: "hello",
    savedContent: "hello",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
    ...overrides,
  };
}

let root: Root | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  reconcileTabFreshnessMock.mockClear();
  loadContentMock.mockClear();
  queryClient = new QueryClient();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(project = "alpha") {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <EditorTabs project={project} />
      </QueryClientProvider>,
    );
  });
}

describe("EditorTabs freshness lifecycle", () => {
  it("invokes reconcileTabFreshness on mount for an active tab", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "alpha::root": tab.key };

    await mount();

    expect(reconcileTabFreshnessMock).toHaveBeenCalledWith(tab.key);
  });

  it("invokes reconcileTabFreshness on mount even if tab is hydrated", async () => {
    const tab = makeTab("alpha", "src/main.ts", { hydrated: true });
    testState.tabs = [tab];
    testState.activeKeys = { "alpha::root": tab.key };

    await mount();

    expect(reconcileTabFreshnessMock).toHaveBeenCalledWith(tab.key);
  });

  it("invokes reconcileTabFreshness on window focus", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "alpha::root": tab.key };

    await mount();
    reconcileTabFreshnessMock.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(reconcileTabFreshnessMock).toHaveBeenCalledWith(tab.key);
  });

  it("invokes reconcileTabFreshness when document becomes visible", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "alpha::root": tab.key };

    await mount();
    reconcileTabFreshnessMock.mockClear();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(reconcileTabFreshnessMock).toHaveBeenCalledWith(tab.key);
  });

  it("invokes reconcileTabFreshness when active tab changes", async () => {
    const tab1 = makeTab("alpha", "src/one.ts");
    const tab2 = makeTab("alpha", "src/two.ts");
    testState.tabs = [tab1, tab2];
    testState.activeKeys = { "alpha::root": tab1.key };

    await mount();
    expect(reconcileTabFreshnessMock).toHaveBeenCalledWith(tab1.key);
    reconcileTabFreshnessMock.mockClear();

    // Switch active tab
    testState.activeKeys = { "alpha::root": tab2.key };
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EditorTabs project="alpha" />
        </QueryClientProvider>,
      );
    });

    expect(reconcileTabFreshnessMock).toHaveBeenCalledWith(tab2.key);
  });

  it("removes focus and visibilitychange listeners on unmount", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "alpha::root": tab.key };

    const addWindowSpy = vi.spyOn(window, "addEventListener");
    const removeWindowSpy = vi.spyOn(window, "removeEventListener");
    const addDocSpy = vi.spyOn(document, "addEventListener");
    const removeDocSpy = vi.spyOn(document, "removeEventListener");

    await mount();

    const focusCall = addWindowSpy.mock.calls.find((c) => c[0] === "focus");
    const visibilityCall = addDocSpy.mock.calls.find(
      (c) => c[0] === "visibilitychange",
    );
    expect(focusCall).toBeDefined();
    expect(visibilityCall).toBeDefined();
    const focusCallback = focusCall?.[1];
    const visibilityCallback = visibilityCall?.[1];

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(removeWindowSpy).toHaveBeenCalledWith("focus", focusCallback);
    expect(removeDocSpy).toHaveBeenCalledWith(
      "visibilitychange",
      visibilityCallback,
    );

    addWindowSpy.mockRestore();
    removeWindowSpy.mockRestore();
    addDocSpy.mockRestore();
    removeDocSpy.mockRestore();
  });
});
