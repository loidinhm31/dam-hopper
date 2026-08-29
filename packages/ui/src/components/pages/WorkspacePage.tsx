import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useState,
  useSyncExternalStore,
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
  Globe2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IdeShell } from "@/components/templates/IdeShell.js";
import { MobileWorkspaceShell } from "@/components/templates/MobileWorkspaceShell.js";
import { TerminalWorkspaceShell } from "@/components/templates/TerminalWorkspaceShell.js";
import { TerminalFloatingFilePanel } from "@/components/organisms/TerminalFloatingFilePanel.js";
import {
  BrowserDebugKeepAliveHost,
  type BrowserDebugKeepAliveHandle,
} from "@/components/organisms/BrowserDebugKeepAliveHost.js";
import { BrowserDebugPanel } from "@/components/organisms/BrowserDebugPanel.js";
import type { ChangedFileSelection } from "@/components/organisms/ChangedFilesList.js";
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
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { useAppZoom } from "@/contexts/AppZoomContext.js";
import { useTerminalManager } from "@/hooks/use-terminal-manager.js";
import { useBrowserDebug } from "@/hooks/use-browser-debug.js";
import { useBrowserDebugHost } from "@/contexts/BrowserDebugHostContext.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useExportDiagnostics } from "@/api/queries.js";
import {
  addKeyboardShortcutListener,
  useDocumentKeyboardShortcut,
} from "@/hooks/use-shortcuts.js";
import { api, type ProjectTargetInput } from "@/api/client.js";
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
import { shouldRenderEmptyTerminalBrowserSurface } from "@/lib/terminal-browser-surface.js";
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
import type { TunnelInfo } from "@/api/client.js";
import type {
  FsArborNode,
  PathSearchMatch,
  SearchMatch,
} from "@/api/fs-types.js";
import type { ToolWindowDef } from "@/types/ide.js";
import type { MobileWorkspaceSurface } from "@/components/templates/MobileWorkspaceShell.js";
import type { ActivateToolRequest } from "@/lib/reveal-active-file.js";
import type { TerminalPanelToolId } from "@/lib/ide-shell-layout.js";
import type {
  TerminalWorkspacePanelControls,
  TerminalWorkspacePanelRequest,
} from "@/lib/terminal-workspace-panel.js";
import type { FileTreeRevealRequest } from "@/lib/file-tree-reveal.js";
import { resolveRevealActiveFileOutcome } from "@/lib/reveal-active-file.js";
import { resolveSearchMatchTarget } from "@/lib/search-replace-next.js";
import { scheduleTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import {
  BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT,
  enterBrowserDebugViewportCustomMode,
  loadBrowserDebugViewport,
  saveBrowserDebugViewport,
  setBrowserDebugViewportMode,
  stepBrowserDebugViewport,
  updateBrowserDebugViewportSize,
  type BrowserDebugViewportState,
} from "@/lib/browser-debug-viewport.js";
import { getBrowserDebugViewportGeometry } from "@/lib/browser-debug-keep-alive.js";
import {
  subscribeToRegistry,
  subscribeToRegistryChanges,
  terminalRegistry,
  getTerminalRegistrySnapshot,
} from "@/lib/terminal-registry.js";
import {
  isBrowserTerminalTargetReady,
  prepareBrowserTerminalArtifact as createPreparedBrowserTerminalArtifact,
  type BrowserTerminalTarget,
  type PreparedBrowserTerminalArtifact,
} from "@/lib/browser-terminal-handoff.js";
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

type OpenDiff = (
  target: ProjectTargetInput,
  path: string,
  fileStatus: string,
  additions: number,
  deletions: number,
  commitHash?: string,
  gitRootId?: string,
  diffPath?: string,
) => void;

export function openChangedFileDiff(
  target: ProjectTargetInput,
  selection: ChangedFileSelection,
  openDiff: OpenDiff,
) {
  openDiff(
    target,
    selection.projectPath,
    selection.status,
    selection.additions,
    selection.deletions,
    undefined,
    selection.gitRootId,
    selection.diffPath,
  );
}

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
  "terminal",
  "browser",
  "git",
  "project",
] as const;
const TERMINAL_COMPACT_SURFACE_IDS = [
  "terminal",
  "fleet",
  "ports",
  "browser",
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

function sessionIdSetsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

export interface OpenTunnelInBrowserRevealOutcome {
  compactSurfaceId?: "browser";
  openBrowser: boolean;
  activateTerminalBrowserSplit: boolean;
}

export function resolveOpenTunnelInBrowserReveal(
  workspaceMode: WorkspaceMode,
  isCompactWorkspace: boolean,
): OpenTunnelInBrowserRevealOutcome {
  if (isCompactWorkspace) {
    return {
      compactSurfaceId: "browser",
      openBrowser: false,
      activateTerminalBrowserSplit: false,
    };
  }

  return {
    openBrowser: true,
    activateTerminalBrowserSplit: workspaceMode === "ide",
  };
}

export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProject, setActiveProject } = useWorkspaceStore();
  const [workspaceMode, setWorkspaceModeState] =
    useState<WorkspaceMode>(loadWorkspaceMode);
  const [terminalUsageMode, setTerminalUsageModeState] =
    useState<TerminalUsageMode>(loadTerminalUsageMode);
  const [visibleSplitSessionIds, setVisibleSplitSessionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
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
  const [ideBottomToolRequest, setIdeBottomToolRequest] =
    useState<ActivateToolRequest | null>(null);
  const [ideRightTopToolRequest, setIdeRightTopToolRequest] =
    useState<ActivateToolRequest | null>(null);
  const [terminalWorkspacePanelRequest, setTerminalWorkspacePanelRequest] =
    useState<TerminalWorkspacePanelRequest | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const browserDebug = useBrowserDebug();
  const browserDebugHost = useBrowserDebugHost();
  const { level: appZoomLevel } = useAppZoom();
  const navigateBrowserTo = browserDebug.navigateTo;
  const registeredTerminalIds = useSyncExternalStore(
    subscribeToRegistryChanges,
    getTerminalRegistrySnapshot,
    getTerminalRegistrySnapshot,
  );
  const browserViewportRef = useRef<HTMLDivElement>(null);
  const browserViewportStageRef = useRef<HTMLDivElement>(null);
  const browserKeepAliveRef = useRef<BrowserDebugKeepAliveHandle>(null);
  const browserViewportPlatform =
    browserDebugHost.environment.platform ??
    (typeof document === "undefined"
      ? undefined
      : document.documentElement.dataset.appPlatform) ??
    (browserDebugHost.environment.kind === "web" ? "web" : undefined);
  const [browserViewportState, setBrowserViewportState] = useState(() =>
    loadBrowserDebugViewport(browserViewportPlatform),
  );
  const [browserViewportReadyVersion, setBrowserViewportReadyVersion] =
    useState(0);
  const browserViewportVersion =
    browserViewportReadyVersion +
    appZoomLevel * 1_000_000 +
    (browserViewportState.mode === "custom"
      ? browserViewportState.customSize.width *
          (BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT + 1) +
        browserViewportState.customSize.height
      : 0);
  const [
    terminalFilePanelEditorFocusSignal,
    setTerminalFilePanelEditorFocusSignal,
  ] = useState(0);
  const [terminalLayoutRevision, setTerminalLayoutRevision] = useState(0);
  const revealRequestNonceRef = useRef(0);
  const panelShortcutNonceRef = useRef(0);
  const terminalNotificationRevealNonceRef = useRef(0);
  const terminalNotificationActivationRef = useRef<() => void>(() => {});
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );
  const terminalAutoSwitchProjectEnabled = useSettingsStore(
    (state) => state.terminalAutoSwitchProjectEnabled,
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
  const isBrowserViewportVisible =
    !isCompactWorkspace || activeCompactSurface === "browser";
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
    { terminalAutoSwitchProjectEnabled, setActiveProject },
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
    handleToggleTabPin,
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

  const browserTerminalTargets = useMemo<BrowserTerminalTarget[]>(() => {
    const mountedById = new Map(
      mountedSessions.map((session) => [session.sessionId, session]),
    );
    const tabsById = new Map(
      tabsWithLiveSession.map((tab) => [tab.sessionId, tab]),
    );
    const sessionIds = new Set([...mountedById.keys(), ...tabsById.keys()]);
    return [...sessionIds].map((sessionId) => {
      const mounted = mountedById.get(sessionId);
      const tab = tabsById.get(sessionId);
      return {
        sessionId,
        label:
          tab?.title.fullText ??
          (mounted ? `${mounted.project} · ${mounted.command}` : "Terminal"),
        ...(tab?.title ? { openTitle: tab.title } : {}),
        mounted: Boolean(mounted),
        registered: registeredTerminalIds.has(sessionId),
        alive: sessionMap.get(sessionId)?.alive,
        current: activeTab === sessionId,
      };
    });
  }, [
    activeTab,
    mountedSessions,
    registeredTerminalIds,
    sessionMap,
    tabsWithLiveSession,
  ]);

  const activeBrowserTerminalTarget = useMemo(
    () =>
      browserTerminalTargets.find(
        (candidate) => candidate.sessionId === activeTab,
      ),
    [activeTab, browserTerminalTargets],
  );

  const prepareBrowserTerminalArtifact = useCallback(
    async (sessionId: string) => {
      const target = browserTerminalTargets.find(
        (candidate) => candidate.sessionId === sessionId,
      );
      if (!browserDebug.selection || !isBrowserTerminalTargetReady(target)) {
        throw new Error("terminal unavailable");
      }

      let artifact = await api.browserDebug.createArtifact(
        sessionId,
        browserDebug.selection,
      );
      try {
        if (browserDebug.captureImage) {
          artifact = await api.browserDebug.uploadPng(
            artifact.artifactId,
            browserDebug.captureImage,
          );
        }
        browserDebug.stopCapture();
        return createPreparedBrowserTerminalArtifact(artifact);
      } catch (error) {
        await api.browserDebug
          .deleteArtifact(artifact.artifactId)
          .catch(() => {});
        throw error;
      }
    },
    [browserDebug, browserTerminalTargets],
  );

  const discardBrowserTerminalArtifact = useCallback(
    async (artifactId: string) => {
      await api.browserDebug.deleteArtifact(artifactId).catch(() => {});
    },
    [],
  );

  const insertBrowserTerminalReference = useCallback(
    async (
      target: BrowserTerminalTarget,
      artifact: PreparedBrowserTerminalArtifact,
    ) => {
      const currentTarget = browserTerminalTargets.find(
        (candidate) => candidate.sessionId === target.sessionId,
      );
      if (
        !isBrowserTerminalTargetReady(currentTarget) ||
        artifact.artifact.terminalId !== target.sessionId
      ) {
        throw new Error("terminal unavailable");
      }
      const result = await api.browserDebug.handoff(
        artifact.artifact.artifactId,
      );
      if (!result.inserted)
        throw new Error("terminal insertion was not confirmed");
    },
    [browserTerminalTargets],
  );

  const handleVisibleSplitSessionsChange = useCallback(
    (sessionIds: ReadonlySet<string>) => {
      setVisibleSplitSessionIds((current) =>
        sessionIdSetsEqual(current, sessionIds) ? current : new Set(sessionIds),
      );
    },
    [],
  );
  const webglEnabledSessionIds = useMemo(
    () =>
      terminalUsageMode === "runtime"
        ? new Set(activeTab ? [activeTab] : [])
        : visibleSplitSessionIds,
    [activeTab, terminalUsageMode, visibleSplitSessionIds],
  );

  const projectName =
    activeProject ?? (projects.length > 0 ? projects[0].name : null);
  const projectTarget = useProjectTarget(projectName);

  const closeTerminalDiagnosticsMenu = useCallback(() => {
    setTerminalDiagnosticsMenuTarget(null);
    setTerminalDiagnosticsError(null);
  }, []);

  const terminalDiagnosticsTargetSession = terminalDiagnosticsMenuTarget
    ? sessionMap.get(terminalDiagnosticsMenuTarget.sessionId)
    : undefined;
  const isTerminalDiagnosticsMenuTargetAvailable =
    terminalDiagnosticsMenuTarget !== null &&
    (terminalDiagnosticsTargetSession
      ? terminalDiagnosticsTargetSession.alive
      : mountedSessions.some(
          (session) =>
            session.sessionId === terminalDiagnosticsMenuTarget.sessionId,
        ));

  const openTerminalDiagnosticsMenu = useCallback(
    (sessionId: string, x: number, y: number) => {
      setTerminalDiagnosticsError(null);
      setTerminalDiagnosticsMenuTarget({ sessionId, x, y });
    },
    [],
  );

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
  const projectPanelShortcut = useSettingsStore((s) => s.projectPanelShortcut);
  const gitPanelShortcut = useSettingsStore((s) => s.gitPanelShortcut);
  const portsPanelShortcut = useSettingsStore((s) => s.portsPanelShortcut);
  const fleetTerminalShortcut = useSettingsStore(
    (s) => s.fleetTerminalShortcut,
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

  const notifyBrowserViewportChanged = useCallback(() => {
    setBrowserViewportReadyVersion((version) => version + 1);
  }, []);

  const setBrowserViewportMode = useCallback(
    (mode: BrowserDebugViewportState["mode"]) => {
      setBrowserViewportState((current) =>
        mode === "custom"
          ? enterBrowserDebugViewportCustomMode(
              current,
              getBrowserDebugViewportGeometry(browserViewportRef.current)
                ?.frame ?? null,
            )
          : setBrowserDebugViewportMode(current, mode),
      );
    },
    [],
  );

  const setBrowserViewportSize = useCallback(
    (size: { width: number; height: number }) => {
      setBrowserViewportState((current) =>
        updateBrowserDebugViewportSize(current, size),
      );
    },
    [],
  );

  const stepBrowserViewport = useCallback(
    (direction: "increase" | "decrease") => {
      setBrowserViewportState((current) =>
        stepBrowserDebugViewport(current, direction),
      );
    },
    [],
  );

  useEffect(() => {
    saveBrowserDebugViewport(browserViewportState, browserViewportPlatform);
  }, [browserViewportPlatform, browserViewportState]);

  const toggleEmbeddedBrowser = useCallback(() => {
    setBrowserOpen((current) => !current);
  }, []);

  const closeEmbeddedBrowser = useCallback(() => {
    setBrowserOpen(false);
  }, []);

  const activateTerminalPanelShortcut = useCallback(
    (targetId: TerminalPanelToolId) => {
      if (isCompactWorkspace) return;
      const nonce = ++panelShortcutNonceRef.current;
      if (workspaceMode === "terminal") {
        setTerminalWorkspacePanelRequest({ nonce, targetId });
        return;
      }
      const request: ActivateToolRequest = {
        nonce,
        toolId: targetId === "project" ? "project-info" : targetId,
        exclusiveTarget: targetId,
      };
      if (targetId === "terminals" || targetId === "project") {
        setIdeRightTopToolRequest(request);
      } else {
        setIdeBottomToolRequest(request);
      }
    },
    [isCompactWorkspace, workspaceMode],
  );

  const focusEmbeddedBrowserAddress = useCallback(() => {
    queueMicrotask(() => document.getElementById("browser-debug-url")?.focus());
  }, []);

  const handleOpenTunnelInBrowser = useCallback(
    (url: string, tunnel: TunnelInfo) => {
      if (!navigateBrowserTo(url, [tunnel])) return;

      const reveal = resolveOpenTunnelInBrowserReveal(
        workspaceMode,
        isCompactWorkspace,
      );

      if (reveal.compactSurfaceId) {
        setRequestedCompactSurface(reveal.compactSurfaceId);
      }
      if (reveal.openBrowser) {
        setBrowserOpen(true);
      }
      if (reveal.activateTerminalBrowserSplit) {
        panelShortcutNonceRef.current += 1;
        setIdeBottomToolRequest({
          nonce: panelShortcutNonceRef.current,
          toolId: "terminal",
        });
      }
      focusEmbeddedBrowserAddress();
    },
    [
      focusEmbeddedBrowserAddress,
      isCompactWorkspace,
      navigateBrowserTo,
      setRequestedCompactSurface,
      workspaceMode,
    ],
  );

  useDocumentKeyboardShortcut(searchTextShortcut, () => openSearch("content"));
  useDocumentKeyboardShortcut(searchFilenameShortcut, () =>
    openSearch("filename"),
  );
  useDocumentKeyboardShortcut(terminalFilePanelShortcut, () => {
    if (workspaceMode !== "terminal" || isCompactWorkspace) return;
    toggleTerminalFilePanel();
  });
  useEffect(
    () =>
      addKeyboardShortcutListener(
        window,
        () => projectPanelShortcut,
        () => activateTerminalPanelShortcut("project"),
      ),
    [activateTerminalPanelShortcut, projectPanelShortcut],
  );
  useEffect(
    () =>
      addKeyboardShortcutListener(
        window,
        () => gitPanelShortcut,
        () => activateTerminalPanelShortcut("git"),
      ),
    [activateTerminalPanelShortcut, gitPanelShortcut],
  );
  useEffect(
    () =>
      addKeyboardShortcutListener(
        window,
        () => portsPanelShortcut,
        () => activateTerminalPanelShortcut("ports"),
      ),
    [activateTerminalPanelShortcut, portsPanelShortcut],
  );
  useEffect(
    () =>
      addKeyboardShortcutListener(
        window,
        () => fleetTerminalShortcut,
        () => activateTerminalPanelShortcut("terminals"),
      ),
    [activateTerminalPanelShortcut, fleetTerminalShortcut],
  );

  const handleRevealActiveFile = useCallback(() => {
    const activePath =
      projectName === null
        ? null
        : (useEditorStore
            .getState()
            .getActiveTab(projectTarget?.target ?? projectName)?.path ?? null);
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
    projectTarget,
    setRequestedCompactSurface,
    setTerminalFilePanelOpen,
    workspaceMode,
  ]);

  const setWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      setWorkspaceModeState(mode);
      setIdeLeftTopToolRequest(null);
      setIdeBottomToolRequest(null);
      setIdeRightTopToolRequest(null);
      setTerminalWorkspacePanelRequest(null);
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
      setIdeLeftTopToolRequest(null);
      setIdeBottomToolRequest(null);
      setIdeRightTopToolRequest(null);
      setTerminalWorkspacePanelRequest(null);
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
    (
      targetProject: string,
      node: FsArborNode,
      targetOverride?: ProjectTargetInput,
    ) => {
      if (shouldAutoOpenTerminalFilePanel(workspaceMode, isCompactWorkspace)) {
        setTerminalFilePanelOpen(true);
        setTerminalFilePanelEditorFocusSignal((current) => current + 1);
      }
      const requestTarget =
        targetOverride ??
        (targetProject === projectName
          ? (projectTarget?.target ?? targetProject)
          : targetProject);
      return openFile(requestTarget, node);
    },
    [
      isCompactWorkspace,
      openFile,
      projectName,
      projectTarget,
      setTerminalFilePanelOpen,
      workspaceMode,
    ],
  );

  const handleFileOpen = useCallback(
    (node: FsArborNode) => {
      if (projectName)
        void openWorkspaceFile(projectName, node, projectTarget?.target);
    },
    [openWorkspaceFile, projectName, projectTarget],
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
      const matchTarget = match.project
        ? resolveSearchMatchTarget(
            projectTarget?.target ?? targetProject,
            targetProject,
            "workspace",
          )
        : targetProject === projectName
          ? projectTarget?.target
          : targetProject;
      void openWorkspaceFile(
        targetProject,
        buildSearchMatchFileNode(match.path),
        matchTarget,
      );
    },
    [
      closeSearch,
      openWorkspaceFile,
      projectName,
      projectTarget,
      setActiveProject,
    ],
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
          registered: terminalRegistry.has(sessionId),
          focusWindow: () => window.focus(),
          revealTerminal: () => {
            if (isCompactWorkspace) {
              setRequestedCompactSurface("terminal");
              return;
            }

            if (workspaceMode === "ide") {
              terminalNotificationRevealNonceRef.current += 1;
              setIdeBottomToolRequest({
                nonce: terminalNotificationRevealNonceRef.current,
                toolId: "terminal",
              });
            }
          },
          selectSession: handleSelectTab,
          focusTerminal: (selectedSessionId) => {
            const suppressNativeFocus =
              isAndroidChromeNativeInputSuppressed ||
              (isCompactWorkspace &&
                isCoarsePointer &&
                mobileCustomKeyboardEnabled);
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
      isAndroidChromeNativeInputSuppressed,
      isCompactWorkspace,
      mobileCustomKeyboardEnabled,
      mountedSessions,
      sessionMap,
      setRequestedCompactSurface,
      workspaceMode,
    ],
  );

  useEffect(() => () => terminalNotificationActivationRef.current(), []);

  const renderBrowserContent = useCallback(
    (onClose?: () => void, handoffMode: "active" | "select" = "select") => (
      <BrowserDebugPanel
        url={browserDebug.inputUrl}
        bridgeStatus={browserDebug.bridgeStatus}
        extensionPresence={browserDebug.extensionPresence}
        hostEnvironment={browserDebugHost.environment}
        captureAvailable={
          browserDebugHost.environment.kind === "web" ||
          browserDebug.bridgeCapabilities.includes("capture")
        }
        onReloadPage={() => window.location.reload()}
        viewportRef={browserViewportRef}
        viewportStageRef={browserViewportStageRef}
        onViewportReady={notifyBrowserViewportChanged}
        viewportState={browserViewportState}
        onViewportModeChange={setBrowserViewportMode}
        onViewportSizeChange={setBrowserViewportSize}
        onViewportStep={stepBrowserViewport}
        selection={browserDebug.selection}
        error={browserDebug.error}
        loading={browserDebug.bridgeStatus === "loading"}
        addressHistory={browserDebug.addressHistory}
        onUrlChange={browserDebug.setInputUrl}
        onNavigate={browserDebug.navigate}
        onBack={() => browserKeepAliveRef.current?.goBack()}
        onForward={() => browserKeepAliveRef.current?.goForward()}
        onReload={() => browserKeepAliveRef.current?.reload()}
        navigationAvailable={browserDebug.bridgeCapabilities.includes(
          "navigation",
        )}
        consoleEntries={browserDebug.consoleEntries}
        consoleAvailable={browserDebug.bridgeCapabilities.includes("console")}
        onClearConsole={browserDebug.clearConsole}
        onStartPicker={() => browserKeepAliveRef.current?.startPicker()}
        onStopPicker={() => browserKeepAliveRef.current?.stopPicker()}
        pickerActive={browserDebug.pickerActive}
        captureStatus={browserDebug.captureStatus}
        captureMessage={browserDebug.captureMessage}
        manualImageName={browserDebug.manualImageName}
        onStartCapture={() => {
          const frame = getBrowserDebugViewportGeometry(
            browserViewportRef.current,
            browserViewportStageRef.current,
          )?.frame;
          void browserDebug.startCapture(
            frame
              ? {
                  left: frame.left,
                  top: frame.top,
                  width: frame.width,
                  height: frame.height,
                }
              : null,
          );
        }}
        onManualImage={browserDebug.setManualImage}
        onStopCapture={browserDebug.stopCapture}
        terminalHandoff={{
          mode: handoffMode,
          target:
            handoffMode === "active" ? activeBrowserTerminalTarget : undefined,
          targets: browserTerminalTargets,
          onPrepare: prepareBrowserTerminalArtifact,
          onDiscard: discardBrowserTerminalArtifact,
          onInsert: insertBrowserTerminalReference,
        }}
        onClose={onClose}
      />
    ),
    [
      activeBrowserTerminalTarget,
      browserDebug,
      browserDebugHost.environment,
      browserViewportState,
      browserTerminalTargets,
      discardBrowserTerminalArtifact,
      insertBrowserTerminalReference,
      notifyBrowserViewportChanged,
      prepareBrowserTerminalArtifact,
      setBrowserViewportMode,
      setBrowserViewportSize,
      stepBrowserViewport,
    ],
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
            {!isCompactWorkspace && (
              <button
                type="button"
                onClick={toggleEmbeddedBrowser}
                aria-pressed={browserOpen}
                className={cn(
                  "rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  browserOpen
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                )}
              >
                Browser
              </button>
            )}
            {workspaceMode === "terminal" && !isCompactWorkspace && (
              <div className="flex rounded-sm border border-[var(--color-border)] bg-[var(--color-background)] p-0.5">
                {[
                  { id: "git", label: "Git" },
                  { id: "ports", label: "Ports" },
                  { id: "project", label: "Project" },
                  { id: "terminals", label: "Fleet" },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      activateTerminalPanelShortcut(id as TerminalPanelToolId)
                    }
                    className="rounded-[3px] px-2 py-1 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
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
                disabled={isAndroidChromeNativeInputSuppressed}
                title={
                  isAndroidChromeNativeInputSuppressed
                    ? "Saving profiles is unavailable in Android Chrome"
                    : undefined
                }
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
                disabled={isAndroidChromeNativeInputSuppressed}
                title={
                  isAndroidChromeNativeInputSuppressed
                    ? "Launching with custom text is unavailable in Android Chrome"
                    : undefined
                }
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
                suppressNativeKeyboard={isAndroidChromeNativeInputSuppressed}
                webglEnabledSessionIds={webglEnabledSessionIds}
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
                onToggleTabPin={handleToggleTabPin}
                onOpenDiagnosticsMenu={openTerminalDiagnosticsMenu}
                onOpenTunnelInBrowser={handleOpenTunnelInBrowser}
                browserOpen={browserOpen && !isCompactWorkspace}
                renderBrowserContent={(onClose) =>
                  renderBrowserContent(onClose, "active")
                }
                onCloseBrowser={closeEmbeddedBrowser}
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
                onToggleTabPin={handleToggleTabPin}
                onCloseTab={handleCloseTab}
                onOpenDiagnosticsMenu={openTerminalDiagnosticsMenu}
                onVisibleSessionIdsChange={handleVisibleSplitSessionsChange}
                browserOpen={browserOpen && !isCompactWorkspace}
                renderBrowserContent={(onClose) =>
                  renderBrowserContent(onClose, "active")
                }
                onCloseBrowser={closeEmbeddedBrowser}
              />
            </Suspense>
          ) : shouldRenderEmptyTerminalBrowserSurface({
              terminalUsageMode,
              mountedSessionCount: mountedSessions.length,
              browserOpen,
              isCompactWorkspace,
            }) ? (
            <div className="h-full min-h-0">
              {renderBrowserContent(closeEmbeddedBrowser, "active")}
            </div>
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
      handleToggleTabPin,
      handleCloseTab,
      setFreeTerminalSavePrompt,
      setLaunchForm,
      mountedSessions,
      handleSessionExit,
      handleAddFreeTerminal,
      handleOpenTunnelInBrowser,
      projectName,
      handleLaunchShell,
      browserOpen,
      closeEmbeddedBrowser,
      terminalFilePanelOpen,
      workspaceMode,
      isCompactWorkspace,
      isAndroidChromeNativeInputSuppressed,
      activateTerminalPanelShortcut,
      toggleTerminalFilePanel,
      diagnosticsWindowMinutes,
      openTerminalDiagnosticsMenu,
      webglEnabledSessionIds,
      handleVisibleSplitSessionsChange,
      renderBrowserContent,
      toggleEmbeddedBrowser,
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
        <PortsPanel onOpenTunnelInBrowser={handleOpenTunnelInBrowser} />
      </Suspense>
    ),
    [handleOpenTunnelInBrowser],
  );

  const browserContent = useMemo(
    () => renderBrowserContent(),
    [renderBrowserContent],
  );

  const terminalGitContent = useMemo(
    () =>
      projectName ? (
        <Suspense fallback={<PanelFallback label="Loading Git…" />}>
          <WorkspaceGitPanel
            key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
            project={projectName}
            target={projectTarget?.target}
          />
        </Suspense>
      ) : (
        <div className="p-4 text-xs text-[var(--color-text-muted)] italic text-center">
          Select a project to see Git status
        </div>
      ),
    [projectName, projectTarget],
  );

  const projectContent = useMemo(
    () =>
      projectName ? (
        <div
          data-testid="workspace-project-info-panel"
          className="flex h-full min-h-0 flex-col"
        >
          <Suspense fallback={<PanelFallback label="Loading project…" />}>
            <ProjectInfoPanel
              projectName={projectName}
              target={projectTarget}
              onLaunchCommand={(cmd) => handleLaunchTerminal(projectName, cmd)}
            />
          </Suspense>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          Select a project to inspect
        </div>
      ),
    [handleLaunchTerminal, projectName, projectTarget],
  );

  const leftTools = useMemo<ToolWindowDef[]>(
    () => [
      {
        id: "search",
        label: "Search",
        icon: Search,
        content: projectName ? (
          <Suspense fallback={<PanelFallback label="Loading search…" />}>
            <SearchPanel
              project={projectName}
              target={projectTarget?.target}
              onResultClick={handleSearchResultOpen}
            />
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
                  key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
                  project={projectName}
                  target={projectTarget?.target}
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
                target={projectTarget?.target}
                selectedFile={null}
                onSelectFile={(selection) =>
                  openChangedFileDiff(
                    projectTarget?.target ?? projectName,
                    selection,
                    openDiff,
                  )
                }
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
            <WorkspaceGitPanel
              key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
              project={projectName}
              target={projectTarget?.target}
            />
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
      projectTarget,
    ],
  );

  const rightTools = useMemo<ToolWindowDef[]>(
    () => [
      {
        id: "project-info",
        label: "Project",
        icon: Folder,
        defaultActive: true,
        content: projectContent,
      },
      {
        id: "terminals",
        label: "Fleet Terminal",
        icon: LayoutGrid,
        content: fleetContent,
      },
    ],
    [fleetContent, projectContent],
  );

  const compactGitSurface = useMemo<MobileWorkspaceSurface>(
    () => ({
      id: "git",
      label: "Git",
      icon: GitMerge,
      content: projectName ? (
        <Suspense fallback={<PanelFallback label="Loading Git…" />}>
          <WorkspaceGitPanel
            key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
            project={projectName}
            target={projectTarget?.target}
          />
        </Suspense>
      ) : (
        renderCompactPlaceholder("Select a project to see Git status")
      ),
    }),
    [projectName, projectTarget],
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
            target={projectTarget}
            onLaunchCommand={(cmd) => handleLaunchTerminal(projectName, cmd)}
          />
        </Suspense>
      ) : (
        renderCompactPlaceholder("Select a project to inspect")
      ),
    }),
    [handleLaunchTerminal, projectName, projectTarget],
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
                  key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
                  project={projectName}
                  target={projectTarget?.target}
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
              target={projectTarget?.target}
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
            <EditorTabs
              key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
              project={projectName}
              target={projectTarget?.target}
            />
          </Suspense>
        ),
      },
      {
        id: "terminal",
        label: "Terminal",
        icon: TerminalIcon,
        content: terminalContent,
      },
      {
        id: "browser",
        label: "Browser",
        icon: Globe2,
        content: browserContent,
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
      terminalContent,
      browserContent,
      projectTarget,
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
      {
        id: "browser",
        label: "Browser",
        icon: Globe2,
        content: browserContent,
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
      browserContent,
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
    () => (controls: TerminalWorkspacePanelControls) => (
      <TerminalFloatingFilePanel
        open={terminalFilePanelOpen}
        treeWidth={terminalFileTreeWidth}
        isDragging={isTerminalFileTreeResizing}
        focusEditorSignal={terminalFilePanelEditorFocusSignal}
        treeResizeHandleProps={terminalFileTreeResizeHandleProps}
        zIndex={controls.zIndex}
        onActivate={controls.onActivate}
        explorerContent={
          projectName ? (
            <Suspense fallback={<PanelFallback label="Loading files…" />}>
              <FileTree
                key={`terminal-panel-${projectName}:${projectTarget?.targetKey ?? "root"}`}
                project={projectName}
                target={projectTarget?.target}
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
        changesContent={
          projectName ? (
            <Suspense fallback={<PanelFallback label="Loading changes…" />}>
              <ChangedFilesList
                key={`terminal-panel-changes-${projectName}:${projectTarget?.targetKey ?? "root"}`}
                project={projectName}
                target={projectTarget?.target}
                selectedFile={null}
                onSelectFile={(selection) =>
                  openChangedFileDiff(
                    projectTarget?.target ?? projectName,
                    selection,
                    openDiff,
                  )
                }
              />
            </Suspense>
          ) : (
            renderCompactPlaceholder("No projects configured")
          )
        }
        editorContent={
          <Suspense fallback={<PanelFallback label="Loading editor…" />}>
            <EditorTabs
              key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
              project={projectName}
              target={projectTarget?.target}
            />
          </Suspense>
        }
        onClose={() => setTerminalFilePanelOpen(false)}
      />
    ),
    [
      handleFileOpen,
      handleLaunchShell,
      isTerminalFileTreeResizing,
      openDiff,
      projectName,
      setTerminalFilePanelOpen,
      fileTreeRevealRequest,
      terminalFilePanelEditorFocusSignal,
      terminalFilePanelOpen,
      terminalFileTreeResizeHandleProps,
      terminalFileTreeWidth,
      projectTarget,
    ],
  );

  return (
    <>
      <BrowserDebugKeepAliveHost
        ref={browserKeepAliveRef}
        browser={browserDebug}
        viewportRef={browserViewportRef}
        viewportStageRef={browserViewportStageRef}
        viewportVersion={browserViewportVersion}
        isViewportVisible={isBrowserViewportVisible}
      />
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
          terminalOverlayOpen={terminalFilePanelOpen}
          fleetContent={fleetContent}
          gitContent={terminalGitContent}
          projectContent={projectContent}
          portsContent={portsContent}
          activatePanelRequest={terminalWorkspacePanelRequest}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          workspaceModeShortcutLabel={terminalWorkspaceShortcut}
        />
      ) : (
        <IdeShell
          leftTools={leftTools}
          rightTools={rightTools}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          workspaceModeShortcutLabel={terminalWorkspaceShortcut}
          activateLeftTopToolRequest={ideLeftTopToolRequest}
          activateBottomToolRequest={ideBottomToolRequest}
          activateRightTopToolRequest={ideRightTopToolRequest}
          editor={
            <Suspense fallback={<PanelFallback label="Loading editor…" />}>
              <EditorTabs
                key={`${projectName}:${projectTarget?.targetKey ?? "root"}`}
                project={projectName}
                target={projectTarget?.target}
              />
            </Suspense>
          }
        />
      )}

      {terminalDiagnosticsMenuTarget &&
        isTerminalDiagnosticsMenuTargetAvailable && (
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
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[max(calc(var(--app-viewport-height)*0.08),var(--safe-area-top))] sm:px-4"
          onClick={closeSearch}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Dialog */}
          <div
            className="dialog-viewport-fit relative z-10 flex h-[min(calc(var(--app-viewport-height)*0.7),42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Suspense fallback={<PanelFallback label="Loading search…" />}>
              <SearchPanel
                project={projectName}
                target={projectTarget?.target}
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
