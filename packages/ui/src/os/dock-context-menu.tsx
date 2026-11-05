import * as React from "react";
import type { ActionContext, OsAppId, OsWindow } from "./types.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu.js";
import { APP_MANIFESTS } from "./app-registry.js";
import { canExecuteAction, executeAction } from "./action-executor.js";
import { useWindowStore } from "./window-store.js";
import { toggleDockPin } from "./dock-pins.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";

export interface DockContextMenuProps {
  appId: OsAppId;
  isPinned: boolean;
  children: React.ReactElement;
  onOpenApp?: (appId: OsAppId, capturedContext?: ActionContext) => void;
}

interface CapturedMenuState {
  capturedContext: ActionContext;
  runningWindows: OsWindow[];
  canOpen: boolean;
  openDisabledReason?: string;
  canNewWindow: boolean;
  newWindowDisabledReason?: string;
  isSupportedNewWindowApp: boolean;
}
type SupportedNewWindowAppId = "terminals" | "editor" | "browser";

function isSupportedNewWindowApp(
  appId: OsAppId,
): appId is SupportedNewWindowAppId {
  return appId === "terminals" || appId === "editor" || appId === "browser";
}

export function DockContextMenu({
  appId,
  isPinned,
  children,
  onOpenApp,
}: DockContextMenuProps) {
  const session = useWindowStore((state) => state.session);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const profile = useServerProfile();
  const activeProfileId = profile?.id ?? "default";

  const [menuState, setMenuState] = React.useState<CapturedMenuState | null>(
    null,
  );

  const manifest = APP_MANIFESTS[appId];
  const isSupportedNewWindow = isSupportedNewWindowApp(appId);
  // Capture context exactly when menu opens
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        setMenuState(null);
        return;
      }

      const activeDesktopId = session.activeDesktopId;
      const activeDesktop =
        session.desktops.find((d) => d.id === activeDesktopId) ??
        session.desktops[0];
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

      const openActionId = `app.${appId}.open` as const;
      const openCheck = canExecuteAction({
        id: openActionId,
        context: capturedContext,
      });

      let canNew = false;
      let newReason: string | undefined;

      if (isSupportedNewWindowApp(appId)) {
        const newActionId = `app.${appId}.new-window` as const;
        const newCheck = canExecuteAction({
          id: newActionId,
          context: capturedContext,
        });
        canNew = newCheck.canExecute;
        if (!newCheck.canExecute) {
          newReason = newCheck.reason;
        }
      }

      const running = Object.values(session.windows).filter(
        (w) => w.appId === appId,
      );

      setMenuState({
        capturedContext,
        runningWindows: running,
        canOpen: openCheck.canExecute,
        openDisabledReason: openCheck.canExecute ? undefined : openCheck.reason,
        canNewWindow: canNew,
        newWindowDisabledReason: newReason,
        isSupportedNewWindowApp: isSupportedNewWindow,
      });
    },
    [session, appId, isSupportedNewWindow, activeProfileId],
  );

  const handleOpenFocus = React.useCallback(() => {
    if (!menuState) return;
    if (onOpenApp) {
      onOpenApp(appId, menuState.capturedContext);
      return;
    }
    const actionId = `app.${appId}.open` as const;
    void executeAction({
      id: actionId,
      context: menuState.capturedContext,
    });
  }, [onOpenApp, appId, menuState]);

  const handleNewWindow = React.useCallback(() => {
    if (!menuState || !isSupportedNewWindowApp(appId)) return;
    const actionId = `app.${appId}.new-window` as const;
    void executeAction({
      id: actionId,
      context: menuState.capturedContext,
    });
  }, [appId, menuState]);

  const handleTogglePin = React.useCallback(() => {
    toggleDockPin(appId);
  }, [appId]);

  const handleFocusRunning = React.useCallback(
    (win: OsWindow) => {
      if (win.desktopId !== session.activeDesktopId) {
        switchDesktop(win.desktopId);
      }
      if (win.minimized) {
        restoreWindow(win.id);
      }
      focusWindow(win.id);
    },
    [session.activeDesktopId, switchDesktop, restoreWindow, focusWindow],
  );

  const runningCount = menuState?.runningWindows.length ?? 0;
  const openLabel = runningCount > 0 ? "Focus" : "Open";

  return (
    <ContextMenu.Root onOpenChange={handleOpenChange}>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="font-semibold text-xs truncate">
          {manifest?.displayName ?? appId}
        </ContextMenuLabel>
        <ContextMenuSeparator />

        {/* 1. Open / Focus */}
        <ContextMenuItem
          disabled={menuState !== null && !menuState.canOpen}
          onClick={handleOpenFocus}
          title={menuState?.openDisabledReason}
          data-testid="dock-menu-open"
        >
          <span>{openLabel}</span>
          {menuState?.openDisabledReason && (
            <span className="ml-auto text-[10px] text-[var(--color-text-muted)] truncate max-w-24">
              (Disabled)
            </span>
          )}
        </ContextMenuItem>

        {/* 2. Supported New Window only (terminals, editor, browser) */}
        {isSupportedNewWindow && (
          <ContextMenuItem
            disabled={menuState !== null && !menuState.canNewWindow}
            onClick={handleNewWindow}
            title={menuState?.newWindowDisabledReason}
            data-testid="dock-menu-new-window"
          >
            <span>New Window</span>
            {menuState?.newWindowDisabledReason && (
              <span className="ml-auto text-[10px] text-[var(--color-text-muted)] truncate max-w-24">
                (Disabled)
              </span>
            )}
          </ContextMenuItem>
        )}

        {/* 3. Running Instances List */}
        {menuState && menuState.runningWindows.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Running Windows ({menuState.runningWindows.length})
            </ContextMenuLabel>
            {menuState.runningWindows.map((win) => {
              const desktop = session.desktops.find(
                (d) => d.id === win.desktopId,
              );
              const isOtherDesktop = win.desktopId !== session.activeDesktopId;
              return (
                <ContextMenuItem
                  key={win.id}
                  onClick={() => handleFocusRunning(win)}
                  data-testid={`dock-menu-instance-${win.id}`}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="truncate max-w-32">
                    {win.title || manifest?.displayName}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-1">
                    {win.minimized
                      ? "(min)"
                      : isOtherDesktop
                        ? `[${desktop?.name ?? win.desktopId}]`
                        : ""}
                  </span>
                </ContextMenuItem>
              );
            })}
          </>
        )}

        <ContextMenuSeparator />

        {/* 4. Pin / Unpin */}
        <ContextMenuItem
          onClick={handleTogglePin}
          data-testid="dock-menu-toggle-pin"
        >
          {isPinned ? "Unpin from Dock" : "Pin to Dock"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu.Root>
  );
}
