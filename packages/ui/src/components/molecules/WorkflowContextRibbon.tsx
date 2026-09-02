import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Plus,
  RefreshCw,
  FolderGit2,
} from "lucide-react";
import type { RefObject } from "react";
import type { ProjectTargetRef } from "@/api/client.js";
import type { ItemOverviewNodeDto, SessionDto } from "@/api/workflow-dto-types.js";
import { formatElapsedDuration } from "@/api/workflow-domain-helpers.js";
import {
  getTrackedTasksProgressText,
  type AttentionSummary,
} from "@/api/workflow-selectors.js";
import { Button } from "@/components/atoms/Button.js";
import { STATUS_CONFIG } from "@/components/molecules/WorkflowItemRow.js";
import { cn } from "@/lib/utils.js";

export interface WorkflowContextRibbonProps {
  target?: ProjectTargetRef | null;
  activeNode?: ItemOverviewNodeDto | null;
  runningSession?: SessionDto | null;
  attention?: AttentionSummary;
  isOpen: boolean;
  onToggle: () => void;
  onOpenQuickCapture?: () => void;
  isLoading?: boolean;
  isUnavailable?: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  nowMs?: number;
  triggerRef?: RefObject<HTMLDivElement | null>;
}

export function WorkflowContextRibbon({
  target,
  activeNode,
  runningSession,
  attention,
  isOpen,
  onToggle,
  onOpenQuickCapture,
  isLoading = false,
  isUnavailable = false,
  error = null,
  onRetry,
  nowMs,
  triggerRef,
}: WorkflowContextRibbonProps) {
  if (isLoading) {
    return (
      <div
        className="flex h-9 w-full items-center justify-between gap-3 px-3 text-xs bg-[var(--color-surface)]/80 border-b border-[var(--color-border)] animate-pulse"
        role="status"
        aria-label="Loading workflow context"
      >
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded-full bg-[var(--color-surface-2)]" />
          <div className="h-3.5 w-24 rounded bg-[var(--color-surface-2)]" />
          <div className="h-3.5 w-40 rounded bg-[var(--color-surface-2)]" />
        </div>
        <div className="h-6 w-16 rounded bg-[var(--color-surface-2)]" />
      </div>
    );
  }

  if (isUnavailable) {
    return <div className="flex h-9 w-full items-center gap-2 px-3 text-xs bg-[var(--color-surface)]/80 border-b border-[var(--color-border)] text-[var(--color-text-muted)]" role="status" aria-label="Workflow unavailable for this profile"><Layers className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Workflow tracking is unavailable for this profile.</span></div>;
  }

  if (error) {
    const errorMsg = typeof error === "string" ? error : error.message;
    return (
      <div
        className="flex h-9 w-full items-center justify-between gap-2 px-3 text-xs bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/30 text-[var(--color-danger)]"
        role="alert"
      >
        <div className="flex items-center gap-1.5 truncate">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Workflow error: {errorMsg}</span>
        </div>
        {onRetry && (
          <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="h-6 gap-1 px-2 text-xs">
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  const activeItem = activeNode?.item;
  const statusCfg = activeItem ? STATUS_CONFIG[activeItem.status] : null;
  const StatusIcon = statusCfg?.icon ?? Layers;
  const progressText = getTrackedTasksProgressText(activeNode);
  const runningDuration = runningSession ? formatElapsedDuration(runningSession.startedAt, null, nowMs) : null;
  const latestNote = activeNode?.notes && activeNode.notes.length > 0 ? activeNode.notes[activeNode.notes.length - 1] : null;

  return (
    <div
      className={cn(
        "flex h-9 w-full min-w-0 items-center justify-between gap-2 px-2 text-xs sm:gap-3 sm:px-3",
        "border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur-xs transition-colors",
      )}
      role="region"
      aria-label="Workflow Context Bar"
    >
      <div
        ref={triggerRef}
        className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden cursor-pointer select-none"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls="workflow-context-deck"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="flex shrink-0 items-center gap-1 text-[var(--color-text-muted)] font-mono text-[11px]">
          <FolderGit2 className="h-3.5 w-3.5" />
          <span className="truncate max-w-[120px]" title={target?.project ?? "All Projects"}>
            {target?.project ?? "All Projects"}
          </span>
          {target?.worktreePath && (
            <span className="text-[10px] opacity-75">({target.worktreePath.split("/").pop()})</span>
          )}
        </div>

        <span className="text-[var(--color-border)]">/</span>

        {activeItem ? (
          <div className="flex min-w-0 items-center gap-2 truncate">
            <span className={cn("flex shrink-0 items-center gap-1 font-medium", statusCfg?.color)}>
              <StatusIcon className="h-3.5 w-3.5" />
              <span className="truncate max-w-[200px]" title={activeItem.title}>
                {activeItem.title}
              </span>
            </span>

            {runningDuration && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--color-primary)]">
                <Clock className="h-3 w-3 animate-spin-slow" />
                {runningDuration}
              </span>
            )}

            <span className="hidden truncate text-[11px] text-[var(--color-text-muted)] md:inline" title={latestNote ? latestNote.body : progressText}>
              {latestNote ? `Next: ${latestNote.body}` : progressText}
            </span>
          </div>
        ) : (
          <span className="text-[var(--color-text-muted)] italic">No active plan</span>
        )}

        {attention && (attention.hasBlockedItems || attention.hasRunningSessions) && (
          <div className="hidden items-center gap-1.5 sm:flex shrink-0 ml-auto">
            {attention.blockedItemCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warning)]">
                <AlertCircle className="h-3 w-3" />
                {attention.blockedItemCount} blocked
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {onOpenQuickCapture && !activeItem && (
          <Button type="button" variant="primary" size="sm" onClick={onOpenQuickCapture} className="h-6 gap-1 px-2 text-[11px]">
            <Plus className="h-3 w-3" />
            Plan
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Collapse workflow deck" : "Expand workflow deck"}
          className="h-6 w-6 p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="sr-only" aria-live="polite">
        {activeItem ? `Active plan: ${activeItem.title}, status: ${activeItem.status}` : "No active plan"}
      </div>
    </div>
  );
}
