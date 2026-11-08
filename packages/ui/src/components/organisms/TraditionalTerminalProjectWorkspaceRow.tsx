import { useId, useMemo } from "react";
import { GitCommit, GitBranch, Plus, X } from "lucide-react";
import { TerminalProjectActivityIndicator } from "@/components/atoms/TerminalActivityIndicator.js";
import { TraditionalTerminalWorktreeSelect } from "@/components/organisms/TraditionalTerminalWorktreeSelect.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useProjectStatus, useWorktrees } from "@/api/queries.js";
import { normalizeWorktreePath } from "@/stores/project-target.js";
import { canDismissWorkspace } from "@/lib/agent-hub-open-workspaces.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import {
  traditionalTerminalProjectPanelId,
  traditionalTerminalProjectTabId,
} from "@/lib/traditional-terminal-projects.js";
import type { ProjectTargetInput } from "@/api/client.js";
import type { ProjectRef } from "@/api/ownership.js";
import type { IntentPayloadMap } from "@/os/intents.js";
import { cn } from "@/lib/utils.js";

export interface TraditionalTerminalProjectWorkspaceRowProps {
  group: TraditionalTerminalProjectGroup;
  index: number;
  isActive: boolean;
  activeGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    groupIndex: number,
  ) => void;
  setButtonRef: (groupId: string, element: HTMLButtonElement | null) => void;
  showCommitStatus: boolean;
  touchOptimized?: boolean;
  isDisclosed?: boolean;
  onToggleDisclosure?: (groupId: string) => void;
  onNewTerminalInGroup?: (groupId: string) => void;
  onCloseWorkspace?: (groupId: string) => void;
  onOpenFile?: (payload: IntentPayloadMap["file:open"]) => void;
}

