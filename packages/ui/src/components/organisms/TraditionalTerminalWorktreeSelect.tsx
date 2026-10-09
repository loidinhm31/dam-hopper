import { useCallback, useId, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import type { ProjectRef } from "@/api/ownership.js";
import { useWorktrees } from "@/api/queries.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/Select.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useWorktreeTargetReconciliation } from "@/hooks/use-worktree-target-reconciliation.js";
import {
  isSelectableWorktree,
  normalizeWorktreePath,
  projectScopeKey,
  useProjectTargetStore,
  worktreeStatusLabel,
} from "@/stores/project-target.js";
import { cn } from "@/lib/utils.js";

export const WORKTREE_ROOT_SENTINEL = "__dam_hopper_root__";

export function distinguishWorktreePath(
  path: string,
  allPaths: readonly string[] = [],
): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return path;
  const basename = segments[segments.length - 1]!;
  const hasDuplicate = allPaths.some((other) => {
    if (other === path) return false;
    const otherNormalized = other.replaceAll("\\", "/").replace(/\/+$/, "");
    const otherSegments = otherNormalized.split("/").filter(Boolean);
    return (
      otherSegments.length > 0 &&
      otherSegments[otherSegments.length - 1] === basename
    );
  });
  if (hasDuplicate && segments.length > 1) {
    return `${segments[segments.length - 2]}/${basename}`;
  }
  return basename;
}

export interface TraditionalTerminalWorktreeSelectProps {
  projectName: string;
  profileId?: string;
  projectRef?: ProjectRef;
  touchOptimized?: boolean;
  className?: string;
}

