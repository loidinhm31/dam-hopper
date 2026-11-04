import { useCallback, useState, useRef, useEffect } from "react";
import {
  useShellInputContext,
  type ShellInputContextValue,
} from "./shell-input-context.js";
import { Server } from "lucide-react";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import { useWindowStore } from "./window-store.js";
import { DesktopSwitcher } from "./DesktopSwitcher.js";
import { WindowList } from "./WindowList.js";
import { readServerProfiles, type ServerProfile } from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useProjects } from "@/api/queries.js";
import { ProfileBadge } from "@/components/atoms/ProfileBadge.js";
import { MonitorTray } from "./MonitorTray.js";
export interface TopBarProps {
  onOpenPalette?: () => void;
  onOpenNotifications?: () => void;
  onOpenMonitor?: (profileId?: string, incidentId?: string) => void;
  unreadNotificationsCount?: number;
  className?: string;
}

export function TopBar({
  onOpenPalette,
  onOpenNotifications,
  unreadNotificationsCount = 0,
  onOpenMonitor,
  className = "",
}: TopBarProps) {
  const session = useWindowStore((state) => state.session);
  const setDefaultCtx = useWindowStore((state) => state.setDefaultCtx);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);

  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ??
    session.desktops[0];

  const activeProfile = useServerProfile();
  const knownProfiles = readServerProfiles();
  const availableProfiles: ServerProfile[] =
    knownProfiles.status === "available" ? knownProfiles.profiles : [];
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  let shellInput: ShellInputContextValue | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    shellInput = useShellInputContext();
  } catch {
    // Standalone fallback
  }

  const targetMenuRef = useRef<HTMLDivElement>(null);
  const [localCtxMenuOpen, setLocalCtxMenuOpen] = useState(false);
  const isCtxMenuOpen = shellInput
    ? shellInput.activeNonmodal === "target-selector"
    : localCtxMenuOpen;

  const setIsCtxMenuOpen = useCallback(
    (open: boolean) => {
      if (shellInput) {
        shellInput.setSurfaceOpen("target-selector", open);
      } else {
        setLocalCtxMenuOpen(open);
      }
    },
    [shellInput],
  );

  useEffect(() => {
    if (!isCtxMenuOpen) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (
        targetMenuRef.current &&
        !targetMenuRef.current.contains(target) &&
        !target?.closest?.('[data-os-nonmodal-trigger="target-selector"]')
      ) {
        setIsCtxMenuOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsCtxMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCtxMenuOpen, setIsCtxMenuOpen]);

  const [isProfilesDialogOpen, setIsProfilesDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null | undefined>(undefined);
  // Default context for new windows on active desktop
  const currentDefaultCtx = activeDesktop?.defaultCtx ?? {
    profileId: activeProfile?.id ?? "default",
    projectId: activeProject ?? undefined,
  };

  const { data: defaultProjects = [] } = useProjects({
    profileId: currentDefaultCtx.profileId,
  });
  const setSelectedProject = useWorkspaceStore(
    (state) => state.setSelectedProject,
  );

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      if (!activeDesktop) return;
      setDefaultCtx(activeDesktop.id, {
        profileId,
        projectId: undefined,
        worktreeId: undefined,
      });
      setSelectedProject(null);
    },
    [activeDesktop, setDefaultCtx, setSelectedProject],
  );

  const handleSelectProject = useCallback(
    (projectName: string) => {
      if (!activeDesktop) return;
      setDefaultCtx(activeDesktop.id, {
        ...currentDefaultCtx,
        projectId: projectName,
        worktreeId: undefined,
      });
      setSelectedProject({
        profileId: currentDefaultCtx.profileId,
        project: projectName,
      });
      setIsCtxMenuOpen(false);
    },
    [activeDesktop, currentDefaultCtx, setDefaultCtx, setSelectedProject],
  );

  const minimizedWindows = Object.values(session.windows).filter(
    (w) => w.minimized && w.desktopId === session.activeDesktopId,
  );

  return (
    <header
      role="banner"
      className={`flex items-center justify-between px-3 h-[var(--os-topbar-height)] border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs z-50 select-none ${className}`}
    >
      {/* Left: Brand mark + Desktop tabs */}
      <div className="flex items-center gap-3">
        <span
          className="font-bold tracking-wider text-[var(--color-primary)] font-mono text-[11px]"
          title="DamHopper Operating System"
        >
          DH//OS
        </span>

        <div className="h-4 w-px bg-[var(--color-border)]" />

        <DesktopSwitcher />
      </div>

      {/* Center: Context Selector (New Windows Only) + Command Palette Trigger */}
      <div className="flex items-center gap-2">
        {/* Context Selector */}
        <div className="relative">
          <button
            type="button"
            aria-label="Default context for new windows"
            aria-expanded={isCtxMenuOpen}
            data-os-nonmodal-trigger="target-selector"
            onClick={() => setIsCtxMenuOpen(!isCtxMenuOpen)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors text-[11px]"
          >
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Target:
            </span>
            <ProfileBadge
              name={
                availableProfiles.find((p) => p.id === currentDefaultCtx.profileId)
                  ?.name ?? currentDefaultCtx.profileId
              }
              profileId={currentDefaultCtx.profileId}
              className="px-1 py-0 text-[10px]"
            />
            {currentDefaultCtx.projectId && (
              <span className="text-[var(--color-text)] font-mono text-[10px]">
                /{currentDefaultCtx.projectId}
              </span>
            )}
            <span className="text-[10px] text-[var(--color-text-muted)]">▾</span>
          </button>

          {isCtxMenuOpen && (
            <div
              ref={targetMenuRef}
              role="menu"
              data-os-nonmodal-surface="target-selector"
              className="absolute left-0 mt-1 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-1 z-50 text-xs"
            >
              <div className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--color-border)] mb-1">
                Default for New Windows
              </div>
              <div className="max-h-36 overflow-y-auto">
                {availableProfiles.map((p) => {
                  const isSelected = p.id === currentDefaultCtx.profileId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleSelectProfile(p.id)}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left truncate transition-colors ${
                        isSelected
                          ? "bg-[var(--color-surface-hover)] font-medium text-[var(--color-primary)]"
                          : "text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {isSelected && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
              {defaultProjects.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold border-b border-t border-[var(--color-border)] my-1">
                    Active Project
                  </div>
                  <div className="max-h-36 overflow-y-auto">
                    {defaultProjects.map((proj) => {
                      const isProjSelected =
                        proj.name === currentDefaultCtx.projectId;
                      return (
                        <button
                          key={proj.name}
                          type="button"
                          role="menuitem"
                          onClick={() => handleSelectProject(proj.name)}
                          className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left truncate transition-colors ${
                            isProjSelected
                              ? "bg-[var(--color-surface-hover)] font-medium text-[var(--color-primary)]"
                              : "text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                          }`}
                        >
                          <span className="truncate">{proj.name}</span>
                          {isProjSelected && <span>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="border-t border-[var(--color-border)] mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsCtxMenuOpen(false);
                    setIsProfilesDialogOpen(true);
                  }}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-[11px] text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <Server className="h-3.5 w-3.5" />
                  <span>Manage Profiles…</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Command Palette Trigger */}
        <button
          type="button"
          aria-label="Open command palette (Ctrl+Alt+K)"
          onClick={onOpenPalette}
          className="flex items-center gap-2 px-2.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors text-[11px]"
        >
          <span>Search commands, agents…</span>
          <kbd className="hidden sm:inline-block px-1 py-0.2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-[9px] text-[var(--color-text-muted)]">
            Ctrl+Alt+K
          </kbd>
        </button>
      </div>

      {/* Right: MonitorTray + Minimized tray + WindowList + Notification bell */}
      <div className="flex items-center gap-2">
        <MonitorTray onOpenMonitor={onOpenMonitor} />

        {/* Minimized Tray */}
        {minimizedWindows.length > 0 && (
          <div className="hidden md:flex items-center gap-1 max-w-[200px] overflow-x-auto">
            {minimizedWindows.map((win) => (
              <button
                key={win.id}
                type="button"
                aria-label={`Restore ${win.title}`}
                onClick={() => restoreWindow(win.id)}
                className="px-2 py-0.5 rounded text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] truncate max-w-[90px]"
              >
                {win.title}
              </button>
            ))}
          </div>
        )}

        <WindowList />

        {/* Notifications Bell */}
        <button
          type="button"
          aria-label={`Notifications (${unreadNotificationsCount} unread)`}
          data-os-nonmodal-trigger="notification-center"
          onClick={() => {
            if (shellInput) {
              shellInput.setSurfaceOpen(
                "notification-center",
                shellInput.activeNonmodal !== "notification-center",
              );
            }
            onOpenNotifications?.();
          }}
        >
          <span className="text-sm">🔔</span>
          {unreadNotificationsCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[9px] font-bold rounded-full bg-[var(--color-warning)] text-black">
              {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
            </span>
          )}
        </button>
      </div>
      {isProfilesDialogOpen && (
        <ServerProfilesDialog
          open={isProfilesDialogOpen}
          onClose={() => setIsProfilesDialogOpen(false)}
          onEditProfile={(p) => setEditingProfile(p)}
        />
      )}
      {editingProfile !== undefined && (
        <ServerSettingsDialog
          open={editingProfile !== undefined}
          profile={editingProfile}
          onClose={() => setEditingProfile(undefined)}
        />
      )}
    </header>
  );
}
