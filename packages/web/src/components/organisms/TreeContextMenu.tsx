import { useEffect, useRef } from "react";
import {
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
}

interface Props {
  x: number;
  y: number;
  nodePath: string;
  isDir: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onClose: () => void;
}

export function TreeContextMenu({
  x,
  y,
  isDir,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onDownload,
  onUpload,
  onClose,
}: Props) {
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

  const items: ContextMenuAction[] = [
    ...(isDir
      ? [
          { label: "New File", icon: <FilePlus className="h-3.5 w-3.5" />, onClick: onNewFile },
          { label: "New Folder", icon: <FolderPlus className="h-3.5 w-3.5" />, onClick: onNewFolder },
          { label: "Upload Here", icon: <Upload className="h-3.5 w-3.5" />, onClick: onUpload },
        ]
      : []),
    { label: "Rename", icon: <Pencil className="h-3.5 w-3.5" />, onClick: onRename },
    ...(!isDir
      ? [{ label: "Download", icon: <Download className="h-3.5 w-3.5" />, onClick: onDownload }]
      : []),
    { label: "Delete", icon: <Trash2 className="h-3.5 w-3.5" />, onClick: onDelete, danger: true },
  ];

  return (
    <div
      ref={ref}
      style={style}
      className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose(); }}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors",
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