export function TraditionalTerminalProjectWorkspaceRow({
  group,
  index,
  isActive,
  activeGroupId,
  onSelectGroup,
  onKeyDown,
  setButtonRef,
  showCommitStatus,
  touchOptimized = false,
  isDisclosed = false,
  onToggleDisclosure,
  onNewTerminalInGroup,
  onCloseWorkspace,
  onOpenFile,
}: TraditionalTerminalProjectWorkspaceRowProps) {

  const projectScope = useMemo<string | ProjectRef | null>(() => {
    if (!group.projectName) return null;
    return (
      group.projectRef ??
      (group.profileId
        ? { profileId: group.profileId, project: group.projectName }
        : group.projectName)
    );
  }, [group.profileId, group.projectName, group.projectRef]);

  const targetSnapshot = useProjectTarget(projectScope);
  const selectedPath = targetSnapshot?.target.worktreePath ?? null;

  // Base project status query to establish Git capability independently of worktree errors
  const { data: baseGitStatus } = useProjectStatus(
    projectScope ?? "",
    Boolean(group.projectName),
  );

  const isGitProject = baseGitStatus
    ? Boolean(
        baseGitStatus.pathExists !== false &&
          !baseGitStatus.statusError &&
          Boolean(baseGitStatus.branch || baseGitStatus.lastCommit?.hash),
      )
    : false;

  const targetInput: ProjectTargetInput = useMemo(() => {
    if (!group.projectName) return "";
    const base: ProjectTargetInput =
      group.projectRef ??
      (group.profileId
        ? { profileId: group.profileId, project: group.projectName }
        : group.projectName);
    if (selectedPath != null) {
      if (typeof base === "string") {
        return { project: base, worktreePath: selectedPath };
      }
      return { ...base, worktreePath: selectedPath };
    }
    return base;
  }, [group.profileId, group.projectName, group.projectRef, selectedPath]);

  // Target-specific status query for the selected worktree commit chip
  const {
    data: worktreeStatus,
    isLoading: isStatusLoading,
    isError: isStatusError,
  } = useProjectStatus(
    targetInput,
    Boolean(group.projectName && isGitProject),
  );

  const {
    data: worktrees,
    isLoading: isWorktreesLoading,
    isError: isWorktreesError,
  } = useWorktrees(targetInput, {
    enabled: Boolean(group.projectName && isGitProject),
  });

  const worktree =
    selectedPath != null
      ? worktrees?.find(
          (candidate) =>
            normalizeWorktreePath(candidate.path) ===
            normalizeWorktreePath(selectedPath),
        )
      : worktrees?.find((candidate) => candidate.isMain);

  // Fail closed: require positive match, available, not prunable, not loading, not errored
  const isWorktreeAvailable = Boolean(
    worktree &&
      worktree.path &&
      worktree.isAvailable === true &&
      !worktree.isPrunable &&
      !isWorktreesLoading &&
      !isWorktreesError,
  );

  const commitHash =
    isWorktreeAvailable &&
    !isStatusLoading &&
    !isStatusError &&
    worktreeStatus?.pathExists !== false &&
    !worktreeStatus?.statusError &&
    worktreeStatus?.lastCommit?.hash
      ? worktreeStatus.lastCommit.hash
      : null;

  const shortHash = commitHash ? commitHash.slice(0, 7) : null;
  const canDismiss = canDismissWorkspace(group);

  const rawBranch =
    worktreeStatus?.branch?.trim() ||
    worktree?.branch?.trim() ||
    (selectedPath == null ? baseGitStatus?.branch?.trim() : null);
  const branchName = rawBranch && rawBranch.length > 0 ? rawBranch : null;

  return (
    <div
      role="presentation"
      className={cn(
        "group/row relative flex flex-col gap-0.5 px-2 py-1 transition-colors",
        isActive
          ? "workbench-selection"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]/40",
      )}
    >
      <div className="flex items-center gap-1">
        <button
          id={traditionalTerminalProjectTabId(group.id)}
          ref={(element) => setButtonRef(group.id, element)}
          type="button"
          role="tab"
          aria-selected={isActive}
          aria-controls={
            isActive ? traditionalTerminalProjectPanelId(group.id) : undefined
          }
          tabIndex={isActive || (!activeGroupId && index === 0) ? 0 : -1}
          onClick={() => onSelectGroup(group.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            touchOptimized
              ? "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]"
              : "flex min-h-8 min-w-0 flex-1 flex-col items-start gap-1 rounded px-1.5 py-1 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]",
          )}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            {group.terminalTabs.length > 0 ? (
              <TerminalProjectActivityIndicator tabs={group.terminalTabs} />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-3 w-3 shrink-0 items-center justify-center text-xs text-[var(--color-text-muted)] select-none"
              >
                ○
              </span>
            )}
            <span
              className={cn(
                "min-w-0 truncate font-mono text-xs",
                isActive
                  ? "text-[var(--color-selection-text)] font-semibold"
                  : "text-current",
              )}
            >
              {group.label}
            </span>

            <span
              className={cn(
                "ml-auto shrink-0 flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-mono font-medium",
                isActive
                  ? "bg-[var(--color-selection-text)]/20 text-[var(--color-selection-text)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
              )}
            >
              {group.terminalTabs.length}
            </span>
          </div>

        </button>
        {onNewTerminalInGroup ? (
          <button
            type="button"
            aria-label={`New terminal in ${group.label}`}
            title={`New terminal in ${group.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onNewTerminalInGroup(group.id);
            }}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
              touchOptimized && "min-h-11 min-w-11",
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}

        {onCloseWorkspace && canDismiss ? (
          <button
            type="button"
            aria-label={`Close ${group.label} workspace`}
            title={`Close ${group.label} workspace`}
            onClick={(event) => {
              event.stopPropagation();
              onCloseWorkspace(group.id);
            }}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
              touchOptimized && "min-h-11 min-w-11",
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {group.projectName && isGitProject && (isActive || isDisclosed) ? (
        <div
          className={cn(
            touchOptimized
              ? "flex items-center gap-2 pl-7 pr-1 pb-1"
              : "flex flex-col gap-1 pl-7 pr-1 pb-1",
          )}
        >
          {branchName ? (
            <div
              title={`Branch: ${branchName}`}
              aria-label={`Branch ${branchName}`}
              className={cn(
                "flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)]/40",
                touchOptimized ? "shrink-0" : "w-full min-w-0 truncate",
              )}
            >
              <GitBranch className="h-3 w-3 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
              <span className="min-w-0 truncate font-semibold text-[var(--color-text)]">
                {branchName}
              </span>
            </div>
          ) : null}
          {showCommitStatus && shortHash ? (
            <span
              title={
                worktreeStatus?.lastCommit?.message
                  ? `Commit ${shortHash}: ${worktreeStatus.lastCommit.message}`
                  : `Commit ${shortHash}`
              }
              aria-label={
                worktreeStatus?.lastCommit?.message
                  ? `Commit ${shortHash}: ${worktreeStatus.lastCommit.message}`
                  : `Commit ${shortHash}`
              }
              className={cn(
                "flex items-center gap-1.5 rounded bg-[var(--color-surface-2)]/60 px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)]",
                touchOptimized ? "shrink-0" : "w-full min-w-0 truncate",
              )}
            >
              <GitCommit className="h-3 w-3 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
              <span className="shrink-0 font-semibold">{shortHash}</span>
              {!touchOptimized && worktreeStatus?.lastCommit?.message ? (
                <span className="min-w-0 truncate text-[10px] opacity-80">
                  {worktreeStatus.lastCommit.message}
                </span>
              ) : null}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <TraditionalTerminalWorktreeSelect
              projectName={group.projectName}
              profileId={group.profileId}
              projectRef={group.projectRef}
              touchOptimized={touchOptimized}
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}
