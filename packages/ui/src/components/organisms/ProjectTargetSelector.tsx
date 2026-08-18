import { useId } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { cn } from "@/lib/utils.js";
import type { Worktree } from "@/api/client.js";
import {
  worktreeTargetKey,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";
import { ProjectTargetWorktreeRow } from "@/components/organisms/ProjectTargetWorktreeRow.js";

interface ProjectTargetSelectorProps {
  projectRoot: string;
  target: ProjectTargetSnapshot;
  worktrees: Worktree[];
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isError: boolean;
  fallbackNotice: string | null;
  fallbackTargetPaths?: string[];
  removePendingPath: string | null;
  onSelect: (worktreePath: string | null) => void;
  onRefresh: () => void;
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

export function ProjectTargetSelector({
  projectRoot,
  target,
  worktrees,
  isLoading,
  isFetching,
  isFetched,
  isError,
  fallbackNotice,
  fallbackTargetPaths,
  removePendingPath,
  onSelect,
  onRefresh,
  onRemove,
}: ProjectTargetSelectorProps) {
  const groupId = useId().replaceAll(":", "");
  const selectedPath = target.target.worktreePath ?? null;
  const selectableWorktrees = worktrees.filter((worktree) => !worktree.isMain);

  return (
    <div className="space-y-2" data-testid="project-target-selector">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-muted)]">
          Select where workspace panels operate
        </p>
        <Button
          size="sm"
          variant="ghost"
          loading={isFetching}
          onClick={onRefresh}
          aria-label="Refresh worktrees"
          title="Refresh worktrees"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>

      {fallbackNotice && (
        <div
          className="space-y-1 text-xs text-[var(--color-warning)]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p>{fallbackNotice}</p>
          {fallbackTargetPaths && fallbackTargetPaths.length > 0 && (
            <ul
              className="list-disc space-y-0.5 pl-4 font-mono text-[10px]"
              aria-label="Unavailable worktree paths"
            >
              {fallbackTargetPaths.map((path) => (
                <li key={path} className="break-all">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <fieldset
        className="min-w-0 space-y-1"
        aria-busy={isFetching || undefined}
      >
        <legend className="text-xs font-semibold text-[var(--color-text)]">
          Active target
        </legend>
        <label
          htmlFor={`${groupId}-root`}
          className={targetRowClass(target.isRoot, false)}
        >
          <input
            id={`${groupId}-root`}
            type="radio"
            name={`${groupId}-target`}
            value="root"
            checked={target.isRoot}
            onChange={() => onSelect(null)}
            aria-describedby={`${groupId}-root-status`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[var(--color-text)]">
              Project root{target.isRoot ? " · Current target" : ""}
            </span>
            <span
              className="block truncate font-mono text-[10px] text-[var(--color-text-muted)]"
              id={`${groupId}-root-status`}
              title={projectRoot}
            >
              {projectRoot || "Configured project root"}
            </span>
          </span>
          <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
            Root
          </span>
        </label>

        {selectableWorktrees.map((worktree) => (
          <ProjectTargetWorktreeRow
            key={worktree.path}
            groupId={groupId}
            worktree={worktree}
            disabled={fallbackTargetPaths?.some(
              (path) =>
                worktreeTargetKey(target.project, path) ===
                worktreeTargetKey(target.project, worktree.path),
            )}
            selected={
              selectedPath != null &&
              worktreeTargetKey(target.project, selectedPath) ===
                worktreeTargetKey(target.project, worktree.path)
            }
            removePendingPath={removePendingPath}
            onSelect={onSelect}
            onRemove={onRemove}
          />
        ))}
      </fieldset>

      {isLoading && (
        <p className="text-xs text-[var(--color-text-muted)]" role="status">
          Discovering worktrees…
        </p>
      )}
      {isError && (
        <div className="flex items-center justify-between gap-2" role="alert">
          <p className="text-xs text-[var(--color-danger)]">
            Worktree discovery failed. Existing rows may be stale.
          </p>
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            Retry
          </Button>
        </div>
      )}
      {isFetched &&
        !isError &&
        !isLoading &&
        selectableWorktrees.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            No registered worktrees
          </p>
        )}
    </div>
  );
}
