import { useState } from "react";
import { GitBranch, GitMerge, Folder, Terminal } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { CollapsibleSection } from "@/components/atoms/CollapsibleSection.js";
import { useProject, useProjectStatus } from "@/api/queries.js";
import type { TreeCommand } from "@/hooks/use-terminal-tree.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import type { ProjectTargetSnapshot } from "@/stores/project-target.js";
import { ProjectInfoCommandsSection } from "@/components/organisms/ProjectInfoCommandsSection.js";
import { ProjectInfoGitSection } from "@/components/organisms/ProjectInfoGitSection.js";
import { ProjectWorktreesSection } from "@/components/organisms/ProjectWorktreesSection.js";

export * from "./ProjectInfoHelpers.js";

interface Props {
  projectName: string;
  target?: ProjectTargetSnapshot | null;
  onLaunchCommand?: (command: TreeCommand) => void;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] font-mono">
      {type}
    </span>
  );
}

function StatusBadge({ isClean }: { isClean: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs font-medium",
        isClean
          ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
          : "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
      )}
    >
      {isClean ? "clean" : "dirty"}
    </span>
  );
}

export function ProjectInfoPanel({
  projectName,
  target: targetOverride,
  onLaunchCommand,
}: Props) {
  const { data: project, isLoading } = useProject(projectName);
  const derivedTarget = useProjectTarget(projectName);
  const target = targetOverride ?? derivedTarget;
  const targetRef = target?.target ?? { project: projectName };
  const { data: targetStatus } = useProjectStatus(targetRef);
  const [worktreesOpen, setWorktreesOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        Project not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 flex-wrap">
          <Folder className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {project.name}
          </h2>
          <TypeBadge type={project.type} />
          {(targetStatus ?? project.status) && (
            <>
              <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <GitBranch className="h-3 w-3" />
                {(targetStatus ?? project.status)?.branch}
              </span>
              <StatusBadge
                isClean={(targetStatus ?? project.status)?.isClean ?? true}
              />
            </>
          )}
        </div>
      </div>

      <div className="flex-1">
        <CollapsibleSection
          title="Git Operations"
          icon={GitBranch}
          defaultOpen={true}
        >
          <ProjectInfoGitSection projectName={projectName} target={targetRef} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Worktrees"
          icon={GitMerge}
          open={worktreesOpen}
          onToggle={setWorktreesOpen}
        >
          {target && (
            <ProjectWorktreesSection
              projectName={projectName}
              projectRoot={project.path}
              target={target}
              isVisible={worktreesOpen}
            />
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Commands" icon={Terminal} defaultOpen={true}>
          <ProjectInfoCommandsSection
            projectName={projectName}
            onLaunchCommand={onLaunchCommand}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
