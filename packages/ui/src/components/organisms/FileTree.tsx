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
import type { NodeApi, NodeRendererProps, RowRendererProps, TreeApi } from "react-arborist";
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
import { getFileTreeRowHeight } from "@/lib/workbench-typography.js";
import { cn } from "@/lib/utils.js";
import { FileDecorationIcon } from "@/lib/file-decoration-icon.js";
import { useFsSubscription, resolveSubscriptionTransport, spliceChildren } from "@/hooks/use-fs-subscription.js";
import { useFsOps } from "@/hooks/use-fs-ops.js";
import { useFsUpload } from "@/hooks/use-fs-upload.js";
import { isHtmlFile } from "@/lib/html-file.js";
import { saveHtmlViewMode } from "@/lib/html-view-mode-persistence.js";
import type { FsArborNode, FsListResponse } from "@/api/fs-types.js";
import type { ProjectTargetInput, ProjectTargetRef } from "@/api/client.js";
import { toServerFsTarget, type FsTargetRef } from "@/api/ownership.js";
import { TreeContextMenu } from "./TreeContextMenu.js";
import { UploadDropzone } from "./UploadDropzone.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { NewItemDialog } from "./NewItemDialog.js";
import { RenameItemDialog } from "./RenameItemDialog.js";
import { MarkProjectDialog } from "./MarkProjectDialog.js";
import { UnmarkProjectDialog } from "./UnmarkProjectDialog.js";
import { LockToggle } from "@/components/atoms/LockToggle.js";
import { EncryptedUploadDialog } from "@/components/organisms/EncryptedUploadDialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useEditorStore } from "@/stores/editor.js";
import {
  explorerTreeScopeKey,
  useExplorerTreeStore,
} from "@/stores/explorer-tree.js";
import {
  useExplorerLanguageScan,
  useGitDiff,
  useProject,
  useProjects,
  useWorkspaceStatus,
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
    isProject?: boolean;
    onOpenDiff?: (state: GitFileState) => void;
    onFileOpen?: (node: FsArborNode) => void;
    onToggleDir?: (node: NodeApi<FsArborNode>) => void;
    isLanguageMode?: boolean;
  };

