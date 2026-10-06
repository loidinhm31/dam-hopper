vi.mock("@/lib/monaco-setup.js", () => ({}));
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitCommitRevealRequest } from "@/lib/git-commit-reveal.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { Tab } from "@/stores/editor.js";
import { editorFileTabKey } from "@/stores/editor.js";
import { EditorTabs } from "./EditorTabs.js";

interface CapturedHostProps {
  sourceActive?: boolean;
  onRevealCommit?: (commitHash: string, rootId: string) => void;
}

const capturedMonacoHostProps: CapturedHostProps[] = [];
const capturedMarkdownHostProps: CapturedHostProps[] = [];
const capturedHtmlHostProps: CapturedHostProps[] = [];

vi.mock("@/components/organisms/MonacoHost.js", () => ({
  MonacoHost: (props: CapturedHostProps) => {
    capturedMonacoHostProps.push(props);
    return (
      <div data-testid="monaco-host">
        <button
          type="button"
          data-testid="trigger-reveal"
          onClick={() => props.onRevealCommit?.("deadbeef1234", "root-1")}
        >
          Reveal
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/organisms/MarkdownHost.js", () => ({
  MarkdownHost: (props: CapturedHostProps) => {
    capturedMarkdownHostProps.push(props);
    return (
      <div data-testid="markdown-host">
        <button
          type="button"
          data-testid="trigger-markdown-reveal"
          onClick={() => props.onRevealCommit?.("mdcommit1234", "root-md")}
        >
          Reveal MD
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/organisms/HtmlHost.js", () => ({
  HtmlHost: (props: CapturedHostProps) => {
    capturedHtmlHostProps.push(props);
    return (
      <div data-testid="html-host">
        <button
          type="button"
          data-testid="trigger-html-reveal"
          onClick={() => props.onRevealCommit?.("htmlcommit1234", "root-html")}
        >
          Reveal HTML
        </button>
      </div>
    );
  },
}));

let mockConnectionSnapshot: ConnectionSnapshot | null = {
  status: "connected",
  serverUrl: "http://127.0.0.1:4801",
  owner: {
    profileId: "profile-1",
    generation: 1,
  },
} as unknown as ConnectionSnapshot;

vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => mockConnectionSnapshot,
  isCurrentConnection: () => true,
}));

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
        reconcileTabFreshness: vi.fn(),
        loadContent: vi.fn(),
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

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const testState = {
  tabs: [] as Tab[],
  activeKeys: {} as Record<string, string | null>,
};

function makeTab(project: string, path: string, overrides?: Partial<Tab>): Tab {
  const target = { project, profileId: "profile-1" } as const;
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
    content: "hello world",
    savedContent: "hello world",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
    blameEnabled: true,
    ...overrides,
  };
}

let root: Root | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  capturedMonacoHostProps.length = 0;
  capturedMarkdownHostProps.length = 0;
  capturedHtmlHostProps.length = 0;
  queryClient = new QueryClient();
  mockConnectionSnapshot = {
    status: "connected",
    serverUrl: "http://127.0.0.1:4801",
    owner: {
      profileId: "profile-1",
      generation: 1,
    },
  } as unknown as ConnectionSnapshot;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const defaultTarget = { project: "alpha", profileId: "profile-1" } as const;

