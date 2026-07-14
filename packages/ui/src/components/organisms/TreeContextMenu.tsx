import { useEffect, useRef } from "react";
import {
  ClipboardCopy,
  Copy,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Download,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils.js";

export interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface TreeContextMenuHandlers {
  onCopyAbsolutePath: () => void;
  onCopyRelativePath: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onUpload: () => void;
}

interface BuildItemsArgs extends TreeContextMenuHandlers {
  isDir: boolean;
  /** When true (e.g. project root unknown), disable the absolute-path copy. */
  absolutePathDisabled?: boolean;
}

/**
 * Build the ordered list of context-menu actions. Extracted as a pure helper
 * so it can be unit-tested without rendering (mirrors `getEditorTabContextMenuItems`).
 */
export function getTreeContextMenuItems({
  isDir,
  absolutePathDisabled = false,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onDownload,
  onUpload,
}: BuildItemsArgs): ContextMenuAction[] {
  return [
    {
      label: "Copy Absolute Path",
      icon: <ClipboardCopy className="h-3.5 w-3.5" />,
      onClick: onCopyAbsolutePath,
      disabled: absolutePathDisabled,
    },
    {
      label: "Copy Relative Path",
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: onCopyRelativePath,
    },
    ...(isDir
      ? [
          {
            label: "New File",
            icon: <FilePlus className="h-3.5 w-3.5" />,
            onClick: onNewFile,
          },
          {
            label: "New Folder",
            icon: <FolderPlus className="h-3.5 w-3.5" />,
            onClick: onNewFolder,
          },
          {
            label: "Upload Here",
            icon: <Upload className="h-3.5 w-3.5" />,
            onClick: onUpload,
          },
        ]
      : []),
    {
      label: "Rename",
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: onRename,
    },
    ...(!isDir
      ? [
          {
            label: "Download",
            icon: <Download className="h-3.5 w-3.5" />,
            onClick: onDownload,
          },
        ]
      : []),
    {
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: onDelete,
      danger: true,
    },
  ];
}

interface Props extends BuildItemsArgs {
  x: number;
  y: number;
  onClose: () => void;
}

export function TreeContextMenu(props: Props) {
  const { x, y, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 60,
    top: Math.min(y, window.innerHeight - 200),
    left: Math.min(x, window.innerWidth - 180),
  };

  const items = getTreeContextMenuItems(props);

  return (
    <div
      ref={ref}
      style={style}
      className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1"
    >
      {items.map((item) => (
        <button
          key={item.label}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            item.danger
              ? "text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
