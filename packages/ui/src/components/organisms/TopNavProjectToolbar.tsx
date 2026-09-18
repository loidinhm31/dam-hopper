import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { ProjectSwitcher } from "@/components/organisms/ProjectSwitcher.js";
import { cn } from "@/lib/utils.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import type { ProjectRef } from "@/api/ownership.js";

interface TopNavProjectToolbarProps {
  compactMobileMenuOpen: boolean;
  project: ProjectRef;
}

export function TopNavProjectToolbar({
  compactMobileMenuOpen,
  project,
}: TopNavProjectToolbarProps) {
  const target = useProjectTarget(project);
  return (
    <div
      data-testid="top-nav-project-toolbar"
      data-mobile-menu-open={compactMobileMenuOpen}
      className={cn(
        "min-w-0 items-center gap-2",
        compactMobileMenuOpen ? "flex" : "hidden sm:flex",
      )}
    >
      <div className="min-w-0 flex-1">
        <ProjectSwitcher className="min-w-0" />
      </div>
      <div className="min-w-0 flex-1">
        <GitBranchControl
          project={project.project}
          target={target?.target}
          compact
          showFeedback={false}
          className="min-w-0"
        />
      </div>
    </div>
  );
}