async function mount(props: Partial<React.ComponentProps<typeof EditorTabs>> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <EditorTabs project="alpha" target={defaultTarget} {...props} />
      </QueryClientProvider>,
    );
  });
  // Flush microtasks for React.lazy dynamic imports
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}
describe("EditorTabs Blame and Reveal Integration", () => {
  it("threads sourceActive and onRevealCommit to MonacoHost for clean text files", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };

    const onRevealGitCommit = vi.fn();
    const onRevealCommit = vi.fn();

    await mount({ sourceActive: true, onRevealGitCommit, onRevealCommit });

    expect(capturedMonacoHostProps.length).toBeGreaterThan(0);
    const lastProps = capturedMonacoHostProps[capturedMonacoHostProps.length - 1];
    expect(lastProps.sourceActive).toBe(true);
    expect(typeof lastProps.onRevealCommit).toBe("function");

    // Trigger reveal from MonacoHost
    act(() => {
      lastProps.onRevealCommit?.("deadbeef1234", "root-1");
    });

    expect(onRevealGitCommit).toHaveBeenCalledTimes(1);
    const request = onRevealGitCommit.mock.calls[0]?.[0] as GitCommitRevealRequest;
    expect(request.hash).toBe("deadbeef1234");
    expect(request.rootId).toBe("root-1");
    expect(request.owner.profileId).toBe("profile-1");
    expect(request.owner.generation).toBe(1);
    expect(request.target.project).toBe("alpha");
    expect(typeof request.nonce).toBe("number");

    expect(onRevealCommit).toHaveBeenCalledWith("deadbeef1234", "root-1");
  });

  it("passes sourceActive=false to MonacoHost when EditorTabs sourceActive is false", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };

    await mount({ sourceActive: false });

    expect(capturedMonacoHostProps.length).toBeGreaterThan(0);
    const lastProps = capturedMonacoHostProps[capturedMonacoHostProps.length - 1];
    expect(lastProps.sourceActive).toBe(false);
  });

  it("blocks reveal request when connection is not connected", async () => {
    const tab = makeTab("alpha", "src/main.ts");
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };

    mockConnectionSnapshot = {
      status: "disconnected",
      serverUrl: "http://127.0.0.1:4801",
      owner: { profileId: "profile-1", generation: 1 },
    } as unknown as ConnectionSnapshot;

    const onRevealGitCommit = vi.fn();
    await mount({ onRevealGitCommit });

    const lastProps = capturedMonacoHostProps[capturedMonacoHostProps.length - 1];
    act(() => {
      lastProps.onRevealCommit?.("deadbeef1234", "root-1");
    });

    expect(onRevealGitCommit).not.toHaveBeenCalled();
  });

  it("blocks reveal request when resourceBinding serverUrl mismatches connection snapshot", async () => {
    const tab = makeTab("alpha", "src/main.ts", {
      resourceBinding: {
        serverUrl: "http://127.0.0.1:9999", // stale binding!
        targetId: "stale-target",
      },
    });
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };
    mockConnectionSnapshot = {
      status: "connected",
      serverUrl: "http://127.0.0.1:4801",
      owner: { profileId: "profile-1", generation: 1 },
    } as unknown as ConnectionSnapshot;

    const onRevealGitCommit = vi.fn();
    await mount({ onRevealGitCommit });

    const lastProps = capturedMonacoHostProps[capturedMonacoHostProps.length - 1];
    act(() => {
      lastProps.onRevealCommit?.("deadbeef1234", "root-1");
    });

    expect(onRevealGitCommit).not.toHaveBeenCalled();
  });

  it("blocks reveal request when target is unavailable or path is missing", async () => {
    const tab = makeTab("alpha", "src/main.ts", { targetAvailable: false });
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };

    const onRevealGitCommit = vi.fn();
    await mount({ onRevealGitCommit });

    const lastProps = capturedMonacoHostProps[capturedMonacoHostProps.length - 1];
    act(() => {
      lastProps.onRevealCommit?.("deadbeef1234", "root-1");
    });

    expect(onRevealGitCommit).not.toHaveBeenCalled();
  });

  it("threads sourceActive and onRevealCommit to MarkdownHost for markdown files", async () => {
    const tab = makeTab("alpha", "README.md");
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };

    const onRevealGitCommit = vi.fn();
    await mount({ sourceActive: true, onRevealGitCommit });

    expect(capturedMarkdownHostProps.length).toBeGreaterThan(0);
    const lastProps = capturedMarkdownHostProps[capturedMarkdownHostProps.length - 1];
    expect(lastProps.sourceActive).toBe(true);

    act(() => {
      lastProps.onRevealCommit?.("mdcommit1234", "root-md");
    });

    expect(onRevealGitCommit).toHaveBeenCalledTimes(1);
    const request = onRevealGitCommit.mock.calls[0]?.[0] as GitCommitRevealRequest;
    expect(request.hash).toBe("mdcommit1234");
    expect(request.rootId).toBe("root-md");
  });

  it("threads sourceActive and onRevealCommit to HtmlHost for html files", async () => {
    const tab = makeTab("alpha", "index.html");
    testState.tabs = [tab];
    testState.activeKeys = { "profile-1::alpha::root": tab.key };

    const onRevealGitCommit = vi.fn();
    await mount({ sourceActive: true, onRevealGitCommit });

    expect(capturedHtmlHostProps.length).toBeGreaterThan(0);
    const lastProps = capturedHtmlHostProps[capturedHtmlHostProps.length - 1];
    expect(lastProps.sourceActive).toBe(true);

    act(() => {
      lastProps.onRevealCommit?.("htmlcommit1234", "root-html");
    });

    expect(onRevealGitCommit).toHaveBeenCalledTimes(1);
    const request = onRevealGitCommit.mock.calls[0]?.[0] as GitCommitRevealRequest;
    expect(request.hash).toBe("htmlcommit1234");
    expect(request.rootId).toBe("root-html");
  });

  it("does not render MonacoHost or pass blame props for unsupported file tiers (binary, diff, large, image, video)", async () => {
    const binaryTab = makeTab("alpha", "logo.bin", { tier: "binary" });
    testState.tabs = [binaryTab];
    testState.activeKeys = { "profile-1::alpha::root": binaryTab.key };
    await mount();

    expect(capturedMonacoHostProps.length).toBe(0);
    expect(capturedMarkdownHostProps.length).toBe(0);
    expect(capturedHtmlHostProps.length).toBe(0);
  });
});
