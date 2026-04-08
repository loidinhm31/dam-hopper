import { useState } from "react";
import { Tree } from "react-arborist";
import type { NodeApi, NodeRendererProps } from "react-arborist";
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
import type { FsArborNode } from "@/api/fs-types.js";

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

function NodeRenderer({
  node,
  style,
  dragHandle,
}: NodeRendererProps<FsArborNode>) {
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
      onClick={() => node.activate()}
    >
      {/* Expand chevron */}
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
  /** Subscribed path (empty string = project root) */
  path?: string;
  onFileOpen?: (node: FsArborNode) => void;
  className?: string;
}

export function FileTree({ project, path = "", onFileOpen, className }: FileTreeProps) {
  const [showHidden, setShowHidden] = useState(false);
  const { data, isLoading, isError, error, loadChildren } = useFsSubscription(project, path);

  const visibleNodes = showHidden
    ? (data?.nodes ?? [])
    : (data?.nodes ?? []).filter((n) => !n.name.startsWith("."));

  function handleToggle(id: string) {
    if (!data) return;
    const node = findNode(data.nodes, id);
    if (node?.kind === "dir" && node.children === null) {
      void loadChildren(id);
    }
  }

  function handleActivate(node: NodeApi<FsArborNode>) {
    if (node.data.kind === "file") {
      onFileOpen?.(node.data);
    } else {
      node.toggle();
    }
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
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
      <div className="flex-1 overflow-hidden">
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
              return d.children ?? [];
            }}
            openByDefault={false}
            onToggle={handleToggle}
            onActivate={handleActivate}
            disableDrag
            disableDrop
            disableEdit
            indent={16}
            rowHeight={24}
            className="!overflow-auto"
          >
            {NodeRenderer}
          </Tree>
        )}
      </div>
    </div>
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
