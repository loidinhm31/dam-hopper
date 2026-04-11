import { cn } from "@/lib/utils.js";

type DiffStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "conflicted";

const statusConfig: Record<DiffStatus, { label: string; className: string }> = {
  modified:   { label: "M", className: "bg-[var(--color-warning)]/15  text-[var(--color-warning)]  border-[var(--color-warning)]/30" },
  added:      { label: "A", className: "bg-[var(--color-success)]/15  text-[var(--color-success)]  border-[var(--color-success)]/30" },
  deleted:    { label: "D", className: "bg-[var(--color-danger)]/15   text-[var(--color-danger)]   border-[var(--color-danger)]/30" },
  renamed:    { label: "R", className: "bg-[var(--color-primary)]/15  text-[var(--color-primary)]  border-[var(--color-primary)]/30" },
  copied:     { label: "C", className: "bg-[var(--color-primary)]/15  text-[var(--color-primary)]  border-[var(--color-primary)]/30" },
  conflicted: { label: "!", className: "bg-[var(--color-danger)]/25   text-[var(--color-danger)]   border-[var(--color-danger)]/50 animate-pulse" },
};

interface Props {
  status: string;
  className?: string;
}

export function FileStatusBadge({ status, className }: Props) {
  const cfg = statusConfig[status as DiffStatus] ?? { label: "?", className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border)]" };
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-4 h-4 rounded-sm text-[10px] font-bold border shrink-0",
        cfg.className,
        className,
      )}
      title={status}
    >
      {cfg.label}
    </span>
  );
}
