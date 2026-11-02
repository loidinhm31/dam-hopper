import { useEffect, useCallback, useState } from "react";
import type { OsWindow, OsAppId, WindowContext } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { DesktopCanvas } from "./DesktopCanvas.js";
import { OsResourceHost } from "./OsResourceHost.js";
import { TerminalsApp } from "./apps/TerminalsApp.js";
import { EditorApp } from "./apps/EditorApp.js";
import { BrowserApp } from "./apps/BrowserApp.js";
import { FilesApp } from "./apps/FilesApp.js";
import { SearchApp } from "./apps/SearchApp.js";
import { ChangesApp } from "./apps/ChangesApp.js";
import { GitApp } from "./apps/GitApp.js";
import { ConflictResolverApp } from "./apps/ConflictResolverApp.js";
import { SessionChangesApp } from "./apps/SessionChangesApp.js";
import { WorkflowPlansApp } from "./apps/WorkflowPlansApp.js";
import { PortsTunnelsApp } from "./apps/PortsTunnelsApp.js";
import { ProjectInfoApp } from "./apps/ProjectInfoApp.js";
import { AgentStoreApp } from "./apps/AgentStoreApp.js";
import { SettingsApp } from "./apps/SettingsApp.js";
import { APP_MANIFESTS, findExistingWindowForApp } from "./app-registry.js";
import { parseOsDeepLink } from "./deep-links.js";
import { readServerProfiles } from "@/api/server-config.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { dispatchIntent, registerIntentHandler } from "./intents.js";
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
import { useEditorStore } from "@/stores/editor.js";
import { normalizeProjectTarget } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";
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
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
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
  // Handle /os deep links
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.search) return;
    const profilesResult = readServerProfiles();
    const profiles =
      profilesResult.status === "available" ? profilesResult.profiles : [];
    const parsed = parseOsDeepLink(window.location.search, profiles);

    if (parsed.status === "invalid") {
      setDeepLinkNotice(parsed.reason ?? "Invalid deep link");
      return;
    }

    if (parsed.status === "valid" && parsed.appId) {
      const manifest = APP_MANIFESTS[parsed.appId];
      if (!manifest) return;

      const targetCtx: WindowContext = parsed.ctx ?? {
        profileId,
        projectId: activeProject ?? undefined,
      };

      let targetWindowId: string | undefined;
      const existing = findExistingWindowForApp(
        session.windows,
        parsed.appId,
        targetCtx,
        parsed.intent?.payload,
      );
      if (existing) {
        targetWindowId = existing.id;
        if (existing.minimized) restoreWindow(existing.id);
        focusWindow(existing.id);
      }
      if (!targetWindowId) {
        targetWindowId = `${parsed.appId}-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id: targetWindowId,
            appId: parsed.appId,
            title: manifest.displayName,
            ctx: targetCtx,
            mode: manifest.defaultPlacement,
            appState: parsed.intent?.payload as
              | Record<string, unknown>
              | undefined,
          },
          session.activeDesktopId,
        );
      }

      if (parsed.intent) {
        void dispatchIntent(parsed.intent);
      }

      try {
        window.history.replaceState({}, "", window.location.pathname);
      } catch {
        // ignore
      }
    }
  }, [
    openWindow,
    focusWindow,
    restoreWindow,
    session.windows,
    session.activeDesktopId,
    profileId,
    activeProject,
  ]);

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

  // Register default OS intent consumers
  useEffect(() => {
    const unregisterList: Array<() => void> = [
      registerIntentHandler("terminal:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
        };
        const id = `terminals-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "terminals",
            title: "Terminals",
            ctx: targetCtx,
            mode: "tile",
            appState: intent.payload.cwd
              ? { cwd: intent.payload.cwd }
              : undefined,
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("file:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
        };
        const targetRef = normalizeProjectTarget({
          profileId: targetCtx.profileId,
          project: targetCtx.projectId ?? "",
          worktreePath: targetCtx.worktreeId,
        });
        const fileNode: FsArborNode = {
          id: intent.payload.filePath,
          name: intent.payload.filePath.split("/").pop() || "",
          kind: "file",
          size: 0,
          mtime: Date.now(),
          isSymlink: false,
          children: null,
        };
        void useEditorStore.getState().open(targetRef, fileNode);

        const existing = Object.values(session.windows).find(
          (w) =>
            w.appId === "editor" &&
            w.ctx.profileId === targetCtx.profileId &&
            w.ctx.projectId === targetCtx.projectId &&
            w.ctx.worktreeId === targetCtx.worktreeId,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            filePath: intent.payload.filePath,
            line: intent.payload.line,
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `editor-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "editor",
            title: intent.payload.filePath.split("/").pop() || "Editor",
            ctx: targetCtx,
            mode: "tile",
            appState: {
              filePath: intent.payload.filePath,
              line: intent.payload.line,
            },
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("browser:open", (intent) => {
        const id = `browser-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "browser",
            title: "Browser Preview",
            ctx: { profileId: intent.payload.profileId },
            mode: "float",
            appState: { url: intent.payload.url },
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("conflict:resolve", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
          gitRootId: intent.payload.root,
          operation: intent.payload.operation,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "conflict-resolver",
          targetCtx,
          intent.payload,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            root: intent.payload.root,
            filePath: intent.payload.filePath,
            operation: intent.payload.operation,
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `conflict-resolver-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "conflict-resolver",
            title: "Conflict Resolver",
            ctx: targetCtx,
            mode: "float",
            appState: {
              root: intent.payload.root,
              filePath: intent.payload.filePath,
              operation: intent.payload.operation,
            },
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("session-changes:open", (intent) => {
        const generation =
          intent.payload.generation ??
          getConnectionSnapshot(intent.payload.profileId)?.owner.generation;
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          generation,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "session-changes",
          targetCtx,
          intent.payload,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            generation,
            terminalId: intent.payload.terminalId,
            terminalIncarnation: intent.payload.terminalIncarnation,
            ompSessionId: intent.payload.ompSessionId,
            rootId: intent.payload.rootId,
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `session-changes-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "session-changes",
            title: "Session Changes",
            ctx: targetCtx,
            mode: "float",
            appState: {
              generation,
              terminalId: intent.payload.terminalId,
              terminalIncarnation: intent.payload.terminalIncarnation,
              ompSessionId: intent.payload.ompSessionId,
              rootId: intent.payload.rootId,
            },
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("git:status", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "git",
          targetCtx,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `git-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "git",
            title: "Git",
            ctx: targetCtx,
            mode: "tile",
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("workflow:open-item", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "workflow-plans",
          targetCtx,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            selectedItemId: intent.payload.itemId,
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `workflow-plans-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "workflow-plans",
            title: "Workflow & Plans",
            ctx: targetCtx,
            mode: "tile",
            appState: { selectedItemId: intent.payload.itemId },
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("ports:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "ports-tunnels",
          targetCtx,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `ports-tunnels-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "ports-tunnels",
            title: "Ports & Tunnels",
            ctx: targetCtx,
            mode: "float",
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("settings:open", (intent) => {
        const existing = findExistingWindowForApp(
          session.windows,
          "settings",
          { profileId: intent.payload.profileId ?? "default" },
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          if (intent.payload.tab) {
            useWindowStore.getState().updateAppState(existing.id, {
              activeTab: intent.payload.tab,
            });
          }
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `settings-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "settings",
            title: "Settings",
            ctx: { profileId: intent.payload.profileId ?? "default" },
            mode: "tile",
            appState: intent.payload.tab
              ? { activeTab: intent.payload.tab }
              : undefined,
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("project:info", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "project-info",
          targetCtx,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `project-info-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "project-info",
            title: "Project Info",
            ctx: targetCtx,
            mode: "float",
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("agent-store:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
        };
        const existing = findExistingWindowForApp(
          session.windows,
          "agent-store",
          targetCtx,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          if (intent.payload.tab) {
            useWindowStore.getState().updateAppState(existing.id, {
              tab: intent.payload.tab,
            });
          }
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `agent-store-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "agent-store",
            title: "Agent Store",
            ctx: targetCtx,
            mode: "tile",
            appState: intent.payload.tab
              ? { tab: intent.payload.tab }
              : undefined,
          },
          session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
    ];

    return () => {
      unregisterList.forEach((unreg) => unreg());
    };
  }, [
    openWindow,
    focusWindow,
    restoreWindow,
    session.windows,
    session.activeDesktopId,
  ]);


  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ??
    session.desktops[0];

  const handleLaunchApp = useCallback(
    (appId: OsAppId) => {
      const manifest = APP_MANIFESTS[appId];
      if (!manifest) return;
      const targetCtx: WindowContext = activeDesktop?.defaultCtx ?? {
        profileId,
        projectId: activeProject ?? undefined,
      };

      const existing = findExistingWindowForApp(
        session.windows,
        appId,
        targetCtx,
      );
      if (existing) {
        if (existing.minimized) restoreWindow(existing.id);
        focusWindow(existing.id);
        return;
      }
      const id = generateUUID();
      openWindow(
        {
          id,
          appId,
          title: manifest.displayName,
          ctx: targetCtx,
          mode: manifest.defaultPlacement,
        },
        session.activeDesktopId,
      );
    },
    [
      openWindow,
      focusWindow,
      restoreWindow,
      session.windows,
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
      case "files":
        return <FilesApp window={window} />;
      case "search":
        return <SearchApp window={window} />;
      case "changes":
        return <ChangesApp window={window} />;
      case "git":
        return <GitApp window={window} />;
      case "conflict-resolver":
        return <ConflictResolverApp window={window} />;
      case "session-changes":
        return <SessionChangesApp window={window} />;
      case "workflow-plans":
        return <WorkflowPlansApp window={window} />;
      case "ports-tunnels":
        return <PortsTunnelsApp window={window} />;
      case "project-info":
        return <ProjectInfoApp window={window} />;
      case "agent-store":
        return <AgentStoreApp window={window} />;
      case "settings":
        return <SettingsApp window={window} />;
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
        {deepLinkNotice && (
          <div
            data-testid="os-deep-link-notice"
            role="alert"
            className="flex items-center justify-between px-4 py-2 bg-[var(--color-danger)]/15 border-b border-[var(--color-danger)]/30 text-xs text-[var(--color-danger)] shrink-0 z-50 select-none"
          >
            <span>{deepLinkNotice}</span>
            <button
              type="button"
              onClick={() => setDeepLinkNotice(null)}
              className="px-2 py-0.5 rounded text-xs hover:bg-[var(--color-danger)]/20"
            >
              Dismiss
            </button>
          </div>
        )}
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
