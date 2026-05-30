import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X, ServerCog } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ConnectionDot } from "@/components/atoms/ConnectionDot.js";
import { Logo } from "@/components/atoms/Logo.js";
import { useIpc } from "@/hooks/use-sse.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";
import { ProjectSwitcher } from "@/components/organisms/ProjectSwitcher.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { HostResourcePopover } from "@/components/organisms/HostResourcePopover.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  getActiveProfile,
  getServerUrl,
  buildAuthHeaders,
  type ServerProfile,
} from "@/api/server-config.js";
import { BASE_NAV } from "@/lib/navigation.js";

interface TopNavProps {
  collapsed?: boolean;
  onToggle?: () => void;
  workspaceMode?: WorkspaceMode;
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
}

function TopNavRouteMenu({
  collapsed,
  isCompactWorkspace,
  compactTextClass,
  compactLabelClass,
}: {
  collapsed: boolean;
  isCompactWorkspace: boolean;
  compactTextClass: string;
  compactLabelClass: string;
}) {
  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "items-center gap-1 overflow-hidden transition-all duration-300 ease-in-out",
          isCompactWorkspace ? "hidden sm:flex" : "flex",
          collapsed
            ? "max-w-0 pointer-events-none opacity-0"
            : "ml-1 max-w-[120px] opacity-100 sm:ml-2 sm:max-w-[180px] lg:max-w-[500px] xl:max-w-[1000px]",
        )}
      >
        {BASE_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-sm border-b px-2 py-1.5 font-bold whitespace-nowrap transition-all sm:px-2.5",
                isCompactWorkspace ? compactTextClass : "text-xs",
                isActive
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-text)] opacity-50 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] hover:opacity-100",
              )
            }
          >
            <Icon className="h-3.5 w-3.5" />
            <span
              className={cn(
                "hidden tracking-widest lg:inline",
                isCompactWorkspace ? compactLabelClass : "text-[10px]",
              )}
            >
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {isCompactWorkspace && !collapsed && (
        <nav
          aria-label="Primary"
          className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-2 sm:hidden"
        >
          {BASE_NAV.map(({ to, icon: Icon, label }, index) => {
            const isOddTail =
              BASE_NAV.length % 2 === 1 && index === BASE_NAV.length - 1;

            return (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 font-bold transition-colors",
                    compactTextClass,
                    isOddTail && "col-span-2",
                    isActive
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
                  )
                }
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span
                  className={cn(
                    "min-w-0 truncate tracking-widest",
                    compactLabelClass,
                  )}
                >
                  {label}
                </span>
              </NavLink>
            );
          })}
        </nav>
      )}
    </>
  );
}

