import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage, {
  openChangedFileDiff,
  resolveOpenTunnelInBrowserReveal,
  resolveActiveCompactSurfaceId,
  resolveRevealActiveFileOutcome,
} from "./WorkspacePage.js";
import { createChangedFileSelection } from "@/components/organisms/ChangedFilesList.js";
import { COMPACT_WORKSPACE_QUERY } from "@/hooks/compact-workspace-media-query.js";
import { TERMINAL_FILE_PANEL_OPEN_KEY } from "@/lib/terminal-floating-file-panel-state.js";
import type { TerminalWorkspacePanelControls } from "@/lib/terminal-workspace-panel.js";
import { useProjectTargetStore } from "@/stores/project-target.js";

let mockWorkspaceMode: "ide" | "terminal" = "ide";
let mockActiveProject: string | null = null;
let mockActiveProjectRevision = 0;
let mockProjects = [{ name: "demo-project" }];
let mockActiveTerminalTab: string | null = null;
let mockMountedSessions: Array<{
  sessionId: string;
  project: string;
  command: string;
}> = [];
let mockTerminalTabs: Array<{
  sessionId: string;
  label: string;
  session?: { alive?: boolean };
}> = [];
let mockSessionMap = new Map<string, { project: string; alive: boolean }>();
let mockAndroidChromeSuppressed = false;
let mockLaunchForm: {
  projectName: string;
  cwd: string;
  command: string;
} | null = null;
let mockFreeTerminalSavePrompt: {
  projectName: string;
  name: string;
  error?: string;
} | null = null;
let lastTerminalWorkspaceShellProps: Record<string, unknown> | null = null;
let lastIdeShellProps: Record<string, unknown> | null = null;
const terminalPanelControls: TerminalWorkspacePanelControls = {
  zIndex: 20,
  onActivate: () => undefined,
};
const projectTargetMock = vi.hoisted(() => ({
  current: null as {
    project: string;
    target: { project: string; worktreePath?: string };
    targetKey: string;
    label: string;
    isRoot: boolean;
    available: boolean;
  } | null,
}));

function renderTerminalOverlayContent() {
  const renderContent =
    lastTerminalWorkspaceShellProps?.terminalOverlayContent as
      | ((controls: TerminalWorkspacePanelControls) => ReactElement)
      | undefined;
  expect(renderContent).toEqual(expect.any(Function));
  return renderContent!(terminalPanelControls);
}

type ButtonElement = ReactElement<{
  "aria-label"?: string;
  children?: ReactNode;
  onClick?: () => void;
}>;

function findButtonByAriaLabel(
  node: ReactNode,
  label: string,
): ButtonElement | null {
  if (!isValidElement(node)) return null;

  const element = node as ButtonElement;
  if (element.type === "button" && element.props["aria-label"] === label) {
    return element;
  }

  const children = element.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findButtonByAriaLabel(child, label);
      if (match) return match;
    }
    return null;
  }

  return findButtonByAriaLabel(children, label);
}
let lastTerminalManagerOptions: {
  terminalAutoSwitchProjectEnabled: boolean;
  setActiveProject: (project: string | null) => void;
} | null = null;
const localStorageState = new Map<string, string>();
const mockSetActiveProject = vi.fn();

const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageState.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    localStorageState.delete(key);
  }),
  clear: vi.fn(() => {
    localStorageState.clear();
  }),
};

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockProjects }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
  useMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/components/templates/IdeShell.js", () => ({
  IdeShell: (props: Record<string, unknown>) => {
    lastIdeShellProps = props;
    return <div data-shell="ide-shell" />;
  },
}));

vi.mock("@/components/templates/TerminalWorkspaceShell.js", () => ({
  TerminalWorkspaceShell: (props: Record<string, unknown>) => {
    lastTerminalWorkspaceShellProps = props;
    return <div data-shell="terminal-shell" />;
  },
}));

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: ({ children }: { children?: ReactNode }) => (
    <div data-testid="top-nav">{children}</div>
  ),
}));

