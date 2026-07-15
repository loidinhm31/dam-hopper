import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage from "@/components/pages/WorkspacePage.js";
import { BrowserNotificationService } from "@/lib/browser-notification-service.js";
import { dispatchTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import { registerTerminal, terminalRegistry } from "@/lib/terminal-registry.js";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";

const mocks = vi.hoisted(() => {
  const sessionId = "terminal:web:_:1";
  const editorStore = {
    open: vi.fn(),
    openDiff: vi.fn(),
  };
  const settingsStore = {
    mobileCustomKeyboardEnabled: false,
    searchTextShortcut: "mod+shift+f",
    searchFilenameShortcut: "mod+p",
    terminalWorkspaceShortcut: "mod+`",
    terminalFilePanelShortcut: "mod+shift+e",
    revealActiveFileShortcut: "alt+f1",
  };
  const selectSession = vi.fn();

  return {
    sessionId,
    editorStore,
    settingsStore,
    selectSession,
    saveWorkspaceMode: vi.fn(),
    fitTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    fitCompetingTerminal: vi.fn(),
    focusCompetingTerminal: vi.fn(),
    compactWorkspace: false,
    coarsePointer: false,
    terminalActions: {
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
      handleSelectTab: selectSession,
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
    },
  };
});

const SESSION_ID = mocks.sessionId;

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ name: "web" }] }),
}));

vi.mock("@/api/queries.js", () => ({
  useExportDiagnostics: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/components/templates/IdeShell.js", () => ({
  IdeShell: () => <div data-shell="ide" />,
}));

vi.mock("@/components/templates/TerminalWorkspaceShell.js", () => ({
  TerminalWorkspaceShell: () => <div data-shell="terminal" />,
}));

vi.mock("@/components/templates/MobileWorkspaceShell.js", () => ({
  MobileWorkspaceShell: ({
    activeSurfaceId,
    workspaceMode,
  }: {
    activeSurfaceId: string;
    workspaceMode: string;
  }) => (
    <div
      data-shell="mobile"
      data-surface={activeSurfaceId}
      data-workspace-mode={workspaceMode}
    />
  ),
}));

vi.mock("@/components/organisms/TerminalFloatingFilePanel.js", () => ({
  TerminalFloatingFilePanel: () => null,
}));

vi.mock("@/components/organisms/TerminalDiagnosticsContextMenu.js", () => ({
  TerminalDiagnosticsContextMenu: () => null,
}));

vi.mock("@/components/molecules/DiagnosticsTimeWindowSelect.js", () => ({
  DiagnosticsTimeWindowSelect: () => null,
}));

vi.mock("@/components/atoms/Button.js", () => ({
  Button: ({ children }: { children?: ReactNode }) => (
    <button>{children}</button>
  ),
  inputClass: "input-class",
}));

vi.mock("@/components/ui/Select.js", () => ({
  Select: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({
    activeProject: "web",
    setActiveProject: vi.fn(),
  }),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: Object.assign(
    (selector: (state: typeof mocks.editorStore) => unknown) =>
      selector(mocks.editorStore),
    { getState: () => mocks.editorStore },
  ),
}));

vi.mock("@/stores/search-ui.js", () => ({
  useSearchUiStore: () => ({
    open: false,
    close: vi.fn(),
    openWith: vi.fn(),
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof mocks.settingsStore) => unknown) =>
      selector(mocks.settingsStore),
    { getState: () => mocks.settingsStore },
  ),
}));

vi.mock("@/hooks/use-terminal-manager.js", () => ({
  useTerminalManager: () => ({
    state: {
      activeTab: null,
      mountedSessions: [
        { sessionId: mocks.sessionId, project: "web", command: "bash" },
      ],
      launchForm: null,
      freeTerminalSavePrompt: null,
      selection: { project: "web" },
    },
    derived: {
      tree: [],
      freeTerminals: [],
      isLoading: false,
      tabsWithLiveSession: [],
      selectedId: null,
      sessionMap: new Map([
        [
          mocks.sessionId,
          { session_id: mocks.sessionId, project: "web", alive: true },
        ],
      ]),
    },
    actions: mocks.terminalActions,
  }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => mocks.compactWorkspace,
}));

vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => mocks.coarsePointer,
}));

vi.mock("@/hooks/use-resize-handle.js", () => ({
  useResizeHandle: () => ({
    width: 320,
    handleProps: {},
    isDragging: false,
  }),
}));

