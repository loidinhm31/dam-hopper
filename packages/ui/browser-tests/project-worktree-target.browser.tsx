import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import WorkspacePage from "@/components/pages/WorkspacePage.js";
import { DiffViewer } from "@/components/organisms/DiffViewer.js";
import { ImagePreview } from "@/components/organisms/ImagePreview.js";
import { VideoPreview } from "@/components/organisms/VideoPreview.js";
import {
  createProjectTargetSnapshot,
  useProjectTargetStore,
} from "@/stores/project-target.js";
import {
  initTransport,
  resetTransport,
  type Transport,
} from "@/api/transport.js";
import "@/index.css";

const testState = vi.hoisted(() => ({
  project: {
    name: "project-1",
    path: "/workspace/project-1",
    type: "git",
    terminals: [],
    services: [{ buildCommand: "pnpm build", runCommand: "pnpm dev" }],
    commands: { lint: "pnpm lint" },
    status: { branch: "main", isClean: true },
  },
  api: {
    projects: { list: vi.fn() },
    terminal: { create: vi.fn() },
  },
  transport: { invoke: vi.fn() },
  settings: {
    searchTextShortcut: "mod+shift+f",
    searchFilenameShortcut: "mod+p",
    terminalWorkspaceShortcut: "mod+`",
    terminalFilePanelShortcut: "mod+shift+e",
    gitPanelShortcut: "mod+shift+g",
    portsPanelShortcut: "mod+shift+p",
    fleetTerminalShortcut: "mod+shift+t",
    revealActiveFileShortcut: "alt+f1",
    mobileCustomKeyboardEnabled: false,
    terminalAutoSwitchProjectEnabled: true,
    explorerShowHidden: false,
    explorerLanguageFilter: "all",
    saveDebounced: vi.fn(),
  },
  captures: {
    fileSearch: [] as unknown[],
    fsSubscription: [] as unknown[],
    explorerLanguageScan: [] as unknown[],
    gitDiff: [] as unknown[],
    gitUntracked: [] as unknown[],
    gitRoots: [] as unknown[],
    branches: [] as unknown[],
    gitLog: [] as unknown[],
    projectStatus: [] as unknown[],
    worktrees: [] as unknown[],
    diff: [] as unknown[],
    media: [] as unknown[],
  },
}));

const PROJECT = testState.project.name;
const PROJECT_ROOT = testState.project.path;
const FEATURE_PATH = "/workspace/project-1-feature";