export function TopNav({
  collapsed = true,
  onToggle,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
}: TopNavProps) {
  const { status } = useIpc();
  const { activeProject } = useWorkspaceStore();
  const isCompactWorkspace = useCompactWorkspace();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [profilesDialogOpen, setProfilesDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<
    ServerProfile | null | undefined
  >(undefined);
  const [isDevMode, setIsDevMode] = useState(false);

  const activeProfile = getActiveProfile();
  const selectedProject = activeProject ?? projects[0]?.name;
  const showProjectToolbar = projects.length > 0 && Boolean(selectedProject);
  const compactMobileMenuOpen = isCompactWorkspace && !collapsed;
  const compactTextClass = "text-[length:calc(var(--app-font-size)*0.75)]";
  const compactLabelClass = "text-[length:calc(var(--app-font-size)*0.65)]";

  useEffect(() => {
    let cancelled = false;

    const checkDevMode = async () => {
      if (status !== "connected") {
        if (!cancelled) {
          setIsDevMode(false);
        }
        return;
      }

      try {
        const res = await fetch(`${getServerUrl()}/api/auth/status`, {
          headers: buildAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setIsDevMode(!!data.dev_mode);
          }
        }
      } catch {}
    };

    void checkDevMode();

    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <header
      className={cn(
        "safe-area-inline safe-area-top shrink-0 glass-card z-50 overflow-visible border-b border-[var(--color-border)]",
        isCompactWorkspace
          ? "flex flex-col gap-2 px-2 py-2"
          : "flex min-h-12 flex-row items-center justify-between gap-2 px-4 py-0",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 gap-2",
          isCompactWorkspace
            ? "flex-col"
            : "flex-1 items-center justify-between",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 gap-2",
            isCompactWorkspace
              ? "flex-col sm:flex-row sm:items-center sm:justify-between"
              : "items-center gap-4",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-center justify-between gap-2",
              isCompactWorkspace && "w-full sm:w-auto",
            )}
          >
            <div className="flex flex-shrink-0 items-center gap-2">
              <Logo size="sm" />
              <span className="hidden text-[10px] font-bold tracking-widest text-[var(--color-primary)] opacity-70 xl:inline">
                DAM-HOPPER
              </span>
            </div>

            <button
              type="button"
              onClick={onToggle}
              className="flex-shrink-0 rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              title={collapsed ? "Show menu" : "Hide menu"}
            >
              {collapsed ? <Menu size={16} /> : <X size={16} />}
            </button>
          </div>

          <TopNavRouteMenu
            collapsed={collapsed}
            isCompactWorkspace={isCompactWorkspace}
            compactTextClass={compactTextClass}
            compactLabelClass={compactLabelClass}
          />
        </div>

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
              "min-w-0",
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
              <div
                className="flex items-center rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-0.5"
                title={
                  workspaceModeShortcutLabel
                    ? `Switch workspace mode (${workspaceModeShortcutLabel})`
                    : "Switch workspace mode"
                }
              >
                {(["ide", "terminal"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onWorkspaceModeChange(mode)}
                    aria-pressed={workspaceMode === mode}
                    className={cn(
                      "rounded-[3px] px-1.5 py-1 font-bold uppercase tracking-wider transition-colors",
                      !isCompactWorkspace && "sm:px-2",
                      isCompactWorkspace ? compactLabelClass : "text-[10px]",
                      workspaceMode === mode
                        ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                    )}
                  >
                    {mode === "ide" ? "IDE" : "Terminal"}
                  </button>
                ))}
              </div>
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

            <button
              type="button"
              onClick={() => setProfilesDialogOpen(true)}
              className="flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-[var(--color-surface-2)]"
              title={activeProfile?.name || "Server connection"}
            >
              <ConnectionDot
                status={status}
                collapsed={isCompactWorkspace}
                devMode={isDevMode}
              />
              {activeProfile && (
                <span
                  className={cn(
                    "font-bold tracking-wider text-[var(--color-text-muted)] uppercase",
                    isCompactWorkspace
                      ? compactMobileMenuOpen
                        ? compactLabelClass
                        : "hidden"
                      : "hidden text-[10px] xl:inline",
                  )}
                >
                  {activeProfile.name}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setProfilesDialogOpen(true)}
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
      </div>

      {isCompactWorkspace && showProjectToolbar && selectedProject && (
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
              project={selectedProject}
              compact
              showFeedback={false}
              className="min-w-0"
            />
          </div>
        </div>
      )}

      <ServerSettingsDialog
        open={serverSettingsOpen}
        onClose={() => {
          setServerSettingsOpen(false);
          setEditingProfile(undefined);
        }}
        profile={editingProfile}
        onSaved={() => {
          setServerSettingsOpen(false);
          setEditingProfile(undefined);
        }}
      />
      <ServerProfilesDialog
        open={profilesDialogOpen}
        onClose={() => setProfilesDialogOpen(false)}
        onEditProfile={(p) => {
          setProfilesDialogOpen(false);
          setEditingProfile(p);
          setServerSettingsOpen(true);
        }}
        onSwitchProfile={() => {}}
      />
    </header>
  );
}
