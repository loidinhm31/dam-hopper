import { useRef } from "react";
import { GitBranch, GitCommit, GitMerge, Plus } from "lucide-react";
import { useProjectStatus, useWorktrees } from "@/api/queries.js";
import { TerminalProjectActivityIndicator } from "@/components/atoms/TerminalActivityIndicator.js";
import {
  traditionalTerminalProjectPanelId,
  traditionalTerminalProjectTabId,
} from "@/lib/traditional-terminal-projects.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";
function TraditionalProjectGitSummary({
  projectName,
}: {
  projectName: string;
}) {
  const {
    data: status,
    isLoading,
    isError,
  } = useProjectStatus(projectName, true);
  const {
    data: worktrees,
    isLoading: isWorktreesLoading,
    isError: isWorktreesError,
  } = useWorktrees(projectName);
  const lastCommit = status?.lastCommit;
  const worktree =
    worktrees?.find((candidate) => candidate.branch === status?.branch) ??
    worktrees?.find((candidate) => candidate.commitHash === lastCommit?.hash) ??
    worktrees?.find((candidate) => candidate.isMain);

  if (
    isLoading ||
    isError ||
    isWorktreesLoading ||
    isWorktreesError ||
    !status ||
    !worktree?.path ||
    worktree.isAvailable !== true ||
    worktree.isPrunable ||
    status.pathExists === false ||
    status.statusError ||
    !status.branch ||
    !lastCommit?.hash ||
    !lastCommit.message ||
    Number.isNaN(new Date(lastCommit.date).getTime())
  ) {
    return null;
  }

  const accessibleLabel = `Branch ${status.branch}; Worktree ${worktree.path}; latest commit ${lastCommit.message}`;
  return (
    <span
      aria-label={accessibleLabel}
      className="mt-1 flex min-w-0 flex-col gap-0.5 text-[11px] leading-4"
      role="status"
      title={accessibleLabel}
    >
      <span className="flex min-w-0 items-start gap-1 text-[var(--color-info)]">
        <GitBranch className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono" title={status.branch}>
          {status.branch}
        </span>
      </span>
      <span className="flex min-w-0 items-start gap-1 text-[var(--color-text-muted)]">
        <GitMerge className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono" title={worktree.path}>
          {worktree.path}
        </span>
      </span>
      <span className="flex min-w-0 items-start gap-1 text-[var(--color-primary)]">
        <GitCommit className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span
          className="min-w-0 whitespace-normal break-words"
          title={status.lastCommit.message}
        >
          {status.lastCommit.message}
        </span>
      </span>
    </span>
  );
}

interface TraditionalTerminalProjectsNavigatorProps {
  groups: readonly TraditionalTerminalProjectGroup[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onNewTerminal?: () => void;
  width?: number;
  className?: string;
  touchOptimized?: boolean;
}

export function TraditionalTerminalProjectsNavigator({
  groups,
  activeGroupId,
  onSelectGroup,
  onNewTerminal,
  width,
  className,
  touchOptimized = false,
}: TraditionalTerminalProjectsNavigatorProps) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const showCommitStatus = useSettingsStore(
    (state) => state.terminalCommitStatusEnabled,
  );
  function focusGroup(index: number) {
    const group = groups[index];
    if (!group) return;
    onSelectGroup(group.id);
    buttonRefs.current.get(group.id)?.focus();
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    groupIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (groupIndex + 1) % groups.length;
    if (event.key === "ArrowUp")
      nextIndex = (groupIndex - 1 + groups.length) % groups.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = groups.length - 1;
    if (nextIndex === null || groups.length === 0) return;
    event.preventDefault();
    focusGroup(nextIndex);
  }

  return (
    <nav
      aria-label="Terminal projects"
      style={width ? { width } : undefined}
      className={cn(
        "flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]",
        touchOptimized && "w-full border-r-0",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-xs font-semibold lowercase tracking-wide text-[var(--color-text-muted)]">
          projects
        </h2>
        {onNewTerminal ? (
          <button
            type="button"
            aria-label="New terminal in selected project"
            title="New terminal in selected project"
            onClick={onNewTerminal}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
              touchOptimized && "h-10 w-10",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div
        role="tablist"
        aria-label="Open terminal projects"
        aria-orientation="vertical"
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {groups.map((group, index) => {
          const isActive = group.id === activeGroupId;
          return (
            <button
              key={group.id}
              id={traditionalTerminalProjectTabId(group.id)}
              ref={(element) => {
                if (element) buttonRefs.current.set(group.id, element);
                else buttonRefs.current.delete(group.id);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={
                isActive
                  ? traditionalTerminalProjectPanelId(group.id)
                  : undefined
              }
              tabIndex={isActive || (!activeGroupId && index === 0) ? 0 : -1}
              onClick={() => onSelectGroup(group.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "flex min-h-11 w-full items-start gap-2 px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]",
                isActive
                  ? "bg-[var(--color-primary)]/12 text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                touchOptimized && "min-h-12",
              )}
            >
              <TerminalProjectActivityIndicator tabs={group.terminalTabs} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate font-mono">
                    {group.label}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-muted)]">
                    {group.terminalTabs.length}
                  </span>
                </span>
                {group.projectName && showCommitStatus ? (
                  <TraditionalProjectGitSummary
                    projectName={group.projectName}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