const worktrees = [
  {
    path: PROJECT_ROOT,
    repositoryPath: "/workspace/project-1/.git",
    branch: "main",
    commitHash: "main-commit",
    isMain: true,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: FEATURE_PATH,
    repositoryPath: "/workspace/project-1/.git",
    branch: "feature/switching",
    commitHash: "feature-commit",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
];
const projectList = [testState.project];
const emptyGitDiff = { entries: [], gitAvailable: true };
const globalConfig = {
  ui: { projectOrder: [], projectCommandOrder: {}, terminalOrder: [] },
};
const worktreeRefetch = vi
  .fn()
  .mockResolvedValue({ data: worktrees, isError: false });
const setSearchParams = vi.fn();
const searchParams = new URLSearchParams();
const setActiveProject = vi.fn();

function TargetPreviewSurfaces() {
  const activePath = useProjectTargetStore(
    (state) => state.activeTargetByProject[PROJECT],
  );
  const target = activePath
    ? { project: PROJECT, worktreePath: activePath }
    : { project: PROJECT };

  return (
    <section data-testid="actual-target-preview-surfaces">
      <ImagePreview
        project={PROJECT}
        target={target}
        path="assets/preview.png"
        fileName="preview.png"
        mime="image/png"
      />
      <VideoPreview
        project={PROJECT}
        target={target}
        path="assets/preview.mp4"
        fileName="preview.mp4"
        mime="video/mp4"
      />
      <DiffViewer
        project={PROJECT}
        target={target}
        filePath="src/example.ts"
        fileStatus="modified"
        additions={1}
        deletions={1}
        onClose={vi.fn()}
      />
    </section>
  );
}

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [searchParams, setSearchParams],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: projectList, isLoading: false }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    refetchQueries: vi.fn().mockResolvedValue(undefined),
    resetQueries: vi.fn().mockResolvedValue(undefined),
    fetchQuery: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/api/queries.js", () => ({
  useExportDiagnostics: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useProjects: () => ({ data: projectList, isLoading: false }),
  useProject: () => ({ data: testState.project, isLoading: false }),
  useProjectStatus: (target: unknown) => {
    testState.captures.projectStatus.push(target);
    return { data: testState.project.status };
  },
  useWorktrees: () => {
    testState.captures.worktrees.push(PROJECT);
    return {
      data: worktrees,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isError: false,
      refetch: worktreeRefetch,
    };
  },
  useRemoveWorktree: () => ({ mutateAsync: vi.fn() }),
  useTerminalSessions: () => ({ data: [], isSuccess: true }),
  useGlobalConfig: () => ({ data: globalConfig }),
  useUpdateUiConfig: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useExplorerLanguageScan: (target: unknown) => {
    testState.captures.explorerLanguageScan.push(target);
    return { cache: null, scan: vi.fn() };
  },
  useGitDiff: (target: unknown) => {
    testState.captures.gitDiff.push(target);
    return {
      data: emptyGitDiff,
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: emptyGitDiff }),
    };
  },
  useGitUntracked: (target: unknown) => {
    testState.captures.gitUntracked.push(target);
    return { data: [], isFetching: false };
  },
  useGitFileDiff: (target: unknown) => {
    testState.captures.diff.push(target);
    return {
      data: { original: "old", modified: "new", language: "plaintext" },
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useGitCommitFileDiff: (target: unknown) => {
    testState.captures.diff.push(target);
    return {
      data: { original: "old", modified: "new", language: "plaintext" },
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useGitRoots: (target: unknown) => {
    testState.captures.gitRoots.push(target);
    return { data: [], error: null };
  },
  useBranches: (target: unknown) => {
    testState.captures.branches.push(target);
    return { data: [], error: null };
  },
  useGitLog: (target: unknown) => {
    testState.captures.gitLog.push(target);
    return { data: [], isLoading: false };
  },
  useGitFetch: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitPull: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitPush: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitHistoryActions: () => ({}),
  useGitCommitFiles: () => ({ data: [], isLoading: false }),
  useGitCherryPick: () => ({ mutateAsync: vi.fn() }),
  useGitCherryPickCommitFiles: () => ({ mutateAsync: vi.fn() }),
  useGitCommitMessage: () => ({ mutateAsync: vi.fn() }),
  useGitDropCommit: () => ({ mutateAsync: vi.fn() }),
  useGitDropCommitFiles: () => ({ mutateAsync: vi.fn() }),
  useGitEditCommitMessage: () => ({ mutateAsync: vi.fn() }),
  useGitRevertCommit: () => ({ mutateAsync: vi.fn() }),
  useGitRevertCommitFiles: () => ({ mutateAsync: vi.fn() }),
  useGitReset: () => ({ mutateAsync: vi.fn() }),
  useGitUndoLastCommit: () => ({ mutateAsync: vi.fn() }),
  invalidateGitFileOperation: vi.fn().mockResolvedValue(undefined),
  markTargetUnavailableIfNeeded: vi.fn(),
}));

vi.mock("@/api/client.js", () => ({
  api: testState.api,
  isGitUnavailableError: () => false,
  isProjectTargetError: () => false,
  normalizeProjectTarget: (target: {
    project: string;
    worktreePath?: string;
  }) =>
    target.worktreePath == null
      ? { project: target.project }
      : { project: target.project, worktreePath: target.worktreePath },
  projectTargetCacheKey: (target: {
    project: string;
    worktreePath?: string;
  }) =>
    target.worktreePath == null ? "root" : `worktree:${target.worktreePath}`,
}));

vi.mock("@/hooks/use-project-target.js", () => ({
  useProjectTarget: (projectName: string | null) => {
    const activePath = useProjectTargetStore((state) =>
      projectName ? state.activeTargetByProject[projectName] : undefined,
    );
    const worktree = worktrees.find(
      (candidate) => candidate.path === activePath,
    );
    return projectName
      ? createProjectTargetSnapshot(projectName, activePath, worktree)
      : null;
  },
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({
    activeProject: PROJECT,
    setActiveProject,
  }),
}));

const editorState = {
  tabs: [],
  activeKeys: {},
  open: vi.fn(),
  openDiff: vi.fn(),
  setActive: vi.fn(),
  close: vi.fn(),
  closeOthers: vi.fn(),
  closeAll: vi.fn(),
  setContent: vi.fn(),
  save: vi.fn().mockResolvedValue(true),
  saveViewState: vi.fn(),
  forceOverwrite: vi.fn(),
  reloadTab: vi.fn(),
  clearConflict: vi.fn(),
  clearStale: vi.fn(),
  markSaved: vi.fn(),
  loadContent: vi.fn(),
  markTargetUnavailable: vi.fn(),
  markTargetAvailable: vi.fn(),
  beginAsyncRequest: vi.fn(() => 1),
  isCurrentAsyncRequest: vi.fn(() => true),
};
vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector?: (state: typeof editorState) => unknown) =>
    selector ? selector(editorState) : editorState,
  editorActiveKeyForTarget: () => null,
  editorTargetScopeKey: (target: { project: string; worktreePath?: string }) =>
    `${target.project}:${target.worktreePath ?? "root"}`,
  countDirtyTabsForTarget: () => 0,
}));

