import { useEffect, useCallback, useState, useRef } from "react";
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
import { SystemMonitorApp } from "./apps/SystemMonitorApp.js";
import { AgentHubApp } from "./apps/AgentHubApp.js";
import { RecipesApp } from "./apps/RecipesApp.js";
import {
  APP_MANIFESTS,
  findExistingWindowForApp,
  getAppManifest,
} from "./app-registry.js";
import { getTerminal } from "@/lib/terminal-registry.js";
import { parseOsDeepLink } from "./deep-links.js";
import { readServerProfiles } from "@/api/server-config.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { dispatchIntent, registerIntentHandler, createIntent } from "./intents.js";
import { TopBar } from "./TopBar.js";
import { Dock } from "./Dock.js";
import { CommandPalette } from "./CommandPalette.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { useOsNotificationStore, ingestIpcActivityEvent } from "./notifications.js";
import { useIpcEvent } from "@/hooks/use-sse-events.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { arbitrateKeyboardEvent } from "./input-arbiter.js";
import "./os.css";
import {
  loadOsSession,
  saveOsSession,
  type PersistenceNotice,
} from "./persistence.js";
import { recoverDurableLaunchRecordsOnStartup } from "./recipes/launch-records.js";
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
  const [handlersReady, setHandlersReady] = useState(false);
  const lastProcessedSearchRef = useRef<string | null>(null);
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
  // Ingest typed IPC events into OS notifications authority
  useIpcEvent("*", (e) => {
    ingestIpcActivityEvent(e);
  });

  // Initial load
  useEffect(() => {
    recoverDurableLaunchRecordsOnStartup();
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
  // Handle /os deep links once intent handlers are registered and ready
  useEffect(() => {
    if (!handlersReady) return;
    if (typeof window === "undefined" || !window.location.search) return;
    if (lastProcessedSearchRef.current === window.location.search) return;

    const currentSearch = window.location.search;
    const profilesResult = readServerProfiles();
    const profiles =
      profilesResult.status === "available" ? profilesResult.profiles : [];
    const parsed = parseOsDeepLink(currentSearch, profiles);

    if (parsed.status === "invalid") {
      setDeepLinkNotice(parsed.reason ?? "Invalid deep link");
      lastProcessedSearchRef.current = currentSearch;
      return;
    }

    if (parsed.status === "valid") {
      lastProcessedSearchRef.current = currentSearch;

      if (parsed.intent) {
        void dispatchIntent(parsed.intent).then((res) => {
          if (res?.status === "handled") {
            try {
              window.history.replaceState({}, "", window.location.pathname);
            } catch {
              // ignore
            }
          } else if (res?.status === "unhandled") {
            setDeepLinkNotice(res.reason ?? "Could not handle deep link intent");
          }
        });
      } else if (parsed.appId) {
        const manifest = APP_MANIFESTS[parsed.appId];
        if (manifest) {
          const currentSession = useWindowStore.getState().session;
          const targetCtx: WindowContext = parsed.ctx ?? {
            profileId,
            projectId: activeProject ?? undefined,
          };
          const existing = findExistingWindowForApp(
            currentSession.windows,
            parsed.appId,
            targetCtx,
          );
          if (existing) {
            if (existing.minimized) restoreWindow(existing.id);
            focusWindow(existing.id);
          } else {
            const newId = `${parsed.appId}-${generateUUID().slice(0, 8)}`;
            openWindow(
              {
                id: newId,
                appId: parsed.appId,
                title: manifest.displayName,
                ctx: targetCtx,
                mode: manifest.defaultPlacement,
              },
              currentSession.activeDesktopId,
            );
          }
          try {
            window.history.replaceState({}, "", window.location.pathname);
          } catch {
            // ignore
          }
        }
      }
    }
  }, [
    handlersReady,
    openWindow,
    focusWindow,
    restoreWindow,
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
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("file:open", (intent) => {
        if (
          intent.payload.profileId &&
          intent.payload.generation !== undefined
        ) {
          const snap = getConnectionSnapshot(intent.payload.profileId);
          if (
            !snap ||
            snap.status !== "connected" ||
            snap.owner.generation !== intent.payload.generation
          ) {
            return {
              status: "unhandled",
              reason: `File open rejected: target profile ${intent.payload.profileId} generation ${intent.payload.generation} is retired`,
            };
          }
        }
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
          generation: intent.payload.generation,
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

        const existing = Object.values(useWindowStore.getState().session.windows).find(
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
          useWindowStore.getState().session.activeDesktopId,
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
          useWindowStore.getState().session.activeDesktopId,
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
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
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
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
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
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("workflow:open-item", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
        };
        const existing = findExistingWindowForApp(
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("ports:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
        };
        const existing = findExistingWindowForApp(
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("settings:open", (intent) => {
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "settings",
          { profileId: intent.payload.profileId ?? "default" },
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          const nextAppState: Record<string, unknown> = {};
          if (intent.payload.tab) {
            nextAppState.activeTab = intent.payload.tab;
          }
          if (intent.payload.profileId !== undefined) {
            nextAppState.profileId = intent.payload.profileId;
            nextAppState.targetProfileId = intent.payload.profileId;
          }
          if (Object.keys(nextAppState).length > 0) {
            useWindowStore.getState().updateAppState(existing.id, nextAppState);
          }
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `settings-${generateUUID().slice(0, 8)}`;
        const activeDesktopId =
          useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "settings",
            title: "Settings",
            ctx: { profileId: intent.payload.profileId ?? "default" },
            mode: "tile",
            appState: {
              activeTab: intent.payload.tab ?? "general",
              profileId: intent.payload.profileId,
              targetProfileId: intent.payload.profileId ?? null,
            },
          },
          activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("settings:devices", (intent) => {
        return dispatchIntent(
          createIntent("settings:open", {
            profileId: intent.payload.profileId,
            tab: "devices",
          }),
        );
      }),
      registerIntentHandler("project:info", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
        };
        const existing = findExistingWindowForApp(
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("agent-store:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
        };
        const existing = findExistingWindowForApp(
          useWindowStore.getState().session.windows,
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
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("system:monitor", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId ?? "default",
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "system-monitor",
          targetCtx,
        );
        if (existing) {
          const activeDId = useWindowStore.getState().session.activeDesktopId;
          if (existing.desktopId !== activeDId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          if (intent.payload.profileId || intent.payload.incidentId || intent.payload.tab) {
            useWindowStore.getState().updateAppState(existing.id, {
              ...(intent.payload.profileId ? { inspectedProfileId: intent.payload.profileId } : {}),
              ...(intent.payload.incidentId ? { selectedIncidentId: intent.payload.incidentId } : {}),
              ...(intent.payload.tab ? { activeTab: intent.payload.tab } : {}),
            });
          }
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `system-monitor-${generateUUID().slice(0, 8)}`;
        const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "system-monitor",
            title: "System Monitor",
            ctx: targetCtx,
            mode: "tile",
            appState: {
              inspectedProfileId: intent.payload.profileId ?? null,
              selectedIncidentId: intent.payload.incidentId ?? null,
              activeTab: intent.payload.tab ?? null,
            },
          },
          activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("monitor:alert", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "system-monitor",
          targetCtx,
        );
        if (existing) {
          const activeDId = useWindowStore.getState().session.activeDesktopId;
          if (existing.desktopId !== activeDId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            inspectedProfileId: intent.payload.profileId,
            selectedIncidentId: intent.payload.incidentId,
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `system-monitor-${generateUUID().slice(0, 8)}`;
        const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "system-monitor",
            title: "System Monitor",
            ctx: targetCtx,
            mode: "tile",
            appState: {
              inspectedProfileId: intent.payload.profileId,
              selectedIncidentId: intent.payload.incidentId,
            },
          },
          activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("terminal:focus", (intent) => {
        const windowList = Object.values(
          useWindowStore.getState().session.windows,
        );
        const existing = windowList.find(
          (w) =>
            w.appId === "terminals" &&
            w.ctx.profileId === intent.payload.profileId &&
            ((w.appState?.sessionId as string | undefined) ===
              intent.payload.terminalId ||
              (w.appState?.terminalId as string | undefined) ===
                intent.payload.terminalId),
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        return { status: "unhandled", reason: "terminal-not-found" };
      }),
      registerIntentHandler("search:query", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "search",
          targetCtx,
          intent.payload,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            query: intent.payload.query,
            deliveryId: generateUUID(),
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const manifest = getAppManifest("search");
        const id = `search-${generateUUID().slice(0, 8)}`;
        const activeDesktopId =
          useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "search",
            title: manifest?.displayName ?? "Search",
            ctx: targetCtx,
            mode: manifest?.defaultPlacement ?? "tile",
            appState: {
              query: intent.payload.query,
              deliveryId: generateUUID(),
            },
          },
          activeDesktopId,
        );
        focusWindow(id);
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("changes:diff", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "changes",
          targetCtx,
          intent.payload,
        );
        if (existing) {
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            filePath: intent.payload.filePath,
            status: intent.payload.status,
            additions: intent.payload.additions,
            deletions: intent.payload.deletions,
            gitRootId: intent.payload.gitRootId,
            diffPath: intent.payload.diffPath,
            activeTab: "diff",
            deliveryId: generateUUID(),
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const manifest = getAppManifest("changes");
        const id = `changes-${generateUUID().slice(0, 8)}`;
        const activeDesktopId =
          useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "changes",
            title: manifest?.displayName ?? "Changes",
            ctx: targetCtx,
            mode: manifest?.defaultPlacement ?? "tile",
            appState: {
              filePath: intent.payload.filePath,
              status: intent.payload.status,
              additions: intent.payload.additions,
              deletions: intent.payload.deletions,
              gitRootId: intent.payload.gitRootId,
              diffPath: intent.payload.diffPath,
              activeTab: "diff",
              deliveryId: generateUUID(),
            },
          },
          activeDesktopId,
        );
        focusWindow(id);
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("git:status", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
        };
        const existing = findExistingWindowForApp(
          useWindowStore.getState().session.windows,
          "git",
          targetCtx,
          intent.payload,
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
            title: "Source Control",
            ctx: targetCtx,
            mode: "tile",
          },
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("agent-hub:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId ?? "",
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "agent-hub",
          targetCtx,
        );
        if (existing) {
          if (existing.desktopId !== useWindowStore.getState().session.activeDesktopId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `agent-hub-${generateUUID().slice(0, 8)}`;
        const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "agent-hub",
            title: "Agent Hub",
            ctx: targetCtx,
            mode: "tile",
          },
          activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("agent:focus", (intent) => {
        const targetSnap = getConnectionSnapshot(intent.payload.profileId);
        if (!targetSnap || targetSnap.status !== "connected") {
          return {
            status: "unhandled",
            reason: `Target profile "${intent.payload.profileId}" is disconnected`,
          };
        }
        const existingTerminal = getTerminal({
          profileId: intent.payload.profileId,
          id: intent.payload.terminalId,
        });
        if (!existingTerminal) {
          return {
            status: "unhandled",
            reason: `Terminal session "${intent.payload.terminalId}" is not live in registry`,
          };
        }
        if (intent.payload.incarnation !== undefined) {
          const agentStatus = useAgentStatusStore
            .getState()
            .profiles.get(intent.payload.profileId)
            ?.rows.get(intent.payload.terminalId);
          if (
            agentStatus &&
            agentStatus.incarnation !== undefined &&
            agentStatus.incarnation !== intent.payload.incarnation
          ) {
            return {
              status: "unhandled",
              reason: `Terminal session "${intent.payload.terminalId}" incarnation changed (expected ${intent.payload.incarnation}, live ${agentStatus.incarnation})`,
            };
          }
        }
        const windowList = Object.values(useWindowStore.getState().session.windows);
        const existing = windowList.find(
          (w) =>
            w.appId === "terminals" &&
            w.ctx.profileId === intent.payload.profileId &&
            ((w.appState?.sessionId as string | undefined) === intent.payload.terminalId ||
              (w.appState?.terminalId as string | undefined) === intent.payload.terminalId),
        );
        if (existing) {
          if (existing.desktopId !== useWindowStore.getState().session.activeDesktopId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `terminals-${generateUUID().slice(0, 8)}`;
        openWindow(
          {
            id,
            appId: "terminals",
            title: `Terminal (${intent.payload.terminalId})`,
            ctx: { profileId: intent.payload.profileId },
            mode: "tile",
            appState: {
              sessionId: intent.payload.terminalId,
              terminalId: intent.payload.terminalId,
            },
          },
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("recipes:open", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId ?? "",
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "recipes",
          targetCtx,
        );
        if (existing) {
          if (existing.desktopId !== useWindowStore.getState().session.activeDesktopId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `recipes-${generateUUID().slice(0, 8)}`;
        const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "recipes",
            title: "Recipes",
            ctx: targetCtx,
            mode: "float",
            appState: {
              activeTab: "catalog",
              selectedRecipeId: intent.payload.recipeId ?? null,
            },
          },
          activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("recipes:launch", (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId ?? "",
        };
        const currentWindows = useWindowStore.getState().session.windows;
        const existing = findExistingWindowForApp(
          currentWindows,
          "recipes",
          targetCtx,
        );
        if (existing) {
          if (existing.desktopId !== useWindowStore.getState().session.activeDesktopId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            activeTab: "review",
            selectedRecipeId: intent.payload.recipeId,
          });
          return { status: "handled", targetWindowId: existing.id };
        }
        const id = `recipes-${generateUUID().slice(0, 8)}`;
        const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
        openWindow(
          {
            id,
            appId: "recipes",
            title: "Recipes",
            ctx: targetCtx,
            mode: "float",
            appState: {
              activeTab: "review",
              selectedRecipeId: intent.payload.recipeId,
            },
          },
          activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
    ];

    setHandlersReady(true);
    return () => {
      setHandlersReady(false);
      unregisterList.forEach((unreg) => unreg());
    };
  }, [
    openWindow,
    focusWindow,
    restoreWindow,
    switchDesktop,
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
        if (existing.desktopId !== session.activeDesktopId) {
          switchDesktop(existing.desktopId);
        }
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
      switchDesktop,
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
      case "system-monitor":
        return <SystemMonitorApp window={window} />;
      case "agent-hub":
        return <AgentHubApp window={window} />;
      case "recipes":
        return <RecipesApp window={window} />;
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
