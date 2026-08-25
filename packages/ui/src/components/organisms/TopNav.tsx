import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils.js";
import { useIpc } from "@/hooks/use-sse.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { TopNavBrand } from "@/components/molecules/TopNavBrand.js";
import { TopNavMenuButton } from "@/components/atoms/TopNavMenuButton.js";
import { TopNavAppZoomControls } from "@/components/atoms/TopNavAppZoomControls.js";
import { useAppZoom } from "@/contexts/AppZoomContext.js";
import { TopNavRouteMenu } from "@/components/organisms/TopNavRouteMenu.js";
import { TopNavUtilityStrip } from "@/components/organisms/TopNavUtilityStrip.js";
import { TopNavProjectToolbar } from "@/components/organisms/TopNavProjectToolbar.js";
import { TerminalNotificationCenter } from "@/components/organisms/TerminalNotificationCenter.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  getProfileChangeVersion,
  getServerUrl,
  buildAuthHeaders,
  type ServerProfile,
} from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { getAppZoomFactor } from "@/lib/app-zoom.js";

interface TopNavProps {
  collapsed?: boolean;
  onToggle?: () => void;
  workspaceMode?: WorkspaceMode;
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
}

export function TopNav({
  collapsed = true,
  onToggle,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
}: TopNavProps) {
  const { level: appZoomLevel } = useAppZoom();
  const headerRef = useRef<HTMLElement>(null);
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

  const activeProfile = useServerProfile();
  const profileRevision = getProfileChangeVersion();
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
        const res = await fetch(
          `${activeProfile?.url ?? getServerUrl()}/api/auth/status`,
          {
            headers: buildAuthHeaders(activeProfile?.id),
          },
        );
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
  }, [activeProfile?.id, activeProfile?.url, profileRevision, status]);

  useEffect(() => {
    const updateHeight = () => {
      const height = headerRef.current?.getBoundingClientRect().height;
      if (height) {
        document.documentElement.style.setProperty(
          "--top-nav-height",
          `${height / getAppZoomFactor()}px`,
        );
      }
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    if (headerRef.current) observer.observe(headerRef.current);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
      document.documentElement.style.removeProperty("--top-nav-height");
    };
  }, [appZoomLevel, compactMobileMenuOpen, isCompactWorkspace]);

  return (
    <header
      ref={headerRef}
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
            <TopNavBrand />
            <div className="flex shrink-0 items-center gap-1">
              <TopNavMenuButton collapsed={collapsed} onToggle={onToggle} />
              <TopNavAppZoomControls />
              {isCompactWorkspace && (
                <div data-testid="top-nav-compact-notifications">
                  <TerminalNotificationCenter />
                </div>
              )}
            </div>
          </div>

          <TopNavRouteMenu
            collapsed={collapsed}
            compactLabelClass={compactLabelClass}
            compactTextClass={compactTextClass}
            isCompactWorkspace={isCompactWorkspace}
          />
        </div>

        <TopNavUtilityStrip
          activeProfileName={activeProfile?.name}
          compactLabelClass={compactLabelClass}
          compactMobileMenuOpen={compactMobileMenuOpen}
          devMode={isDevMode}
          isCompactWorkspace={isCompactWorkspace}
          onOpenProfiles={() => setProfilesDialogOpen(true)}
          onWorkspaceModeChange={onWorkspaceModeChange}
          selectedProject={selectedProject}
          showProjectToolbar={showProjectToolbar}
          status={status}
          workspaceMode={workspaceMode}
          workspaceModeShortcutLabel={workspaceModeShortcutLabel}
        />
      </div>

      {isCompactWorkspace && showProjectToolbar && selectedProject && (
        <TopNavProjectToolbar
          compactMobileMenuOpen={compactMobileMenuOpen}
          project={selectedProject}
        />
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
      />
    </header>
  );
}
