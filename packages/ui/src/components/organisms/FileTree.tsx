import {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useId,
  type ComponentPropsWithoutRef,
} from "react";
import { Tree } from "react-arborist";
import type { NodeApi, NodeRendererProps, TreeApi } from "react-arborist";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Loader2,
  Upload,
  RefreshCw,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { FileDecorationIcon } from "@/lib/file-decoration-icon.js";
import { useFsSubscription } from "@/hooks/use-fs-subscription.js";
import { useFsOps } from "@/hooks/use-fs-ops.js";
import { useFsUpload } from "@/hooks/use-fs-upload.js";
import type { FsArborNode } from "@/api/fs-types.js";
import { TreeContextMenu } from "./TreeContextMenu.js";
import { UploadDropzone } from "./UploadDropzone.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { NewItemDialog } from "./NewItemDialog.js";
import { RenameItemDialog } from "./RenameItemDialog.js";
import { LockToggle } from "@/components/atoms/LockToggle.js";
import { EncryptedUploadDialog } from "@/components/organisms/EncryptedUploadDialog.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useEditorStore } from "@/stores/editor.js";
import {
  useExplorerLanguageScan,
  useGitDiff,
  useProject,
} from "@/api/queries.js";
import type { ExplorerLanguageFilter } from "@/api/fs-types.js";
import { isExplorerLanguageFilter } from "@/lib/ui-config.js";
import {
  buildExplorerLanguageTree,
  collectExplorerLanguageTreeIds,
} from "@/lib/explorer-language-tree.js";
import {
  buildGitFileStateIndex,
  gitStateTitle,
  gitStatusClassName,
  gitStatusShortLabel,
  type GitFileState,
} from "@/lib/git-file-state.js";
import {
  revealFileTreePath,
  type FileTreeRevealRequest,
} from "@/lib/file-tree-reveal.js";
import { useCopyToClipboard } from "@/hooks/use-clipboard.js";
import { buildTreeCopyPaths } from "@/lib/tree-copy-paths.js";

const LOADING_SENTINEL_PREFIX = "__loading__:" as const;

const LANGUAGE_FILTER_LABELS: Record<ExplorerLanguageFilter, string> = {
  all: "All",
  rust: "Rust",
  "javascript-typescript": "JS/TS",
  java: "Java",
};

function loadingSentinel(parentId: string): FsArborNode {
  return {
    id: `${LOADING_SENTINEL_PREFIX}${parentId}`,
    name: "",
    kind: "file",
    size: 0,
    mtime: 0,
    isSymlink: false,
    children: null,
  };
}

function isLoadingSentinel(id: string) {
  return id.startsWith(LOADING_SENTINEL_PREFIX);
}

// ---------------------------------------------------------------------------
// File icon mapping
// ---------------------------------------------------------------------------

function TreeNodeIcon({
  path,
  isDir,
  isOpen,
}: {
  path: string;
  isDir: boolean;
  isOpen?: boolean;
}) {
  if (isDir) {
    return isOpen ? (
      <FolderOpen className="h-4 w-4 shrink-0 text-yellow-400" />
    ) : (
      <Folder className="h-4 w-4 shrink-0 text-yellow-400" />
    );
  }
  return <FileDecorationIcon pathOrName={path} className="h-4 w-4" />;
}

