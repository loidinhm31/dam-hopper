vi.mock("@/lib/monaco-setup.js", () => ({}));
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockConnectionSnapshot = {
  status: "connected",
  serverUrl: "http://127.0.0.1:4803",
  owner: { generation: 1 },
};

let mockSemanticEnabled = false;

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
        reconcileTabFreshness: vi.fn().mockResolvedValue(undefined),
        loadContent: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => mockConnectionSnapshot,
  getAuthToken: () => "test-token",
}));

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({ isEncryptEnabled: () => false }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ data: undefined }),
  useGitFileDiff: () => ({ data: undefined }),
  useSemanticSettings: () => ({
    data: { runtimeEnabled: mockSemanticEnabled },
    isLoading: false,
    isError: false,
  }),
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
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const testState = {
  tabs: [] as Tab[],
  activeKeys: {} as Record<string, string | null>,
};

function makeTab(project: string, path: string, profileId = "prof-test"): Tab {
  const target = { project, profileId };
  const key = editorFileTabKey(target, path);
  return {
    key,
    name: path.split("/").pop() ?? path,
    path,
    project,
    target,
    targetKey: project,
    content: "export const x = 1;",
    originalContent: "export const x = 1;",
    dirty: false,
    stale: false,
    conflicted: false,
    loading: false,
    tier: "code",
    readOnly: false,
    targetAvailable: true,
  };
}

describe("EditorTabs semantic connection lifecycle (W-3)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    testState.tabs = [];
    testState.activeKeys = {};
    mockSemanticEnabled = false;
    mockConnectionSnapshot.status = "connected";
    mockConnectionSnapshot.owner = { generation: 1 };
    useSemanticNavigationStore.getState().disconnectAll();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    queryClient.clear();
  });

  it("gates semantic connection creation when semantic navigation is disabled", async () => {
    const tab = makeTab("proj-1", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys["proj-1"] = tab.key;
    mockSemanticEnabled = false;

    const spyGetOrCreate = vi.spyOn(
      useSemanticNavigationStore.getState(),
      "getOrCreateClient",
    );

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EditorTabs project="proj-1" target={{ project: "proj-1", profileId: "prof-test" }} />
        </QueryClientProvider>,
      );
    });

    expect(spyGetOrCreate).not.toHaveBeenCalled();
    spyGetOrCreate.mockRestore();
  });

  it("creates and connects client when semantic is enabled and connection is ready", async () => {
    const tab = makeTab("proj-1", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys["proj-1"] = tab.key;
    mockSemanticEnabled = true;

    const mockClient = {
      getStatus: vi.fn().mockReturnValue("disconnected"),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };

    const spyGetOrCreate = vi
      .spyOn(useSemanticNavigationStore.getState(), "getOrCreateClient")
      // @ts-expect-error Mock client
      .mockReturnValue(mockClient);

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EditorTabs project="proj-1" target={{ project: "proj-1", profileId: "prof-test" }} />
        </QueryClientProvider>,
      );
    });

    expect(spyGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "prof-test",
        project: "proj-1",
        targetKey: "root",
        connectionGeneration: 1,
      }),
    );
    expect(mockClient.connect).toHaveBeenCalled();

    spyGetOrCreate.mockRestore();
  });

  it("releases client on unmount via releaseClient", async () => {
    const tab = makeTab("proj-1", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys["proj-1"] = tab.key;
    mockSemanticEnabled = true;

    const spyRelease = vi.spyOn(
      useSemanticNavigationStore.getState(),
      "releaseClient",
    );

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EditorTabs project="proj-1" target={{ project: "proj-1", profileId: "prof-test" }} />
        </QueryClientProvider>,
      );
    });

    act(() => {
      root?.unmount();
      root = null;
    });

    expect(spyRelease).toHaveBeenCalled();
    spyRelease.mockRestore();
  });
});