vi.mock("@/stores/search-ui.js", () => ({
  useSearchUiStore: () => ({
    open: false,
    close: vi.fn(),
    openWith: vi.fn(),
    scope: "project",
    setScope: vi.fn(),
    mode: "content",
    setMode: vi.fn(),
    queries: { content: "", filename: "" },
    replaceQuery: "",
    setQuery: vi.fn(),
    setReplaceQuery: vi.fn(),
    caseSensitive: false,
    setCaseSensitive: vi.fn(),
    selectOnOpen: false,
    consumeSelectOnOpen: vi.fn(() => false),
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector?: (state: typeof testState.settings) => unknown,
  ) => (selector ? selector(testState.settings) : testState.settings),
}));

vi.mock("@/hooks/use-file-search.js", () => ({
  useFileSearch: (target: unknown) => {
    testState.captures.fileSearch.push(target);
    return {
      caseSensitive: false,
      setCaseSensitive: vi.fn(),
      data: { matches: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: { matches: [] } }),
    };
  },
}));
vi.mock("@/hooks/use-fs-subscription.js", () => ({
  useFsSubscription: (target: unknown) => {
    testState.captures.fsSubscription.push(target);
    return {
      data: { sub_id: 1, nodes: [] },
      isLoading: false,
      isError: false,
      error: null,
      loadChildren: vi.fn(),
      refetch: vi.fn(),
      isFetching: false,
    };
  },
}));
vi.mock("@/hooks/use-fs-ops.js", () => ({
  useFsOps: () => ({
    createFile: vi.fn(),
    createDir: vi.fn(),
    rename: vi.fn(),
    deleteEntry: vi.fn(),
    move: vi.fn(),
    download: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-fs-upload.js", () => ({
  useFsUpload: () => ({
    progress: null,
    upload: vi.fn(),
    clearProgress: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));
vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({
    isEncryptEnabled: () => false,
    getPassphrase: () => "",
    promptPassphrase: vi.fn(),
    setPassphrase: vi.fn(),
    getSession: () => null,
    setSession: vi.fn(),
    clearSession: vi.fn(),
    clearPassphrase: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-encrypted-write.js", () => ({
  useEncryptedWrite: () => ({
    saveText: vi.fn(),
    uploadFile: vi.fn(),
    status: "idle",
    error: null,
    resetError: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-git-with-ssh-retry.js", () => ({
  useGitWithSshRetry: () => ({
    passphraseDialogProps: { open: false },
    statusMessage: undefined,
    executeWithRetry: async (_options: unknown, fn: () => Promise<unknown>) =>
      fn(),
  }),
}));

vi.mock("react-arborist", () => ({
  Tree: () => <div data-testid="actual-file-tree" />,
}));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => <div data-testid="actual-diff-editor" />,
  loader: { config: vi.fn() },
}));
vi.mock("@/api/image-tickets.js", () => ({
  issueImageTicket: (target: unknown) => {
    testState.captures.media.push(target);
    return Promise.reject(new Error("media ticket intentionally stubbed"));
  },
}));
vi.mock("@/api/video-tickets.js", () => ({
  issueVideoTicket: (target: unknown) => {
    testState.captures.media.push(target);
    return Promise.reject(new Error("media ticket intentionally stubbed"));
  },
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

vi.mock("@/hooks/use-browser-debug.js", () => ({
  useBrowserDebug: () => ({
    extensionPresence: "unknown",
    inputUrl: "",
    addressHistory: [],
    target: null,
    bridgeStatus: "idle",
    bridgeCapabilities: [],
    selection: null,
    pickerActive: false,
    captureStatus: "idle",
    captureMessage: null,
    manualImageName: null,
    captureImage: null,
    error: null,
    consoleEntries: [],
    setInputUrl: vi.fn(),
    navigate: vi.fn(),
    navigateTo: vi.fn(() => false),
    setBridgeStatus: vi.fn(),
    setSelection: vi.fn(),
    setPickerActive: vi.fn(),
    setError: vi.fn(),
    syncCurrentUrl: vi.fn(),
    setBridgeCapabilities: vi.fn(),
    appendConsoleEntry: vi.fn(),
    clearConsole: vi.fn(),
    startCapture: vi.fn(),
    setManualImage: vi.fn(),
    stopCapture: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => false,
}));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => false,
}));
vi.mock("@/hooks/use-resize-handle.js", () => ({
  useResizeHandle: ({ defaultWidth }: { defaultWidth: number }) => ({
    width: defaultWidth,
    handleProps: {},
    isDragging: false,
  }),
}));
vi.mock("@/hooks/use-shortcuts.js", () => ({
  addKeyboardShortcutListener: () => () => {},
  useDocumentKeyboardShortcut: () => {},
}));
vi.mock("@/lib/workspace-mode.js", () => ({
  loadWorkspaceMode: () => "ide",
  saveWorkspaceMode: vi.fn(),
}));

vi.mock("@/components/atoms/Button.js", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  inputClass: "",
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
  SelectValue: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/templates/IdeShell.js", () => ({
  IdeShell: ({
    leftTools,
    rightTools,
    editor,
  }: {
    leftTools: Array<{ id: string; content: ReactNode }>;
    rightTools: Array<{ id: string; content: ReactNode }>;
    editor: ReactNode;
  }) => (
    <main data-testid="workspace-page">
      <section data-testid="workspace-editor-surface">{editor}</section>
      {[...leftTools, ...rightTools].map((tool) => (
        <section key={tool.id} data-testid={`workspace-surface-${tool.id}`}>
          {tool.content}
        </section>
      ))}
    </main>
  ),
}));
vi.mock("@/components/templates/MobileWorkspaceShell.js", () => ({
  MobileWorkspaceShell: () => <div />,
}));
vi.mock("@/components/templates/TerminalWorkspaceShell.js", () => ({
  TerminalWorkspaceShell: () => <div />,
}));

vi.mock("@/components/organisms/PortsPanel.js", () => ({
  PortsPanel: () => <div />,
}));
vi.mock("@/components/organisms/ActiveTerminalRuntimeDisplay.js", () => ({
  ActiveTerminalRuntimeDisplay: () => <div />,
}));
vi.mock("@/components/organisms/TerminalKeepAliveHost.js", () => ({
  TerminalKeepAliveHost: () => null,
}));
vi.mock("@/components/organisms/TerminalFloatingFilePanel.js", () => ({
  TerminalFloatingFilePanel: () => null,
}));
vi.mock("@/components/organisms/BrowserDebugKeepAliveHost.js", () => ({
  BrowserDebugKeepAliveHost: () => null,
}));
vi.mock("@/components/organisms/BrowserDebugPanel.js", () => ({
  BrowserDebugPanel: () => null,
}));
vi.mock("@/components/molecules/DiagnosticsTimeWindowSelect.js", () => ({
  DiagnosticsTimeWindowSelect: () => null,
}));
vi.mock("@/components/organisms/TerminalDiagnosticsContextMenu.js", () => ({
  TerminalDiagnosticsContextMenu: () => null,
}));
vi.mock("@/components/organisms/PassphraseDialog.js", () => ({
  PassphraseDialog: () => null,
}));
vi.mock("@/components/organisms/GitForcePushDialog.js", () => ({
  GitForcePushDialog: () => null,
}));
vi.mock("@/components/atoms/SshRetryStatusMessage.js", () => ({
  SshRetryStatusMessage: () => null,
}));
vi.mock("@/components/organisms/GitBranchControl.js", () => ({
  GitBranchControl: () => <div data-testid="actual-git-branch-control" />,
}));
vi.mock("@/components/organisms/GitLogTree.js", () => ({
  GitLogTree: () => <div data-testid="actual-git-log-tree" />,
}));
vi.mock("@/components/organisms/CommitDetailsPanel.js", () => ({
  CommitDetailsPanel: () => null,
}));
vi.mock("@/components/organisms/GitHistoryActions.js", () => ({
  GitDropCommitDialog: () => null,
  GitEditCommitMessageDialog: () => null,
  GitHistoryStatusBanner: () => null,
  GitRevertCommitDialog: () => null,
  GitResetDialog: () => null,
  GitUndoLastCommitDialog: () => null,
  useGitHistoryActions: () => ({}),
}));
vi.mock("@/components/organisms/WorktreeAddForm.js", () => ({
  WorktreeAddForm: () => null,
}));

describe("WorkspacePage project worktree target routing in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    useProjectTargetStore.getState().resetTarget(PROJECT);
    for (const capture of Object.values(testState.captures)) capture.length = 0;
    editorState.tabs = [];
    editorState.activeKeys = {};
    testState.api.projects.list
      .mockReset()
      .mockResolvedValue([testState.project]);
    testState.api.terminal.create.mockReset().mockResolvedValue(undefined);
    testState.transport.invoke.mockReset().mockResolvedValue(undefined);
    initTransport(testState.transport as unknown as Transport);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <>
          <WorkspacePage />
          <TargetPreviewSurfaces />
        </>,
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    useProjectTargetStore.getState().resetTarget(PROJECT);
    resetTransport();
  });

  it("switches the real workspace page surfaces and terminal launch to one target", async () => {
    await expect
      .element(page.getByTestId("workspace-project-info-panel"))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /^▶ Worktrees$/ }));

    const featureRadio = page.getByRole("radio", {
      name: /feature\/switching/,
    });
    await expect.element(featureRadio).toBeVisible();
    await userEvent.click(featureRadio);

    const featureTarget = { project: PROJECT, worktreePath: FEATURE_PATH };
    for (const captures of [
      testState.captures.fileSearch,
      testState.captures.fsSubscription,
      testState.captures.gitDiff,
      testState.captures.gitRoots,
      testState.captures.branches,
      testState.captures.gitLog,
      testState.captures.projectStatus,
      testState.captures.explorerLanguageScan,
      testState.captures.diff,
      testState.captures.media,
    ]) {
      expect(captures).toContainEqual(featureTarget);
    }
    expect(
      container.querySelector('[data-testid="actual-file-tree"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="actual-git-branch-control"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="actual-git-log-tree"]'),
    ).toBeTruthy();

    await userEvent.click(
      page
        .getByTestId("workspace-project-info-panel")
        .getByRole("button", { name: "Launch build" }),
    );
    expect(testState.api.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        project: PROJECT,
        worktreePath: FEATURE_PATH,
      }),
    );
    expect(testState.api.terminal.create.mock.calls[0]?.[0]?.id).toContain(
      "wt-",
    );
    await expect
      .element(page.getByTestId("workspace-project-info-panel"))
      .toBeVisible();
  });
});