function getNodeDecorationPath(node: FsArborNode): string {
  // Prefer the relative path id when it still points at the visible entry.
  // If tree ids ever become synthetic/opaque, fall back to the display name.
  if (
    node.id === node.name ||
    node.id.endsWith(`/${node.name}`) ||
    node.id.endsWith(`\\${node.name}`)
  ) {
    return node.id;
  }
  return node.name;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

type NodeRendererWithContextProps = Omit<
  NodeRendererProps<FsArborNode>,
  "style"
> &
  Omit<ComponentPropsWithoutRef<"div">, "style" | "onContextMenu"> & {
    style: React.CSSProperties;
    onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
    gitState?: GitFileState;
    hasChangedDescendant?: boolean;
    onOpenDiff?: (state: GitFileState) => void;
  };

const NodeRenderer = forwardRef<HTMLDivElement, NodeRendererWithContextProps>(
  function NodeRenderer(
    {
      node,
      style,
      dragHandle,
      gitState,
      hasChangedDescendant,
      onOpenDiff,
      onContextMenu,
      ...props
    },
    forwardedRef,
  ) {
    const combinedRef = useCallback(
      (element: HTMLDivElement | null) => {
        assignRef(dragHandle, element);
        assignRef(forwardedRef, element);
      },
      [dragHandle, forwardedRef],
    );

    if (isLoadingSentinel(node.data.id)) {
      return (
        <div
          {...props}
          ref={combinedRef}
          style={style}
          className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-[var(--color-text-muted)] opacity-40 select-none"
        >
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          Loading…
        </div>
      );
    }

    const isDir = node.data.kind === "dir";
    const isHidden = node.data.name.startsWith(".");
    const isLarge = !isDir && node.data.size > 5 * 1024 * 1024;

    return (
      <div
        {...props}
        ref={combinedRef}
        style={style}
        className={cn(
          "flex items-center gap-1.5 px-1 py-0.5 cursor-pointer rounded-sm select-none",
          "hover:bg-[var(--color-surface-2)] text-xs",
          node.isSelected
            ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
            : "text-[var(--color-text)]",
          node.isFocused &&
            !node.isSelected &&
            "outline outline-1 outline-[var(--color-primary)]/40",
          isHidden && "opacity-50",
          node.isDragging && "opacity-40",
          node.willReceiveDrop &&
            "bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]",
        )}
        onContextMenu={onContextMenu}
      >
        <span className="w-4 shrink-0 flex items-center justify-center">
          {isDir ? (
            node.isOpen ? (
              <ChevronDown className="h-3 w-3 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronRight className="h-3 w-3 text-[var(--color-text-muted)]" />
            )
          ) : null}
        </span>

        <TreeNodeIcon
          path={getNodeDecorationPath(node.data)}
          isDir={isDir}
          isOpen={node.isOpen}
        />

        <span
          className="truncate"
          title={
            isLarge
              ? `${node.data.name} — large file (read-only preview)`
              : node.data.name
          }
        >
          {node.data.name}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {isDir && hasChangedDescendant && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
              title="Contains changed files"
            />
          )}
          {!isDir && gitState && (
            <button
              type="button"
              className={cn(
                "h-4 min-w-4 rounded-[2px] border px-0.5 text-[9px] font-black leading-none",
                gitStatusClassName(gitState),
              )}
              title={`Open diff: ${gitStateTitle(gitState)}`}
              onPointerDown={(event) => {
                if (
                  event.pointerType === "touch" ||
                  event.pointerType === "pen"
                ) {
                  event.stopPropagation();
                }
              }}
              onContextMenu={(event) => {
                const nativeEvent = event.nativeEvent as MouseEvent & {
                  pointerType?: string;
                };
                const isNonMouseContextMenu =
                  nativeEvent.pointerType !== undefined &&
                  nativeEvent.pointerType !== "mouse";
                const isLegacyNonRightButton =
                  nativeEvent.pointerType === undefined &&
                  nativeEvent.button !== 2;
                if (isNonMouseContextMenu || isLegacyNonRightButton) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onClick={(event) => {
                event.stopPropagation();
                onOpenDiff?.(gitState);
              }}
              aria-label={`Open diff for ${node.data.name}`}
            >
              {gitStatusShortLabel(gitState)}
            </button>
          )}
          {isLarge && (
            <span className="text-[10px] text-[var(--color-text-muted)] opacity-60">
              {(node.data.size / (1024 * 1024)).toFixed(0)}MB
            </span>
          )}
        </span>
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

interface FileTreeProps {
  project: string;
  path?: string;
  onFileOpen?: (node: FsArborNode) => void;
  onOpenTerminal?: () => void;
  className?: string;
  revealRequest?: FileTreeRevealRequest | null;
}

interface RenameState {
  path: string;
  currentName: string;
}

interface DeleteState {
  nodes: FsArborNode[];
  loading: boolean;
}

export function FileTree({
  project,
  path = "",
  onFileOpen,
  onOpenTerminal,
  className,
  revealRequest,
}: FileTreeProps) {
  const {
    explorerShowHidden: showHidden,
    explorerLanguageFilter: configuredLanguageFilter,
    saveDebounced,
  } = useSettingsStore();
  const languageFilter: ExplorerLanguageFilter = isExplorerLanguageFilter(
    configuredLanguageFilter,
  )
    ? configuredLanguageFilter
    : "all";
  const isLanguageMode = languageFilter !== "all";
  const languageFilterId = useId();
  const [encUploadOpen, setEncUploadOpen] = useState(false);
  const { data, isLoading, isError, error, loadChildren, refetch, isFetching } =
    useFsSubscription(project, path);
  const languageScan = useExplorerLanguageScan(project);
  const { cache: languageScanCache, scan } = languageScan;
  const { data: gitDiff } = useGitDiff(project, "*");
  const openDiff = useEditorStore((s) => s.openDiff);
  const ops = useFsOps(project, path);
  const { progress, upload, clearProgress } = useFsUpload(project, path);
  const { isEncryptEnabled } = useEncryptMode();
  const { data: projectData } = useProject(project);
  const projectRoot = projectData?.path ?? "";
  const { copied, copy } = useCopyToClipboard();

  const [newItemDialog, setNewItemDialog] = useState<{
    open: boolean;
    type: "file" | "folder";
    parentPath: string;
  } | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [uploadDir, setUploadDir] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<TreeApi<FsArborNode> | undefined>(undefined);
  const handledRevealNonceRef = useRef<number | null>(null);
  const pendingRevealRef = useRef<FileTreeRevealRequest | null>(null);
  const pendingDownloadsRef = useRef(new Set<string>());
  const liveTreeCommitVersionRef = useRef(0);
  const liveTreeCommitWaitersRef = useRef<Set<() => void>>(new Set());

  // Track dirs the user has expanded so we can auto-reload them after a refetch
  // wipes children back to null.
  const expandedDirsRef = useRef<Set<string>>(new Set());

  // Parent layout effects run after Arborist has committed its new rows. Lazy
  // reveal waits on this boundary before invoking TreeApi for loaded children.
  useLayoutEffect(() => {
    if (!data || languageFilter !== "all") return;
    liveTreeCommitVersionRef.current += 1;
    for (const resolve of liveTreeCommitWaitersRef.current) resolve();
    liveTreeCommitWaitersRef.current.clear();
  }, [data, languageFilter]);

  const waitForLiveTreeCommitAfter = useCallback((version: number) => {
    if (liveTreeCommitVersionRef.current > version) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      liveTreeCommitWaitersRef.current.add(resolve);
    });
  }, []);

  useEffect(() => {
    if (!data || isLanguageMode) return;
    const unloaded = collectUnloadedExpanded(
      data.nodes,
      expandedDirsRef.current,
    );
    for (const id of unloaded) {
      void loadChildren(id);
    }
  }, [data, isLanguageMode, loadChildren]);

  const clearTreeSelection = useCallback(() => {
    const tree = treeRef.current as
      | (TreeApi<FsArborNode> & {
          deselectAll?: () => void;
        })
      | undefined;
    tree?.deselectAll?.();
    setNewItemDialog(null);
    setRename(null);
    setDeleteState(null);
    setEncUploadOpen(false);
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      containerRef.current?.contains(active) &&
      active.getAttribute("role") === "treeitem"
    ) {
      active.blur();
    }
  }, []);

  useEffect(() => {
    clearTreeSelection();
  }, [
    clearTreeSelection,
    languageFilter,
    languageScanCache?.result,
    project,
    showHidden,
  ]);

  useEffect(() => {
    if (
      !revealRequest ||
      handledRevealNonceRef.current === revealRequest.nonce
    ) {
      return;
    }
    if (revealRequest.project !== project) return;
    if (languageFilter !== "all") {
      if (pendingRevealRef.current?.nonce !== revealRequest.nonce) {
        pendingRevealRef.current = revealRequest;
        clearTreeSelection();
        saveDebounced({ explorerLanguageFilter: "all" });
      }
      return;
    }
    if (!data || !treeRef.current) return;

    let cancelled = false;
    pendingRevealRef.current = null;
    void revealFileTreePath({
      path: revealRequest.path,
      nodes: data.nodes,
      tree: treeRef.current,
      loadChildren,
      getTreeCommitVersion: () => liveTreeCommitVersionRef.current,
      waitForTreeCommitAfter: waitForLiveTreeCommitAfter,
    }).then((revealed) => {
      if (!cancelled && revealed) {
        handledRevealNonceRef.current = revealRequest.nonce;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    clearTreeSelection,
    data,
    languageFilter,
    loadChildren,
    project,
    revealRequest,
    saveDebounced,
    waitForLiveTreeCommitAfter,
  ]);

  const visibleNodes = useMemo(
    () =>
      showHidden
        ? (data?.nodes ?? [])
        : (data?.nodes ?? []).filter((n) => !n.name.startsWith(".")),
    [data, showHidden],
  );
  const languageNodes = useMemo(() => {
    if (!isLanguageMode || !languageScanCache?.result) return [];
    return buildExplorerLanguageTree(
      languageScanCache.result.files,
      languageFilter,
      showHidden,
    );
  }, [isLanguageMode, languageFilter, languageScanCache?.result, showHidden]);
  const renderedNodes = isLanguageMode ? languageNodes : visibleNodes;
  // Arborist owns a focused-node pointer independently from DOM focus. Remount
  // when a projection changes so synthetic nodes cannot retain live-tree focus.
  const treeKey = isLanguageMode
    ? `${project}:${languageFilter}:${showHidden}:${languageScanCache?.resultVersion ?? -1}`
    : `${project}:all:${showHidden}`;
  const renderedLiveTreeIds = useMemo(
    () => collectExplorerLanguageTreeIds(visibleNodes),
    [visibleNodes],
  );
  const isRenderedLiveNode = useCallback(
    (node: FsArborNode) => !isLanguageMode && renderedLiveTreeIds.has(node.id),
    [isLanguageMode, renderedLiveTreeIds],
  );
  const gitIndex = useMemo(
    () => buildGitFileStateIndex(gitDiff?.entries),
    [gitDiff],
  );

  // Stable reference — react-arborist uses this to build its internal flat list.
  // Inline arrow function would cause a full list rebuild on every render.
  const childrenAccessor = useCallback((d: FsArborNode) => {
    if (d.kind !== "dir") return null;
    if (d.children === null) return [loadingSentinel(d.id)];
    return d.children;
  }, []);

  function handleActivate(node: NodeApi<FsArborNode>) {
    if (isLoadingSentinel(node.data.id)) return;
    if (node.data.kind === "file") {
      onFileOpen?.(node.data);
    } else {
      if (!isLanguageMode && node.data.children === null) {
        expandedDirsRef.current.add(node.data.id);
        void loadChildren(node.data.id);
      }
      node.toggle();
    }
  }

  function handleCopyAbsolutePath(node: FsArborNode) {
    if (!isRenderedLiveNode(node)) return;
    const { absolutePath } = buildTreeCopyPaths({
      projectRoot,
      subPath: path,
      nodeId: node.id,
    });
    void copy(absolutePath);
  }

  function handleCopyRelativePath(node: FsArborNode) {
    if (!isRenderedLiveNode(node)) return;
    const { relativePath } = buildTreeCopyPaths({
      projectRoot,
      subPath: path,
      nodeId: node.id,
    });
    void copy(relativePath);
  }

  // ── Context menu actions ────────────────────────────────────────────────

  function handleNewFile(node: FsArborNode) {
    if (!isRenderedLiveNode(node)) return;
    const dir = node.kind === "dir" ? node.id : parentDir(node.id);
    setNewItemDialog({ open: true, type: "file", parentPath: dir });
  }

  function handleNewFolder(node: FsArborNode) {
    if (!isRenderedLiveNode(node)) return;
    const dir = node.kind === "dir" ? node.id : parentDir(node.id);
    setNewItemDialog({ open: true, type: "folder", parentPath: dir });
  }

  function handleNewItemConfirm(name: string) {
    if (
      !newItemDialog ||
      isLanguageMode ||
      (newItemDialog.parentPath &&
        !renderedLiveTreeIds.has(newItemDialog.parentPath))
    ) {
      return;
    }
    const { type, parentPath } = newItemDialog;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    const promise =
      type === "file" ? ops.createFile(fullPath) : ops.createDir(fullPath);

    void promise
      .then((r) => {
        if (!r.ok) setOpError(r.error ?? "Create failed");
      })
      .catch((error) => {
        setOpError(error instanceof Error ? error.message : "Create failed");
      })
      .finally(() => setNewItemDialog(null));
  }

  function handleRenameStart(node: FsArborNode) {
    if (!isRenderedLiveNode(node)) return;
    setRenaming(false);
    setRenameValue(node.name);
    setRename({ path: node.id, currentName: node.name });
  }

  function handleRenameCancel() {
    if (renaming) return;
    const renamePath = rename?.path;
    setRename(null);
    if (renamePath) treeRef.current?.focus(renamePath);
  }

  async function handleRenameSubmit() {
    if (
      renaming ||
      isLanguageMode ||
      (rename && !renderedLiveTreeIds.has(rename.path))
    ) {
      return;
    }
    if (!rename || !renameValue.trim() || renameValue === rename.currentName) {
      handleRenameCancel();
      return;
    }
    const newPath = parentDir(rename.path)
      ? `${parentDir(rename.path)}/${renameValue.trim()}`
      : renameValue.trim();
    setRenaming(true);
    try {
      const result = await ops.rename(rename.path, newPath);
      if (!result.ok) setOpError(result.error ?? "Rename failed");
    } catch (error) {
      setOpError(error instanceof Error ? error.message : "Rename failed");
    } finally {
      setRenaming(false);
      setRename(null);
    }
  }

  function getContextNodes(node: NodeApi<FsArborNode>): FsArborNode[] {
    if (!isRenderedLiveNode(node.data)) return [];
    const selectedNodes = (
      treeRef.current as
        | (TreeApi<FsArborNode> & { selectedNodes?: NodeApi<FsArborNode>[] })
        | undefined
    )?.selectedNodes;
    const nodes = selectedNodes?.some((selected) => selected.id === node.id)
      ? selectedNodes.map((selected) => selected.data)
      : [node.data];
    return normalizeOperationNodes(nodes).filter((candidate) =>
      renderedLiveTreeIds.has(candidate.id),
    );
  }

  function handleDeleteStart(nodes: FsArborNode[]) {
    if (isLanguageMode) return;
    const liveNodes = nodes.filter(isRenderedLiveNode);
    if (liveNodes.length === 0) return;
    setDeleteState({
      nodes: liveNodes,
      loading: false,
    });
  }

  function handleDeleteConfirm() {
    if (
      !deleteState ||
      deleteState.loading ||
      isLanguageMode ||
      deleteState.nodes.some((node) => !isRenderedLiveNode(node))
    ) {
      return;
    }
    setDeleteState((s) => (s ? { ...s, loading: true } : null));
    void (async () => {
      const failures: string[] = [];
      try {
        for (const node of deleteState.nodes) {
          try {
            const result = await ops.deleteEntry(node.id);
            if (!result.ok)
              failures.push(`${node.name}: ${result.error ?? "Delete failed"}`);
          } catch (error) {
            failures.push(
              `${node.name}: ${error instanceof Error ? error.message : "Delete failed"}`,
            );
          }
        }
      } finally {
        if (failures.length > 0) setOpError(failures.join("; "));
        setDeleteState(null);
      }
    })();
  }

  function handleDeleteCancel() {
    if (!deleteState?.loading) setDeleteState(null);
  }

  function handleDownload(node: FsArborNode) {
    if (!isRenderedLiveNode(node) || node.kind !== "file") return;
    if (pendingDownloadsRef.current.has(node.id)) return;
    pendingDownloadsRef.current.add(node.id);
    void ops
      .download(node.id, node.size)
      .catch((error) => {
        setOpError(error?.message ?? "Download failed");
      })
      .finally(() => pendingDownloadsRef.current.delete(node.id));
  }

  function handleUploadHere(node: FsArborNode) {
    if (!isRenderedLiveNode(node)) return;
    setUploadDir(node.kind === "dir" ? node.id : parentDir(node.id));
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (isLanguageMode) return;
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    for (const file of files) {
      void upload(uploadDir, file);
    }
    e.target.value = "";
  }

  function handleDropzoneDrop(dir: string, files: File[]) {
    if (isLanguageMode) return;
    for (const file of files) {
      void upload(dir, file);
    }
  }

  async function handleMove({
    dragIds,
    parentId,
    parentNode,
  }: {
    dragIds: string[];
    parentId: string | null;
    parentNode: NodeApi<FsArborNode> | null;
  }) {
    if (isLanguageMode) return;
    if (
      (parentNode && !isRenderedLiveNode(parentNode.data)) ||
      (parentId && !renderedLiveTreeIds.has(parentId))
    ) {
      return;
    }
    // Drop on file → use its parent dir as target
    let destDir = parentId ?? "";
    if (parentNode && parentNode.data.kind !== "dir") {
      destDir = parentDir(parentNode.data.id);
    }

    const sourcePaths = normalizeOperationPaths(dragIds).filter((id) =>
      renderedLiveTreeIds.has(id),
    );
    const failures: string[] = [];
    for (const srcPath of sourcePaths) {
      const name = srcPath.split("/").pop()!;
      const newPath = destDir ? `${destDir}/${name}` : name;
      if (srcPath === newPath) continue;
      try {
        const result = await ops.move(srcPath, newPath);
        if (!result.ok)
          failures.push(`${name}: ${result.error ?? "Move failed"}`);
      } catch (error) {
        failures.push(
          `${name}: ${error instanceof Error ? error.message : "Move failed"}`,
        );
      }
    }
    if (failures.length > 0) setOpError(failures.join("; "));
  }

  const [treeBodyHeight, setTreeBodyHeight] = useState(0);
  const [treeBodyWidth, setTreeBodyWidth] = useState(0);

  // Measure the tree body's pixel dimensions so react-arborist can virtualize correctly.
  // Auto-sizing via CSS alone is unreliable when dimensions flow through multiple flex layers.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setTreeBodyHeight(entry.contentRect.height);
      setTreeBodyWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!onOpenTerminal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.shiftKey &&
        e.key === "Enter" &&
        containerRef.current?.contains(document.activeElement)
      ) {
        e.preventDefault();
        onOpenTerminal!();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenTerminal]);

  return (
    <>
      <UploadDropzone
        currentDir={path}
        onDrop={handleDropzoneDrop}
        progress={progress}
        disabled={isLanguageMode}
        className={cn("flex flex-col h-full", className)}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[10px] font-bold tracking-widest text-[var(--color-text-muted)] uppercase">
              Explorer
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                setNewItemDialog({ open: true, type: "file", parentPath: "" })
              }
              title="New File in project root"
              aria-label="New File in project root"
              disabled={isLanguageMode}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-40"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                setNewItemDialog({ open: true, type: "folder", parentPath: "" })
              }
              title="New Folder in project root"
              aria-label="New Folder in project root"
              disabled={isLanguageMode}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-40"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void refetch()}
              title="Refresh file tree"
              aria-label="Refresh file tree"
              disabled={isFetching || isLanguageMode}
              className="shrink-0 p-1 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={cn("h-3 w-3", isFetching && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={() => saveDebounced({ explorerShowHidden: !showHidden })}
              title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
              className={cn(
                "shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm transition-colors",
                showHidden
                  ? "text-[var(--color-primary)] bg-[var(--color-primary)]/10"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              .*
            </button>
          </div>
        </div>

        {/* Project label */}
        <div className="px-2 py-1 shrink-0 flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-wide uppercase truncate">
            {project}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {isEncryptEnabled(project) && (
              <button
                type="button"
                onClick={() => {
                  if (!isLanguageMode) setEncUploadOpen(true);
                }}
                title="Encrypted file upload"
                disabled={isLanguageMode}
                className="p-1 rounded-sm text-[var(--color-accent,#7c6aff)] hover:bg-[var(--color-accent,#7c6aff)]/10 transition-colors disabled:pointer-events-none disabled:opacity-40"
              >
                <Upload size={13} />
              </button>
            )}
            {!isLanguageMode && <LockToggle project={project} />}
          </div>
        </div>

        {/* Explicit project-wide scan controls. The preference is persisted,
            while scan results remain in-memory and are never auto-fetched. */}
        <div className="border-b border-[var(--color-border)] px-2 pb-2 shrink-0">
          <label
            htmlFor={languageFilterId}
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
          >
            Filter Explorer by language
          </label>
          <div className="flex items-center gap-1.5">
            <select
              id={languageFilterId}
              aria-label="Filter Explorer by language"
              value={languageFilter}
              onChange={(event) => {
                const next = event.target.value;
                if (!isExplorerLanguageFilter(next)) return;
                clearTreeSelection();
                saveDebounced({ explorerLanguageFilter: next });
              }}
              className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-[11px] text-[var(--color-text)] outline-none transition-colors focus-visible:border-[var(--color-primary)] focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
            >
              {(
                Object.keys(LANGUAGE_FILTER_LABELS) as ExplorerLanguageFilter[]
              ).map((value) => (
                <option key={value} value={value}>
                  {LANGUAGE_FILTER_LABELS[value]}
                </option>
              ))}
            </select>
            {isLanguageMode && (
              <button
                type="button"
                onClick={() => {
                  scan.reset();
                  void scan.mutateAsync().catch(() => undefined);
                }}
                disabled={scan.isPending}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm bg-[var(--color-primary)]/10 px-2 text-[10px] font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50"
              >
                {scan.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                {languageScanCache?.result ? "Rescan" : "Scan"}
              </button>
            )}
          </div>
          {isLanguageMode && languageScanCache?.scannedAt && (
            <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
              Last scanned {formatScanTime(languageScanCache.scannedAt)}
            </p>
          )}
          {isLanguageMode && languageScanCache?.stale && (
            <p className="mt-1 text-[10px] text-amber-300" role="status">
              Results may be outdated. Rescan to refresh.
            </p>
          )}
          {isLanguageMode && scan.isPending && languageScanCache?.result && (
            <p
              className="mt-1 text-[10px] text-[var(--color-primary)]"
              role="status"
            >
              Rescanning project… current results remain available.
            </p>
          )}
          {isLanguageMode && languageScanCache?.result?.truncated && (
            <p className="mt-1 text-[10px] text-amber-300" role="status">
              Showing first {languageScanCache.result.limit.toLocaleString()}{" "}
              matching files.
            </p>
          )}
          {isLanguageMode && scan.isError && (
            <p className="mt-1 text-[10px] text-red-400" role="alert">
              {scan.error instanceof Error ? scan.error.message : "Scan failed"}
            </p>
          )}
        </div>

        {/* Tree body — overflow-hidden and flex-1 to consume full space */}
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
          {!isLanguageMode && isLoading && (
            <div className="flex items-center justify-center h-16 gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {!isLanguageMode && isError && (
            <div className="px-3 py-2 text-xs text-red-400">
              {error instanceof Error ? error.message : "Failed to load"}
            </div>
          )}
          {isLanguageMode && !languageScanCache?.result && !scan.isPending && (
            <div className="flex h-24 flex-col items-center justify-center gap-1 px-3 text-center text-xs text-[var(--color-text-muted)]">
              <span>
                Scan project to show {LANGUAGE_FILTER_LABELS[languageFilter]}{" "}
                files
              </span>
              <span className="text-[10px]">
                Use Scan above to build a navigation-only view.
              </span>
            </div>
          )}
          {isLanguageMode && scan.isPending && !languageScanCache?.result && (
            <div
              className="flex h-24 items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning project…
            </div>
          )}
          {isLanguageMode &&
            languageScanCache?.result &&
            languageNodes.length === 0 &&
            !scan.isPending && (
              <div className="flex h-24 items-center justify-center px-3 text-center text-xs text-[var(--color-text-muted)]">
                No {LANGUAGE_FILTER_LABELS[languageFilter]} files found.
              </div>
            )}
          {(!isLanguageMode ? data : languageScanCache?.result) && (
            <Tree<FsArborNode>
              key={treeKey}
              ref={treeRef}
              data={renderedNodes}
              childrenAccessor={childrenAccessor}
              openByDefault={false}
              onActivate={handleActivate}
              onMove={isLanguageMode ? undefined : handleMove}
              disableDrag={(node) =>
                isLanguageMode || isLoadingSentinel(node.id)
              }
              disableDrop={({ parentNode, dragNodes }) => {
                if (isLanguageMode) return true;
                if (!parentNode?.data) return false;
                if (isLoadingSentinel(parentNode.data.id)) return true;
                // Prevent drop onto self or descendant
                return dragNodes.some(
                  (d) =>
                    d.data?.id === parentNode.data.id ||
                    parentNode.data.id.startsWith((d.data?.id ?? "") + "/"),
                );
              }}
              disableEdit
              indent={16}
              rowHeight={24}
              overscanCount={8}
              height={treeBodyHeight || undefined}
              width={treeBodyWidth || undefined}
            >
              {(props) => {
                const node = (
                  <NodeRenderer
                    {...props}
                    gitState={gitIndex.files.get(props.node.data.id)}
                    hasChangedDescendant={gitIndex.changedDirs.has(
                      props.node.data.id,
                    )}
                    onOpenDiff={(state) =>
                      openDiff(
                        project,
                        state.path,
                        state.status,
                        state.additions,
                        state.deletions,
                        undefined,
                        state.rootId,
                        state.rootRelativePath,
                      )
                    }
                  />
                );
                if (isLanguageMode) return node;
                return (
                  <TreeContextMenu
                    isDir={props.node.data.kind === "dir"}
                    onCopyAbsolutePath={() =>
                      handleCopyAbsolutePath(props.node.data)
                    }
                    onCopyRelativePath={() =>
                      handleCopyRelativePath(props.node.data)
                    }
                    absolutePathDisabled={!projectRoot}
                    onNewFile={() => handleNewFile(props.node.data)}
                    onNewFolder={() => handleNewFolder(props.node.data)}
                    onRename={() => handleRenameStart(props.node.data)}
                    onDelete={() =>
                      handleDeleteStart(getContextNodes(props.node))
                    }
                    onDownload={() => handleDownload(props.node.data)}
                    onUpload={() => handleUploadHere(props.node.data)}
                  >
                    {node}
                  </TreeContextMenu>
                );
              }}
            </Tree>
          )}
        </div>

        {/* Op error toast */}
        {opError && (
          <div
            className="absolute bottom-2 left-2 right-2 z-10 rounded px-2 py-1.5 text-[10px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 cursor-pointer"
            onClick={() => setOpError(null)}
          >
            {opError}
          </div>
        )}

        {copied && (
          <div className="absolute bottom-2 left-2 right-2 z-10 rounded px-2 py-1.5 text-[10px] text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20">
            Copied to clipboard
          </div>
        )}

        {/* Hidden file input for upload */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* Delete confirm dialog */}
        <ConfirmDeleteDialog
          open={!!deleteState}
          paths={deleteState?.nodes.map((node) => node.id) ?? []}
          hasDirectory={
            deleteState?.nodes.some((node) => node.kind === "dir") ?? false
          }
          loading={deleteState?.loading ?? false}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />

        {/* New file/folder dialog */}
        <NewItemDialog
          open={!!newItemDialog}
          type={newItemDialog?.type ?? "file"}
          onConfirm={handleNewItemConfirm}
          onCancel={() => setNewItemDialog(null)}
        />

        <RenameItemDialog
          open={!!rename}
          value={renameValue}
          onValueChange={setRenameValue}
          onConfirm={handleRenameSubmit}
          onCancel={handleRenameCancel}
          pending={renaming}
        />

        {/* Progress done — clear after a moment */}
        {progress?.done && !progress.error && (
          <button
            className="hidden"
            ref={(el) => {
              if (el) setTimeout(clearProgress, 2000);
            }}
          />
        )}
      </UploadDropzone>

      {encUploadOpen && (
        <EncryptedUploadDialog
          project={project}
          dir={uploadDir}
          onClose={() => setEncUploadOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parentDir(nodePath: string): string {
  const parts = nodePath.split("/");
  parts.pop();
  return parts.join("/");
}

function formatScanTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toLocaleString();
  }
}

/** Keep a bulk operation from acting on a selected child after its ancestor. */
function normalizeOperationPaths(paths: string[]): string[] {
  return [...new Set(paths)]
    .sort((left, right) => left.localeCompare(right))
    .filter(
      (path, _index, all) =>
        !all.some(
          (candidate) => candidate !== path && path.startsWith(`${candidate}/`),
        ),
    );
}

function normalizeOperationNodes(nodes: FsArborNode[]): FsArborNode[] {
  const byPath = new Map(nodes.map((node) => [node.id, node]));
  return normalizeOperationPaths(nodes.map((node) => node.id)).flatMap(
    (path) => {
      const node = byPath.get(path);
      return node ? [node] : [];
    },
  );
}

/** Walk the tree and collect IDs of dirs that were expanded but now have unloaded children. */
function collectUnloadedExpanded(
  nodes: FsArborNode[],
  expanded: Set<string>,
): string[] {
  const result: string[] = [];
  for (const n of nodes) {
    if (n.kind !== "dir") continue;
    if (expanded.has(n.id) && n.children === null) {
      result.push(n.id);
    } else if (n.children) {
      result.push(...collectUnloadedExpanded(n.children, expanded));
    }
  }
  return result;
}