const NodeRenderer = forwardRef<HTMLDivElement, NodeRendererWithContextProps>(
  function NodeRenderer(
    {
      node,
      tree: _tree,
      style,
      dragHandle,
      gitState,
      hasChangedDescendant,
      isProject,
      onOpenDiff,
      onContextMenu,
      onFileOpen,
      onToggleDir,
      isLanguageMode,
      ...domProps
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
          {...domProps}
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
        {...domProps}
        ref={combinedRef}
        style={style}
        data-testid={`file-tree-item-${node.data.id}`}
        className={cn(
          "flex items-center gap-1.5 px-1 py-0.5 cursor-pointer rounded-sm select-none",
          "hover:bg-[var(--color-surface-2)] text-xs",
          node.isSelected
            ? "workbench-selection"
            : "text-[var(--color-text)]",
          node.isFocused &&
            "outline outline-1 outline-[var(--color-primary)]/70",
          isHidden && "opacity-50",
          node.isDragging && "opacity-40",
          node.willReceiveDrop &&
            "bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]",
        )}
        onContextMenu={onContextMenu}
        onClick={(e) => {
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey) {
            node.isSelected ? node.deselect() : node.selectMulti();
          } else if (e.shiftKey) {
            node.selectContiguous();
          } else {
            node.select();
            if (isDir) {
              onToggleDir?.(node);
            } else if (isLanguageMode && node.data.kind === "file") {
              onFileOpen?.(node.data);
            }
          }
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isLoadingSentinel(node.data.id)) return;
          if (node.data.kind === "file") {
            onFileOpen?.(node.data);
          }
        }}
      >
        <span
          className="w-4 shrink-0 flex items-center justify-center cursor-pointer hover:text-[var(--color-text)]"
          onClick={(e) => {
            e.stopPropagation();
            onToggleDir?.(node);
          }}
        >
          {isDir ? (
            node.isOpen ? (
              <ChevronDown className="h-3 w-3 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronRight className="h-3 w-3 text-[var(--color-text-muted)]" />
            )
          ) : null}
        </span>

        <span
          className={cn(isDir && "cursor-pointer")}
          onClick={(e) => {
            if (isDir) {
              e.stopPropagation();
              onToggleDir?.(node);
            }
          }}
        >
          <TreeNodeIcon
            path={getNodeDecorationPath(node.data)}
            isDir={isDir}
            isOpen={node.isOpen}
          />
        </span>
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

        {isDir && isProject && (
          <span
            data-testid="project-badge"
            className="px-1 py-0 text-[10px] font-semibold rounded bg-[var(--color-primary)]/20 text-[var(--color-primary)] border border-[var(--color-primary)]/30 shrink-0"
            title="Marked project"
          >
            [Project]
          </span>
        )}
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
                "h-4 min-w-4 rounded-[2px] border px-0.5 text-2xs font-black leading-none",
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
            <span className="text-2xs text-[var(--color-text-muted)] opacity-60">
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

export interface FileTreeProps {
  project?: string;
  target?: FsTargetRef | ProjectTargetRef;
  mode?: "workspace" | "projects";
  projectFilter?: string;
  onReturnToWorkspace?: () => void;
  path?: string;
  onFileOpen?: (node: FsArborNode) => void;
  onOpenTerminal?: (cwd?: string) => void;
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
  project = "",
  target,
  mode,
  projectFilter,
  onReturnToWorkspace,
  path = "",
  onFileOpen,
  onOpenTerminal,
  className,
  revealRequest,
}: FileTreeProps) {
  const resolvedMode =
    mode ??
    (target && "kind" in target && target.kind === "workspace"
      ? "workspace"
      : project
        ? "projects"
        : "workspace");
  const isWorkspaceMode = resolvedMode === "workspace";
  const { data: projects = [] } = useProjects({ profileId: target?.profileId });

  const targetProject = (target && "project" in target ? target.project : project)?.trim();
  const worktreePath = target && "worktreePath" in target ? target.worktreePath : undefined;
  const isProjectsAll =
    resolvedMode === "projects" && (!targetProject || projectFilter === "all");

  const { data: wsStatus } = useWorkspaceStatus(
    target?.profileId ? { profileId: target.profileId } : undefined,
  );

  const requestTarget = useMemo<FsTargetRef>(() => {
    if (isWorkspaceMode) {
      const explicitEpoch =
        target && "workspaceEpoch" in target && typeof target.workspaceEpoch === "number"
          ? target.workspaceEpoch
          : undefined;
      const epoch = explicitEpoch ?? wsStatus?.workspaceEpoch;
      if (target && "kind" in target && target.kind === "workspace") {
        return epoch !== undefined && target.workspaceEpoch !== epoch
          ? { ...target, workspaceEpoch: epoch }
          : target;
      }
      return {
        kind: "workspace" as const,
        profileId: target?.profileId ?? "",
        ...(epoch !== undefined ? { workspaceEpoch: epoch } : {}),
      };
    }
    if (target && "kind" in target) {
      if (target.kind === "workspace") return target;
      return target;
    }
    if (isProjectsAll || !targetProject) {
      return { kind: "project" as const, project: "", profileId: target?.profileId ?? "" };
    }
    return worktreePath == null
      ? { kind: "project" as const, project: targetProject, profileId: target?.profileId ?? "" }
      : { kind: "project" as const, project: targetProject, worktreePath, profileId: target?.profileId ?? "" };
  }, [isWorkspaceMode, target, targetProject, worktreePath, wsStatus?.workspaceEpoch]);
  const scopeKey = useMemo(
    () => explorerTreeScopeKey(requestTarget),
    [requestTarget],
  );
  const settings = useSettingsStore();
  const showHidden = settings?.explorerShowHidden ?? false;
  const configuredLanguageFilter = settings?.explorerLanguageFilter ?? "all";
  const systemFontSize =
    typeof settings?.systemFontSize === "number" ? settings.systemFontSize : 14;
  const saveDebounced = settings?.saveDebounced;
  const rowHeight = useMemo(
    () => getFileTreeRowHeight(systemFontSize),
    [systemFontSize],
  );
  const languageFilter: ExplorerLanguageFilter = isExplorerLanguageFilter(
    configuredLanguageFilter,
  )
    ? configuredLanguageFilter
    : "all";
  const isLanguageMode = languageFilter !== "all";
  const languageFilterId = useId();
  const [encUploadOpen, setEncUploadOpen] = useState(false);
  const { data, isLoading, isError, error, loadChildren, refetch, isFetching } =
    useFsSubscription(requestTarget, path, {
      enabled: isWorkspaceMode || (Boolean(targetProject) && !isProjectsAll),
    });
  const projectTargetInput: ProjectTargetInput = useMemo(
    () => ({
      project: isWorkspaceMode ? "" : (targetProject || ""),
      worktreePath: worktreePath ?? undefined,
      profileId: target?.profileId,
    }),
    [isWorkspaceMode, targetProject, worktreePath, target?.profileId],
  );
  const languageScan = useExplorerLanguageScan(projectTargetInput);
  const { cache: languageScanCache, scan } = languageScan;
  const { data: gitDiff } = useGitDiff(projectTargetInput, "*");
  const openDiff = useEditorStore((s) => s.openDiff);
  const ops = useFsOps(requestTarget, path);
  const { progress, upload, clearProgress } = useFsUpload(requestTarget, path);
  const { isEncryptEnabled } = useEncryptMode();
  const { data: projectData } = useProject(targetProject, target?.profileId);
  const projectRoot = worktreePath ?? projectData?.path ?? "";
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
  const [markDialog, setMarkDialog] = useState<{
    open: boolean;
    folderPath: string;
  } | null>(null);
  const [unmarkDialog, setUnmarkDialog] = useState<{
    open: boolean;
    projectName: string;
  } | null>(null);

  const projectPathMap = useMemo(() => {
    const map = new Map<string, (typeof projects)[number]>();
    for (const p of projects) {
      if (p.path) {
        const norm = p.path.replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
        map.set(norm, p);
      }
      map.set(p.name, p);
    }
    return map;
  }, [projects]);

  const [allProjectsChildren, setAllProjectsChildren] = useState<
    Record<string, FsArborNode[]>
  >({});

  const loadProjectChildren = useCallback(
    async (nodeId: string) => {
      const parts = nodeId.split("/");
      const projectName = parts[0];
      const relPath = parts.slice(1).join("/");
      const proj = projects.find((p) => p.name === projectName);
      if (!proj) return [];
      const projectTarget: FsTargetRef = {
        kind: "project",
        project: projectName,
        profileId: (requestTarget as FsTargetRef).profileId,
      };
      const t = resolveSubscriptionTransport(projectTarget);
      const wire = toServerFsTarget(projectTarget);
      const resp = await t.invoke<FsListResponse>("fs:list", {
        target: wire,
        path: relPath,
      });
      const children: FsArborNode[] = resp.entries.map((e) => ({
        id: nodeId + "/" + e.name,
        name: e.name,
        kind: e.kind,
        size: e.size,
        mtime: e.mtime,
        isSymlink: e.isSymlink,
        children: null,
      }));
      setAllProjectsChildren((prev) => {
        const rootNodes = prev[projectName] ?? [];
        if (nodeId === projectName) {
          return { ...prev, [projectName]: children };
        }
        return {
          ...prev,
          [projectName]: spliceChildren(rootNodes, nodeId, children),
        };
      });
      return children;
    },
    [projects, requestTarget],
  );

  const inFlightLoadsRef = useRef<Map<string, Promise<FsArborNode[]>>>(new Map());

  const effectiveLoadChildren = useCallback(
    (nodeId: string): Promise<FsArborNode[]> => {
      const loadKey = `${scopeKey}:${nodeId}`;
      const existing = inFlightLoadsRef.current.get(loadKey);
      if (existing) {
        return existing;
      }
      const promise = (async () => {
        try {
          if (isProjectsAll) {
            return await loadProjectChildren(nodeId);
          }
          return await loadChildren(nodeId);
        } finally {
          inFlightLoadsRef.current.delete(loadKey);
        }
      })();
      inFlightLoadsRef.current.set(loadKey, promise);
      return promise;
    },
    [scopeKey, isProjectsAll, loadProjectChildren, loadChildren],
  );

  const allProjectNodes: FsArborNode[] = useMemo(() => {
    return projects.map((p) => ({
      id: p.name,
      name: p.name,
      kind: "dir" as const,
      size: 0,
      mtime: 0,
      isSymlink: false,
      children: allProjectsChildren[p.name] ?? null,
    }));
  }, [projects, allProjectsChildren]);
  const handledRevealNonceRef = useRef<number | null>(null);
  const treeRef = useRef<TreeApi<FsArborNode> | undefined>(undefined);
  const pendingRevealRef = useRef<FileTreeRevealRequest | null>(null);
  const pendingDownloadsRef = useRef(new Set<string>());
  const liveTreeCommitVersionRef = useRef(0);
  const liveTreeCommitWaitersRef = useRef<Set<() => void>>(new Set());

  const openMap = useExplorerTreeStore((s) => s.openMapByTarget[scopeKey]);
  const setFolderOpen = useExplorerTreeStore((s) => s.setFolderOpen);
  const prunePath = useExplorerTreeStore((s) => s.prunePath);
  const renamePath = useExplorerTreeStore((s) => s.renamePath);

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
    const targetOpenMap =
      useExplorerTreeStore.getState().openMapByTarget[scopeKey] ?? {};
    const openIds = new Set(
      Object.entries(targetOpenMap)
        .filter(([, isOpen]) => Boolean(isOpen))
        .map(([id]) => id),
    );
    if (openIds.size === 0) return;
    const unloaded = collectUnloadedExpanded(data.nodes, openIds);
    for (const id of unloaded) {
      void effectiveLoadChildren(id).catch(() => {
        prunePath(scopeKey, id);
      });
    }
  }, [data, isLanguageMode, effectiveLoadChildren, prunePath, scopeKey]);

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
      loadChildren: effectiveLoadChildren,
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
    effectiveLoadChildren,
    project,
    revealRequest,
    saveDebounced,
    waitForLiveTreeCommitAfter,
  ]);

  const rawNodes = isProjectsAll ? allProjectNodes : (data?.nodes ?? []);

  const visibleNodes = useMemo(
    () =>
      showHidden
        ? rawNodes
        : rawNodes.filter((n) => !n.name.startsWith(".")),
    [rawNodes, showHidden],
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
    ? `${scopeKey}:${languageFilter}:${showHidden}:${languageScanCache?.resultVersion ?? -1}`
    : `${scopeKey}:all:${showHidden}`;
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

  const handleToggleDir = useCallback(
    (node: NodeApi<FsArborNode>) => {
      const isCurrentlyOpen = treeRef.current?.isOpen(node.data.id) ?? node.isOpen;
      const willOpen = !isCurrentlyOpen;

      setFolderOpen(scopeKey, node.data.id, willOpen);

      if (willOpen) {
        treeRef.current?.open(node.data.id);
        if (!isLanguageMode && node.data.children === null) {
          void effectiveLoadChildren(node.data.id)
            .then(() => {
              const currentIsOpen =
                useExplorerTreeStore.getState().openMapByTarget[scopeKey]?.[node.data.id];
              if (currentIsOpen) {
                treeRef.current?.open(node.data.id);
              }
            })
            .catch(() => {
              prunePath(scopeKey, node.data.id);
            });
        }
      } else {
        treeRef.current?.close(node.data.id);
      }
    },
    [isLanguageMode, effectiveLoadChildren, prunePath, scopeKey, setFolderOpen],
  );

  function handleActivate(node: NodeApi<FsArborNode>) {
    if (isLoadingSentinel(node.data.id)) return;
    if (node.data.kind === "file") {
      onFileOpen?.(node.data);
    } else {
      handleToggleDir(node);
    }
  }

  const RowRenderer = useCallback(
    ({ node, innerRef, attrs, children }: RowRendererProps<FsArborNode>) => {
      return (
        <div
          {...attrs}
          ref={innerRef}
          onFocus={(e) => e.stopPropagation()}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              node.isSelected ? node.deselect() : node.selectMulti();
            } else if (e.shiftKey) {
              node.selectContiguous();
            } else {
              node.select();
              if (node.data.kind === "dir") {
                handleToggleDir(node);
              } else if (isLanguageMode && node.data.kind === "file") {
                onFileOpen?.(node.data);
              }
            }
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isLoadingSentinel(node.data.id)) return;
            if (node.data.kind === "file") {
              onFileOpen?.(node.data);
            }
          }}
        >
          {children}
        </div>
      );
    },
    [handleToggleDir, onFileOpen],
  );

  function handleCopyAbsolutePath(node: FsArborNode) {
    if (isLanguageMode || isLoadingSentinel(node.id)) return;
    const { absolutePath } = buildTreeCopyPaths({
      projectRoot,
      subPath: path,
      nodeId: node.id,
    });
    void copy(absolutePath);
  }

  function handleCopyRelativePath(node: FsArborNode) {
    if (isLanguageMode || isLoadingSentinel(node.id)) return;
    const { relativePath } = buildTreeCopyPaths({
      projectRoot,
      subPath: path,
      nodeId: node.id,
    });
    void copy(relativePath);
  }

  function handlePreview(node: FsArborNode) {
    if (
      !isRenderedLiveNode(node) ||
      node.kind !== "file" ||
      node.size >= 5 * 1024 * 1024
    ) {
      return;
    }
    saveHtmlViewMode("preview");
    onFileOpen?.(node);
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
    if (isLanguageMode || isLoadingSentinel(node.id)) return;
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
      (rename && isLoadingSentinel(rename.path))
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
      if (!result.ok) {
        setOpError(result.error ?? "Rename failed");
      } else {
        renamePath(scopeKey, rename.path, newPath);
      }
    } catch (error) {
      setOpError(error instanceof Error ? error.message : "Rename failed");
    } finally {
      setRenaming(false);
      setRename(null);
    }
  }

  function getContextNodes(node: NodeApi<FsArborNode>): FsArborNode[] {
    if (isLanguageMode || isLoadingSentinel(node.data.id)) return [];
    const selectedNodes = (
      treeRef.current as
        | (TreeApi<FsArborNode> & { selectedNodes?: NodeApi<FsArborNode>[] })
        | undefined
    )?.selectedNodes;
    const nodes = selectedNodes?.some((selected) => selected.id === node.id)
      ? selectedNodes.map((selected) => selected.data)
      : [node.data];
    return normalizeOperationNodes(nodes).filter((candidate) =>
      !isLoadingSentinel(candidate.id),
    );
  }

  function handleDeleteStart(nodes: FsArborNode[]) {
    if (isLanguageMode) return;
    const liveNodes = nodes.filter((n) => !isLoadingSentinel(n.id));
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
            if (!result.ok) {
              failures.push(`${node.name}: ${result.error ?? "Delete failed"}`);
            } else {
              prunePath(scopeKey, node.id);
            }
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
    if (isLanguageMode || isLoadingSentinel(node.id) || node.kind !== "file") return;
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
    if (isLanguageMode || isLoadingSentinel(node.id)) return;
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
        if (!result.ok) {
          failures.push(`${name}: ${result.error ?? "Move failed"}`);
        } else {
          renamePath(scopeKey, srcPath, newPath);
        }
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
    function onKeyDown(e: KeyboardEvent) {
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (
        e.shiftKey &&
        e.key === "Enter" &&
        onOpenTerminal
      ) {
        e.preventDefault();
        onOpenTerminal();
        return;
      }
      if (
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key === "Enter" &&
        !rename &&
        !renaming &&
        !newItemDialog
      ) {
        const focused = treeRef.current?.focusedNode;
        if (focused && !isLoadingSentinel(focused.data.id)) {
          e.preventDefault();
          e.stopPropagation();
          if (focused.data.kind === "file") {
            onFileOpen?.(focused.data);
          } else {
            handleToggleDir(focused);
          }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    handleToggleDir,
    newItemDialog,
    onFileOpen,
    onOpenTerminal,
    rename,
    renaming,
  ]);

  if (isProjectsAll && projects.length === 0) {
    return (
      <div
        data-testid="no-marked-projects"
        className={cn(
          "flex flex-col items-center justify-center h-full p-4 text-center text-xs text-[var(--color-text-muted)] gap-2 select-none",
          className,
        )}
      >
        <Folder className="h-8 w-8 text-[var(--color-text-muted)] opacity-40" />
        <span className="font-medium text-[var(--color-text)]">No marked projects</span>
        {onReturnToWorkspace && (
          <button
            type="button"
            data-testid="return-to-workspace-btn"
            onClick={onReturnToWorkspace}
            className="mt-2 px-3 py-1 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Return to Workspace
          </button>
        )}
      </div>
    );
  }

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
            <span className="shrink-0 text-2xs font-bold tracking-widest text-[var(--color-text-muted)] uppercase">
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
                "shrink-0 text-2xs px-1.5 py-0.5 rounded-sm transition-colors",
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
          <span className="text-xs font-semibold text-[var(--color-text-muted)] tracking-wide uppercase truncate">
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
            className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
          >
            Filter Explorer by language
          </label>
          <div className="flex items-center gap-1.5">
            <Select
              value={languageFilter}
              onValueChange={(next) => {
                if (!isExplorerLanguageFilter(next)) return;
                clearTreeSelection();
                saveDebounced({ explorerLanguageFilter: next });
              }}
            >
              <SelectTrigger
                id={languageFilterId}
                aria-label="Filter Explorer by language"
                className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-xs text-[var(--color-text)] outline-none transition-colors"
              >
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(LANGUAGE_FILTER_LABELS) as ExplorerLanguageFilter[]
                ).map((value) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {LANGUAGE_FILTER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLanguageMode && (
              <button
                type="button"
                onClick={() => {
                  scan.reset();
                  void scan.mutateAsync().catch(() => undefined);
                }}
                disabled={scan.isPending}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm bg-[var(--color-primary)]/10 px-2 text-2xs font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50"
              >
                {scan.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                {languageScanCache?.result ? "Rescan" : "Scan"}
              </button>
            )}
          </div>
          {isLanguageMode && languageScanCache?.scannedAt && (
            <p className="mt-1 text-2xs text-[var(--color-text-muted)]">
              Last scanned {formatScanTime(languageScanCache.scannedAt)}
            </p>
          )}
          {isLanguageMode && languageScanCache?.stale && (
            <p className="mt-1 text-2xs text-amber-300" role="status">
              Results may be outdated. Rescan to refresh.
            </p>
          )}
          {isLanguageMode && scan.isPending && languageScanCache?.result && (
            <p
              className="mt-1 text-2xs text-[var(--color-primary)]"
              role="status"
            >
              Rescanning project… current results remain available.
            </p>
          )}
          {isLanguageMode && languageScanCache?.result?.truncated && (
            <p className="mt-1 text-2xs text-amber-300" role="status">
              Showing first {languageScanCache.result.limit.toLocaleString()}{" "}
              matching files.
            </p>
          )}
          {isLanguageMode && scan.isError && (
            <p className="mt-1 text-2xs text-red-400" role="alert">
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
              <span className="text-2xs">
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
          {(!isLanguageMode ? (isProjectsAll ? allProjectNodes : data) : languageScanCache?.result) && (
            <Tree<FsArborNode>
              key={treeKey}
              ref={treeRef}
              data={renderedNodes}
              childrenAccessor={childrenAccessor}
              openByDefault={false}
              initialOpenState={isLanguageMode ? undefined : openMap}
              onToggle={(id) => {
                if (isLanguageMode || isLoadingSentinel(id)) return;
                const node = treeRef.current?.get(id);
                if (node?.data.kind === "dir") {
                  const isOpen = treeRef.current?.isOpen(id) ?? false;
                  setFolderOpen(scopeKey, id, isOpen);
                  if (isOpen && node.data.children === null) {
                    void effectiveLoadChildren(id)
                      .then(() => {
                        const currentIsOpen =
                          useExplorerTreeStore.getState().openMapByTarget[scopeKey]?.[id];
                        if (currentIsOpen) {
                          treeRef.current?.open(id);
                        }
                      })
                      .catch(() => {
                        prunePath(scopeKey, id);
                      });
                  }
                }
              }}
              renderRow={RowRenderer}
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
              rowHeight={rowHeight}
              overscanCount={8}
              height={treeBodyHeight || undefined}
              width={treeBodyWidth || undefined}
            >
              {(props) => {
                const isDir = props.node.data.kind === "dir";
                const normId = props.node.data.id.replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
                const matchedProject = isDir ? projectPathMap.get(normId) : undefined;
                const isMarked = Boolean(matchedProject);

                const node = (
                  <NodeRenderer
                    {...props}
                    isProject={isMarked}
                    gitState={gitIndex.files.get(props.node.data.id)}
                    hasChangedDescendant={gitIndex.changedDirs.has(
                      props.node.data.id,
                    )}
                    onFileOpen={onFileOpen}
                    onToggleDir={handleToggleDir}
                    isLanguageMode={isLanguageMode}
                    onOpenDiff={(state) =>
                      openDiff(
                        projectTargetInput,
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
                    isDir={isDir}
                    isMarkedProject={isMarked}
                    isHtml={
                      props.node.data.kind === "file" &&
                      props.node.data.size < 5 * 1024 * 1024 &&
                      isHtmlFile(props.node.data.name)
                    }
                    onPreview={() => handlePreview(props.node.data)}
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
                    onOpenTerminalHere={
                      onOpenTerminal
                        ? () => onOpenTerminal(props.node.data.id)
                        : undefined
                    }
                    onMarkProject={() =>
                      setMarkDialog({ open: true, folderPath: props.node.data.id })
                    }
                    onUnmarkProject={() =>
                      setUnmarkDialog({
                        open: true,
                        projectName: matchedProject?.name ?? props.node.data.name,
                      })
                    }
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
            className="absolute bottom-2 left-2 right-2 z-10 rounded px-2 py-1.5 text-2xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 cursor-pointer"
            onClick={() => setOpError(null)}
          >
            {opError}
          </div>
        )}

        {copied && (
          <div className="absolute bottom-2 left-2 right-2 z-10 rounded px-2 py-1.5 text-2xs text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20">
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
          project={isWorkspaceMode ? "" : targetProject}
          target={target && "project" in target ? (target as ProjectTargetRef) : undefined}
          dir={uploadDir}
          onClose={() => setEncUploadOpen(false)}
        />
      )}

      {markDialog?.open && (
        <MarkProjectDialog
          open={markDialog.open}
          folderPath={markDialog.folderPath}
          target={requestTarget as FsTargetRef}
          profileId={(requestTarget as FsTargetRef).profileId}
          onCancel={() => setMarkDialog(null)}
          onSuccess={() => setMarkDialog(null)}
        />
      )}

      {unmarkDialog?.open && (
        <UnmarkProjectDialog
          open={unmarkDialog.open}
          projectName={unmarkDialog.projectName}
          profileId={(requestTarget as FsTargetRef).profileId}
          onCancel={() => setUnmarkDialog(null)}
          onSuccess={() => setUnmarkDialog(null)}
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
