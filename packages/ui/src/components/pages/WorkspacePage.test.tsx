import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage, { resolveActiveCompactSurfaceId } from "./WorkspacePage.js";
import { COMPACT_WORKSPACE_QUERY } from "@/hooks/compact-workspace-media-query.js";

let mockWorkspaceMode: "ide" | "terminal" = "ide";

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ name: "demo-project" }] }),
}));

vi.mock("@/components/templates/IdeShell.js", () => ({
  IdeShell: () => <div data-shell="ide-shell" />,
}));

vi.mock("@/components/templates/TerminalWorkspaceShell.js", () => ({
  TerminalWorkspaceShell: () => <div data-shell="terminal-shell" />,
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
});
