import { useCallback, useState } from "react";
import { useWindowStore } from "./window-store.js";
import { DesktopSwitcher } from "./DesktopSwitcher.js";
import { WindowList } from "./WindowList.js";
import { readServerProfiles, type ServerProfile } from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { ProfileBadge } from "@/components/atoms/ProfileBadge.js";

export interface TopBarProps {
  onOpenPalette?: () => void;
  onOpenNotifications?: () => void;
  unreadNotificationsCount?: number;
  className?: string;
}

export function TopBar({
  onOpenPalette,
  onOpenNotifications,
  unreadNotificationsCount = 0,
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

  const [isCtxMenuOpen, setIsCtxMenuOpen] = useState(false);

  // Default context for new windows on active desktop
  const currentDefaultCtx = activeDesktop?.defaultCtx ?? {
    profileId: activeProfile?.id ?? "default",
    projectId: activeProject ?? undefined,
  };

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      if (!activeDesktop) return;
      setDefaultCtx(activeDesktop.id, {
        ...currentDefaultCtx,
        profileId,
      });
      setIsCtxMenuOpen(false);
    },
    [activeDesktop, currentDefaultCtx, setDefaultCtx],
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
            onClick={() => setIsCtxMenuOpen((prev) => !prev)}
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
              role="menu"
              className="absolute left-0 mt-1 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-1 z-50 text-xs"
            >
              <div className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--color-border)] mb-1">
                Default for New Windows
              </div>
              <div className="max-h-48 overflow-y-auto">
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

      {/* Right: Minimized tray + WindowList + Notification bell */}
      <div className="flex items-center gap-2">
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
          onClick={onOpenNotifications}
          className="relative p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <span className="text-sm">🔔</span>
          {unreadNotificationsCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[9px] font-bold rounded-full bg-[var(--color-warning)] text-black">
              {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