export function TraditionalTerminalWorktreeSelect({
  projectName,
  profileId,
  projectRef,
  touchOptimized = false,
  className,
}: TraditionalTerminalWorktreeSelectProps) {
  const fallbackStatusId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const projectScope = useMemo<string | ProjectRef>(
    () =>
      projectRef ??
      (profileId ? { profileId, project: projectName } : projectName),
    [profileId, projectName, projectRef],
  );

  const targetSnapshot = useProjectTarget(projectScope);
  const selectedPath = targetSnapshot?.target.worktreePath ?? null;
  const projectScopeKeyStr = useMemo(
    () => projectScopeKey(projectScope),
    [projectScope],
  );
  const lastUnavailablePath = useProjectTargetStore(
    (state) => state.unavailableTargetByProject[projectScopeKeyStr],
  );
  const clearUnavailableTarget = useProjectTargetStore(
    (state) => state.clearUnavailableTarget,
  );

  const {
    data: worktrees = [],
    dataUpdatedAt,
    isFetched,
    isFetching,
    isError,
    refetch,
  } = useWorktrees(projectScope, {
    enabled: isOpen || selectedPath != null || Boolean(lastUnavailablePath),
    pollWhileVisible: isOpen,
  });

  const {
    isCurrentTargetUnavailable,
    fallbackNotice,
    selectedWorktree,
  } = useWorktreeTargetReconciliation({
    projectName,
    projectScope,
    worktrees,
    selectedPath,
    dataUpdatedAt,
    isFetched,
    isFetching,
    isError,
    enabled: true,
  });

  const selectTarget = useProjectTargetStore((state) => state.selectTarget);

  const allWorktreePaths = useMemo(
    () => worktrees.map((w) => w.path),
    [worktrees],
  );

  const secondaryWorktrees = useMemo(
    () => worktrees.filter((w) => !w.isMain),
    [worktrees],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open && typeof refetch === "function") {
        void refetch();
      }
    },
    [refetch],
  );

  const handleValueChange = useCallback(
    (nextValue: string) => {
      clearUnavailableTarget(projectScope);
      if (nextValue === WORKTREE_ROOT_SENTINEL) {
        selectTarget(projectScope, null);
        return;
      }
      const candidate = worktrees.find(
        (w) =>
          !w.isMain &&
          normalizeWorktreePath(w.path) === normalizeWorktreePath(nextValue),
      );
      if (candidate && isSelectableWorktree(candidate) && !candidate.isBare) {
        selectTarget(projectScope, candidate.path);
      }
    },
    [clearUnavailableTarget, projectScope, selectTarget, worktrees],
  );

  const currentTriggerLabel = useMemo(() => {
    if (selectedPath == null) {
      if (lastUnavailablePath) {
        const short = distinguishWorktreePath(
          lastUnavailablePath,
          allWorktreePaths,
        );
        return `${short} (missing · using root)`;
      }
      return "root";
    }
    const short = distinguishWorktreePath(selectedPath, allWorktreePaths);
    if (isCurrentTargetUnavailable) {
      return `${short} (unavailable)`;
    }
    const branch =
      selectedWorktree?.branch ||
      (selectedWorktree?.isDetached ? "Detached HEAD" : null);
    if (branch) {
      return `${branch} (${short})`;
    }
    return short;
  }, [
    allWorktreePaths,
    isCurrentTargetUnavailable,
    lastUnavailablePath,
    selectedPath,
    selectedWorktree,
  ]);

  const selectValue = selectedPath ?? WORKTREE_ROOT_SENTINEL;
  const effectiveMissingPath = selectedPath ?? lastUnavailablePath ?? null;
  const hasMissingSelectedTarget =
    effectiveMissingPath != null &&
    !worktrees.some(
      (w) =>
        normalizeWorktreePath(w.path) ===
        normalizeWorktreePath(effectiveMissingPath),
    );

  return (
    <div
      className={cn(
        "relative flex min-w-0 max-w-full items-center",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {fallbackNotice ? (
        <span
          id={fallbackStatusId}
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {fallbackNotice}
        </span>
      ) : null}
      <Select
        value={selectValue}
        onValueChange={handleValueChange}
        open={isOpen}
        onOpenChange={handleOpenChange}
      >
        <SelectTrigger
          aria-label={`Worktree for ${projectName}: ${currentTriggerLabel}`}
          aria-describedby={fallbackNotice ? fallbackStatusId : undefined}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            "h-7 w-full min-w-0 gap-1.5 px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors rounded bg-[var(--color-surface-2)]/60 hover:bg-[var(--color-surface-2)] border border-[var(--color-border)]/80 focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
            (isCurrentTargetUnavailable || Boolean(lastUnavailablePath)) &&
              "border-[var(--color-warning)]/60 text-[var(--color-warning)]",
            touchOptimized && "min-h-11 text-sm px-3",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <GitBranch
              className="h-3.5 w-3.5 shrink-0 opacity-70"
              aria-hidden="true"
            />
            <span className="truncate">{currentTriggerLabel}</span>
          </div>
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          className="w-[min(24rem,var(--radix-select-trigger-width))]"
        >
          <SelectGroup>
            <SelectItem
              value={WORKTREE_ROOT_SENTINEL}
              title={`Project root: ${projectName}`}
              aria-label={`Project root: ${projectName}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                <span className="font-medium text-[var(--color-text)]">
                  Project root
                </span>
              </span>
            </SelectItem>
          </SelectGroup>
          {secondaryWorktrees.length > 0 ? (
            <SelectGroup>
              <SelectSeparator />
              {secondaryWorktrees.map((worktree) => {
                const selectable =
                  isSelectableWorktree(worktree) && !worktree.isBare;
                const short = distinguishWorktreePath(
                  worktree.path,
                  allWorktreePaths,
                );
                const branchLabel =
                  worktree.branch ||
                  (worktree.isDetached ? "Detached HEAD" : "Detached");
                const status = worktreeStatusLabel(worktree);
                const accessibleLabel = `Branch ${branchLabel}; Worktree ${worktree.path}; ${status}`;

                return (
                  <SelectItem
                    key={worktree.path}
                    value={worktree.path}
                    disabled={!selectable}
                    title={worktree.path}
                    aria-label={accessibleLabel}
                  >
                    <span className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-xs text-[var(--color-text)]">
                        {branchLabel}{" "}
                        <span className="text-[var(--color-text-muted)]">
                          ({short})
                        </span>
                        {worktree.isLocked ? (
                          <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">
                            · Locked
                          </span>
                        ) : null}
                      </span>
                      {!selectable ? (
                        <span className="truncate text-[10px] text-[var(--color-warning)]">
                          {status}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ) : null}
          {hasMissingSelectedTarget && effectiveMissingPath ? (
            <SelectGroup>
              <SelectSeparator />
              <SelectItem
                value={effectiveMissingPath}
                disabled
                title={effectiveMissingPath}
                aria-label={`Missing worktree: ${effectiveMissingPath}`}
              >
                <span className="truncate text-xs text-[var(--color-warning)]">
                  {distinguishWorktreePath(effectiveMissingPath, allWorktreePaths)}{" "}
                  (Missing)
                </span>
              </SelectItem>
            </SelectGroup>
          ) : null}
          {secondaryWorktrees.length === 0 && !hasMissingSelectedTarget ? (
            <SelectGroup>
              <SelectSeparator />
              {isFetching ? (
                <SelectLabel className="text-[10px] font-normal text-[var(--color-text-muted)] italic">
                  Loading worktrees…
                </SelectLabel>
              ) : isError ? (
                <SelectLabel className="text-[10px] font-normal text-[var(--color-text-muted)] italic">
                  Worktrees unavailable
                </SelectLabel>
              ) : (
                <SelectLabel className="text-[10px] font-normal text-[var(--color-text-muted)] italic">
                  No secondary worktrees
                </SelectLabel>
              )}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
