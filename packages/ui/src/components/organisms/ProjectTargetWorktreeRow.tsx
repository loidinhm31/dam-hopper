import { Trash2 } from "lucide-react";
import type { Worktree } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import {
  isSelectableWorktree,
  worktreeStatusLabel,
} from "@/stores/project-target.js";

interface ProjectTargetWorktreeRowProps {
  groupId: string;
  worktree: Worktree;
  selected: boolean;
  disabled?: boolean;
  removePendingPath: string | null;
  onSelect: (worktreePath: string) => void;
  onRemove: (path: string) => void;
}

function targetRowClass(selected: boolean, disabled: boolean) {
  return cn(
    "flex min-h-11 items-center gap-2 rounded border px-2 text-xs",
    "has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[var(--color-ring)]",
    selected
      ? "border-[var(--color-primary)]/60 bg-[var(--color-primary)]/10"
      : "border-[var(--color-border)]",
    disabled && "opacity-60",
  );
}

export function ProjectTargetWorktreeRow({
  groupId,
  worktree,
  selected,
  disabled = false,
  removePendingPath,
  onSelect,
  onRemove,
}: ProjectTargetWorktreeRowProps) {
  const selectable = isSelectableWorktree(worktree) && !disabled;
  const rowId = `${groupId}-${worktree.path}`;
  const status = [
    selected ? "Current target" : null,
    disabled ? "Unavailable until worktree refresh" : null,
    worktreeStatusLabel(worktree),
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");

  return (
    <div className="flex items-stretch gap-1">
      <label
        htmlFor={rowId}
        className={cn(targetRowClass(selected, !selectable), "min-w-0 flex-1")}
        data-worktree-path={worktree.path}
      >
        <input
          id={rowId}
          type="radio"
          name={`${groupId}-target`}
          value={worktree.path}
          checked={selected}
          disabled={!selectable}
          onChange={() => onSelect(worktree.path)}
          aria-describedby={`${rowId}-status`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[var(--color-text)]">
            {worktree.branch || "Detached worktree"}
            {selected ? " · Current target" : ""}
          </span>
          <span
            id={`${rowId}-status`}
            className="block truncate font-mono text-[10px] text-[var(--color-text-muted)]"
            title={worktree.path}
          >
            {worktree.path} · {status}
          </span>
        </span>
      </label>
      <button
        type="button"
        className="min-h-11 min-w-11 shrink-0 rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onRemove(worktree.path)}
        disabled={disabled || removePendingPath === worktree.path}
        aria-label={`Remove worktree ${worktree.branch || worktree.path}`}
        title="Remove worktree"
      >
        <Trash2 className="mx-auto h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
