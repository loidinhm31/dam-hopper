vi.mock("@/lib/monaco-setup.js", () => ({}));
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitRevealRequest } from "@/lib/git-commit-reveal.js";
import type { ProjectTargetRef } from "@/api/client.js";

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

interface CapturedEditorTabsProps {
  project: string | null;
  target?: ProjectTargetRef;
  sourceActive?: boolean;
  onRevealGitCommit?: (request: GitCommitRevealRequest) => void;
}

interface CapturedWorkspaceGitPanelProps {
  revealRequest?: GitCommitRevealRequest | null;
  onRevealRequestConsumed?: (nonce: number) => void;
}

const capturedEditorTabsProps: CapturedEditorTabsProps[] = [];
const capturedGitPanelProps: CapturedWorkspaceGitPanelProps[] = [];

vi.mock("@/components/organisms/EditorTabs.js", () => ({
  EditorTabs: (props: CapturedEditorTabsProps) => {
    capturedEditorTabsProps.push(props);
    return <div data-testid="mock-editor-tabs" />;
  },
}));

vi.mock("@/components/organisms/WorkspaceGitPanel.js", () => ({
  WorkspaceGitPanel: (props: CapturedWorkspaceGitPanelProps) => {
    capturedGitPanelProps.push(props);
    return <div data-testid="mock-workspace-git-panel" />;
  },
}));

vi.mock("@/components/organisms/SearchPanel.js", () => ({
  SearchPanel: () => <div data-testid="search-panel" />,
}));
let lastIdeShellProps: {
  activateBottomToolRequest?: { nonce: number; toolId: string } | null;
  editor?: React.ReactNode;
} | null = null;

vi.mock("@/components/templates/IdeShell.js", () => ({
  IdeShell: (props: {
    activateBottomToolRequest?: { nonce: number; toolId: string } | null;
    editor?: React.ReactNode;
  }) => {
    lastIdeShellProps = props;
    return (
      <div data-testid="ide-shell">
        {props.editor}
      </div>
    );
  },
}));

let lastTerminalWorkspaceShellProps: {
  activatePanelRequest?: { nonce: number; targetId: string; intent?: string } | null;
  terminalOverlayContent?: ((controls: { zIndex: number; onActivate: () => void }) => React.ReactNode);
  gitContent?: React.ReactNode;
  toolbarActions?: React.ReactNode;
} | null = null;

vi.mock("@/components/templates/TerminalWorkspaceShell.js", () => ({
  TerminalWorkspaceShell: (props: {
    activatePanelRequest?: { nonce: number; targetId: string; intent?: string } | null;
    terminalOverlayContent?: ((controls: { zIndex: number; onActivate: () => void }) => React.ReactNode);
    gitContent?: React.ReactNode;
    toolbarActions?: React.ReactNode;
  }) => {
    lastTerminalWorkspaceShellProps = props;
    const overlay = props.terminalOverlayContent?.({ zIndex: 10, onActivate: () => {} });
    return (
      <div data-testid="terminal-shell">
        {overlay}
      </div>
    );
  },
}));

let mockActiveCompactSurfaceId = "editor";

vi.mock("@/components/templates/MobileWorkspaceShell.js", () => ({
  MobileWorkspaceShell: (props: {
    surfaces: Array<{ id: string; content: React.ReactNode }>;
    activeSurfaceId: string;
    onSurfaceChange: (id: string) => void;
  }) => {
    mockActiveCompactSurfaceId = props.activeSurfaceId;
    const active = props.surfaces.find((s) => s.id === props.activeSurfaceId);
    return <div data-testid="mobile-workspace-shell">{active?.content}</div>;
  },
}));

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <div data-testid="top-nav" />,
}));

vi.mock("@/components/organisms/WorkflowContextSurface.js", () => ({
  WorkflowContextSurface: () => <div data-testid="workflow-surface" />,
}));

let mockWorkspaceMode: "ide" | "terminal" = "ide";
vi.mock("@/lib/workspace-mode.js", () => ({
  loadWorkspaceMode: () => mockWorkspaceMode,
  saveWorkspaceMode: vi.fn(),
}));

const compactMock = vi.hoisted(() => ({ current: false }));
vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => compactMock.current,
}));

