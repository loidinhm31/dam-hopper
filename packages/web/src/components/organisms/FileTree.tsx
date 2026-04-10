import { useRef, useState, useEffect } from "react";
import { Tree } from "react-arborist";
import type { NodeApi, NodeRendererProps } from "react-arborist";

/** Sentinel child injected into unloaded dirs so react-arborist renders a chevron. */
const LOADING_PLACEHOLDER: FsArborNode = {
  id: "__loading__",
  name: "",
  kind: "file",
  size: 0,
  mtime: 0,
  isSymlink: false,
  children: null,
};
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
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useFsSubscription } from "@/hooks/useFsSubscription.js";
import { useFsOps } from "@/hooks/useFsOps.js";
import { useFsUpload } from "@/hooks/useFsUpload.js";
import type { FsArborNode } from "@/api/fs-types.js";
import { TreeContextMenu } from "./TreeContextMenu.js";
import { UploadDropzone } from "./UploadDropzone.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";

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
  // Hide the sentinel loading placeholder entirely
  if (node.data.id === "__loading__") {
    return (
      <div ref={dragHandle} style={style} className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-[var(--color-text-muted)] opacity-40 select-none">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        Loading…
      </div>
    );
  }

  const isDir = node.data.kind === "dir";
  const isHidden = node.data.name.startsWith(".");

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

      <span className="truncate" title={node.data.name}>
        {node.data.name}
      </span>
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

export function FileTree({ project, path = "", onFileOpen, onOpenTerminal, className }: FileTreeProps) {
  const [showHidden, setShowHidden] = useState(false);
  const { data, isLoading, isError, error, loadChildren } = useFsSubscription(project, path);
  const ops = useFsOps(project, path);
  const { progress, upload, clearProgress } = useFsUpload(project, path);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef<string>("");

  const visibleNodes = showHidden
    ? (data?.nodes ?? [])
    : (data?.nodes ?? []).filter((n) => !n.name.startsWith("."));

  function handleActivate(node: NodeApi<FsArborNode>) {
    if (node.data.id === "__loading__") return;
    if (node.data.kind === "file") {
      onFileOpen?.(node.data);
    } else {
      // Load children on first expand if not yet fetched
      if (node.data.children === null) {
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
    const name = prompt("New file name:");
    if (!name?.trim()) return;
    void ops.createFile(dir ? `${dir}/${name.trim()}` : name.trim()).then((r) => {
      if (!r.ok) setOpError(r.error ?? "Create failed");
    });
  }

  function handleNewFolder() {
    if (!menu) return;
    const dir = menu.node.kind === "dir" ? menu.node.id : parentDir(menu.node.id);
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    void ops.createDir(dir ? `${dir}/${name.trim()}` : name.trim()).then((r) => {
      if (!r.ok) setOpError(r.error ?? "Create failed");
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
    ops.download(menu.node.id);
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

  const containerRef = useRef<HTMLDivElement>(null);

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
      <div className="px-2 py-1 shrink-0">
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-wide uppercase truncate">
          {project}
        </span>
      </div>

      {/* Tree body */}
      <div ref={containerRef} className="flex-1 overflow-hidden">
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
            childrenAccessor={(d) => {
              if (d.kind !== "dir") return null;
              // null children = not yet loaded → inject sentinel so arborist
              // renders a chevron and treats the dir as expandable.
              if (d.children === null) return [LOADING_PLACEHOLDER];
              return d.children;
            }}
            openByDefault={false}
            onActivate={handleActivate}
            disableDrag
            disableDrop
            disableEdit
            indent={16}
            rowHeight={24}
            className="!overflow-auto"
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
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNode(nodes: FsArborNode[], id: string): FsArborNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
}

function parentDir(nodePath: string): string {
  const parts = nodePath.split("/");
  parts.pop();
  return parts.join("/");
}
