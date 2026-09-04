import { FolderGit2, Layers, ListTodo, Play } from "lucide-react";
import type { ProjectTargetRef } from "@/api/client.js";
import type { ProjectDto } from "@/api/workflow-dto-types.js";
import { cn } from "@/lib/utils.js";

export interface WorkflowProjectListProps {
  projects: ProjectDto[];
  selectedTarget?: ProjectTargetRef | null;
  onSelectTarget: (target: ProjectTargetRef | null) => void;
}

export function WorkflowProjectList({
  projects,
  selectedTarget,
  onSelectTarget,
}: WorkflowProjectListProps) {
  const isAllSelected = !selectedTarget;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] pb-2 font-semibold text-[var(--color-text)]">
        <div className="flex items-center gap-1.5">
          <FolderGit2 className="h-4 w-4 text-[var(--color-primary)]" />
          <span>Projects</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onSelectTarget(null)}
            className={cn(
              "flex w-full items-center justify-between rounded p-2 text-left transition-colors cursor-pointer",
              "hover:bg-[var(--color-surface-2)]/70",
              isAllSelected
                ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-primary)]"
                : "text-[var(--color-text)]",
            )}
          >
            <span>All Projects</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {projects.length}
            </span>
          </button>

          {projects.map((proj) => {
            const isSelected =
              selectedTarget?.project === proj.project &&
              (selectedTarget?.worktreePath ?? null) ===
                (proj.target?.worktreePath ?? null);

            return (
              <button
                key={`${proj.project}-${proj.target?.worktreePath ?? ""}`}
                type="button"
                onClick={() =>
                  onSelectTarget({
                    project: proj.project,
                    worktreePath: proj.target?.worktreePath ?? undefined,
                  })
                }
                className={cn(
                  "flex flex-col gap-1 rounded p-2 text-left transition-colors cursor-pointer",
                  "hover:bg-[var(--color-surface-2)]/70",
                  isSelected
                    ? "bg-[var(--color-surface-2)] border-l-2 border-l-[var(--color-primary)] font-medium text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-medium text-[var(--color-text)]">
                    {proj.project}
                  </span>
                  {proj.runningSessionCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-primary)] font-medium">
                      <Play className="h-2.5 w-2.5 fill-current" />
                      {proj.runningSessionCount}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {proj.planCount} plans
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ListTodo className="h-3 w-3" />
                    {proj.taskCount} tasks
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
