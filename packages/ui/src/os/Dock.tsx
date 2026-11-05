import * as React from "react";
import { LayoutGrid } from "lucide-react";
import type { ActionContext, OsAppId } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { useSettingsStore } from "@/stores/settings.js";
import { APP_MANIFESTS } from "./app-registry.js";
import { AppIcon } from "./app-icons.js";
import {
  getDockPinsSnapshot,
  subscribeDockPins,
} from "./dock-pins.js";
import { DockContextMenu } from "./dock-context-menu.js";
import { AppLauncher } from "./AppLauncher.js";
import { executeAction } from "./action-executor.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";

export interface DockProps {
  onLaunchApp?: (appId: OsAppId, capturedContext?: ActionContext) => void;
  className?: string;
}

export function Dock({ onLaunchApp, className = "" }: DockProps) {
  const [isAppLauncherOpen, setIsAppLauncherOpen] = React.useState(false);

  const pinnedApps = React.useSyncExternalStore(
    subscribeDockPins,
    getDockPinsSnapshot,
    getDockPinsSnapshot,
  );

  const session = useWindowStore((state) => state.session);
  const profile = useServerProfile();
  const activeProfileId = profile?.id ?? "default";

  // Appearance preferences from settings store
  const dockPadding = useSettingsStore((s) => s.dockPadding) ?? 8;
  const dockItemSpacing = useSettingsStore((s) => s.dockItemSpacing) ?? 6;
  const dockOuterSpacing = useSettingsStore((s) => s.dockOuterSpacing) ?? 12;
  const dockRadius = useSettingsStore((s) => s.dockRadius) ?? 18;

  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ??
    session.desktops[0];

  const handleLaunch = React.useCallback(
    (appId: OsAppId) => {
      const activeDesktopId = session.activeDesktopId;
      const desktopCtx = activeDesktop?.defaultCtx ?? { profileId: activeProfileId };

      let owner: ConnectionRef | null = null;
      if (desktopCtx.profileId) {
        try {
          const snap = getConnectionSnapshot(desktopCtx.profileId);
          if (snap && snap.status === "connected") {
            owner = snap.owner;
          }
        } catch {
          // Fall back gracefully
        }
      }

      const capturedContext: ActionContext = {
        kind: "desktop",
        desktopId: activeDesktopId,
        windowContext: desktopCtx,
        owner,
        target: desktopCtx.target,
      };

      if (onLaunchApp) {
        onLaunchApp(appId, capturedContext);
        return;
      }
      const actionId = `app.${appId}.open` as const;
      void executeAction({
        id: actionId,
        context: capturedContext,
      });
    },
    [onLaunchApp, session.activeDesktopId, activeDesktop?.defaultCtx, activeProfileId],
  );

  // Calculate items to display:
  // 1. Ordered pinned apps
  // 2. Stable manifest-order running-unpinned apps across all desktops, deduped
  const allRunningWindows = React.useMemo(
    () => Object.values(session.windows),
    [session.windows],
  );

  const runningAppIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const win of allRunningWindows) {
      ids.add(win.appId);
    }
    return ids;
  }, [allRunningWindows]);

  const runningUnpinnedApps = React.useMemo(() => {
    const manifestOrder = Object.keys(APP_MANIFESTS) as OsAppId[];
    return manifestOrder.filter(
      (appId) => runningAppIds.has(appId) && !pinnedApps.includes(appId),
    );
  }, [runningAppIds, pinnedApps]);

  const displayAppIds = React.useMemo(
    () => [...pinnedApps, ...runningUnpinnedApps],
    [pinnedApps, runningUnpinnedApps],
  );

  const gutterWidth = 44 + 2 * dockPadding + 2 * dockOuterSpacing;

  return (
    <>
      <aside
        role="navigation"
        aria-label="Application Dock"
        style={{
          width: `${gutterWidth}px`,
          paddingLeft: `${dockOuterSpacing}px`,
          paddingRight: `${dockOuterSpacing}px`,
        }}
        className={`h-full flex flex-col items-center justify-center pointer-events-none select-none z-40 shrink-0 ${className}`}
      >
        <div
          style={{
            padding: `${dockPadding}px`,
            borderRadius: `${dockRadius}px`,
            gap: `${dockItemSpacing}px`,
            maxHeight: `calc(100% - ${2 * dockOuterSpacing}px)`,
          }}
          className="flex flex-col items-center border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg pointer-events-auto overflow-hidden shrink-0"
          data-testid="dock-panel"
        >
          {/* Scrollable app items scroller with reserved horizontal indicator clearance */}
          <div
            style={{ gap: `${dockItemSpacing}px` }}
            className="flex-1 min-h-0 flex flex-col items-center overflow-y-auto overflow-x-hidden no-scrollbar w-full py-0.5"
            data-testid="dock-items-scroller"
          >
            {displayAppIds.map((appId) => {
              const manifest = APP_MANIFESTS[appId];
              if (!manifest) return null;

              const isPinned = pinnedApps.includes(appId);
              const runningWindows = allRunningWindows.filter(
                (w) => w.appId === appId,
              );
              const isRunning = runningWindows.length > 0;
              const isFocused = runningWindows.some(
                (w) =>
                  w.id === activeDesktop?.focusedWindowId &&
                  w.desktopId === session.activeDesktopId,
              );
              const hasMinimized = runningWindows.some(
                (w) => w.minimized && w.desktopId === session.activeDesktopId,
              );

              const stateLabel = isFocused
                ? "focused"
                : isRunning
                  ? "running"
                  : "";
              const minimizedLabel = hasMinimized ? "has minimized" : "";
              const fullAriaLabel = [
                `Launch or focus ${manifest.displayName}`,
                stateLabel,
                minimizedLabel,
              ]
                .filter(Boolean)
                .join(", ");

              return (
                <DockContextMenu
                  key={appId}
                  appId={appId}
                  isPinned={isPinned}
                  onOpenApp={onLaunchApp}
                >
                  <div
                    className="relative group shrink-0 w-[44px] h-[44px] flex items-center justify-center"
                    data-testid={`dock-entry-${appId}`}
                  >
                    <button
                      type="button"
                      aria-label={fullAriaLabel}
                      title={manifest.displayName}
                      aria-current={isFocused ? "true" : undefined}
                      onClick={() => handleLaunch(appId)}
                      data-testid={`dock-item-${appId}`}
                      className={`relative flex items-center justify-center w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-primary)] ${
                        isFocused
                          ? "bg-[var(--color-surface-hover)] border-[var(--color-primary)] text-[var(--color-primary)] shadow-sm"
                          : "border-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border)]"
                      }`}
                    >
                      <AppIcon appId={appId} size={20} strokeWidth={2} />
                    </button>

                    {/* Running Indicator Pip */}
                    {isRunning && (
                      <div
                        className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none"
                        data-testid={`dock-running-indicator-${appId}`}
                      >
                        <span
                          className={`rounded-full transition-all ${
                            isFocused
                              ? "w-1.5 h-3 bg-[var(--color-primary)]"
                              : "w-1 h-2 bg-[var(--color-text-muted)]"
                          }`}
                        />
                      </div>
                    )}

                    {/* Minimized Indicator Pip */}
                    {hasMinimized && (
                      <span
                        title="Has minimized window"
                        aria-label="Has minimized window"
                        data-testid={`dock-minimized-indicator-${appId}`}
                        className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-[var(--color-surface)] pointer-events-none"
                      />
                    )}
                  </div>
                </DockContextMenu>
              );
            })}
          </div>

          {/* Permanent reachable Apps button outside overflow scroller */}
          <div
            style={{ paddingTop: `${dockItemSpacing}px` }}
            className="border-t border-[var(--color-border)] shrink-0 flex flex-col items-center w-full"
          >
            <button
              type="button"
              aria-label="Applications"
              title="Applications"
              onClick={() => setIsAppLauncherOpen((v) => !v)}
              className="flex items-center justify-center w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-primary)] transition-all"
              data-testid="dock-apps-trigger"
            >
              <LayoutGrid size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Apps Catalog Launcher Modal */}
      <AppLauncher
        isOpen={isAppLauncherOpen}
        onClose={() => setIsAppLauncherOpen(false)}
        onLaunchApp={onLaunchApp}
      />
    </>
  );
}
