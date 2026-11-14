import { useMemo } from "react";
import { FolderGit2, Globe, Layers, ListTodo, Play } from "lucide-react";
import type { ProjectTargetRef } from "@/api/client.js";
import {
  GLOBAL_WORKSPACE_PROJECT,
  type ProjectDto,
} from "@/api/workflow-dto-types.js";
import { cn } from "@/lib/utils.js";

export interface WorkflowProjectListProps {
  projects: ProjectDto[];
  configuredProjects?: Array<{ name: string }>;
  selectedTarget?: ProjectTargetRef | null;
  onSelectTarget: (target: ProjectTargetRef | null) => void;
  showAllOption?: boolean;
  showGlobalWorkspaceOption?: boolean;
}

export function WorkflowProjectList({
  projects,
  configuredProjects = [],
  selectedTarget,
  onSelectTarget,
  showAllOption = true,
  showGlobalWorkspaceOption = true,
}: WorkflowProjectListProps) {
  const isAllSelected = !selectedTarget;
  const isGlobalSelected = selectedTarget?.project === GLOBAL_WORKSPACE_PROJECT;

  const globalSummary = useMemo(
    () => projects.find((p) => p.project === GLOBAL_WORKSPACE_PROJECT),
    [projects],
  );

  const mergedProjects = useMemo(() => {
    const byName = new Map<string, ProjectDto>();
    for (const proj of projects) {
      if (proj.project === GLOBAL_WORKSPACE_PROJECT) continue;
      byName.set(`${proj.project}::${proj.target?.worktreePath ?? ""}`, proj);
    }
    for (const cfg of configuredProjects) {
      if (!cfg.name || cfg.name === GLOBAL_WORKSPACE_PROJECT) continue;
      const hasAny = Array.from(byName.values()).some(
        (p) => p.project === cfg.name,
      );
      if (!hasAny) {
        byName.set(`${cfg.name}::`, {
          project: cfg.name,
          target: { project: cfg.name, worktreePath: null },
          planCount: 0,
          taskCount: 0,
          runningSessionCount: 0,
          lastActivityAt: null,
        });
      }
    }
    return Array.from(byName.values());
  }, [projects, configuredProjects]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] pb-2 font-semibold text-[var(--color-text)]">
        <div className="flex items-center gap-1.5">
          <FolderGit2 className="h-4 w-4 text-[var(--color-primary)]" />
          <span>Spaces</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1">
          {showAllOption && (
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
                {mergedProjects.length}
              </span>
            </button>
          )}

          {showGlobalWorkspaceOption && (
            <button
              type="button"
              data-testid="workflow-space-general"
              onClick={() =>
                onSelectTarget({
                  project: GLOBAL_WORKSPACE_PROJECT,
                })
              }
              className={cn(
                "flex flex-col gap-1 rounded p-2 text-left transition-colors cursor-pointer",
                "hover:bg-[var(--color-surface-2)]/70",
                isGlobalSelected
                  ? "bg-[var(--color-surface-2)] border-l-2 border-l-[var(--color-primary)] font-medium text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)]",
              )}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="inline-flex items-center gap-1.5 truncate font-medium text-[var(--color-text)]">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                  <span className="truncate">General</span>
                </span>
                {(globalSummary?.runningSessionCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-primary)] font-medium">
                    <Play className="h-2.5 w-2.5 fill-current" />
                    {globalSummary?.runningSessionCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
                <span>Global workspace</span>
                {globalSummary && (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <Layers className="h-3 w-3" />
                      {globalSummary.planCount}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ListTodo className="h-3 w-3" />
                      {globalSummary.taskCount}
                    </span>
                  </>
                )}
              </div>
            </button>
          )}

          {mergedProjects.length > 0 && (
            <div className="pt-1 pb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Projects
            </div>
          )}

          {mergedProjects.map((proj) => {
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
