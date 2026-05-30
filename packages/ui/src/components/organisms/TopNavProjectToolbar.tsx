import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { ProjectSwitcher } from "@/components/organisms/ProjectSwitcher.js";
import { cn } from "@/lib/utils.js";

interface TopNavProjectToolbarProps {
  compactMobileMenuOpen: boolean;
  project: string;
}

export function TopNavProjectToolbar({
  compactMobileMenuOpen,
  project,
}: TopNavProjectToolbarProps) {
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
          project={project}
          compact
          showFeedback={false}
          className="min-w-0"
        />
      </div>
    </div>
  );
}