vi.mock("@/hooks/use-sidebar-collapse.js", () => ({
  useSidebarCollapse: () => ({ collapsed: true, toggle: () => {} }),
}));

vi.mock("@/hooks/use-project-target.js", () => ({
  useProjectTarget: () => projectTargetMock.current,
}));

vi.mock("@/components/atoms/Button.js", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  inputClass: "input-class",
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockAndroidChromeSuppressed,
  }),
}));

vi.mock("@/components/ui/Select.js", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => <div />,
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({
    activeProject: mockActiveProject,
    activeProjectRevision: mockActiveProjectRevision,
    setActiveProject: mockSetActiveProject,
  }),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector: (state: typeof editorStore) => unknown) =>
    selector(editorStore),
}));

vi.mock("@/stores/search-ui.js", () => ({
  useSearchUiStore: () => ({
    open: false,
    close: vi.fn(),
    openWith: vi.fn(),
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector: (state: typeof settingsStore) => unknown) =>
    selector(settingsStore),
}));

vi.mock("@/hooks/use-terminal-manager.js", () => ({
  useTerminalManager: (
    _searchParams: URLSearchParams,
    _setSearchParams: unknown,
    options: {
      terminalAutoSwitchProjectEnabled: boolean;
      setActiveProject: (project: string | null) => void;
    },
  ) => {
    lastTerminalManagerOptions = options;
    return {
      state: {
        activeTab: mockActiveTerminalTab,
        openTabs: mockTerminalTabs,
        mountedSessions: mockMountedSessions,
        launchForm: mockLaunchForm,
        freeTerminalSavePrompt: mockFreeTerminalSavePrompt,
        selection: null,
      },
      derived: {
        tree: [],
        freeTerminals: [],
        isLoading: false,
        terminalTabs: mockTerminalTabs,
        selectedId: null,
        sessionMap: mockSessionMap,
      },
      actions: terminalActions,
    };
  },
}));

vi.mock("@/hooks/use-shortcuts.js", () => ({
  addKeyboardShortcutListener: () => () => {},
  useDocumentKeyboardShortcut: () => {},
}));

vi.mock("@/api/client.js", () => ({
  api: {
    projects: {
      list: async () => [{ name: "demo-project" }],
    },
  },
  normalizeProjectTarget: (target: {
    project: string;
    worktreePath?: string | null;
  }) =>
    target.worktreePath == null
      ? { project: target.project }
      : { project: target.project, worktreePath: target.worktreePath },
  normalizeProjectTargetPath: (path: string) => path,
  projectTargetCacheKey: (target: {
    project: string;
    worktreePath?: string | null;
  }) =>
    target.worktreePath == null ? "root" : `worktree:${target.worktreePath}`,
}));

vi.mock("@/lib/workspace-mode.js", () => ({
  loadWorkspaceMode: () => mockWorkspaceMode,
  saveWorkspaceMode: vi.fn(),
}));

const editorStore = {
  open: vi.fn(),
  openDiff: vi.fn(),
};

const settingsStore = {
  searchTextShortcut: "mod+shift+f",
  searchFilenameShortcut: "mod+p",
  terminalWorkspaceShortcut: "mod+`",
  terminalFilePanelShortcut: "mod+shift+e",
  projectPanelShortcut: "mod+shift+b",
  revealActiveFileShortcut: "alt+f1",
  terminalAutoSwitchProjectEnabled: true,
};

const terminalActions = {
  handleSelectProject: vi.fn(),
  handleSelectTerminal: vi.fn(),
  handleLaunchTerminal: vi.fn(),
  handleLaunchProfile: vi.fn(),
  handleLaunchFormSubmit: vi.fn(),
  handleDeleteProfile: vi.fn(),
  handleAddFreeTerminal: vi.fn(),
  handleLaunchFreeWithCommand: vi.fn(),
  handleLaunchSuggestedCommand: vi.fn(),
  handleLaunchShell: vi.fn(),
  handleSelectTab: vi.fn(),
  handleCloseTab: vi.fn(),
  handleKillTerminal: vi.fn(),
  handleRemoveFreeTerminal: vi.fn(),
  handleOpenFreeTerminalSavePrompt: vi.fn(),
  handleSaveFreeTerminalToProject: vi.fn(),
  handleUpdateProfile: vi.fn(),
  handleUpdateCustomCommand: vi.fn(),
  handleSessionExit: vi.fn(),
  setFreeTerminalSavePrompt: vi.fn(),
  setLaunchForm: vi.fn(),
};

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("window", {
    matchMedia: vi.fn((query: string) => ({
      matches: query === COMPACT_WORKSPACE_QUERY ? matches : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    mockWorkspaceMode = "ide";
    mockActiveProject = null;
    mockActiveProjectRevision = 0;
    mockProjects = [{ name: "demo-project" }];
    mockActiveTerminalTab = null;
    mockMountedSessions = [];
    mockTerminalTabs = [];
    mockSessionMap = new Map();
    mockAndroidChromeSuppressed = false;
    settingsStore.terminalAutoSwitchProjectEnabled = true;
    mockLaunchForm = null;
    mockFreeTerminalSavePrompt = null;
    lastTerminalWorkspaceShellProps = null;
    lastIdeShellProps = null;
    projectTargetMock.current = null;
    lastTerminalManagerOptions = null;
    mockSetActiveProject.mockClear();
    localStorageState.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    localStorageMock.clear.mockClear();
    vi.stubGlobal("localStorage", localStorageMock);
    useProjectTargetStore.getState().resetTarget("demo-project");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the mobile shell with IDE surfaces on compact viewports", () => {
    stubMatchMedia(true);

    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).not.toContain("IDE companion");
    expect(markup).toContain("Explorer");
    expect(markup).toContain("Search");
    expect(markup).toContain("Editor");
    expect(markup).toContain("Git");
    expect(markup).toContain("Project");
  });

  it("passes the terminal auto-switch preference and workspace setter to the manager", () => {
    settingsStore.terminalAutoSwitchProjectEnabled = true;

    renderToStaticMarkup(<WorkspacePage />);

    expect(lastTerminalManagerOptions).toEqual({
      terminalAutoSwitchProjectEnabled: true,
      setActiveProject: mockSetActiveProject,
    });
  });

  it("renders the mobile shell with terminal surfaces in terminal mode", () => {
    stubMatchMedia(true);
    mockWorkspaceMode = "terminal";

    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).not.toContain("Terminal companion");
    expect(markup).toContain("Terminal");
    expect(markup).toContain("Browser");
    expect(markup).toContain("Fleet");
    expect(markup).toContain("Ports");
    expect(markup).toContain("Browser");
    expect(markup).toContain("Git");
    expect(markup).toContain("Project");
  });

  it("keeps the desktop IDE shell on wide viewports", () => {
    stubMatchMedia(false);

    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).toContain('data-shell="ide-shell"');
    expect(markup).not.toContain("Panels");
    expect(markup).not.toContain("IDE companion");
  });

  it("passes one selected target reference to Explorer, Search, and Project", () => {
    stubMatchMedia(false);
    projectTargetMock.current = {
      project: "demo-project",
      target: {
        project: "demo-project",
        worktreePath: "/tmp/demo-feature",
      },
      targetKey: "worktree:/tmp/demo-feature",
      label: "feature/demo",
      isRoot: false,
      available: true,
    };

    try {
      renderToStaticMarkup(<WorkspacePage />);

      const leftTools = lastIdeShellProps?.leftTools as Array<{
        id: string;
        content: ReactElement;
      }>;
      const rightTools = lastIdeShellProps?.rightTools as Array<{
        id: string;
        content: ReactElement;
      }>;
      const searchSuspense = leftTools.find((tool) => tool.id === "search")
        ?.content as ReactElement<{
        children: ReactElement<{ target?: unknown }>;
      }>;
      const explorerSurface = leftTools.find((tool) => tool.id === "explorer")
        ?.content as ReactElement<{
        children: ReactElement<{
          children: ReactElement<{ target?: unknown }>;
        }>;
      }>;
      const projectSurface = rightTools.find(
        (tool) => tool.id === "project-info",
      )?.content as ReactElement<{
        children: ReactElement<{
          children: ReactElement<{ target?: { target?: unknown } }>;
        }>;
      }>;

      const searchTarget = searchSuspense.props.children.props.target;
      const explorerTarget =
        explorerSurface.props.children.props.children.props.target;
      const projectTarget =
        projectSurface.props.children.props.children.props.target?.target;

      expect(searchTarget).toEqual({
        project: "demo-project",
        worktreePath: "/tmp/demo-feature",
      });
      expect(explorerTarget).toBe(searchTarget);
      expect(projectTarget).toBe(searchTarget);
    } finally {
      projectTargetMock.current = null;
    }
  });

  it("remounts Explorer when the selected target changes", () => {
    stubMatchMedia(false);

    const getExplorerKey = () => {
      const leftTools = lastIdeShellProps?.leftTools as Array<{
        id: string;
        content: ReactElement;
      }>;
      const explorerSurface = leftTools.find((tool) => tool.id === "explorer")
        ?.content as ReactElement<{
        children: ReactElement<{ children: ReactElement }>;
      }>;
      const fileTree = explorerSurface.props.children.props.children;
      return fileTree.key;
    };

    try {
      projectTargetMock.current = null;
      renderToStaticMarkup(<WorkspacePage />);
      const rootKey = getExplorerKey();

      projectTargetMock.current = {
        project: "demo-project",
        target: {
          project: "demo-project",
          worktreePath: "/tmp/demo-feature",
        },
        targetKey: "worktree:/tmp/demo-feature",
        label: "feature/demo",
        isRoot: false,
        available: true,
      };
      renderToStaticMarkup(<WorkspacePage />);
      const worktreeKey = getExplorerKey();

      expect(rootKey).toBe("demo-project:root");
      expect(worktreeKey).toBe("demo-project:worktree:/tmp/demo-feature");
      expect(worktreeKey).not.toBe(rootKey);
    } finally {
      projectTargetMock.current = null;
    }
  });

  it("keeps the desktop terminal shell on wide viewports and exposes the files toggle", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";

    const markup = renderToStaticMarkup(<WorkspacePage />);
    const terminalMarkup = renderToStaticMarkup(
      <>{lastTerminalWorkspaceShellProps?.terminalContent as ReactNode}</>,
    );
    expect(markup).not.toContain("Panels");

    expect(markup).toContain('data-shell="terminal-shell"');
    expect(lastTerminalWorkspaceShellProps?.terminalOverlayContent).toEqual(
      expect.any(Function),
    );
    expect(lastTerminalWorkspaceShellProps?.terminalOverlayOpen).toBe(false);
    expect(lastTerminalWorkspaceShellProps?.toolbarActions).toBeUndefined();
    expect(terminalMarkup).toContain('aria-label="Diagnostics time window"');
    expect(terminalMarkup).toContain('value="10" selected=""');
    expect(terminalMarkup).toContain("Show files panel");
    expect(terminalMarkup).toContain("Git");
    expect(terminalMarkup).toContain("Ports");
    expect(terminalMarkup).toContain("Project");
    expect(terminalMarkup).toContain("Fleet");
    expect(lastTerminalWorkspaceShellProps?.projectContent).toBeDefined();
  });

  it("keeps the header launch action scoped to the selected project", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";
    mockProjects = [{ name: "alpha" }, { name: "beta" }];
    mockActiveProject = "beta";
    mockActiveTerminalTab = "alpha-terminal";
    mockMountedSessions = [
      { sessionId: "alpha-terminal", project: "alpha", command: "bash" },
    ];
    mockTerminalTabs = [
      { sessionId: "alpha-terminal", label: "alpha", session: { alive: true } },
    ];
    mockSessionMap = new Map([
      ["alpha-terminal", { project: "alpha", alive: true }],
    ]);

    renderToStaticMarkup(<WorkspacePage />);
    const terminalMarkup = renderToStaticMarkup(
      <>{lastTerminalWorkspaceShellProps?.terminalContent as ReactNode}</>,
    );

    expect(terminalMarkup).toContain('aria-label="Open terminal in beta"');
    expect(terminalMarkup).toContain('title="Open terminal in beta"');

    const launchButton = findButtonByAriaLabel(
      lastTerminalWorkspaceShellProps?.terminalContent as ReactNode,
      "Open terminal in beta",
    );
    expect(launchButton).not.toBeNull();
    terminalActions.handleLaunchShell.mockClear();
    launchButton?.props.onClick?.();
    expect(terminalActions.handleLaunchShell).toHaveBeenCalledWith("beta");

    mockActiveProject = "alpha";
    renderToStaticMarkup(<WorkspacePage />);
    const sameProjectMarkup = renderToStaticMarkup(
      <>{lastTerminalWorkspaceShellProps?.terminalContent as ReactNode}</>,
    );
    expect(sameProjectMarkup).not.toContain(
      'aria-label="Open terminal in alpha"',
    );
  });

  it("disables text-dependent terminal actions when Android Chrome input is suppressed", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";
    mockAndroidChromeSuppressed = true;
    mockLaunchForm = { projectName: "demo-project", cwd: ".", command: "" };
    mockFreeTerminalSavePrompt = {
      projectName: "demo-project",
      name: "",
    };

    renderToStaticMarkup(<WorkspacePage />);
    const terminalMarkup = renderToStaticMarkup(
      <>{lastTerminalWorkspaceShellProps?.terminalContent as ReactNode}</>,
    );

    expect(terminalMarkup).toContain(
      "Launching with custom text is unavailable in Android Chrome",
    );
    expect(terminalMarkup).toContain(
      "Saving profiles is unavailable in Android Chrome",
    );
    expect(terminalMarkup).toMatch(
      /<button[^>]*disabled=""[^>]*title="Launching with custom text is unavailable in Android Chrome"/,
    );
  });

  it("restores the floating file panel state in desktop terminal mode", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";
    localStorage.setItem(TERMINAL_FILE_PANEL_OPEN_KEY, "true");

    renderToStaticMarkup(<WorkspacePage />);
    const overlayMarkup = renderToStaticMarkup(renderTerminalOverlayContent());

    expect(overlayMarkup).toContain("Workspace Files");
    expect(overlayMarkup).toContain("Close files panel");
    expect(overlayMarkup).toContain("terminal-file-panel-changes-panel");
  });

  it("threads desktop floating-panel stacking controls into Files", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";
    localStorage.setItem(TERMINAL_FILE_PANEL_OPEN_KEY, "true");

    renderToStaticMarkup(<WorkspacePage />);
    const renderContent =
      lastTerminalWorkspaceShellProps?.terminalOverlayContent as (
        controls: TerminalWorkspacePanelControls,
      ) => ReactElement;
    const markup = renderToStaticMarkup(
      renderContent({ zIndex: 25, onActivate: () => undefined }),
    );

    expect(markup).toContain('style="z-index:25"');
  });

  it("provides a no-project Changes fallback in the terminal panel", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";
    mockProjects = [];
    localStorage.setItem(TERMINAL_FILE_PANEL_OPEN_KEY, "true");

    renderToStaticMarkup(<WorkspacePage />);
    const overlay = renderTerminalOverlayContent() as ReactElement<{
      changesContent: ReactNode;
    }>;
    const changesMarkup = renderToStaticMarkup(
      <>{overlay.props.changesContent}</>,
    );

    expect(changesMarkup).toContain("No projects configured");
  });

  it("opens changed-file diffs with their original metadata and root routing", () => {
    const openDiff = vi.fn();
    const selections = [
      createChangedFileSelection({
        path: "removed.ts",
        status: "deleted",
        staged: false,
        additions: 0,
        deletions: 8,
      }),
      createChangedFileSelection({
        path: "conflict.ts",
        status: "conflicted",
        staged: false,
        additions: 3,
        deletions: 2,
        rootId: "packages/app",
      }),
    ];

    for (const selection of selections) {
      openChangedFileDiff("demo-project", selection, openDiff);
    }

    expect(openDiff).toHaveBeenNthCalledWith(
      1,
      "demo-project",
      "removed.ts",
      "deleted",
      0,
      8,
      undefined,
      ".",
      "removed.ts",
    );
    expect(openDiff).toHaveBeenNthCalledWith(
      2,
      "demo-project",
      "packages/app/conflict.ts",
      "conflicted",
      3,
      2,
      undefined,
      "packages/app",
      "conflict.ts",
    );
  });

  it("falls back to a valid compact surface when the current one disappears", () => {
    expect(
      resolveActiveCompactSurfaceId(
        "explorer",
        [{ id: "terminal" }, { id: "fleet" }, { id: "ports" }],
        "terminal",
      ),
    ).toBe("terminal");

    expect(
      resolveActiveCompactSurfaceId(
        "terminal",
        [{ id: "terminal" }, { id: "fleet" }, { id: "ports" }],
        "terminal",
      ),
    ).toBe("terminal");
  });

  it("resolves reveal-active-file behavior for desktop IDE mode", () => {
    expect(
      resolveRevealActiveFileOutcome({
        projectName: "demo-project",
        path: "src/App.tsx",
        nonce: 4,
        workspaceMode: "ide",
        isCompactWorkspace: false,
      }),
    ).toEqual({
      revealRequest: {
        project: "demo-project",
        path: "src/App.tsx",
        nonce: 4,
      },
      leftTopToolRequest: { toolId: "explorer", nonce: 4 },
    });
  });

  it("resolves reveal-active-file behavior for desktop terminal mode", () => {
    expect(
      resolveRevealActiveFileOutcome({
        projectName: "demo-project",
        path: "src/App.tsx",
        nonce: 7,
        workspaceMode: "terminal",
        isCompactWorkspace: false,
      }),
    ).toEqual({
      revealRequest: {
        project: "demo-project",
        path: "src/App.tsx",
        nonce: 7,
      },
      openTerminalFilePanel: true,
    });
  });

  it("no-ops for compact terminal mode because no explorer surface exists", () => {
    expect(
      resolveRevealActiveFileOutcome({
        projectName: "demo-project",
        path: "src/App.tsx",
        nonce: 9,
        workspaceMode: "terminal",
        isCompactWorkspace: true,
      }),
    ).toBeNull();
  });

  it("scopes reveal requests to the originating project", () => {
    expect(
      resolveRevealActiveFileOutcome({
        projectName: "demo-project",
        path: "src/App.tsx",
        nonce: 11,
        workspaceMode: "ide",
        isCompactWorkspace: true,
      }),
    ).toEqual({
      revealRequest: {
        project: "demo-project",
        path: "src/App.tsx",
        nonce: 11,
      },
      compactSurfaceId: "explorer",
    });
  });

  it("chooses the right browser reveal mode for tunnel handoff", () => {
    expect(resolveOpenTunnelInBrowserReveal("ide", false)).toEqual({
      openBrowser: true,
      activateTerminalBrowserSplit: true,
    });
    expect(resolveOpenTunnelInBrowserReveal("terminal", false)).toEqual({
      openBrowser: true,
      activateTerminalBrowserSplit: false,
    });
    expect(resolveOpenTunnelInBrowserReveal("ide", true)).toEqual({
      compactSurfaceId: "browser",
      openBrowser: false,
      activateTerminalBrowserSplit: false,
    });
  });
});
