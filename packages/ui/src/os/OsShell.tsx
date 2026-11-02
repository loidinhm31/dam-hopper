import { useEffect, useCallback, useState } from "react";
import type { OsWindow, OsAppId } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { DesktopCanvas } from "./DesktopCanvas.js";
import { OsResourceHost } from "./OsResourceHost.js";
import { TerminalsApp } from "./apps/TerminalsApp.js";
import { EditorApp } from "./apps/EditorApp.js";
import { BrowserApp } from "./apps/BrowserApp.js";
import {
  loadOsSession,
  saveOsSession,
  type PersistenceNotice,
} from "./persistence.js";
import { generateUUID } from "@/lib/utils.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
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
      openWindow({
        id,
        appId,
        title,
        ctx: {
          profileId,
          projectId: activeProject ?? undefined,
        },
        mode: appId === "browser" ? "float" : "tile",
      });
    },
    [openWindow, profileId, activeProject],
  );

  const handleAddDesktop = useCallback(() => {
    const nextIdx = session.desktops.length + 1;
    const newDesktop = {
      id: `desktop-${nextIdx}`,
      name: `Desktop ${nextIdx}`,
      tree: null,
      floatingWindowIds: [],
      focusedWindowId: null,
    };
    setSession({
      ...session,
      desktops: [...session.desktops, newDesktop],
      activeDesktopId: newDesktop.id,
    });
  }, [session, setSession]);

  const minimizedWindows = Object.values(session.windows).filter(
    (w) => w.minimized && w.desktopId === session.activeDesktopId,
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
        <header className="flex items-center justify-between px-3 h-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs z-50">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[var(--color-text)] tracking-tight">
              DamHopper OS
            </span>

            {/* Desktop Tabs */}
            <nav
              aria-label="Desktops"
              className="flex items-center gap-1 border-l border-[var(--color-border)] pl-3"
            >
              {session.desktops.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => switchDesktop(d.id)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    d.id === session.activeDesktopId
                      ? "bg-[var(--color-primary)] text-white font-medium"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {d.name}
                </button>
              ))}
              <button
                type="button"
                aria-label="Add Desktop"
                onClick={handleAddDesktop}
                className="px-2 py-1 rounded text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              >
                +
              </button>
            </nav>
          </div>

          {/* Center / Minimized Tray */}
          {minimizedWindows.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-md px-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Minimized:
              </span>
              {minimizedWindows.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => restoreWindow(w.id)}
                  className="px-2 py-0.5 rounded text-[11px] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] truncate max-w-[120px]"
                >
                  {w.title}
                </button>
              ))}
            </div>
          )}

          {/* Launch Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleLaunchApp("terminals")}
              className="px-2.5 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors"
            >
              + Terminal
            </button>
            <button
              type="button"
              onClick={() => handleLaunchApp("editor")}
              className="px-2.5 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors"
            >
              + Editor
            </button>
            <button
              type="button"
              onClick={() => handleLaunchApp("browser")}
              className="px-2.5 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors"
            >
              + Browser
            </button>
          </div>
        </header>
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
        <main className="flex-1 min-h-0 relative">
          {activeDesktop && (
            <DesktopCanvas
              desktop={activeDesktop}
              renderApp={renderApp}
            />
          )}
        </main>
      </div>
      </OsResourceHost>
  );
}
