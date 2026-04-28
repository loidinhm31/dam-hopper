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
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
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

interface FileTreeProps {
  project: string;
  path?: string;
  onFileOpen?: (node: FsArborNode) => void;
  onOpenTerminal?: () => void;
  className?: string;
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

      {/* Tree body — overflow-hidden and flex-1 to consume full space */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden"
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
