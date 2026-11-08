import { useEffect, useCallback, useState, useRef } from "react";
import type { ActionContext, OsWindow, OsAppId, WindowContext, ShellNonmodalSurface } from "./types.js";
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
import { LockScreenOverlay } from "./LockScreenOverlay.js";
import { PinSetupDialog } from "./PinSetupDialog.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import {
  APP_MANIFESTS,
  findExistingWindowForApp,
  getAppManifest,
} from "./app-registry.js";
import { getTerminal } from "@/lib/terminal-registry.js";
import { parseOsDeepLink, qualifyOsDeepLink } from "./deep-links.js";
import { executeAction } from "./action-executor.js";
import { registerShellDelegate } from "./action-dispatch.js";
import { readServerProfiles } from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
  getApi,
  useConnectionSnapshot,
} from "@/api/connections.js";
import { dispatchIntent, registerIntentHandler, createIntent } from "./intents.js";
import { TerminalCloseProvider } from "./terminal-close-context.js";
import { ReviewRetirementHost } from "./review-retirement.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import {
  type ReviewTarget,
  type TerminalTarget,
  isCanonicalUuid,
  resolveWindowTerminalObservation,
} from "@/api/terminal-session-contract.js";
import { findMatchingTerminalWindow } from "./agent-hub.js";
import { TopBar } from "./TopBar.js";
import { Dock } from "./Dock.js";
import { CommandPalette } from "./CommandPalette.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { useOsNotificationStore, ingestIpcActivityEvent } from "./notifications.js";
import { ShellInputProvider } from "./shell-input-context.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useIpcEvent } from "@/hooks/use-sse-events.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { arbitrateKeyboardEvent } from "./input-arbiter.js";
import "./os.css";
import { syncCursorTheme, type CursorTheme } from "./cursor.js";
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
import { editorDiffTabKey, editorFileTabKey, useEditorStore } from "@/stores/editor.js";
import { normalizeFsTarget, toServerFsTarget, type FsTargetRef } from "@/api/ownership.js";
import { normalizeProjectTarget } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";
export function OsShell() {
  const session = useWindowStore((state) => state.session);
  const setSession = useWindowStore((state) => state.setSession);
  const shellRootRef = useRef<HTMLDivElement>(null);
  const cursorTheme = useSettingsStore((s) => s.cursorTheme) ?? "system";
  const dockPadding = useSettingsStore((s) => s.dockPadding) ?? 8;
  const dockOuterSpacing = useSettingsStore((s) => s.dockOuterSpacing) ?? 12;
  const dockGutter = 44 + 2 * dockPadding + 2 * dockOuterSpacing;
  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const isLocked = useLockScreenStore((s) => s.isLocked);
  const dockPosition = useSettingsStore((s) => s.dockPosition) ?? "left";

  const workspaceFlexClass =
    dockPosition === "right"
      ? "flex-row-reverse"
      : dockPosition === "top"
        ? "flex-col"
        : dockPosition === "bottom"
          ? "flex-col-reverse"
          : "flex-row";

  useEffect(() => {
    return syncCursorTheme({
      theme: cursorTheme as CursorTheme,
      shellRoot: shellRootRef.current,
    });
  }, [cursorTheme]);
  const openWindow = useWindowStore((state) => state.openWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const profile = useServerProfile();
  const profileId = profile?.id ?? "default";
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  const { observations } = useAggregatedTerminalSessions();
  const latestObservationsRef = useRef(observations);
  useEffect(() => {
    latestObservationsRef.current = observations;
  }, [observations]);
  // Synchronize inventory-observed terminal target and terminationState into windows
  useEffect(() => {
    const sessionWindows = useWindowStore.getState().session.windows;
    let changed = false;
    const nextWindows = { ...sessionWindows };
    for (const [winId, win] of Object.entries(sessionWindows)) {
      if (win.appId !== "terminals") continue;
      const resolved = resolveWindowTerminalObservation(win, observations);
      const currentTarget =
        win.runtimeIdentity?.kind === "terminal"
          ? win.runtimeIdentity.target
          : (win.appState?.target as TerminalTarget | undefined);
      const currentTerminationState = win.appState?.terminationState;

      // Only adopt if we gained a verified target whose owner is currently active, or if terminationState changed
      const isTargetCurrent = resolved.target
        ? isCurrentConnection({
            profileId: resolved.target.profileId,
            generation: resolved.target.generation,
          })
        : false;
      const shouldAdoptTarget = !currentTarget && resolved.target !== null && isTargetCurrent;
      const shouldUpdateState = currentTerminationState !== resolved.availability;
      if (shouldAdoptTarget || shouldUpdateState) {
        changed = true;
        nextWindows[winId] = {
          ...win,
          ...(shouldAdoptTarget && resolved.target
            ? {
                runtimeIdentity: {
                  kind: "terminal",
                  target: resolved.target,
                },
              }
            : {}),
          appState: {
            ...win.appState,
            target: currentTarget ?? resolved.target ?? win.appState?.target,
            terminationState: resolved.availability,
          },
        };
      }
    }
    if (changed) {
      useWindowStore.getState().setSession({
        ...useWindowStore.getState().session,
        windows: nextWindows,
      });
    }
  }, [observations]);
  const [notice, setNotice] = useState<PersistenceNotice | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [handlersReady, setHandlersReady] = useState(false);
  const connectionSnap = useConnectionSnapshot(profileId);
  const lastProcessedSearchRef = useRef<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [activeNonmodal, setActiveNonmodal] = useState<ShellNonmodalSurface | null>(null);
  const [modalDepth, setModalDepth] = useState(0);
  const isNotificationsOpen = activeNonmodal === "notification-center";
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

  // Autosave
  const prevWindowCountRef = useRef(Object.keys(session.windows).length);
  useEffect(() => {
    const currentWindowCount = Object.keys(session.windows).length;
    const delay = currentWindowCount < prevWindowCountRef.current ? 0 : 300;
    prevWindowCountRef.current = currentWindowCount;
    const timer = window.setTimeout(() => {
      saveOsSession(session, undefined, setNotice);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [session]);

  useEffect(() => {
    const handleFlush = () => {
      saveOsSession(useWindowStore.getState().session);
    };
    window.addEventListener("beforeunload", handleFlush);
    window.addEventListener("pagehide", handleFlush);
    return () => {
      window.removeEventListener("beforeunload", handleFlush);
      window.removeEventListener("pagehide", handleFlush);
    };
  }, []);
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
       const explicitProfile = parsed.ctx?.profileId ?? profileId;
       const snap = getConnectionSnapshot(explicitProfile);
       if (!snap || snap.status !== "connected") {
         setDeepLinkNotice(`Profile '${explicitProfile}' is not connected`);
         return;
       }

      lastProcessedSearchRef.current = currentSearch;

      const parsedProject = parsed.ctx?.projectId;
      const explicitTarget: FsTargetRef = parsed.ctx?.target
        ? parsed.ctx.target
        : parsedProject
          ? normalizeFsTarget({
              profileId: explicitProfile,
              project: parsedProject,
              worktreePath: parsed.ctx?.worktreeId,
            })
          : activeProject
            ? normalizeFsTarget({ profileId, project: activeProject })
            : { kind: "workspace", profileId };

      const qualified = qualifyOsDeepLink(parsed, {
        owner: snap.owner,
        target: explicitTarget,
        projectId: parsedProject ?? (activeProject ?? undefined),
        destinationDesktopId: useWindowStore.getState().session.activeDesktopId,
      });

      if (qualified.status === "unqualified") {
        setDeepLinkNotice(qualified.reason);
        return;
      }

      if (qualified.intent) {
        void dispatchIntent(qualified.intent).then((res) => {
          if (res?.status === "handled") {
            try {
              window.history.replaceState({}, "", window.location.pathname);
            } catch {
              // ignore
            }
          } else if (res?.status === "unhandled") {
            setDeepLinkNotice(res.reason ?? "Could not handle deep link intent");
          } else if (res?.status === "invalid") {
            setDeepLinkNotice(res.error ?? "Invalid deep link intent");
          }
        });
      } else if (qualified.appId) {
        const manifest = APP_MANIFESTS[qualified.appId];
        if (manifest) {
          const currentSession = useWindowStore.getState().session;
          const targetCtx: WindowContext = qualified.ctx;
          const existing = findExistingWindowForApp(
            currentSession.windows,
            qualified.appId,
            targetCtx,
          );
          if (existing) {
            if (existing.minimized) restoreWindow(existing.id);
            focusWindow(existing.id);
          } else {
            const newId = `${qualified.appId}-${generateUUID().slice(0, 8)}`;
            openWindow(
              {
                id: newId,
                appId: qualified.appId,
                title: manifest.displayName,
                ctx: targetCtx,
                mode: manifest.defaultPlacement,
                appState: qualified.appState,
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
    connectionSnap?.status,
  ]);

  // Register Shell Input Delegate with the root keyboard coordinator (Architecture Contract C5)
  useEffect(() => {
    return registerShellDelegate({
      getActiveWindow: () => {
        const session = useWindowStore.getState().session;
        const desk = session.desktops.find(
          (d) => d.id === session.activeDesktopId,
        );
        return desk?.focusedWindowId
          ? session.windows[desk.focusedWindowId]
          : undefined;
      },
      getActiveDesktopId: () =>
        useWindowStore.getState().session.activeDesktopId,
      getActivePalette: () => isPaletteOpen,
      getActiveNonmodal: () => activeNonmodal,
      getModalDepth: () => modalDepth,
      closeActiveNonmodal: () => setActiveNonmodal(null),
      closePalette: () => setIsPaletteOpen(false),
      togglePalette: () => {
        setActiveNonmodal(null);
        setIsPaletteOpen((prev) => !prev);
      },
      cycleFocus: () => {
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
      },
    });
  }, [isPaletteOpen, activeNonmodal, modalDepth, focusWindow]);

  // Register default OS intent consumers
  useEffect(() => {
    const getPlacement = () =>
      useSettingsStore.getState().defaultWindowPlacement ?? "float";

    const unregisterList: Array<() => void> = [
      registerIntentHandler("terminal:open", async (intent) => {
        const targetCtx: WindowContext = {
          profileId: intent.payload.profileId,
          projectId: intent.payload.projectId,
          worktreeId: intent.payload.worktreeId,
          target: intent.payload.target,
        };
        const id = `terminals-${generateUUID()}`;
        const terminalId =
          intent.payload.terminalId ?? `term-${generateUUID()}`;

        let createError: string | undefined;
        let incarnation: number | undefined;
        let serverEpoch: string | undefined;
        const snap = getConnectionSnapshot(targetCtx.profileId);
        if (snap && snap.status === "connected") {
          const originatingGeneration = snap.owner.generation;
          const originatingProfileId = snap.owner.profileId;
          try {
            const client = getApi(snap.owner);
            const wireTarget = targetCtx.target ? toServerFsTarget(targetCtx.target) : undefined;
            const session = await client.terminal.create({
              id: terminalId,
              command: "",
              project: targetCtx.projectId,
              cwd: intent.payload.cwd ?? undefined,
              target: wireTarget,
              cols: 80,
              rows: 24,
            });
            const snapAfter = getConnectionSnapshot(targetCtx.profileId);
            if (
              snapAfter &&
              snapAfter.status === "connected" &&
              snapAfter.owner.profileId === originatingProfileId &&
              snapAfter.owner.generation === originatingGeneration
            ) {
              incarnation = session.incarnation;
              if (session.serverEpoch && isCanonicalUuid(session.serverEpoch)) {
                serverEpoch = session.serverEpoch;
              }
            } else {
              createError = "Connection owner changed during creation";
            }
          } catch (err) {
            createError = err instanceof Error ? err.message : String(err);
          }
        }

        openWindow(
          {
            id,
            appId: "terminals",
            title: "Terminals",
            ctx: targetCtx,
            mode: getPlacement(),
            appState: {
              sessionId: terminalId,
              terminalId,
              ...(incarnation !== undefined && serverEpoch !== undefined
                ? {
                    incarnation,
                    incarnationExact: String(incarnation),
                    generation: snap?.owner.generation,
                    profileId: snap?.owner.profileId,
                    serverEpoch,
                  }
                : {}),
              ...(createError ? { createError } : {}),
              ...(intent.payload.cwd ? { cwd: intent.payload.cwd } : {}),
            },
          },
          useWindowStore.getState().session.activeDesktopId,
        );
        return { status: "handled", targetWindowId: id };
      }),
      registerIntentHandler("file:open", async (intent) => {
        if (
          intent.payload.mode === "float" &&
          intent.payload.generation === undefined &&
          intent.payload.profileId &&
          intent.payload.profileId !== "default"
        ) {
          return {
            status: "unhandled",
            reason: "File open with mode 'float' requires a defined generation",
          };
        }
        if (
          intent.payload.profileId &&
          intent.payload.profileId !== "default" &&
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
          target: intent.payload.target,
        };
        const targetRef = intent.payload.target
          ? normalizeFsTarget(intent.payload.target, targetCtx.profileId)
          : targetCtx.projectId
            ? normalizeFsTarget({
                profileId: targetCtx.profileId,
                project: targetCtx.projectId,
                worktreePath: targetCtx.worktreeId,
              })
            : { kind: "workspace" as const, profileId: targetCtx.profileId ?? "" };
        const fileNode: FsArborNode = {
          id: intent.payload.filePath,
          name: intent.payload.filePath.split("/").pop() || "",
          kind: "file",
          size: 0,
          mtime: 0,
          isSymlink: false,
          children: null,
        };

        const currentTabs = useEditorStore.getState().tabs;
        const currentTabKey = intent.payload.isDiff
          ? editorDiffTabKey(targetRef, intent.payload.filePath)
          : editorFileTabKey(targetRef, intent.payload.filePath);
        const currentTab = currentTabs.find((t) => t.key === currentTabKey);
        const canonicalDocKey = currentTab?.documentKey;

        const existing = Object.values(useWindowStore.getState().session.windows).find(
          (w) => {
            if (w.appId !== "editor") return false;
            // CRITICAL: Diff windows must never match non-diff windows!
            if (Boolean(w.appState?.isDiff) !== Boolean(intent.payload.isDiff)) {
              return false;
            }
            if (canonicalDocKey && w.appState?.documentKey === canonicalDocKey) return true;
            let wTarget: FsTargetRef;
            if (w.ctx.target) {
              wTarget = normalizeFsTarget(w.ctx.target, w.ctx.profileId);
            } else if (w.ctx.projectId) {
              wTarget = normalizeFsTarget({
                profileId: w.ctx.profileId,
                project: w.ctx.projectId,
                worktreePath: w.ctx.worktreeId,
              });
            } else {
              wTarget = { kind: "workspace", profileId: w.ctx.profileId ?? "" };
            }
            const wTabKey = w.appState?.isDiff
              ? editorDiffTabKey(wTarget, (w.appState?.filePath as string) ?? "")
              : editorFileTabKey(wTarget, (w.appState?.filePath as string) ?? "");
            if (wTabKey === currentTabKey) return true;
            return (
              w.ctx.profileId === targetCtx.profileId &&
              (w.ctx.projectId ?? "") === (targetCtx.projectId ?? "") &&
              (w.ctx.worktreeId ?? "") === (targetCtx.worktreeId ?? "") &&
              w.appState?.filePath === intent.payload.filePath
            );
          },
        );
        if (existing) {
          if (intent.payload.mode === "float") {
            if (
              existing.ctx.generation !== undefined &&
              existing.ctx.generation !== intent.payload.generation
            ) {
              useWindowStore.getState().revealWindow(existing.id);
              return {
                status: "unhandled",
                reason: "Document belongs to a retired connection; reopen it from its window",
              };
            }
            useWindowStore.getState().presentWindowAsFloat(
              existing.id,
              useWindowStore.getState().session.activeDesktopId,
            );
            if (intent.payload.line !== undefined) {
              useWindowStore.getState().updateAppState(existing.id, {
                line: intent.payload.line,
              });
            }
            if (intent.payload.isDiff) {
              useEditorStore.getState().openDiff(
                targetRef,
                intent.payload.filePath,
                intent.payload.fileStatus || "modified",
                0,
                0,
              );
            } else {
              void useEditorStore.getState().open(targetRef, fileNode);
            }
            return { status: "handled", targetWindowId: existing.id };
          }

          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          if (intent.payload.line !== undefined) {
            useWindowStore.getState().updateAppState(existing.id, {
              line: intent.payload.line,
            });
          }
          if (intent.payload.isDiff) {
            useEditorStore.getState().openDiff(
              targetRef,
              intent.payload.filePath,
              intent.payload.fileStatus || "modified",
              0,
              0,
              undefined,
              intent.payload.gitRootId,
              intent.payload.diffPath,
            );
          } else {
            void useEditorStore.getState().open(targetRef, fileNode);
          }
          return { status: "handled", targetWindowId: existing.id };
        }

        if (intent.payload.isDiff) {
          useEditorStore.getState().openDiff(
            targetRef,
            intent.payload.filePath,
            intent.payload.fileStatus || "modified",
            0,
            0,
            undefined,
            intent.payload.gitRootId,
            intent.payload.diffPath,
          );
        } else {
          void useEditorStore.getState().open(targetRef, fileNode);
        }
        const id = `editor-${generateUUID().slice(0, 8)}`;
        const placement = intent.payload.mode === "float"
          ? "float"
          : (useSettingsStore.getState().defaultWindowPlacement ?? "float");
        const fileName = intent.payload.filePath.split("/").pop() || "Editor";
        const title = intent.payload.isDiff ? `Diff: ${fileName}` : fileName;
        openWindow(
          {
            id,
            appId: "editor",
            title,
            ctx: targetCtx,
            mode: placement,
            appState: {
              filePath: intent.payload.filePath,
              diffPath: intent.payload.diffPath,
              gitRootId: intent.payload.gitRootId,
              line: intent.payload.line,
              isDiff: intent.payload.isDiff,
              fileStatus: intent.payload.fileStatus,
              ...(canonicalDocKey ? { documentKey: canonicalDocKey } : {}),
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
        const payload = intent.payload;
        if (
          !payload ||
          !payload.profileId ||
          typeof payload.generation !== "number" ||
          !payload.terminalId ||
          !payload.terminalIncarnation ||
          !payload.ompSessionId ||
          !payload.serverEpoch ||
          !payload.rootId ||
          !payload.baselineId
        ) {
          return {
            status: "invalid",
            error:
              "Session Changes requires complete ReviewTarget tuple (profileId, generation, terminalId, terminalIncarnation, ompSessionId, serverEpoch, rootId, baselineId). Please upgrade or open from Agent Hub.",
          };
        }

        if (
          !isCurrentConnection({
            profileId: payload.profileId,
            generation: payload.generation,
          })
        ) {
          return {
            status: "invalid",
            error:
              "Session Changes target owner is disconnected or connection generation has changed.",
          };
        }

        const reviewTarget: ReviewTarget = Object.freeze({ ...payload });
        const targetCtx: WindowContext = {
          profileId: reviewTarget.profileId,
          generation: reviewTarget.generation,
        };

        const existing = Object.values(
          useWindowStore.getState().session.windows,
        ).find((w) => {
          if (w.appId !== "session-changes") return false;
          const target =
            w.runtimeIdentity?.kind === "review"
              ? w.runtimeIdentity.target
              : (w.appState?.target as ReviewTarget | undefined);
          if (target) {
            return (
              target.profileId === reviewTarget.profileId &&
              target.generation === reviewTarget.generation &&
              target.terminalId === reviewTarget.terminalId &&
              target.terminalIncarnation === reviewTarget.terminalIncarnation &&
              target.ompSessionId === reviewTarget.ompSessionId &&
              target.serverEpoch === reviewTarget.serverEpoch &&
              target.rootId === reviewTarget.rootId &&
              target.baselineId === reviewTarget.baselineId
            );
          }
          return false;
        });

        if (existing) {
          if (
            existing.desktopId !==
            useWindowStore.getState().session.activeDesktopId
          ) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            target: reviewTarget,
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
            mode: getPlacement(),
            runtimeIdentity: {
              kind: "review",
              target: reviewTarget,
            },
            appState: {
              target: reviewTarget,
            },
          },
          useWindowStore.getState().session.activeDesktopId,
        );
        focusWindow(id);
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
          if (
            existing.desktopId !==
            useWindowStore.getState().session.activeDesktopId
          ) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) restoreWindow(existing.id);
          focusWindow(existing.id);
          return { status: "handled", targetWindowId: existing.id };
        }
        return { status: "unhandled", reason: "terminal-not-found" };
      }),
      registerIntentHandler("terminal:place-existing", (intent) => {
        const { sourceHubWindowId, target, action } = intent.payload;
        if (!sourceHubWindowId || !target || !action) {
          return {
            status: "invalid",
            error: "Missing required placement fields",
          };
        }

        const currentWindows = useWindowStore.getState().session.windows;
        const sourceHubWin = currentWindows[sourceHubWindowId];
        if (!sourceHubWin) {
          return {
            status: "invalid",
            error: `Source Hub window '${sourceHubWindowId}' not found`,
          };
        }

        if (
          !isCurrentConnection({
            profileId: target.profileId,
            generation: target.generation,
          })
        ) {
          return {
            status: "invalid",
            error: `Owner connection '${target.profileId}' generation changed or disconnected`,
          };
        }

        const obs = latestObservationsRef.current.find(
          (o) =>
            o.owner?.profileId === target.profileId &&
            o.owner?.generation === target.generation,
        );
        if (
          !obs ||
          obs.termination.version !== 1 ||
          obs.termination.serverEpoch !== target.serverEpoch
        ) {
          return {
            status: "invalid",
            error:
              "Target PTY serverEpoch mismatch or unsupported inventory authority",
          };
        }

        const inventorySession = obs.sessions.find(
          (s) =>
            s.id === target.terminalId &&
            s.incarnationExact === target.incarnation,
        );
        if (!inventorySession) {
          return {
            status: "invalid",
            error: "Target terminal session is missing, replaced, or retired",
          };
        }

        const matching = findMatchingTerminalWindow(target, currentWindows);
        const existingWindow = matching ? matching.window : null;

        const activeDesktopId =
          useWindowStore.getState().session.activeDesktopId;
        const sourceDesktopId = sourceHubWin.desktopId;

        if (action === "focus-existing") {
          if (existingWindow) {
            if (existingWindow.desktopId !== activeDesktopId) {
              switchDesktop(existingWindow.desktopId);
            }
            if (existingWindow.minimized) {
              restoreWindow(existingWindow.id);
            }
            focusWindow(existingWindow.id);
            return { status: "handled", targetWindowId: existingWindow.id };
          }
          return {
            status: "unhandled",
            reason: "No active window found for terminal target",
          };
        }

        if (action === "open-beside") {
          if (existingWindow && existingWindow.desktopId === sourceDesktopId) {
            if (existingWindow.minimized) {
              restoreWindow(existingWindow.id);
            }
            focusWindow(existingWindow.id);
            return { status: "handled", targetWindowId: existingWindow.id };
          }

          const terminalWinId = existingWindow
            ? existingWindow.id
            : `terminals-${generateUUID().slice(0, 8)}`;
          const winToPlace: OsWindow = existingWindow ?? {
            id: terminalWinId,
            appId: "terminals",
            title: `Terminal (${target.terminalId})`,
            ctx: {
              profileId: target.profileId,
              generation: target.generation,
            },
            mode: sourceHubWin.mode === "tile" ? "tile" : "float",
            desktopId: sourceDesktopId,
            maximized: false,
            minimized: false,
            runtimeIdentity: {
              kind: "terminal",
              target,
            },
            appState: {
              target,
              sessionId: target.terminalId,
              attachPolicy: "existing-only",
            },
          };

          const placedId = useWindowStore.getState().placeExistingTerminal({
            sourceHubWindowId,
            terminalWindow: winToPlace,
            action: "open-beside",
          });
          return { status: "handled", targetWindowId: placedId };
        }

        if (action === "move-beside") {
          if (!existingWindow) {
            return {
              status: "invalid",
              error:
                "Cannot move-beside: no existing window found for target",
            };
          }

          const placedId = useWindowStore.getState().placeExistingTerminal({
            sourceHubWindowId,
            terminalWindow: {
              ...existingWindow,
              runtimeIdentity: {
                kind: "terminal",
                target,
              },
              appState: {
                ...existingWindow.appState,
                target,
                attachPolicy: "existing-only",
              },
            },
            action: "move-beside",
          });
          return { status: "handled", targetWindowId: placedId };
        }

        return {
          status: "invalid",
          error: `Unknown placement action '${action}'`,
        };
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
            mode: intent.payload.mode ?? "content",
            searchMode: intent.payload.mode ?? "content",
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
            mode: getPlacement(),
            appState: {
              query: intent.payload.query,
              mode: intent.payload.mode ?? "content",
              searchMode: intent.payload.mode ?? "content",
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
          const state = useWindowStore.getState();
          if (existing.desktopId !== state.session.activeDesktopId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) {
            restoreWindow(existing.id);
          }
          if (existing.maximized) {
            state.toggleMaximizeWindow(existing.id);
          }
          if (intent.payload.mode === "float" && existing.mode === "tile") {
            state.toggleWindowMode(existing.id);
          }
          focusWindow(existing.id);
          useWindowStore.getState().updateAppState(existing.id, {
            filePath: intent.payload.filePath,
            status: intent.payload.status,
            additions: intent.payload.additions,
            deletions: intent.payload.deletions,
            gitRootId: intent.payload.gitRootId,
            diffPath: intent.payload.diffPath,
            activeTab: intent.payload.activeTab ?? (intent.payload.filePath ? "diff" : "changes"),
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
            mode: intent.payload.mode ?? getPlacement(),
            appState: {
              filePath: intent.payload.filePath,
              status: intent.payload.status,
              additions: intent.payload.additions,
              deletions: intent.payload.deletions,
              gitRootId: intent.payload.gitRootId,
              diffPath: intent.payload.diffPath,
              activeTab: intent.payload.activeTab ?? (intent.payload.filePath ? "diff" : "changes"),
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
        const state = useWindowStore.getState();
        const existing = findExistingWindowForApp(
          state.session.windows,
          "git",
          targetCtx,
          intent.payload,
        );
        if (existing) {
          if (existing.desktopId !== state.session.activeDesktopId) {
            switchDesktop(existing.desktopId);
          }
          if (existing.minimized) {
            restoreWindow(existing.id);
          }
          if (existing.maximized) {
            state.toggleMaximizeWindow(existing.id);
          }
          if (intent.payload.mode === "float" && existing.mode === "tile") {
            state.toggleWindowMode(existing.id);
          }
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
            mode: intent.payload.mode ?? getPlacement(),
          },
          useWindowStore.getState().session.activeDesktopId,
        );
        focusWindow(id);
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
            mode: getPlacement(),
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
            mode: getPlacement(),
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
    async (appId: OsAppId, capturedContext?: ActionContext) => {
      const defaultTarget: FsTargetRef = activeProject
        ? normalizeFsTarget({ profileId, project: activeProject })
        : { kind: "workspace", profileId };
      const targetCtx: WindowContext = activeDesktop?.defaultCtx ?? {
        profileId,
        projectId: activeProject ?? undefined,
        target: defaultTarget,
      };
      const snap = getConnectionSnapshot(
        capturedContext?.windowContext?.profileId ?? profileId,
      );
      const owner =
        capturedContext?.owner ?? snap?.owner ?? { profileId, generation: 1 };

      const context: ActionContext = capturedContext ?? {
        kind: "desktop",
        desktopId: session.activeDesktopId,
        windowContext: targetCtx,
        owner,
      };

      await executeAction({
        id: `app.${appId}.open`,
        context,
      });
    },
    [profileId, activeProject, activeDesktop, session.activeDesktopId],
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
    <ShellInputProvider
      activePalette={isPaletteOpen}
      onPaletteChange={setIsPaletteOpen}
      activeNonmodal={activeNonmodal}
      onNonmodalChange={setActiveNonmodal}
      onModalDepthChange={setModalDepth}
    >
      <TerminalCloseProvider>
        <ReviewRetirementHost />
        <OsResourceHost>
          <div
            ref={shellRootRef}
            data-os-shell="true"
            data-testid="os-shell-root"
            inert={isLocked ? true : undefined}
            style={{ "--os-dock-gutter": `${dockGutter}px` } as React.CSSProperties}
            className="flex flex-col w-screen h-screen overflow-hidden bg-[var(--color-bg)] select-none"
          >
            {/* Top OS Bar */}
            <TopBar
              onRequestSetupPin={() => setIsPinSetupOpen(true)}
              onOpenPalette={() => {
                setActiveNonmodal(null);
                setIsPaletteOpen(true);
              }}
              onOpenNotifications={() =>
                setActiveNonmodal((prev) =>
                  prev === "notification-center" ? null : "notification-center",
                )
              }
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

            {/* Main Workspace: Dock + Desktop Canvas */}
            <div
              data-testid="os-workspace-container"
              data-dock-position={dockPosition}
              className={`flex ${workspaceFlexClass} flex-1 min-h-0 min-w-0 w-full overflow-hidden`}
            >
              <Dock onLaunchApp={handleLaunchApp} position={dockPosition} />

              <main className="flex-1 min-h-0 min-w-0 relative overflow-hidden" role="main">
                {activeDesktop && (
                  <DesktopCanvas
                    desktop={activeDesktop}
                    renderApp={renderApp}
                    onNotice={(msg) => setNotice({ kind: "storage-error", message: msg })}
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
              onClose={() => setActiveNonmodal(null)}
            />
          </div>
            {/* Lock Screen Overlay */}
            <LockScreenOverlay />

            {/* PIN Setup Dialog */}
            <PinSetupDialog
              open={isPinSetupOpen}
              onOpenChange={setIsPinSetupOpen}
            />
        </OsResourceHost>
      </TerminalCloseProvider>
    </ShellInputProvider>
  );
}
