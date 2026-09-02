import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  HelpCircle,
  PlayCircle,
  XCircle,
} from "lucide-react";
import type { ItemDto, ItemOverviewNodeDto, ItemStatus } from "@/api/workflow-dto-types.js";
import { getTrackedTasksProgressText } from "@/api/workflow-selectors.js";
import { cn } from "@/lib/utils.js";

export interface WorkflowItemRowProps {
  node: ItemOverviewNodeDto;
  isSelected?: boolean;
  depth?: number;
  onSelect?: (item: ItemDto) => void;
  onStatusChange?: (item: ItemDto, status: ItemStatus) => void;
}

export const STATUS_CONFIG: Record<
  ItemStatus,
  { label: string; color: string; icon: typeof Circle }
> = {
  backlog: { label: "Backlog", color: "text-[var(--color-text-muted)]", icon: Circle },
  next: { label: "Next", color: "text-[var(--color-info)]", icon: Clock },
  in_progress: { label: "In Progress", color: "text-[var(--color-primary)]", icon: PlayCircle },
  blocked: { label: "Blocked", color: "text-[var(--color-warning)]", icon: AlertCircle },
  done: { label: "Done", color: "text-[var(--color-success)]", icon: CheckCircle2 },
  canceled: { label: "Canceled", color: "text-[var(--color-danger)]", icon: XCircle },
};

export function WorkflowItemRow({
  node,
  isSelected = false,
  depth = 0,
  onSelect,
  onStatusChange,
}: WorkflowItemRowProps) {
  const { item, activeSessions, notes } = node;
  const statusCfg = STATUS_CONFIG[item.status] ?? {
    label: item.status,
    color: "text-[var(--color-text-muted)]",
    icon: HelpCircle,
  };
  const StatusIcon = statusCfg.icon;
  const hasRunningSession = activeSessions.some((s) => s.status === "running");
  const progressText = getTrackedTasksProgressText(node);
  const latestNote = notes.length > 0 ? notes[notes.length - 1] : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(item);
        }
      }}
      className={cn(
        "group flex flex-col gap-1 rounded border border-transparent p-2 text-xs transition-colors cursor-pointer select-none",
        "hover:bg-[var(--color-surface-2)]/60",
        isSelected
          ? "border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-xs"
          : "bg-transparent",
      )}
      style={{ paddingLeft: `${Math.max(8, depth * 16 + 8)}px` }}
      aria-selected={isSelected}
      aria-label={`${item.kind}: ${item.title} (${statusCfg.label})`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusCfg.color)} />
          <span className="truncate font-medium text-[var(--color-text)]" title={item.title}>
            {item.title}
          </span>
          <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase font-semibold text-[var(--color-text-muted)]">
            {item.kind}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasRunningSession && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-primary)]"
              title="Active session running"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
              Running
            </span>
          )}
          <span className={cn("text-[11px] font-medium", statusCfg.color)}>
            {statusCfg.label}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
        <span className="truncate">
          {latestNote ? `Note: ${latestNote.body}` : progressText}
        </span>
        {node.children.length > 0 && (
          <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
            {node.children.length} {node.children.length === 1 ? "child" : "children"}
          </span>
        )}
      </div>
    </div>
  );
}