vi.mock("@/hooks/use-shortcuts.js", () => ({
  addKeyboardShortcutListener: () => () => {},
  useDocumentKeyboardShortcut: () => {},
}));

vi.mock("@/api/client.js", () => ({
  api: {
    projects: {
      list: async () => [{ name: "web" }],
    },
  },
}));

vi.mock("@/lib/workspace-mode.js", () => ({
  loadWorkspaceMode: () => "ide",
  saveWorkspaceMode: mocks.saveWorkspaceMode,
}));

class FakeNotification extends EventTarget {
  readonly close = vi.fn();
}

const notificationEvent: TerminalAgentNotification = {
  source: "osc9",
  sessionId: SESSION_ID,
  project: "web",
  agent: "codex",
  title: "Codex is ready",
  body: "Review the completed task.",
  status: "finished",
  receivedAt: 1,
};

describe("WorkspacePage notification navigation in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  async function renderWorkspace() {
    await act(async () => {
      root?.render(<WorkspacePage />);
    });
  }

  function registerNotifiedTerminal() {
    registerTerminal(
      SESSION_ID,
      { focus: mocks.focusTerminal } as never,
      { fit: mocks.fitTerminal } as never,
      {} as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compactWorkspace = false;
    mocks.coarsePointer = false;
    mocks.settingsStore.mobileCustomKeyboardEnabled = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    terminalRegistry.set("terminal:api:_:2", {
      terminal: { focus: mocks.focusCompetingTerminal },
      fitAddon: { fit: mocks.fitCompetingTerminal },
      findController: {},
    } as never);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    terminalRegistry.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  it("selects the popup's live bash and focuses its xterm", async () => {
    await renderWorkspace();
    const windowFocus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const nativeNotification = new FakeNotification();
    let notificationOptions: NotificationOptions | undefined;
    const service = new BrowserNotificationService({
      getPermission: () => "granted",
      notificationFactory: (_title, options) => {
        notificationOptions = options;
        return nativeNotification;
      },
    });

    expect(container.querySelector('[data-shell="ide"]')).not.toBeNull();
    expect(
      service.notifyTerminalAgent(notificationEvent, {
        terminalOrder: 1,
        onSelect: ({ sessionId }) =>
          dispatchTerminalNotificationSelection(sessionId),
      }),
    ).toEqual({ delivered: true });
    expect(notificationOptions?.body).toBe(
      "web · Bash #1\nReview the completed task.",
    );

    await act(async () => {
      nativeNotification.dispatchEvent(new Event("click"));
    });

    expect(nativeNotification.close).toHaveBeenCalledOnce();
    expect(windowFocus).toHaveBeenCalledOnce();
    expect(mocks.saveWorkspaceMode).toHaveBeenCalledWith("terminal");
    expect(mocks.selectSession).toHaveBeenCalledWith(SESSION_ID);
    expect(container.querySelector('[data-shell="terminal"]')).not.toBeNull();
    expect(mocks.focusCompetingTerminal).not.toHaveBeenCalled();

    await act(async () => registerNotifiedTerminal());
    await vi.waitFor(() => {
      expect(mocks.fitTerminal).toHaveBeenCalled();
      expect(mocks.focusTerminal).toHaveBeenCalled();
    });
    expect(mocks.fitCompetingTerminal).not.toHaveBeenCalled();
  });

  it("reveals the compact terminal without forcing the native keyboard", async () => {
    mocks.compactWorkspace = true;
    mocks.coarsePointer = true;
    mocks.settingsStore.mobileCustomKeyboardEnabled = true;
    registerNotifiedTerminal();
    await renderWorkspace();
    vi.spyOn(window, "focus").mockImplementation(() => {});

    expect(
      container
        .querySelector('[data-shell="mobile"]')
        ?.getAttribute("data-workspace-mode"),
    ).toBe("ide");

    await act(async () => {
      dispatchTerminalNotificationSelection(SESSION_ID);
    });

    const shell = container.querySelector('[data-shell="mobile"]');
    expect(shell?.getAttribute("data-workspace-mode")).toBe("terminal");
    expect(shell?.getAttribute("data-surface")).toBe("terminal");
    expect(mocks.selectSession).toHaveBeenCalledWith(SESSION_ID);
    await vi.waitFor(() => expect(mocks.fitTerminal).toHaveBeenCalled());
    expect(mocks.focusTerminal).not.toHaveBeenCalled();
  });
});
