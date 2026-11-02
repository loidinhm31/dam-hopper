import { useState, useCallback, useEffect } from "react";
import type { OsAppId } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { loadDockPins, saveDockPins } from "./persistence.js";
import { APP_MANIFESTS, findExistingWindowForApp } from "./app-registry.js";
import { generateUUID } from "@/lib/utils.js";

export interface DockProps {
  onLaunchApp?: (appId: OsAppId) => void;
  className?: string;
}

const APP_ICONS: Record<OsAppId, string> = {
  terminals: ">_",
  editor: "{ }",
  browser: "🌐",
  files: "📁",
  search: "🔍",
  changes: "±",
  git: "⎇",
  "conflict-resolver": "⚡",
  "session-changes": "Δ",
  "workflow-plans": "📋",
  "ports-tunnels": "🔌",
  "project-info": "ℹ",
  "agent-store": "🛒",
  settings: "⚙",
  "system-monitor": "📊",
  "agent-hub": "🤖",
  recipes: "📜",
};

export function Dock({ onLaunchApp, className = "" }: DockProps) {
  const [pinnedApps, setPinnedApps] = useState<OsAppId[]>(() => loadDockPins());
  const session = useWindowStore((state) => state.session);
  const openWindow = useWindowStore((state) => state.openWindow);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);

  useEffect(() => {
    saveDockPins(pinnedApps);
  }, [pinnedApps]);

  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ??
    session.desktops[0];

  const handleLaunch = useCallback(
    (appId: OsAppId) => {
      if (onLaunchApp) {
        onLaunchApp(appId);
        return;
      }
      const manifest = APP_MANIFESTS[appId];
      if (!manifest) return;

      const desktopCtx = activeDesktop?.defaultCtx ?? { profileId: "default" };
      const existing = findExistingWindowForApp(session.windows, appId, desktopCtx);
      if (existing) {
        if (existing.minimized) restoreWindow(existing.id);
        focusWindow(existing.id);
        return;
      }
      openWindow(
        {
          id: `${appId}-${generateUUID().slice(0, 8)}`,
          appId,
          title: manifest.displayName,
          ctx: desktopCtx,
          mode: manifest.defaultPlacement,
        },
        session.activeDesktopId,
      );
    },
    [
      onLaunchApp,
      session.windows,
      session.activeDesktopId,
      activeDesktop?.defaultCtx,
      openWindow,
      focusWindow,
      restoreWindow,
    ],
  );

  return (
    <aside
      role="navigation"
      aria-label="Application Dock"
      className={`flex flex-col items-center py-2 border-r border-[var(--color-border)] bg-[var(--color-surface)] w-[var(--os-dock-width)] z-40 select-none ${className}`}
    >
      <div className="flex-1 flex flex-col items-center gap-2">
        {pinnedApps.map((appId) => {
          const manifest = APP_MANIFESTS[appId];
          if (!manifest) return null;

          // Find running windows for this appId
          const runningWindows = Object.values(session.windows).filter(
            (w) => w.appId === appId,
          );
          const runningCount = runningWindows.length;
          const isFocused = runningWindows.some(
            (w) =>
              w.id === activeDesktop?.focusedWindowId &&
              w.desktopId === session.activeDesktopId,
          );
          const hasMinimized = runningWindows.some(
            (w) => w.minimized && w.desktopId === session.activeDesktopId,
          );

          return (
            <div key={appId} className="relative group">
              <button
                type="button"
                aria-label={`Launch or focus ${manifest.displayName}`}
                title={manifest.displayName}
                onClick={() => handleLaunch(appId)}
                className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-all text-xs font-mono ${
                  isFocused
                    ? "bg-[var(--color-surface-hover)] border-[var(--color-primary)] text-[var(--color-primary)] shadow-md"
                    : "border-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border)]"
                }`}
              >
                <span>{APP_ICONS[appId] ?? "⬚"}</span>
              </button>

              {/* Running Pip */}
              {runningCount > 0 && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                  <span
                    className={`rounded-full transition-all ${
                      isFocused
                        ? "w-1.5 h-3 bg-[var(--color-primary)]"
                        : "w-1 h-2 bg-[var(--color-text-muted)]"
                    }`}
                  />
                </div>
              )}

              {/* Minimized indicator */}
              {hasMinimized && (
                <span
                  title="Has minimized window"
                  className="absolute -right-0.5 top-0 w-2 h-2 rounded-full bg-[var(--color-warning)]"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Dock bottom pinned settings / toggle if needed */}
      <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-[var(--color-border)] w-full">
        <span
          className="text-[9px] text-[var(--color-text-muted)] font-mono tracking-tighter"
          title="DamHopper OS Dock"
        >
          OS
        </span>
      </div>
    </aside>
  );
}
