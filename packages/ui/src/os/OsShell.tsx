import { useEffect, useCallback, useState } from "react";
import type { OsWindow, OsAppId, WindowContext } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { DesktopCanvas } from "./DesktopCanvas.js";
import { OsResourceHost } from "./OsResourceHost.js";
import { TerminalsApp } from "./apps/TerminalsApp.js";
import { EditorApp } from "./apps/EditorApp.js";
import { BrowserApp } from "./apps/BrowserApp.js";
import { TopBar } from "./TopBar.js";
import { Dock } from "./Dock.js";
import { CommandPalette } from "./CommandPalette.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { useOsNotificationStore } from "./notifications.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import { arbitrateKeyboardEvent } from "./input-arbiter.js";
import "./os.css";
import {
  loadOsSession,
  saveOsSession,
  type PersistenceNotice,
} from "./persistence.js";
import { generateUUID } from "@/lib/utils.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useSettingsStore } from "@/stores/settings.js";
export function OsShell() {
  const session = useWindowStore((state) => state.session);
  const setSession = useWindowStore((state) => state.setSession);
  const openWindow = useWindowStore((state) => state.openWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const profile = useServerProfile();
  const profileId = profile?.id ?? "default";
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  const [notice, setNotice] = useState<PersistenceNotice | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const unreadTerminalNotifs = useTerminalNotificationsStore(
    (state) => state.notifications.filter((n) => !n.read).length,
  );
  const unreadOsNotifs = useOsNotificationStore(
    (state) => state.entries.filter((e) => !e.read).length,
  );
  const unreadNotifs = unreadTerminalNotifs + unreadOsNotifs;
  const osPaletteShortcut = useSettingsStore((state) => state.osPaletteShortcut);
  const osCycleFocusShortcut = useSettingsStore(
    (state) => state.osCycleFocusShortcut,
  );
  const focusWindow = useWindowStore((state) => state.focusWindow);

  // Initial load
  useEffect(() => {
    const loaded = loadOsSession(undefined, setNotice);
    setSession(loaded);
  }, [setSession]);

  // Debounced autosave
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveOsSession(session, undefined, setNotice);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [session]);

  // Shell-level global shortcut arbitration (e.g. Ctrl+Alt+K for Command Palette)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest?.('[data-shortcut-capture="true"]')) return;

      const disposition = arbitrateKeyboardEvent(e, {
        isCognitoActive: false,
        isComposing: Boolean(e.isComposing),
        isFrameFocused: false,
        paletteShortcut: osPaletteShortcut,
        cycleFocusShortcut: osCycleFocusShortcut,
      });

      if (disposition === "os-palette-handled") {
        e.preventDefault();
        e.stopPropagation();
        setIsPaletteOpen((prev) => !prev);
      } else if (disposition === "os-shortcut-handled") {
        e.preventDefault();
        e.stopPropagation();
        const currentDeskId = useWindowStore.getState().session.activeDesktopId;
        const currentWindows = useWindowStore.getState().session.windows;
        const visibleWindowIds = Object.keys(currentWindows).filter(
          (id) =>
            !currentWindows[id]?.minimized &&
            currentWindows[id]?.desktopId === currentDeskId,
        );
        if (visibleWindowIds.length > 0) {
          const focusedId =
            useWindowStore
              .getState()
              .session.desktops.find((d) => d.id === currentDeskId)
              ?.focusedWindowId;
          const idx = focusedId ? visibleWindowIds.indexOf(focusedId) : -1;
          const nextId =
            visibleWindowIds[(idx + 1) % visibleWindowIds.length] ??
            visibleWindowIds[0];
          if (nextId) {
            focusWindow(nextId);
            const nextEl = document.querySelector(
              `[data-os-window-frame="${CSS.escape(nextId)}"]`,
            ) as HTMLElement | null;
            nextEl?.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [osPaletteShortcut, osCycleFocusShortcut, focusWindow]);


  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ??
    session.desktops[0];

  const handleLaunchApp = useCallback(
    (appId: OsAppId) => {
      const id = generateUUID();
      const title =
        appId === "terminals"
          ? "Terminals"
          : appId === "editor"
            ? "Editor"
            : "Browser Preview";

      const targetCtx: WindowContext = activeDesktop?.defaultCtx ?? {
        profileId,
        projectId: activeProject ?? undefined,
      };

      openWindow(
        {
          id,
          appId,
          title,
          ctx: targetCtx,
          mode: appId === "browser" ? "float" : "tile",
        },
        session.activeDesktopId,
      );
    },
    [
      openWindow,
      profileId,
      activeProject,
      activeDesktop?.defaultCtx,
      session.activeDesktopId,
    ],
  );


  const renderApp = (window: OsWindow) => {
    switch (window.appId) {
      case "terminals":
        return <TerminalsApp window={window} />;
      case "editor":
        return <EditorApp window={window} />;
      case "browser":
        return <BrowserApp window={window} />;
      default:
        return null;
    }
  };

  return (
    <OsResourceHost>
      <div
        data-os-shell="true"
        data-testid="os-shell-root"
        className="flex flex-col w-screen h-screen overflow-hidden bg-[var(--color-bg)] select-none"
      >
        {/* Top OS Bar */}
        <TopBar
          onOpenPalette={() => setIsPaletteOpen(true)}
          onOpenNotifications={() => setIsNotificationsOpen((prev) => !prev)}
          unreadNotificationsCount={unreadNotifs}
        />
        {notice && (
          <div
            data-os-notice="true"
            className="flex items-center justify-between px-3 py-1 bg-[var(--color-warning)] text-black text-xs z-50"
          >
            <span>{notice.message}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
              className="text-xs font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Desktop Canvas */}
        {/* Main Workspace: Left Dock + Desktop Canvas */}
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          <Dock onLaunchApp={handleLaunchApp} />

          <main className="flex-1 min-h-0 relative overflow-hidden" role="main">
            {activeDesktop && (
              <DesktopCanvas
                desktop={activeDesktop}
                renderApp={renderApp}
              />
            )}
          </main>
        </div>

        {/* Command Palette Modal */}
        <CommandPalette
          isOpen={isPaletteOpen}
          onClose={() => setIsPaletteOpen(false)}
        />

        {/* Notification Center Popover */}
        <NotificationCenter
          isOpen={isNotificationsOpen}
          onClose={() => setIsNotificationsOpen(false)}
        />
      </div>
      </OsResourceHost>
  );
}
