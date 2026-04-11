import { useState } from "react";
import { Minus, Plus, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { FileStatusBadge } from "@/components/atoms/FileStatusBadge.js";
import type { DiffFileEntry } from "@/api/client.js";

interface Props {
  entry: DiffFileEntry;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void;
  isMutating?: boolean;
}

export function ChangedFileEntry({
  entry,
  isSelected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  isMutating,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const fileName = entry.path.split("/").pop() ?? entry.path;
  const dirPath = entry.path.includes("/")
    ? entry.path.slice(0, entry.path.lastIndexOf("/"))
    : null;

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-3 py-1 cursor-pointer select-none text-xs",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected && "bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/15",
      )}
      onClick={() => onSelect(entry.path)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <FileStatusBadge status={entry.status} />

      <span className="flex-1 min-w-0">
        <span className="truncate text-[var(--color-text)] font-medium">{fileName}</span>
        {dirPath && (
          <span className="ml-1.5 truncate text-[var(--color-text-muted)] text-[10px]">{dirPath}</span>
        )}
        {entry.oldPath && (
          <span className="ml-1.5 text-[var(--color-text-muted)] text-[10px]">← {entry.oldPath}</span>
        )}
      </span>

      {(entry.additions > 0 || entry.deletions > 0) && (
        <span className="flex items-center gap-1 shrink-0 text-[10px] font-mono">
          {entry.additions > 0 && (
            <span className="text-[var(--color-success)]">+{entry.additions}</span>
          )}
          {entry.deletions > 0 && (
            <span className="text-[var(--color-danger)]">-{entry.deletions}</span>
          )}
        </span>
      )}

      {isMutating ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--color-text-muted)]" />
      ) : hovered ? (
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {entry.staged && onUnstage && (
            <button
              title="Unstage"
              aria-label={`Unstage ${fileName}`}
              onClick={() => onUnstage(entry.path)}
              className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <Minus className="h-3 w-3" />
            </button>
          )}
          {!entry.staged && onStage && (
            <button
              title="Stage"
              aria-label={`Stage ${fileName}`}
              onClick={() => onStage(entry.path)}
              className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-success)] transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
          {!entry.staged && onDiscard && entry.status !== "conflicted" && (
            <button
              title="Discard changes"
              aria-label={`Discard changes in ${fileName}`}
              onClick={() => onDiscard(entry.path)}
              className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
