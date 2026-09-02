import { ServerCog } from "lucide-react";
import { HostResourcePopover } from "@/components/organisms/HostResourcePopover.js";
import { TerminalNotificationCenter } from "@/components/organisms/TerminalNotificationCenter.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";
import { ProjectSwitcher } from "@/components/organisms/ProjectSwitcher.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { TopNavWorkspaceModeSwitch } from "@/components/molecules/TopNavWorkspaceModeSwitch.js";
import { TopNavConnectionButton } from "@/components/molecules/TopNavConnectionButton.js";
import type { ConnectionStatus } from "@/components/atoms/ConnectionDot.js";
import { cn } from "@/lib/utils.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";

interface TopNavUtilityStripProps {
  activeProfileName?: string;
  compactLabelClass: string;
  compactMobileMenuOpen: boolean;
  devMode: boolean;
  isCompactWorkspace: boolean;
  onOpenProfiles: () => void;
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  selectedProject?: string;
  showProjectToolbar: boolean;
  status: ConnectionStatus;
  workspaceMode?: WorkspaceMode;
  workspaceModeShortcutLabel?: string;
}

export function TopNavUtilityStrip({
  activeProfileName,
  compactLabelClass,
  compactMobileMenuOpen,
  devMode,
  isCompactWorkspace,
  onOpenProfiles,
  onWorkspaceModeChange,
  selectedProject,
  showProjectToolbar,
  status,
  workspaceMode,
  workspaceModeShortcutLabel,
}: TopNavUtilityStripProps) {
  const selectedTarget = useProjectTarget(selectedProject ?? null);
  return (
    <div
      data-testid="top-nav-utility-strip"
      data-mobile-menu-open={compactMobileMenuOpen}
      className={cn(
        "min-w-0 items-center",
        isCompactWorkspace
          ? compactMobileMenuOpen
            ? "flex w-full flex-wrap justify-between gap-2 sm:w-auto sm:flex-nowrap sm:justify-end sm:gap-1.5"
            : "hidden sm:flex sm:w-auto sm:flex-nowrap sm:justify-end sm:gap-1.5"
          : "flex justify-end gap-3",
      )}
    >
      <div
        className={cn(
          "min-w-0 shrink-0",
          !isCompactWorkspace && "max-w-none",
          isCompactWorkspace && "flex-1 sm:max-w-[9.5rem] sm:flex-none",
        )}
      >
        <WorkspaceSwitcher variant="compact" />
      </div>

      {workspaceMode && onWorkspaceModeChange && (
        <>
          <div
            className={cn(
              "hidden h-4 w-[1px] bg-[var(--color-border)]",
              !isCompactWorkspace && "md:block",
            )}
          />
          <TopNavWorkspaceModeSwitch
            compactLabelClass={compactLabelClass}
            isCompactWorkspace={isCompactWorkspace}
            workspaceMode={workspaceMode}
            workspaceModeShortcutLabel={workspaceModeShortcutLabel}
            onWorkspaceModeChange={onWorkspaceModeChange}
          />
        </>
      )}

      {!isCompactWorkspace && showProjectToolbar && selectedProject && (
        <>
          <div className="hidden h-4 w-[1px] bg-[var(--color-border)] md:block" />
          <div className="hidden min-w-0 md:block">
            <ProjectSwitcher />
          </div>

          <div className="hidden h-4 w-[1px] bg-[var(--color-border)] md:block" />
          <div className="hidden min-w-0 md:block">
            <GitBranchControl
              project={selectedProject}
              target={selectedTarget?.target}
              compact
              showFeedback={false}
            />
          </div>
        </>
      )}

      <div className="h-4 w-[1px] bg-[var(--color-border)]" />

      <div
        className={cn(
          "flex flex-shrink-0 items-center",
          isCompactWorkspace ? "gap-1" : "gap-2",
        )}
      >
        {!isCompactWorkspace && (
          <div data-testid="top-nav-desktop-notifications">
            <TerminalNotificationCenter />
          </div>
        )}

        <div
          data-testid="top-nav-resource-control"
          data-mobile-visible={compactMobileMenuOpen}
          className={cn(
            isCompactWorkspace
              ? compactMobileMenuOpen
                ? "block"
                : "hidden"
              : "hidden sm:block",
          )}
        >
          <HostResourcePopover />
        </div>

        <TopNavConnectionButton
          activeProfileName={activeProfileName}
          compactLabelClass={compactLabelClass}
          compactMobileMenuOpen={compactMobileMenuOpen}
          devMode={devMode}
          isCompactWorkspace={isCompactWorkspace}
          onClick={onOpenProfiles}
          status={status}
        />

        <button
          type="button"
          onClick={onOpenProfiles}
          className={cn(
            "rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
            isCompactWorkspace
              ? compactMobileMenuOpen
                ? "inline-flex"
                : "hidden"
              : "hidden sm:block",
          )}
          data-testid="top-nav-server-manage"
          data-mobile-visible={compactMobileMenuOpen}
          title="Manage server connections"
        >
          <ServerCog size={16} />
        </button>
      </div>
    </div>
  );
}
