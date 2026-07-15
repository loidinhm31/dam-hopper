import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage, {
  resolveActiveCompactSurfaceId,
  resolveRevealActiveFileOutcome,
} from "./WorkspacePage.js";
import { COMPACT_WORKSPACE_QUERY } from "@/hooks/compact-workspace-media-query.js";
import { TERMINAL_FILE_PANEL_OPEN_KEY } from "@/lib/terminal-floating-file-panel-state.js";

let mockWorkspaceMode: "ide" | "terminal" = "ide";
let lastTerminalWorkspaceShellProps: Record<string, unknown> | null = null;
const localStorageState = new Map<string, string>();

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
  useQuery: () => ({ data: [{ name: "demo-project" }] }),
  useMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/components/templates/IdeShell.js", () => ({
  IdeShell: () => <div data-shell="ide-shell" />,
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

vi.mock("@/components/atoms/Button.js", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  inputClass: "input-class",
}));

vi.mock("@/components/ui/Select.js", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <div />,
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({
    activeProject: null,
    setActiveProject: vi.fn(),
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
  useTerminalManager: () => ({
    state: {
      activeTab: null,
      mountedSessions: [],
      launchForm: null,
      freeTerminalSavePrompt: null,
      selection: null,
    },
    derived: {
      tree: [],
      freeTerminals: [],
      isLoading: false,
      tabsWithLiveSession: [],
      selectedId: null,
      sessionMap: new Map(),
    },
    actions: terminalActions,
  }),
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
  revealActiveFileShortcut: "alt+f1",
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
    lastTerminalWorkspaceShellProps = null;
    localStorageState.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    localStorageMock.clear.mockClear();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the mobile shell with IDE surfaces on compact viewports", () => {
    stubMatchMedia(true);

    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).toContain("IDE companion");
    expect(markup).toContain("Explorer");
    expect(markup).toContain("Search");
    expect(markup).toContain("Editor");
    expect(markup).toContain("Git");
    expect(markup).toContain("Project");
  });

  it("renders the mobile shell with terminal surfaces in terminal mode", () => {
    stubMatchMedia(true);
    mockWorkspaceMode = "terminal";

    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).toContain("Terminal companion");
    expect(markup).toContain("Terminal");
    expect(markup).toContain("Fleet");
    expect(markup).toContain("Ports");
    expect(markup).toContain("Git");
    expect(markup).toContain("Project");
  });

  it("keeps the desktop IDE shell on wide viewports", () => {
    stubMatchMedia(false);

    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).toContain('data-shell="ide-shell"');
    expect(markup).not.toContain("IDE companion");
  });

  it("keeps the desktop terminal shell on wide viewports and exposes the files toggle", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";

    const markup = renderToStaticMarkup(<WorkspacePage />);
    const terminalMarkup = renderToStaticMarkup(
      <>{lastTerminalWorkspaceShellProps?.terminalContent as ReactNode}</>,
    );

    expect(markup).toContain('data-shell="terminal-shell"');
    expect(lastTerminalWorkspaceShellProps?.terminalOverlayContent).toBeTruthy();
    expect(lastTerminalWorkspaceShellProps?.toolbarActions).toBeUndefined();
    expect(terminalMarkup).toContain('aria-label="Diagnostics time window"');
    expect(terminalMarkup).toContain('value="10" selected=""');
    expect(terminalMarkup).toContain("Show files panel");
  });

  it("restores the floating file panel state in desktop terminal mode", () => {
    stubMatchMedia(false);
    mockWorkspaceMode = "terminal";
    localStorage.setItem(TERMINAL_FILE_PANEL_OPEN_KEY, "true");

    renderToStaticMarkup(<WorkspacePage />);
    const overlayMarkup = renderToStaticMarkup(
      <>{lastTerminalWorkspaceShellProps?.terminalOverlayContent as ReactNode}</>,
    );

    expect(overlayMarkup).toContain("Workspace Files");
    expect(overlayMarkup).toContain("Close files panel");
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
});
