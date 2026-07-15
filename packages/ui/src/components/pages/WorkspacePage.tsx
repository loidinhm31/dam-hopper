import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import {
  Terminal as TerminalIcon,
  Plus,
  Files,
  Search,
  Radio,
  GitCommit,
  GitMerge,
  LayoutGrid,
  Folder,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IdeShell } from "@/components/templates/IdeShell.js";
import { MobileWorkspaceShell } from "@/components/templates/MobileWorkspaceShell.js";
import { TerminalWorkspaceShell } from "@/components/templates/TerminalWorkspaceShell.js";
import { TerminalFloatingFilePanel } from "@/components/organisms/TerminalFloatingFilePanel.js";
import { DiagnosticsTimeWindowSelect } from "@/components/molecules/DiagnosticsTimeWindowSelect.js";
import { TerminalDiagnosticsContextMenu } from "@/components/organisms/TerminalDiagnosticsContextMenu.js";

import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useEditorStore } from "@/stores/editor.js";
import { useSearchUiStore } from "@/stores/search-ui.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalManager } from "@/hooks/use-terminal-manager.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useExportDiagnostics } from "@/api/queries.js";
import {
  addKeyboardShortcutListener,
  useDocumentKeyboardShortcut,
} from "@/hooks/use-shortcuts.js";
import { api } from "@/api/client.js";
import {
  loadWorkspaceMode,
  saveWorkspaceMode,
  type WorkspaceMode,
} from "@/lib/workspace-mode.js";
import {
  loadTerminalUsageMode,
  saveTerminalUsageMode,
  type TerminalUsageMode,
} from "@/lib/terminal-usage-mode.js";
import {
  loadTerminalFilePanelOpen,
  saveTerminalFilePanelOpen,
  shouldAutoOpenTerminalFilePanel,
  TERMINAL_FILE_PANEL_TREE_DEFAULT_WIDTH,
  TERMINAL_FILE_PANEL_TREE_MAX_WIDTH,
  TERMINAL_FILE_PANEL_TREE_MIN_WIDTH,
  TERMINAL_FILE_PANEL_TREE_WIDTH_KEY,
} from "@/lib/terminal-floating-file-panel-state.js";
import { cn } from "@/lib/utils.js";
import type { FsArborNode, PathSearchMatch, SearchMatch } from "@/api/fs-types.js";
import type { ToolWindowDef } from "@/types/ide.js";
import type { MobileWorkspaceSurface } from "@/components/templates/MobileWorkspaceShell.js";
import type { ActivateToolRequest } from "@/lib/reveal-active-file.js";
import type { FileTreeRevealRequest } from "@/lib/file-tree-reveal.js";
import { resolveRevealActiveFileOutcome } from "@/lib/reveal-active-file.js";
import { scheduleTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import {
  subscribeToRegistry,
  terminalRegistry,
} from "@/lib/terminal-registry.js";
import {
  activateTerminalAfterNavigation,
  navigateToTerminalNotification,
  subscribeToTerminalNotificationSelection,
} from "@/lib/terminal-notification-navigation.js";
import {
  exportDiagnosticsBundle,
  type DiagnosticsTimeWindowMinutes,
} from "@/lib/diagnostics-export.js";
export { resolveRevealActiveFileOutcome };

const FileTree = lazy(() =>
  import("@/components/organisms/FileTree.js").then((m) => ({
    default: m.FileTree,
  })),
);
const EditorTabs = lazy(() =>
  import("@/components/organisms/EditorTabs.js").then((m) => ({
    default: m.EditorTabs,
  })),
);
const TerminalTreeView = lazy(() =>
  import("@/components/organisms/TerminalTreeView.js").then((m) => ({
    default: m.TerminalTreeView,
  })),
);
const MultiTerminalDisplay = lazy(() =>
  import("@/components/organisms/MultiTerminalDisplay.js").then((m) => ({
    default: m.MultiTerminalDisplay,
  })),
);
const ActiveTerminalRuntimeDisplay = lazy(() =>
  import("@/components/organisms/ActiveTerminalRuntimeDisplay.js").then(
    (m) => ({
      default: m.ActiveTerminalRuntimeDisplay,
    }),
  ),
);
const TerminalKeepAliveHost = lazy(() =>
  import("@/components/organisms/TerminalKeepAliveHost.js").then((m) => ({
    default: m.TerminalKeepAliveHost,
  })),
);
const ProjectInfoPanel = lazy(() =>
  import("@/components/organisms/ProjectInfoPanel.js").then((m) => ({
    default: m.ProjectInfoPanel,
  })),
);
const SearchPanel = lazy(() =>
  import("@/components/organisms/SearchPanel.js").then((m) => ({
    default: m.SearchPanel,
  })),
);
const ChangedFilesList = lazy(() =>
  import("@/components/organisms/ChangedFilesList.js").then((m) => ({
    default: m.ChangedFilesList,
  })),
);
const PortsPanel = lazy(() =>
  import("@/components/organisms/PortsPanel.js").then((m) => ({
    default: m.PortsPanel,
  })),
);
const WorkspaceGitPanel = lazy(() =>
  import("@/components/organisms/WorkspaceGitPanel.js").then((m) => ({
    default: m.WorkspaceGitPanel,
  })),
);

function PanelFallback({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center text-xs text-[var(--color-text-muted)]">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      <span className="ml-2">{label}</span>
    </div>
  );
}

const IDE_COMPACT_SURFACE_IDS = [
  "explorer",
  "search",
  "editor",
  "git",
  "project",
] as const;
const TERMINAL_COMPACT_SURFACE_IDS = [
  "terminal",
  "fleet",
  "ports",
  "git",
  "project",
] as const;
const TERMINAL_LAYOUT_SENSITIVE_COMPACT_SURFACES = new Set(["terminal"]);
const TERMINAL_USAGE_OPTIONS: TerminalUsageMode[] = ["traditional", "runtime"];
const WORKSPACE_DIAGNOSTICS_FRONTEND_SCOPES = [
  "WorkspacePage",
  "TerminalPanel",
  "terminal-panel",
  "terminal-agent-notifications",
  "workspace",
];

interface TerminalDiagnosticsMenuTarget {
  sessionId: string;
  x: number;
  y: number;
}

function renderCompactPlaceholder(message: string) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-[var(--color-text-muted)]">
      {message}
    </div>
  );
}