let mockProjectTarget = {
  project: "demo-project",
  target: { project: "demo-project", profileId: "profile-1" } as ProjectTargetRef,
  targetKey: "root",
  label: "demo-project",
  isRoot: true,
  available: true,
};

vi.mock("@/hooks/use-project-target.js", () => ({
  useProjectTarget: () => mockProjectTarget,
}));

let mockWorkspaceConnection: {
  owner: { profileId: string; generation: number };
  status: string;
  serverUrl: string;
} | null = {
  owner: { profileId: "profile-1", generation: 1 },
  status: "connected",
  serverUrl: "http://127.0.0.1:4801",
};

vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => mockWorkspaceConnection,
  getConnectionSnapshot: () => mockWorkspaceConnection,
  subscribeConnections: () => () => {},
  getApi: () => ({}),
  isCurrentConnection: () => true,
}));

vi.mock("@/hooks/use-browser-debug.js", () => ({
  useBrowserDebug: () => ({
    browserOpen: false,
    inputUrl: "",
    status: "idle",
    bridgeCapabilities: [],
  }),
  useBrowserDebugHost: () => ({
    host: "127.0.0.1",
    port: 9222,
  }),
}));

vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => ({ id: "profile-1", name: "Default" }),
}));

vi.mock("@/hooks/use-advisor.js", () => ({
  useAdvisorVisibility: () => ({
    isVisible: false,
    isConnected: false,
    isAdmin: false,
    isEnabled: false,
    isAvailable: false,
    path: null,
    sourceError: null,
    status: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({
    activeProject: "demo-project",
    activeProjectRevision: 0,
    setActiveProject: vi.fn(),
  }),
}));

vi.mock("@/stores/project-target.js", () => ({
  useProjectTargetStore: () => ({
    activeTargetByProject: {},
    setActiveTarget: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-terminal-manager.js", () => ({
  useTerminalManager: () => ({
    state: {
      activeTab: null,
      openTabs: [],
      mountedSessions: [],
      launchForm: null,
      freeTerminalSavePrompt: null,
      selection: null,
    },
    derived: {
      tree: [],
      freeTerminals: [],
      isLoading: false,
      terminalTabs: [],
      selectedId: null,
      sessionMap: { current: {} },
    },
    actions: {
      handleSelectTerminal: vi.fn(),
      handleCloseTerminal: vi.fn(),
      handleCreateTerminal: vi.fn(),
      handleSaveTerminal: vi.fn(),
      handleSaveFreeTerminal: vi.fn(),
      handleDiscardFreeTerminal: vi.fn(),
    },
  }),
}));

vi.mock("@/stores/search-ui.js", () => ({
  useSearchUiStore: () => ({
    open: false,
    close: vi.fn(),
    openWith: vi.fn(),
    mode: "files",
    queries: { files: "", content: "", path: "" },
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) => {
    const s = {
      theme: "dark",
      editorFontSize: 14,
      editorZoomWheelEnabled: false,
      compactWorkspaceSurface: "editor",
      setCompactWorkspaceSurface: vi.fn(),
    };
    return selector ? selector(s) : s;
  },
}));

vi.mock("@/hooks/use-shortcuts.js", () => ({
  addKeyboardShortcutListener: () => () => {},
  useDocumentKeyboardShortcut: () => {},
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector?: (s: unknown) => unknown) => {
    const s = {
      tabs: [],
      activeKeys: {},
    };
    return selector ? selector(s) : s;
  },
}));

vi.mock("@/api/client.js", () => ({
  api: {
    projects: {
      list: async () => [{ name: "demo-project" }],
    },
  },
  normalizeProjectTarget: (target: ProjectTargetRef) => target,
  normalizeProjectTargetPath: (path: string) => path,
  projectTargetCacheKey: () => "root",
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ name: "demo-project" }], isLoading: false }),
  useQueries: () => [],
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
import WorkspacePage from "./WorkspacePage.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  capturedEditorTabsProps.length = 0;
  capturedGitPanelProps.length = 0;
  lastIdeShellProps = null;
  lastTerminalWorkspaceShellProps = null;
  mockWorkspaceMode = "ide";
  compactMock.current = false;
  mockWorkspaceConnection = {
    owner: { profileId: "profile-1", generation: 1 },
    status: "connected",
    serverUrl: "http://127.0.0.1:4801",
  };
  mockProjectTarget = {
    project: "demo-project",
    target: { project: "demo-project", profileId: "profile-1" } as ProjectTargetRef,
    targetKey: "root",
    label: "demo-project",
    isRoot: true,
    available: true,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

async function flushLazy(): Promise<void> {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

describe("WorkspacePage Blame Reveal Integration", () => {
  it("in IDE layout, handleRevealGitCommit activates Git bottom tool and passes revealRequest", async () => {
    mockWorkspaceMode = "ide";
    compactMock.current = false;

    await act(async () => {
      root?.render(<WorkspacePage />);
    });
    await flushLazy();

    expect(capturedEditorTabsProps.length).toBeGreaterThan(0);
    const editorProps = capturedEditorTabsProps[capturedEditorTabsProps.length - 1];
    expect(editorProps?.sourceActive).toBe(true);
    expect(typeof editorProps?.onRevealGitCommit).toBe("function");

    const revealRequest: GitCommitRevealRequest = {
      nonce: 42,
      owner: { profileId: "profile-1", generation: 1 },
      target: { project: "demo-project", profileId: "profile-1" },
      rootId: "root-main",
      hash: "abc1234def5678",
    };

    act(() => {
      editorProps?.onRevealGitCommit?.(revealRequest);
    });

    expect(lastIdeShellProps?.activateBottomToolRequest).toEqual({
      nonce: 1,
      toolId: "git",
    });
  });

  it("in IDE layout, target mismatch blocks Git commit reveal", async () => {
    mockWorkspaceMode = "ide";
    compactMock.current = false;

    await act(async () => {
      root?.render(<WorkspacePage />);
    });
    await flushLazy();

    const editorProps = capturedEditorTabsProps[capturedEditorTabsProps.length - 1];

    const mismatchedRequest: GitCommitRevealRequest = {
      nonce: 99,
      owner: { profileId: "profile-WRONG", generation: 1 },
      target: { project: "demo-project", profileId: "profile-WRONG" },
      rootId: "root-main",
      hash: "abc1234def5678",
    };

    act(() => {
      editorProps?.onRevealGitCommit?.(mismatchedRequest);
    });

    expect(lastIdeShellProps?.activateBottomToolRequest).toBeNull();
  });

  it("in Compact layout, handleRevealGitCommit sets requested compact surface to git", async () => {
    mockWorkspaceMode = "ide";
    compactMock.current = true;

    await act(async () => {
      root?.render(<WorkspacePage />);
    });
    await flushLazy();
    expect(capturedEditorTabsProps.length).toBeGreaterThan(0);
    const editorProps = capturedEditorTabsProps[capturedEditorTabsProps.length - 1];

    const revealRequest: GitCommitRevealRequest = {
      nonce: 55,
      owner: { profileId: "profile-1", generation: 1 },
      target: { project: "demo-project", profileId: "profile-1" },
      rootId: "root-main",
      hash: "compact-hash-123",
    };

    act(() => {
      editorProps?.onRevealGitCommit?.(revealRequest);
    });


    expect(mockActiveCompactSurfaceId).toBe("git");
  });

  it("in Terminal layout, handleRevealGitCommit activates Terminal panel request with intent='reveal' and targetId='git'", async () => {
    mockWorkspaceMode = "terminal";
    compactMock.current = false;
    localStorage.setItem("dam-hopper:terminal-floating-file-panel-open", "true");
    await act(async () => {
      root?.render(<WorkspacePage />);
    });
    await flushLazy();

    expect(capturedEditorTabsProps.length).toBeGreaterThan(0);
    const editorProps = capturedEditorTabsProps[capturedEditorTabsProps.length - 1];

    const revealRequest: GitCommitRevealRequest = {
      nonce: 77,
      owner: { profileId: "profile-1", generation: 1 },
      target: { project: "demo-project", profileId: "profile-1" },
      rootId: "root-terminal",
      hash: "terminal-commit-hash",
    };

    act(() => {
      editorProps?.onRevealGitCommit?.(revealRequest);
    });

    expect(lastTerminalWorkspaceShellProps?.activatePanelRequest).toEqual({
      nonce: 1,
      targetId: "git",
      intent: "reveal",
    });
  });
});
