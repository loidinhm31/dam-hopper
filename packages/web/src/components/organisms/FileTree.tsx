import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Tree } from "react-arborist";
import type { NodeApi, NodeRendererProps } from "react-arborist";

const LOADING_SENTINEL_PREFIX = "__loading__:" as const;

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
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  ImageIcon,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Check,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useGitDiff, useGitUntracked, useGitStage, useGitUnstage, useGitDiscard, useGitCommit } from "@/api/queries.js";
import type { DiffFileEntry } from "@/api/client.js";
import { useFsSubscription } from "@/hooks/useFsSubscription.js";
import { useFsOps } from "@/hooks/useFsOps.js";
import { useFsUpload } from "@/hooks/useFsUpload.js";
import type { FsArborNode } from "@/api/fs-types.js";
import { TreeContextMenu } from "./TreeContextMenu.js";
import { UploadDropzone } from "./UploadDropzone.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { NewItemDialog } from "./NewItemDialog.js";
import { LockToggle } from "@/components/atoms/LockToggle.js";
import { EncryptedUploadDialog } from "@/components/organisms/EncryptedUploadDialog.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";

// ---------------------------------------------------------------------------
// File icon mapping (simple extension-based)
// ---------------------------------------------------------------------------

function FileIcon({ name, isDir, isOpen }: { name: string; isDir: boolean; isOpen?: boolean }) {
  if (isDir) {
    return isOpen
      ? <FolderOpen className="h-4 w-4 shrink-0 text-yellow-400" />
      : <Folder className="h-4 w-4 shrink-0 text-yellow-400" />;
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const codeExts = new Set(["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "toml", "yaml", "yml", "json"]);
  const textExts = new Set(["md", "txt", "log", "env", "gitignore", "sh"]);
  const imgExts = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"]);

  if (codeExts.has(ext)) return <FileCode className="h-4 w-4 shrink-0 text-blue-400" />;
  if (imgExts.has(ext)) return <ImageIcon className="h-4 w-4 shrink-0 text-green-400" />;
  if (textExts.has(ext)) return <FileText className="h-4 w-4 shrink-0 text-gray-400" />;
  return <File className="h-4 w-4 shrink-0 text-gray-400" />;
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

interface NodeRendererWithContextProps extends NodeRendererProps<FsArborNode> {
  onContextMenu: (e: React.MouseEvent, node: NodeApi<FsArborNode>) => void;
}

function NodeRenderer({
  node,
  style,
  dragHandle,
  onContextMenu,
}: NodeRendererWithContextProps) {
  if (isLoadingSentinel(node.data.id)) {
    return (
      <div ref={dragHandle} style={style} className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-[var(--color-text-muted)] opacity-40 select-none">
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
      ref={dragHandle}
      style={style}
      className={cn(
        "flex items-center gap-1.5 px-1 py-0.5 cursor-pointer rounded-sm select-none",
        "hover:bg-[var(--color-surface-2)] text-xs",
        node.isSelected ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]" : "text-[var(--color-text)]",
        node.isFocused && !node.isSelected && "outline outline-1 outline-[var(--color-primary)]/40",
        isHidden && "opacity-50",
        node.isDragging && "opacity-40",
        node.willReceiveDrop && "bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]",
      )}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      <span className="w-4 shrink-0 flex items-center justify-center">
        {isDir ? (
          node.isOpen
            ? <ChevronDown className="h-3 w-3 text-[var(--color-text-muted)]" />
            : <ChevronRight className="h-3 w-3 text-[var(--color-text-muted)]" />
        ) : null}
      </span>

      <FileIcon name={node.data.name} isDir={isDir} isOpen={node.isOpen} />

      <span className="truncate" title={isLarge ? `${node.data.name} — large file (read-only preview)` : node.data.name}>
        {node.data.name}
      </span>

      {isLarge && (
        <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-muted)] opacity-60">
          {(node.data.size / (1024 * 1024)).toFixed(0)}MB
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

const CHANGES_SPLIT_KEY = "dam-hopper:filetree-changes-split";

interface FileTreeProps {
  project: string;
  path?: string;
  onFileOpen?: (node: FsArborNode) => void;
  onOpenTerminal?: () => void;
  className?: string;
  selectedDiffFile?: string | null;
  onSelectDiffFile?: (path: string, isConflict: boolean) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FsArborNode;
}

interface RenameState {
  path: string;
  currentName: string;
}

interface DeleteState {
  path: string;
  isDir: boolean;
  loading: boolean;
}

export function FileTree({
  project,
  path = "",
  onFileOpen,
  onOpenTerminal,
  className,
  selectedDiffFile,
  onSelectDiffFile,
}: FileTreeProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [encUploadOpen, setEncUploadOpen] = useState(false);
  const { data, isLoading, isError, error, loadChildren } = useFsSubscription(project, path);
  const ops = useFsOps(project, path);
  const { progress, upload, clearProgress } = useFsUpload(project, path);
  const { isEncryptEnabled } = useEncryptMode();

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [newItemDialog, setNewItemDialog] = useState<{ open: boolean, type: 'file' | 'folder', parentPath: string } | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef<string>("");

  // Track dirs the user has expanded so we can auto-reload them after a refetch
  // wipes children back to null.
  const expandedDirsRef = useRef<Set<string>>(new Set());
  const loadChildrenRef = useRef(loadChildren);
  loadChildrenRef.current = loadChildren;

  useEffect(() => {
    if (!data) return;
    const unloaded = collectUnloadedExpanded(data.nodes, expandedDirsRef.current);
    for (const id of unloaded) {
      void loadChildrenRef.current(id);
    }
  // data identity changes on every refetch/delta — that's exactly when we want to run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const visibleNodes = useMemo(
    () => showHidden
      ? (data?.nodes ?? [])
      : (data?.nodes ?? []).filter((n) => !n.name.startsWith(".")),
    [data, showHidden],
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
      if (node.data.children === null) {
        expandedDirsRef.current.add(node.data.id);
        void loadChildren(node.data.id);
      }
      node.toggle();
    }
  }

  function handleContextMenu(e: React.MouseEvent, node: NodeApi<FsArborNode>) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, node: node.data });
  }

  // ── Context menu actions ────────────────────────────────────────────────

  function handleNewFile() {
    if (!menu) return;
    const dir = menu.node.kind === "dir" ? menu.node.id : parentDir(menu.node.id);
    setNewItemDialog({ open: true, type: "file", parentPath: dir });
  }

  function handleNewFolder() {
    if (!menu) return;
    const dir = menu.node.kind === "dir" ? menu.node.id : parentDir(menu.node.id);
    setNewItemDialog({ open: true, type: "folder", parentPath: dir });
  }

  function handleNewItemConfirm(name: string) {
    if (!newItemDialog) return;
    const { type, parentPath } = newItemDialog;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    const promise = type === "file" ? ops.createFile(fullPath) : ops.createDir(fullPath);

    void promise.then((r) => {
      if (!r.ok) setOpError(r.error ?? "Create failed");
      setNewItemDialog(null);
    });
  }

  function handleRenameStart() {
    if (!menu) return;
    setRenameValue(menu.node.name);
    setRename({ path: menu.node.id, currentName: menu.node.name });
  }

  function handleRenameSubmit() {
    if (!rename || !renameValue.trim() || renameValue === rename.currentName) {
      setRename(null);
      return;
    }
    const newPath = parentDir(rename.path)
      ? `${parentDir(rename.path)}/${renameValue.trim()}`
      : renameValue.trim();
    void ops.rename(rename.path, newPath).then((r) => {
      if (!r.ok) setOpError(r.error ?? "Rename failed");
    });
    setRename(null);
  }

  function handleDeleteStart() {
    if (!menu) return;
    setDeleteState({ path: menu.node.id, isDir: menu.node.kind === "dir", loading: false });
  }

  function handleDeleteConfirm() {
    if (!deleteState) return;
    setDeleteState((s) => s ? { ...s, loading: true } : null);
    void ops.deleteEntry(deleteState.path).then((r) => {
      if (!r.ok) setOpError(r.error ?? "Delete failed");
      setDeleteState(null);
    });
  }

  function handleDownload() {
    if (!menu || menu.node.kind !== "file") return;
    void ops.download(menu.node.id).catch((error) => {
      setOpError(error?.message ?? "Download failed");
    });
  }

  function handleUploadHere() {
    if (!menu) return;
    uploadDirRef.current = menu.node.kind === "dir" ? menu.node.id : parentDir(menu.node.id);
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    for (const file of files) {
      void upload(uploadDirRef.current, file);
    }
    e.target.value = "";
  }

  function handleDropzoneDrop(dir: string, files: File[]) {
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
    const srcPath = dragIds[0];
    if (!srcPath) return;
    const name = srcPath.split("/").pop()!;

    // Drop on file → use its parent dir as target
    let destDir = parentId ?? "";
    if (parentNode && parentNode.data.kind !== "dir") {
      destDir = parentDir(parentNode.data.id);
    }

    const newPath = destDir ? `${destDir}/${name}` : name;
    if (srcPath === newPath) return;
    const result = await ops.move(srcPath, newPath);
    if (!result.ok) setOpError(result.error ?? "Move failed");
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
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

  const [splitPct, setSplitPct] = useState<number>(() => {
    const stored = localStorage.getItem(CHANGES_SPLIT_KEY);
    if (stored) {
      const v = parseInt(stored, 10);
      if (!isNaN(v)) return Math.min(Math.max(v, 20), 80);
    }
    return 60;
  });
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  function handleSplitMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const startY = e.clientY;
    const startPct = splitPct;
    const totalH = container.getBoundingClientRect().height;

    setIsDraggingSplit(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const newPct = Math.min(Math.max(startPct + ((ev.clientY - startY) / totalH) * 100, 20), 80);
      setSplitPct(newPct);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDraggingSplit(false);
      setSplitPct((pct) => {
        localStorage.setItem(CHANGES_SPLIT_KEY, String(Math.round(pct)));
        return pct;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  useEffect(() => {
    if (!onOpenTerminal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.shiftKey && e.key === "Enter" && containerRef.current?.contains(document.activeElement)) {
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
      className={cn("flex flex-col h-full", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <span className="text-[10px] font-bold tracking-widest text-[var(--color-text-muted)] uppercase">
          Explorer
        </span>
        <button
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-sm transition-colors",
            showHidden
              ? "text-[var(--color-primary)] bg-[var(--color-primary)]/10"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          .*
        </button>
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
              onClick={() => setEncUploadOpen(true)}
              title="Encrypted file upload"
              className="p-1 rounded-sm text-[var(--color-accent,#7c6aff)] hover:bg-[var(--color-accent,#7c6aff)]/10 transition-colors"
            >
              <Upload size={13} />
            </button>
          )}
          <LockToggle project={project} />
        </div>
      </div>

      {/* Split container: tree body on top, changes panel on bottom */}
      <div
        ref={splitContainerRef}
        className={cn("flex-1 flex flex-col min-h-0 overflow-hidden", isDraggingSplit && "select-none")}
      >
        {/* Tree body — flex-grow ratio instead of height:% to avoid percentage resolution issues */}
        <div
          ref={containerRef}
          style={{ flexGrow: splitPct, flexShrink: 1, flexBasis: 0 }}
          className="min-h-0 overflow-hidden"
        >
          {isLoading && (
            <div className="flex items-center justify-center h-16 gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {isError && (
            <div className="px-3 py-2 text-xs text-red-400">
              {error instanceof Error ? error.message : "Failed to load"}
            </div>
          )}
          {data && (
            <Tree<FsArborNode>
              data={visibleNodes}
              childrenAccessor={childrenAccessor}
              openByDefault={false}
              onActivate={handleActivate}
              onMove={handleMove}
              disableDrag={(node) => isLoadingSentinel(node.id)}
              disableDrop={({ parentNode, dragNodes }) => {
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
              {(props) => (
                <NodeRenderer
                  {...props}
                  onContextMenu={handleContextMenu}
                />
              )}
            </Tree>
          )}
        </div>

        {/* Vertical resize handle */}
        <div
          onMouseDown={handleSplitMouseDown}
          className={cn(
            "h-1 shrink-0 cursor-row-resize group relative border-t border-[var(--color-border)]",
            "hover:bg-[var(--color-primary)]/20",
            isDraggingSplit && "bg-[var(--color-primary)]/20",
          )}
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Changes panel */}
        <div
          style={{ flexGrow: 100 - splitPct, flexShrink: 1, flexBasis: 0 }}
          className="min-h-0 overflow-hidden flex flex-col"
        >
          <ChangedFilesList
            project={project}
            selectedFile={selectedDiffFile ?? null}
            onSelectFile={onSelectDiffFile ?? (() => {})}
          />
        </div>
      </div>

      {/* Inline rename input */}
      {rename && (
        <div className="absolute inset-x-0 top-14 z-30 px-2">
          <input
            autoFocus
            className="w-full text-xs px-2 py-1 rounded border border-[var(--color-primary)] bg-[var(--color-surface)] text-[var(--color-text)] outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setRename(null);
            }}
            onBlur={handleRenameSubmit}
          />
        </div>
      )}

      {/* Op error toast */}
      {opError && (
        <div
          className="absolute bottom-2 left-2 right-2 z-10 rounded px-2 py-1.5 text-[10px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 cursor-pointer"
          onClick={() => setOpError(null)}
        >
          {opError}
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

      {/* Context menu */}
      {menu && (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          nodePath={menu.node.id}
          isDir={menu.node.kind === "dir"}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRenameStart}
          onDelete={handleDeleteStart}
          onDownload={handleDownload}
          onUpload={handleUploadHere}
          onClose={() => setMenu(null)}
        />
      )}

      {/* Delete confirm dialog */}
      <ConfirmDeleteDialog
        open={!!deleteState}
        path={deleteState?.path ?? ""}
        isDir={deleteState?.isDir ?? false}
        loading={deleteState?.loading ?? false}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteState(null)}
      />

      {/* New file/folder dialog */}
      <NewItemDialog
        open={!!newItemDialog}
        type={newItemDialog?.type ?? "file"}
        onConfirm={handleNewItemConfirm}
        onCancel={() => setNewItemDialog(null)}
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
        dir={uploadDirRef.current || ""}
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

/** Walk the tree and collect IDs of dirs that were expanded but now have unloaded children. */
function collectUnloadedExpanded(nodes: FsArborNode[], expanded: Set<string>): string[] {
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

// ---------------------------------------------------------------------------
// ChangedFilesList — IntelliJ-style local changes panel
// ---------------------------------------------------------------------------

export interface ChangedFilesListProps {
  project: string;
  selectedFile: string | null;
  onSelectFile: (path: string, isConflict: boolean) => void;
}

interface GitContextMenuState {
  x: number;
  y: number;
  entry: DiffFileEntry;
  section: "changes" | "unversioned";
}

function gitStatusColor(status: string, staged: boolean): string {
  if (status === "conflicted") return "text-red-400";
  if (staged) return "text-green-400";
  if (status === "deleted") return "text-red-400/80";
  if (status === "added") return "text-green-400";
  return "text-blue-400";
}

function gitStatusBadge(status: string, staged: boolean): string {
  if (status === "conflicted") return "C";
  if (staged) {
    if (status === "added") return "A";
    if (status === "deleted") return "D";
    if (status === "renamed") return "R";
    return "M";
  }
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "added") return "?";
  return "M";
}

function GitSectionHeader({
  label,
  count,
  open,
  onToggle,
  checkState,
  onCheckAll,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  checkState: "all" | "some" | "none";
  onCheckAll: () => void;
}) {
  const checkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkRef.current) {
      checkRef.current.indeterminate = checkState === "some";
    }
  }, [checkState]);

  return (
    <div className="flex items-center gap-1 px-2 py-1 select-none bg-[var(--color-surface)] sticky top-0 z-10 border-b border-[var(--color-border)]/40">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 min-w-0 text-left"
      >
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />}
        <span className="text-[10px] font-semibold text-[var(--color-text)] truncate">
          {label}
        </span>
        <span className="text-[9px] text-[var(--color-text-muted)] ml-1 shrink-0">
          {count} {count === 1 ? "file" : "files"}
        </span>
      </button>
      {count > 0 && (
        <input
          ref={checkRef}
          type="checkbox"
          checked={checkState === "all"}
          onChange={onCheckAll}
          onClick={(e) => e.stopPropagation()}
          className="h-3 w-3 shrink-0 cursor-pointer accent-[var(--color-primary)]"
          aria-label={`Select all ${label}`}
        />
      )}
    </div>
  );
}

function GitFileRow({
  entry,
  isSelected,
  checked,
  isMutating,
  onSelect,
  onContextMenu,
  onToggle,
}: {
  entry: DiffFileEntry;
  isSelected: boolean;
  checked: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggle: () => void;
}) {
  const parts = entry.path.split("/");
  const filename = parts.pop()!;
  const dir = parts.join("/");
  const color = gitStatusColor(entry.status, checked);
  const badge = gitStatusBadge(entry.status, checked);

  return (
    <div
      role="row"
      className={cn(
        "flex items-center gap-1.5 px-2 py-[3px] cursor-pointer",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected && "bg-[var(--color-primary)]/15",
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {isMutating ? (
        <span className="h-3 w-3 shrink-0 inline-block animate-spin rounded-full border border-current border-t-transparent opacity-40" />
      ) : (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="h-3 w-3 shrink-0 cursor-pointer accent-[var(--color-primary)]"
          aria-label={checked ? `Unstage ${filename}` : `Stage ${filename}`}
        />
      )}
      <span className={cn("text-[9px] font-bold w-3 shrink-0 text-center leading-none", color)}>
        {badge}
      </span>
      <span className={cn("text-[11px] truncate flex-1", color, isSelected && "!text-[var(--color-primary)]")}>
        {filename}
      </span>
      {dir && (
        <span className="text-[9px] text-[var(--color-text-muted)]/60 truncate max-w-[45%] shrink-0 pl-1">
          {dir}
        </span>
      )}
    </div>
  );
}

function GitContextMenuPopover({
  x, y,
  entry,
  section,
  onStage,
  onUnstage,
  onDiscard,
  onClose,
}: {
  x: number;
  y: number;
  entry: DiffFileEntry;
  section: "changes" | "unversioned";
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  type Action = { label: string; onClick: () => void; danger?: boolean };
  const actions: Action[] = [];

  if (section === "unversioned" || !entry.staged) {
    actions.push({ label: "Add to commit", onClick: onStage });
  }
  if (entry.staged) {
    actions.push({ label: "Remove from commit", onClick: onUnstage });
  }
  if (section !== "unversioned" && entry.status !== "conflicted") {
    actions.push({ label: "Discard changes", onClick: onDiscard, danger: true });
  }

  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 60,
    top: Math.min(y, window.innerHeight - 120),
    left: Math.min(x, window.innerWidth - 170),
  };

  return (
    <div
      ref={ref}
      style={style}
      className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1"
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => { a.onClick(); onClose(); }}
          className={cn(
            "w-full flex items-center px-3 py-1.5 text-xs text-left transition-colors",
            a.danger
              ? "text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

const UNTRACKED_PAGE_SIZE = 500;

export function ChangedFilesList({ project, selectedFile, onSelectFile }: ChangedFilesListProps) {
  const [commitMsg, setCommitMsg] = useState("");
  const [mutatingPaths, setMutatingPaths] = useState<Set<string>>(new Set());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<GitContextMenuState | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(true);
  const [unversionedOpen, setUnversionedOpen] = useState(true);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);
  const [untrackedPage, setUntrackedPage] = useState(0);
  const [extraUntracked, setExtraUntracked] = useState<DiffFileEntry[]>([]);

  const { data, isLoading, isError, refetch } = useGitDiff(project);
  const stageMutation = useGitStage(project);
  const unstageMutation = useGitUnstage(project);
  const discardMutation = useGitDiscard(project);
  const commitMutation = useGitCommit(project);

  // Guard against stale cache holding old DiffFileEntry[] shape before response format changed
  const isLegacyShape = Array.isArray(data);
  const entries = isLegacyShape ? (data as unknown as DiffFileEntry[]) : (data?.entries ?? []);
  const untrackedTruncated = isLegacyShape ? false : (data?.untrackedTruncated ?? false);
  const untrackedTotal = isLegacyShape ? 0 : (data?.untrackedTotal ?? 0);

  // Fetch next page of untracked files when user clicks "Load more"
  const { data: nextPageData, isFetching: isLoadingMore } = useGitUntracked(
    project,
    (untrackedPage + 1) * UNTRACKED_PAGE_SIZE,
    UNTRACKED_PAGE_SIZE,
    untrackedTruncated && untrackedPage >= 0,
  );

  // Accumulate loaded pages; reset when project or base diff changes
  useEffect(() => {
    setExtraUntracked([]);
    setUntrackedPage(0);
  }, [project, data]);

  useEffect(() => {
    if (nextPageData && untrackedPage > 0) {
      setExtraUntracked((prev) => {
        const existingPaths = new Set(prev.map((f) => f.path));
        const fresh = nextPageData.filter((f) => !existingPaths.has(f.path));
        return [...prev, ...fresh];
      });
    }
  }, [nextPageData, untrackedPage]);

  const changedFiles = entries.filter((f) => !(f.status === "added" && !f.staged));
  const unversionedFiles = [
    ...entries.filter((f) => f.status === "added" && !f.staged),
    ...extraUntracked,
  ];
  const stagedCount = entries.filter((f) => f.staged).length;
  const hasMoreUntracked = untrackedTruncated && unversionedFiles.length < untrackedTotal;

  function handleLoadMoreUntracked() {
    setUntrackedPage((p) => p + 1);
  }

  const trackMutating = useCallback((path: string) => {
    setMutatingPaths((p) => new Set([...p, path]));
    return () => setMutatingPaths((p) => { const n = new Set(p); n.delete(path); return n; });
  }, []);

  async function handleStage(path: string) {
    const untrack = trackMutating(path);
    setMutationError(null);
    try {
      await stageMutation.mutateAsync([path]);
    } catch {
      setMutationError(`Failed to stage ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleUnstage(path: string) {
    const untrack = trackMutating(path);
    setMutationError(null);
    try {
      await unstageMutation.mutateAsync([path]);
    } catch {
      setMutationError(`Failed to unstage ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleDiscard(path: string) {
    const untrack = trackMutating(path);
    setMutationError(null);
    try {
      await discardMutation.mutateAsync(path);
      setDiscardConfirm(null);
    } catch {
      setMutationError(`Failed to discard ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleStageAll(paths: string[]) {
    if (paths.length === 0) return;
    setMutationError(null);
    try {
      await stageMutation.mutateAsync(paths);
    } catch {
      setMutationError("Failed to stage all");
    }
  }

  async function handleUnstageAll(paths: string[]) {
    if (paths.length === 0) return;
    setMutationError(null);
    try {
      await unstageMutation.mutateAsync(paths);
    } catch {
      setMutationError("Failed to unstage all");
    }
  }

  async function handleCommit() {
    if (!commitMsg.trim() || stagedCount === 0) return;
    setMutationError(null);
    try {
      const result = await commitMutation.mutateAsync(commitMsg);
      setCommitMsg("");
      setCommitSuccess(result.hash.slice(0, 7));
      setTimeout(() => setCommitSuccess(null), 3000);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Commit failed");
    }
  }

  const changedStageable = changedFiles.filter((f) => f.status !== "conflicted");
  const changedStagedCount = changedStageable.filter((f) => f.staged).length;
  const changedCheckState: "all" | "some" | "none" =
    changedStageable.length === 0
      ? "none"
      : changedStagedCount === changedStageable.length
        ? "all"
        : changedStagedCount > 0
          ? "some"
          : "none";

  function handleChangesCheckAll() {
    if (changedCheckState === "all") {
      void handleUnstageAll(changedStageable.map((f) => f.path));
    } else {
      void handleStageAll(changedStageable.filter((f) => !f.staged).map((f) => f.path));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading changes…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-xs text-[var(--color-danger)]">
        <AlertTriangle className="h-5 w-5" />
        <span>Failed to load changes</span>
        <button onClick={() => void refetch()} className="text-[10px] text-[var(--color-primary)] hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 text-xs overflow-hidden min-h-0">
      {/* Panel header */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-bold tracking-widest text-[var(--color-text-muted)] uppercase">
          Local Changes
        </span>
        <button
          onClick={() => void refetch()}
          aria-label="Refresh changes"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Error banner */}
      {mutationError && (
        <div
          role="alert"
          className="shrink-0 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 flex items-center justify-between gap-2"
        >
          <span className="text-[var(--color-danger)] text-[10px] truncate">{mutationError}</span>
          <button
            onClick={() => setMutationError(null)}
            aria-label="Dismiss error"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px] shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Commit success flash */}
      {commitSuccess && (
        <div className="shrink-0 px-3 py-1.5 bg-green-500/10 border-b border-green-500/20 text-[10px] text-green-400">
          Committed {commitSuccess}
        </div>
      )}

      {/* Discard confirm */}
      {discardConfirm && (
        <div
          role="alertdialog"
          className="shrink-0 px-3 py-2 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)]"
        >
          <p className="text-[10px] font-medium mb-1">Discard changes to:</p>
          <p className="font-mono text-[9px] mb-2 truncate opacity-80">{discardConfirm}</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleDiscard(discardConfirm)}
              disabled={mutatingPaths.has(discardConfirm)}
              className="px-2 py-0.5 text-[10px] bg-[var(--color-danger)] text-white rounded-sm hover:opacity-80 disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={() => setDiscardConfirm(null)}
              className="px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-sm border border-[var(--color-border)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && !untrackedTruncated ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-[var(--color-text-muted)]">
            <span className="text-2xl opacity-20">✓</span>
            <span className="text-[11px]">No local changes</span>
          </div>
        ) : (
          <>
            {changedFiles.length > 0 && (
              <>
                <GitSectionHeader
                  label="Changes"
                  count={changedFiles.length}
                  open={changesOpen}
                  onToggle={() => setChangesOpen((v) => !v)}
                  checkState={changedCheckState}
                  onCheckAll={handleChangesCheckAll}
                />
                {changesOpen && changedFiles.map((f) => (
                  <GitFileRow
                    key={f.path}
                    entry={f}
                    isSelected={selectedFile === f.path}
                    checked={f.staged}
                    isMutating={mutatingPaths.has(f.path)}
                    onSelect={() => onSelectFile(f.path, f.status === "conflicted")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, entry: f, section: "changes" });
                    }}
                    onToggle={() => void (f.staged ? handleUnstage(f.path) : handleStage(f.path))}
                  />
                ))}
              </>
            )}

            {(unversionedFiles.length > 0 || untrackedTruncated) && (
              <>
                <GitSectionHeader
                  label="Unversioned Files"
                  count={untrackedTruncated ? untrackedTotal : unversionedFiles.length}
                  open={unversionedOpen}
                  onToggle={() => setUnversionedOpen((v) => !v)}
                  checkState="none"
                  onCheckAll={() => void handleStageAll(unversionedFiles.map((f) => f.path))}
                />
                {unversionedOpen && (
                  <>
                    {untrackedTruncated && (
                      <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)]/50 border-b border-[var(--color-border)]/40">
                        Showing {unversionedFiles.length} of {untrackedTotal.toLocaleString()} unversioned files
                      </div>
                    )}
                    {unversionedFiles.map((f) => (
                      <GitFileRow
                        key={f.path}
                        entry={f}
                        isSelected={selectedFile === f.path}
                        checked={false}
                        isMutating={mutatingPaths.has(f.path)}
                        onSelect={() => onSelectFile(f.path, false)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, entry: f, section: "unversioned" });
                        }}
                        onToggle={() => void handleStage(f.path)}
                      />
                    ))}
                    {hasMoreUntracked && (
                      <button
                        onClick={handleLoadMoreUntracked}
                        disabled={isLoadingMore}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] text-[var(--color-primary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 border-t border-[var(--color-border)]/40"
                      >
                        {isLoadingMore
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                          : `Load ${Math.min(UNTRACKED_PAGE_SIZE, untrackedTotal - unversionedFiles.length).toLocaleString()} more`}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Commit area */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-2 flex flex-col gap-1.5">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleCommit();
          }}
          placeholder="Commit message…"
          rows={2}
          className="w-full resize-none rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/50 transition-colors"
        />
        <button
          onClick={() => void handleCommit()}
          disabled={!commitMsg.trim() || stagedCount === 0 || commitMutation.isPending}
          className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium rounded-sm bg-[var(--color-primary)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {commitMutation.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Check className="h-3 w-3" />}
          Commit{stagedCount > 0 ? ` ${stagedCount} file${stagedCount !== 1 ? "s" : ""}` : ""}
        </button>
      </div>

      {/* Git file context menu */}
      {contextMenu && (
        <GitContextMenuPopover
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          section={contextMenu.section}
          onStage={() => void handleStage(contextMenu.entry.path)}
          onUnstage={() => void handleUnstage(contextMenu.entry.path)}
          onDiscard={() => setDiscardConfirm(contextMenu.entry.path)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