export function resolveActiveCompactSurfaceId(
  currentSurfaceId: string,
  surfaces: ReadonlyArray<string | Pick<MobileWorkspaceSurface, "id">>,
  fallbackSurfaceId: string,
) {
  return surfaces.some((surface) =>
    typeof surface === "string"
      ? surface === currentSurfaceId
      : surface.id === currentSurfaceId,
  )
    ? currentSurfaceId
    : fallbackSurfaceId;
}

function getCompactSurfaceIds(mode: WorkspaceMode) {
  return mode === "terminal"
    ? TERMINAL_COMPACT_SURFACE_IDS
    : IDE_COMPACT_SURFACE_IDS;
}

function getDefaultCompactSurfaceId(mode: WorkspaceMode) {
  return mode === "terminal" ? "terminal" : "editor";
}

function buildSearchMatchFileNode(path: string): FsArborNode {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    kind: "file",
    size: 0,
    mtime: 0,
    isSymlink: false,
    children: null,
  };
}

export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProject, setActiveProject } = useWorkspaceStore();
  const [workspaceMode, setWorkspaceModeState] =
    useState<WorkspaceMode>(loadWorkspaceMode);
  const [terminalUsageMode, setTerminalUsageModeState] =
    useState<TerminalUsageMode>(loadTerminalUsageMode);
  const [diagnosticsWindowMinutes, setDiagnosticsWindowMinutes] =
    useState<DiagnosticsTimeWindowMinutes>(10);
  const [terminalDiagnosticsMenuTarget, setTerminalDiagnosticsMenuTarget] =
    useState<TerminalDiagnosticsMenuTarget | null>(null);
  const [terminalDiagnosticsError, setTerminalDiagnosticsError] = useState<
    string | null
  >(null);
  const exportDiagnostics = useExportDiagnostics();
  const [terminalFilePanelOpen, setTerminalFilePanelOpenState] = useState(
    loadTerminalFilePanelOpen,
  );
  const [fileTreeRevealRequest, setFileTreeRevealRequest] =
    useState<FileTreeRevealRequest | null>(null);
  const [ideLeftTopToolRequest, setIdeLeftTopToolRequest] =
    useState<ActivateToolRequest | null>(null);
  const [terminalFilePanelEditorFocusSignal, setTerminalFilePanelEditorFocusSignal] =
    useState(0);
  const [terminalLayoutRevision, setTerminalLayoutRevision] = useState(0);
  const revealRequestNonceRef = useRef(0);
  const terminalNotificationActivationRef = useRef<() => void>(() => {});
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );
  const defaultCompactSurfaceId = getDefaultCompactSurfaceId(workspaceMode);
  const availableCompactSurfaceIds = getCompactSurfaceIds(workspaceMode);
  const [requestedCompactSurface, setRequestedCompactSurface] = useState(
    defaultCompactSurfaceId,
  );
  const activeCompactSurface = resolveActiveCompactSurfaceId(
    requestedCompactSurface,
    availableCompactSurfaceIds,
    defaultCompactSurfaceId,
  );
  const compactTerminalLayoutRevision =
    isCompactWorkspace &&
    workspaceMode === "terminal" &&
    TERMINAL_LAYOUT_SENSITIVE_COMPACT_SURFACES.has(activeCompactSurface)
      ? terminalLayoutRevision + 1
      : terminalLayoutRevision;
  const {
    width: terminalFileTreeWidth,
    handleProps: terminalFileTreeResizeHandleProps,
    isDragging: isTerminalFileTreeResizing,
  } = useResizeHandle({
    min: TERMINAL_FILE_PANEL_TREE_MIN_WIDTH,
    max: TERMINAL_FILE_PANEL_TREE_MAX_WIDTH,
    defaultWidth: TERMINAL_FILE_PANEL_TREE_DEFAULT_WIDTH,
    storageKey: TERMINAL_FILE_PANEL_TREE_WIDTH_KEY,
  });

  const openFile = useEditorStore((s) => s.open);
  const openDiff = useEditorStore((s) => s.openDiff);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  // Validate persisted project still exists in the current workspace.
  useEffect(() => {
    if (projects.length > 0 && activeProject) {
      if (!projects.some((p) => p.name === activeProject)) {
        setActiveProject(null);
      }
    }
  }, [projects, activeProject, setActiveProject]);

  const { state, derived, actions } = useTerminalManager(
    searchParams,
    setSearchParams,
  );
  const {
    activeTab,
    mountedSessions,
    launchForm,
    freeTerminalSavePrompt,
    selection,
  } = state;
  const {
    tree,
    freeTerminals,
    isLoading,
    tabsWithLiveSession,
    selectedId,
    sessionMap,
  } = derived;
  const {
    handleSelectProject,
    handleSelectTerminal,
    handleLaunchTerminal,
    handleLaunchProfile,
    handleLaunchFormSubmit,
    handleDeleteProfile,
    handleAddFreeTerminal,
    handleLaunchFreeWithCommand,
    handleLaunchSuggestedCommand,
    handleLaunchShell,
    handleSelectTab,
    handleCloseTab,
    handleKillTerminal,
    handleRemoveFreeTerminal,
    handleOpenFreeTerminalSavePrompt,
    handleSaveFreeTerminalToProject,
    handleUpdateProfile,
    handleUpdateCustomCommand,
    handleSessionExit,
    setFreeTerminalSavePrompt,
    setLaunchForm,
  } = actions;

  const projectName =
    activeProject ?? (projects.length > 0 ? projects[0].name : null);

  const closeTerminalDiagnosticsMenu = useCallback(() => {
    setTerminalDiagnosticsMenuTarget(null);
    setTerminalDiagnosticsError(null);
  }, []);

  const handleExportTerminalDiagnostics = useCallback(async () => {
    const target = terminalDiagnosticsMenuTarget;
    if (!target || exportDiagnostics.isPending) return;

    setTerminalDiagnosticsError(null);
    const terminalIds = [target.sessionId];
    const sessionProject =
      sessionMap.get(target.sessionId)?.project ??
      mountedSessions.find((session) => session.sessionId === target.sessionId)
        ?.project ??
      null;

    try {
      await exportDiagnosticsBundle(
        (request) => exportDiagnostics.mutateAsync(request),
        {
          windowMinutes: diagnosticsWindowMinutes,
          includeTerminalOutput: true,
          terminalTailBytes: 65_536,
          terminalIds,
          scope: {
            page: "workspace",
            route: "/workspace",
            project: sessionProject,
            terminalIds,
            frontendScopes: WORKSPACE_DIAGNOSTICS_FRONTEND_SCOPES,
          },
        },
      );
      setTerminalDiagnosticsMenuTarget(null);
    } catch (error) {
      setTerminalDiagnosticsError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [
    diagnosticsWindowMinutes,
    exportDiagnostics,
    mountedSessions,
    sessionMap,
    terminalDiagnosticsMenuTarget,
  ]);

  const {
    open: searchOpen,
    close: closeSearch,
    openWith: openSearch,
  } = useSearchUiStore();
  const searchTextShortcut = useSettingsStore((s) => s.searchTextShortcut);
  const searchFilenameShortcut = useSettingsStore(
    (s) => s.searchFilenameShortcut,
  );
  const terminalWorkspaceShortcut = useSettingsStore(
    (s) => s.terminalWorkspaceShortcut,
  );
  const terminalFilePanelShortcut = useSettingsStore(
    (s) => s.terminalFilePanelShortcut,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setTerminalFilePanelOpen = useCallback((open: boolean) => {
    setTerminalFilePanelOpenState(open);
    saveTerminalFilePanelOpen(open);
  }, []);

  const toggleTerminalFilePanel = useCallback(() => {
    setTerminalFilePanelOpenState((current) => {
      const next = !current;
      saveTerminalFilePanelOpen(next);
      return next;
    });
  }, []);

  useDocumentKeyboardShortcut(searchTextShortcut, () => openSearch("content"));
  useDocumentKeyboardShortcut(searchFilenameShortcut, () =>
    openSearch("filename"),
  );
  useDocumentKeyboardShortcut(terminalFilePanelShortcut, () => {
    if (workspaceMode !== "terminal" || isCompactWorkspace) return;
    toggleTerminalFilePanel();
  });

  const handleRevealActiveFile = useCallback(() => {
    const activePath =
      projectName === null
        ? null
        : useEditorStore.getState().getActiveTab(projectName)?.path ?? null;
    const nonce = revealRequestNonceRef.current + 1;
    const outcome = resolveRevealActiveFileOutcome({
      projectName,
      path: activePath,
      nonce,
      workspaceMode,
      isCompactWorkspace,
    });
    if (!outcome) return;

    revealRequestNonceRef.current = nonce;
    if (outcome.compactSurfaceId) {
      setRequestedCompactSurface(outcome.compactSurfaceId);
    }
    if (outcome.leftTopToolRequest) {
      setIdeLeftTopToolRequest(outcome.leftTopToolRequest);
    }
    if (outcome.openTerminalFilePanel) {
      setTerminalFilePanelOpen(true);
    }
    setFileTreeRevealRequest(outcome.revealRequest);
  }, [
    isCompactWorkspace,
    projectName,
    setRequestedCompactSurface,
    setTerminalFilePanelOpen,
    workspaceMode,
  ]);

  const setWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      setWorkspaceModeState(mode);
      setRequestedCompactSurface((current) =>
        resolveActiveCompactSurfaceId(
          current,
          getCompactSurfaceIds(mode),
          getDefaultCompactSurfaceId(mode),
        ),
      );
      saveWorkspaceMode(mode);
      setTerminalLayoutRevision((current) => current + 1);
    },
    [setRequestedCompactSurface],
  );

  const toggleWorkspaceMode = useCallback(() => {
    setWorkspaceModeState((current) => {
      const next = current === "ide" ? "terminal" : "ide";
      setRequestedCompactSurface((activeSurface) =>
        resolveActiveCompactSurfaceId(
          activeSurface,
          getCompactSurfaceIds(next),
          getDefaultCompactSurfaceId(next),
        ),
      );
      saveWorkspaceMode(next);
      setTerminalLayoutRevision((revision) => revision + 1);
      return next;
    });
  }, [setRequestedCompactSurface]);

  const setTerminalUsageMode = useCallback((mode: TerminalUsageMode) => {
    setTerminalUsageModeState((current) => {
      if (current === mode) return current;
      saveTerminalUsageMode(mode);
      setTerminalLayoutRevision((revision) => revision + 1);
      return mode;
    });
  }, []);

  useEffect(
    () =>
      addKeyboardShortcutListener(
        window,
        () => useSettingsStore.getState().terminalWorkspaceShortcut,
        toggleWorkspaceMode,
      ),
    [toggleWorkspaceMode],
  );
  useEffect(
    () =>
      addKeyboardShortcutListener(
        window,
        () => useSettingsStore.getState().revealActiveFileShortcut,
        handleRevealActiveFile,
      ),
    [handleRevealActiveFile],
  );

  const openWorkspaceFile = useCallback(
    (targetProject: string, node: FsArborNode) => {
      if (shouldAutoOpenTerminalFilePanel(workspaceMode, isCompactWorkspace)) {
        setTerminalFilePanelOpen(true);
        setTerminalFilePanelEditorFocusSignal((current) => current + 1);
      }
      return openFile(targetProject, node);
    },
    [
      isCompactWorkspace,
      openFile,
      setTerminalFilePanelOpen,
      workspaceMode,
    ],
  );

  const handleFileOpen = useCallback(
    (node: FsArborNode) => {
      if (projectName) void openWorkspaceFile(projectName, node);
    },
    [openWorkspaceFile, projectName],
  );

  const handleSearchResultOpen = useCallback(
    (
      match: SearchMatch | PathSearchMatch,
      options?: {
        closeSearch?: boolean;
      },
    ) => {
      const targetProject = match.project ?? projectName;
      if (!targetProject) return;
      if (options?.closeSearch) closeSearch();
      if (match.project && match.project !== projectName) {
        setActiveProject(match.project);
      }
      void openWorkspaceFile(targetProject, buildSearchMatchFileNode(match.path));
    },
    [closeSearch, openWorkspaceFile, projectName, setActiveProject],
  );

  const handleSelectProjectInTree = useCallback(
    (name: string) => {
      setActiveProject(name);
      handleSelectProject(name);
    },
    [handleSelectProject, setActiveProject],
  );

  useEffect(() => {
    if (!selection && projectName) {
      handleSelectProject(projectName);
    }
  }, [handleSelectProject, projectName, selection]);

  const handleOpenCurrentTerminal = useCallback(() => {
    if (projectName) {
      handleLaunchShell(projectName);
    } else {
      handleAddFreeTerminal();
    }
  }, [handleAddFreeTerminal, handleLaunchShell, projectName]);

  useEffect(
    () =>
      subscribeToTerminalNotificationSelection((sessionId) => {
        navigateToTerminalNotification({
          sessionId,
          mountedSessionIds: mountedSessions.map(
            (session) => session.sessionId,
          ),
          alive: sessionMap.get(sessionId)?.alive,
          focusWindow: () => window.focus(),
          revealTerminal: () => {
            setWorkspaceMode("terminal");
            setRequestedCompactSurface("terminal");
          },
          selectSession: handleSelectTab,
          focusTerminal: (selectedSessionId) => {
            const suppressNativeFocus =
              isCompactWorkspace &&
              isCoarsePointer &&
              mobileCustomKeyboardEnabled;
            terminalNotificationActivationRef.current();
            terminalNotificationActivationRef.current =
              activateTerminalAfterNavigation({
                sessionId: selectedSessionId,
                hasTerminal: (candidateSessionId) =>
                  terminalRegistry.has(candidateSessionId),
                activateTerminal: (candidateSessionId) =>
                  scheduleTerminalFit(
                    terminalRegistry.get(candidateSessionId),
                    { focus: !suppressNativeFocus },
                  ),
                subscribeToTerminal: subscribeToRegistry,
              });
          },
        });
      }),
    [
      handleSelectTab,
      isCoarsePointer,
      isCompactWorkspace,
      mobileCustomKeyboardEnabled,
      mountedSessions,
      sessionMap,
      setRequestedCompactSurface,
      setWorkspaceMode,
    ],
  );

  useEffect(
    () => () => terminalNotificationActivationRef.current(),
    [],
  );

  const terminalContent = useMemo(
    () => (
      <div className="flex flex-col h-full">
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
          <div className="flex min-w-0 items-center gap-2">
            <TerminalIcon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
            <span className="truncate text-xs font-semibold text-[var(--color-text)]">
              Terminal
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DiagnosticsTimeWindowSelect
              value={diagnosticsWindowMinutes}
              onChange={setDiagnosticsWindowMinutes}
            />
            <div className="flex rounded-sm border border-[var(--color-border)] bg-[var(--color-background)] p-0.5">
              {TERMINAL_USAGE_OPTIONS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTerminalUsageMode(mode)}
                  className={cn(
                    "rounded-[3px] px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                    terminalUsageMode === mode
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={toggleTerminalFilePanel}
              title={
                terminalFilePanelOpen ? "Hide files panel" : "Show files panel"
              }
              aria-label={
                terminalFilePanelOpen ? "Hide files panel" : "Show files panel"
              }
              className={cn(
                "rounded-sm p-1.5 transition-colors",
                terminalFilePanelOpen
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
              )}
            >
              <Files className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleOpenCurrentTerminal}
              title="Open terminal"
              className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {freeTerminalSavePrompt && projects.length > 0 && (
          <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--color-text)] mb-2">
              Save terminal as profile in project
            </p>
            <div className="flex gap-2 flex-wrap">
              <Select
                value={freeTerminalSavePrompt.projectName}
                onValueChange={(v) =>
                  setFreeTerminalSavePrompt((p) =>
                    p ? { ...p, projectName: v, error: undefined } : p,
                  )
                }
              >
                <SelectTrigger className="flex-1 min-w-32 text-xs h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex-1 min-w-32">
                <input
                  type="text"
                  autoFocus
                  placeholder="Profile name"
                  value={freeTerminalSavePrompt.name}
                  onChange={(e) =>
                    setFreeTerminalSavePrompt((p) =>
                      p ? { ...p, name: e.target.value, error: undefined } : p,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveFreeTerminalToProject();
                    if (e.key === "Escape") setFreeTerminalSavePrompt(null);
                  }}
                  className={
                    inputClass +
                    " w-full" +
                    (freeTerminalSavePrompt.error
                      ? " border-[var(--color-danger)]"
                      : "")
                  }
                />
                {freeTerminalSavePrompt.error && (
                  <p className="text-[10px] text-[var(--color-danger)] mt-0.5">
                    {freeTerminalSavePrompt.error}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={handleSaveFreeTerminalToProject}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFreeTerminalSavePrompt(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {launchForm && (
          <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--color-text)] mb-2">
              New terminal in{" "}
              <span className="text-[var(--color-primary)]">
                {launchForm.projectName}
              </span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                autoFocus
                placeholder="Path (relative to project root)"
                value={launchForm.cwd}
                onChange={(e) =>
                  setLaunchForm((f) => (f ? { ...f, cwd: e.target.value } : f))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLaunchFormSubmit();
                  if (e.key === "Escape") setLaunchForm(null);
                }}
                className={inputClass + " flex-1 min-w-32"}
              />
              <input
                type="text"
                placeholder="Command (blank for bash)"
                value={launchForm.command}
                onChange={(e) =>
                  setLaunchForm((f) =>
                    f ? { ...f, command: e.target.value } : f,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLaunchFormSubmit();
                  if (e.key === "Escape") setLaunchForm(null);
                }}
                className={inputClass + " flex-1 min-w-32"}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={handleLaunchFormSubmit}
              >
                Launch
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLaunchForm(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {mountedSessions.length > 0 && (
            <Suspense fallback={null}>
              <TerminalKeepAliveHost
                mountedSessions={mountedSessions}
                openTabs={tabsWithLiveSession}
                onSessionExit={handleSessionExit}
                onNewTerminal={handleOpenCurrentTerminal}
                suppressAutoFocus
                suppressNativeKeyboard={false}
              />
            </Suspense>
          )}

          {terminalUsageMode === "runtime" ? (
            <Suspense fallback={<PanelFallback label="Loading runtime…" />}>
              <ActiveTerminalRuntimeDisplay
                activeSessionId={activeTab}
                mountedSessions={mountedSessions}
                openTabs={tabsWithLiveSession}
                currentProjectName={projectName}
                layoutRevision={compactTerminalLayoutRevision}
                renderTerminals={false}
                onSessionExit={handleSessionExit}
                onCloseSession={handleCloseTab}
                onNewProjectTerminal={handleLaunchShell}
                onNewFreeTerminal={handleAddFreeTerminal}
                onSelectTab={handleSelectTab}
              />
            </Suspense>
          ) : mountedSessions.length > 0 ? (
            <Suspense fallback={<PanelFallback label="Loading terminals…" />}>
              <MultiTerminalDisplay
                activeSessionId={activeTab}
                mountedSessions={mountedSessions}
                openTabs={tabsWithLiveSession}
                layoutRevision={compactTerminalLayoutRevision}
                renderTerminals={false}
                onSessionExit={handleSessionExit}
                onNewTerminal={handleOpenCurrentTerminal}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
              />
            </Suspense>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--color-text-muted)]">
              <TerminalIcon className="h-12 w-12 opacity-20" />
              <div className="text-center">
                <p className="text-sm mb-1">No projects configured</p>
                <p className="text-xs opacity-60">
                  Open a free terminal to get started
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenCurrentTerminal}
                >
                  Open Terminal
                </Button>
                <kbd className="text-[10px] text-[var(--color-text-muted)]/50 font-mono">
                  Ctrl+`
                </kbd>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-muted)]">
              <TerminalIcon className="h-10 w-10 opacity-20" />
              <div className="text-center">
                <p className="text-sm">
                  {workspaceMode === "terminal"
                    ? "Terminal workspace"
                    : "Select a project or terminal from the tree"}
                </p>
                {workspaceMode === "terminal" && (
                  <p className="mt-1 text-xs opacity-60">
                    Open a terminal from Fleet Terminal or launch one here
                  </p>
                )}
              </div>
              {projectName && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleOpenCurrentTerminal}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Open Terminal
                  </Button>
                  <kbd className="text-[10px] text-[var(--color-text-muted)]/50 font-mono">
                    Ctrl+`
                  </kbd>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    ),
    [
      freeTerminalSavePrompt,
      projects,
      handleSaveFreeTerminalToProject,
      launchForm,
      handleLaunchFormSubmit,
      terminalUsageMode,
      setTerminalUsageMode,
      handleOpenCurrentTerminal,
      tabsWithLiveSession,
      activeTab,
      compactTerminalLayoutRevision,
      handleSelectTab,
      handleCloseTab,
      setFreeTerminalSavePrompt,
      setLaunchForm,
      mountedSessions,
      handleSessionExit,
      handleAddFreeTerminal,
      projectName,
      handleLaunchShell,
      terminalFilePanelOpen,
      toggleTerminalFilePanel,
      workspaceMode,
      diagnosticsWindowMinutes,
    ],
  );

  const fleetContent = useMemo(
    () =>
      isLoading ? (
        <div className="flex items-center justify-center flex-1 h-full">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
        </div>
      ) : (
        <Suspense fallback={<PanelFallback label="Loading terminal tree…" />}>
          <TerminalTreeView
            projects={tree}
            freeTerminals={freeTerminals}
            activeProjectName={projectName ?? undefined}
            selectedId={selectedId}
            onSelectProject={handleSelectProjectInTree}
            onSelectTerminal={handleSelectTerminal}
            onLaunchTerminal={handleLaunchTerminal}
            onKillTerminal={handleKillTerminal}
            onAddShell={handleLaunchShell}
            onLaunchProfile={handleLaunchProfile}
            onDeleteProfile={handleDeleteProfile}
            onLaunchSuggestedCommand={handleLaunchSuggestedCommand}
            onAddFreeTerminal={handleAddFreeTerminal}
            onLaunchFreeWithCommand={handleLaunchFreeWithCommand}
            onSelectFreeTerminal={handleSelectTerminal}
            onKillFreeTerminal={handleKillTerminal}
            onRemoveFreeTerminal={handleRemoveFreeTerminal}
            onSaveFreeTerminal={handleOpenFreeTerminalSavePrompt}
            onUpdateProfile={handleUpdateProfile}
            onUpdateCustomCommand={handleUpdateCustomCommand}
          />
        </Suspense>
      ),
    [
      isLoading,
      tree,
      freeTerminals,
      projectName,
      selectedId,
      handleSelectProjectInTree,
      handleSelectTerminal,
      handleLaunchTerminal,
      handleKillTerminal,
      handleLaunchShell,
      handleLaunchProfile,
      handleDeleteProfile,
      handleLaunchSuggestedCommand,
      handleAddFreeTerminal,
      handleLaunchFreeWithCommand,
      handleOpenFreeTerminalSavePrompt,
      handleUpdateProfile,
      handleUpdateCustomCommand,
      handleRemoveFreeTerminal,
    ],
  );

  const portsContent = useMemo(
    () => (
      <Suspense fallback={<PanelFallback label="Loading ports…" />}>
        <PortsPanel />
      </Suspense>
    ),
    [],
  );

  const leftTools = useMemo<ToolWindowDef[]>(
    () => [
      {
        id: "search",
        label: "Search",
        icon: Search,
        content: projectName ? (
          <Suspense fallback={<PanelFallback label="Loading search…" />}>
            <SearchPanel project={projectName} onResultClick={handleSearchResultOpen} />
          </Suspense>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
            Select a project to search
          </div>
        ),
      },
      {
        id: "explorer",
        label: "Explorer",
        icon: Files,
        defaultActive: true,
        content: (
          <div className="flex flex-col h-full">
            {projectName ? (
              <Suspense fallback={<PanelFallback label="Loading files…" />}>
                <FileTree
                  key={projectName}
                  project={projectName}
                  path=""
                  onFileOpen={handleFileOpen}
                  onOpenTerminal={() => handleLaunchShell(projectName)}
                  className="flex-1"
                  revealRequest={
                    fileTreeRevealRequest?.project === projectName
                      ? fileTreeRevealRequest
                      : null
                  }
                />
              </Suspense>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
                No projects configured
              </div>
            )}
          </div>
        ),
      },
      {
        id: "source-control",
        label: "Commit",
        icon: GitCommit,
        content: projectName ? (
          <div className="flex h-full min-h-0 flex-col">
            <Suspense fallback={<PanelFallback label="Loading changes…" />}>
              <ChangedFilesList
                project={projectName}
                selectedFile={null}
                onSelectFile={(path) => {
                  if (projectName)
                    openDiff(projectName, path, "modified", 0, 0);
                }}
              />
            </Suspense>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
            Select a project to view changes
          </div>
        ),
      },
      {
        id: "terminal",
        label: "Terminal",
        icon: TerminalIcon,
        position: "bottom",
        content: terminalContent,
      },
      {
        id: "git",
        label: "Git",
        icon: GitMerge,
        position: "bottom",
        content: projectName ? (
          <Suspense fallback={<PanelFallback label="Loading Git…" />}>
            <WorkspaceGitPanel key={projectName} project={projectName} />
          </Suspense>
        ) : (
          <div className="p-4 text-xs text-[var(--color-text-muted)] italic text-center">
            Select a project to see Git status
          </div>
        ),
      },
      {
        id: "ports",
        label: "Ports",
        icon: Radio,
        position: "bottom",
        content: portsContent,
      },
    ],
    [
      projectName,
      handleFileOpen,
      handleLaunchShell,
      openDiff,
      handleSearchResultOpen,
      fileTreeRevealRequest,
      terminalContent,
      portsContent,
    ],
  );

  const rightTools = useMemo<ToolWindowDef[]>(
    () => [
      {
        id: "project-info",
        label: "Project",
        icon: Folder,
        defaultActive: true,
        content: projectName ? (
          <div
            data-testid="workspace-project-info-panel"
            className="flex h-full min-h-0 flex-col"
          >
            <Suspense fallback={<PanelFallback label="Loading project…" />}>
              <ProjectInfoPanel
                projectName={projectName}
                onLaunchCommand={(cmd) =>
                  handleLaunchTerminal(projectName, cmd)
                }
              />
            </Suspense>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
            Select a project to inspect
          </div>
        ),
      },
      {
        id: "terminals",
        label: "Fleet Terminal",
        icon: LayoutGrid,
        content: fleetContent,
      },
    ],
    [fleetContent, handleLaunchTerminal, projectName],
  );

  const handleTerminalWorkspaceFleetLayoutChange = useCallback(() => {
    setTerminalLayoutRevision((current) => current + 1);
  }, []);

  const compactGitSurface = useMemo<MobileWorkspaceSurface>(
    () => ({
      id: "git",
      label: "Git",
      icon: GitMerge,
      content: projectName ? (
        <Suspense fallback={<PanelFallback label="Loading Git…" />}>
          <WorkspaceGitPanel key={projectName} project={projectName} />
        </Suspense>
      ) : (
        renderCompactPlaceholder("Select a project to see Git status")
      ),
    }),
    [projectName],
  );

  const compactProjectSurface = useMemo<MobileWorkspaceSurface>(
    () => ({
      id: "project",
      label: "Project",
      icon: Folder,
      content: projectName ? (
        <Suspense fallback={<PanelFallback label="Loading project…" />}>
          <ProjectInfoPanel
            projectName={projectName}
            onLaunchCommand={(cmd) => handleLaunchTerminal(projectName, cmd)}
          />
        </Suspense>
      ) : (
        renderCompactPlaceholder("Select a project to inspect")
      ),
    }),
    [handleLaunchTerminal, projectName],
  );

  const compactIdeSurfaces = useMemo<MobileWorkspaceSurface[]>(
    () => [
      {
        id: "explorer",
        label: "Explorer",
        icon: Files,
        content: (
          <div className="flex min-h-0 flex-1 flex-col">
            {projectName ? (
              <Suspense fallback={<PanelFallback label="Loading files…" />}>
                <FileTree
                  key={projectName}
                  project={projectName}
                  path=""
                  onFileOpen={handleFileOpen}
                  onOpenTerminal={() => handleLaunchShell(projectName)}
                  className="flex-1"
                  revealRequest={
                    fileTreeRevealRequest?.project === projectName
                      ? fileTreeRevealRequest
                      : null
                  }
                />
              </Suspense>
            ) : (
              renderCompactPlaceholder("No projects configured")
            )}
          </div>
        ),
      },
      {
        id: "search",
        label: "Search",
        icon: Search,
        content: projectName ? (
          <Suspense fallback={<PanelFallback label="Loading search…" />}>
            <SearchPanel
              project={projectName}
              closeOnResultClick
              onResultClick={handleSearchResultOpen}
            />
          </Suspense>
        ) : (
          renderCompactPlaceholder("Select a project to search")
        ),
      },
      {
        id: "editor",
        label: "Editor",
        icon: LayoutGrid,
        content: (
          <Suspense fallback={<PanelFallback label="Loading editor…" />}>
            <EditorTabs project={projectName} />
          </Suspense>
        ),
      },
      compactGitSurface,
      compactProjectSurface,
    ],
    [
      compactGitSurface,
      compactProjectSurface,
      handleFileOpen,
      handleLaunchShell,
      handleSearchResultOpen,
      fileTreeRevealRequest,
      projectName,
    ],
  );

  const compactTerminalSurfaces = useMemo<MobileWorkspaceSurface[]>(
    () => [
      {
        id: "terminal",
        label: "Terminal",
        icon: TerminalIcon,
        content: terminalContent,
      },
      {
        id: "fleet",
        label: "Fleet",
        icon: LayoutGrid,
        content: fleetContent,
      },
      {
        id: "ports",
        label: "Ports",
        icon: Radio,
        content: portsContent,
      },
      compactGitSurface,
      compactProjectSurface,
    ],
    [
      compactGitSurface,
      compactProjectSurface,
      fleetContent,
      portsContent,
      terminalContent,
    ],
  );

  const compactSurfaces =
    workspaceMode === "terminal" ? compactTerminalSurfaces : compactIdeSurfaces;

  const handleCompactSurfaceChange = useCallback(
    (surfaceId: string) => {
      setRequestedCompactSurface(surfaceId);
    },
    [setRequestedCompactSurface],
  );

  const terminalFilePanelContent = useMemo(
    () => (
      <TerminalFloatingFilePanel
        open={terminalFilePanelOpen}
        treeWidth={terminalFileTreeWidth}
        isDragging={isTerminalFileTreeResizing}
        focusEditorSignal={terminalFilePanelEditorFocusSignal}
        treeResizeHandleProps={terminalFileTreeResizeHandleProps}
        explorerContent={
          projectName ? (
            <Suspense fallback={<PanelFallback label="Loading files…" />}>
              <FileTree
                key={`terminal-panel-${projectName}`}
                project={projectName}
                path=""
                onFileOpen={handleFileOpen}
                onOpenTerminal={() => handleLaunchShell(projectName)}
                className="flex-1"
                revealRequest={
                  fileTreeRevealRequest?.project === projectName
                    ? fileTreeRevealRequest
                    : null
                }
              />
            </Suspense>
          ) : (
            renderCompactPlaceholder("No projects configured")
          )
        }
        editorContent={
          <Suspense fallback={<PanelFallback label="Loading editor…" />}>
            <EditorTabs project={projectName} />
          </Suspense>
        }
        onClose={() => setTerminalFilePanelOpen(false)}
      />
    ),
    [
      handleFileOpen,
      handleLaunchShell,
      isTerminalFileTreeResizing,
      projectName,
      setTerminalFilePanelOpen,
      fileTreeRevealRequest,
      terminalFilePanelEditorFocusSignal,
      terminalFilePanelOpen,
      terminalFileTreeResizeHandleProps,
      terminalFileTreeWidth,
    ],
  );

  return (
    <>
      {isCompactWorkspace ? (
        <MobileWorkspaceShell
          surfaces={compactSurfaces}
          activeSurfaceId={activeCompactSurface}
          onSurfaceChange={handleCompactSurfaceChange}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          workspaceModeShortcutLabel={terminalWorkspaceShortcut}
        />
      ) : workspaceMode === "terminal" ? (
        <TerminalWorkspaceShell
          terminalContent={terminalContent}
          terminalOverlayContent={terminalFilePanelContent}
          fleetContent={fleetContent}
          portsContent={portsContent}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          workspaceModeShortcutLabel={terminalWorkspaceShortcut}
          onFleetLayoutChange={handleTerminalWorkspaceFleetLayoutChange}
        />
      ) : (
        <IdeShell
          leftTools={leftTools}
          rightTools={rightTools}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          workspaceModeShortcutLabel={terminalWorkspaceShortcut}
          activateLeftTopToolRequest={ideLeftTopToolRequest}
          editor={
            <Suspense fallback={<PanelFallback label="Loading editor…" />}>
              <EditorTabs project={projectName} />
            </Suspense>
          }
        />
      )}

      {terminalDiagnosticsMenuTarget && (
        <TerminalDiagnosticsContextMenu
          x={terminalDiagnosticsMenuTarget.x}
          y={terminalDiagnosticsMenuTarget.y}
          isPending={exportDiagnostics.isPending}
          error={terminalDiagnosticsError}
          onExport={() => void handleExportTerminalDiagnostics()}
          onClose={closeTerminalDiagnosticsMenu}
        />
      )}

      {/* Floating search dialog */}
      {searchOpen && projectName && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[max(8vh,var(--safe-area-top))] sm:px-4"
          onClick={closeSearch}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Dialog */}
          <div
            className="dialog-viewport-fit relative z-10 flex h-[min(70vh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Suspense fallback={<PanelFallback label="Loading search…" />}>
              <SearchPanel
                project={projectName}
                closeOnResultClick
                inputRef={searchInputRef}
                onClose={closeSearch}
                onResultClick={handleSearchResultOpen}
              />
            </Suspense>
          </div>
        </div>
      )}
    </>
  );
}
