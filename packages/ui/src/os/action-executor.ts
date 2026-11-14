import { getActionDescriptor } from "./actions.js";
import {
  findExistingWindowForApp,
  getAppManifest,
} from "./app-registry.js";
import type {
  ActionContext,
  ActionRequest,
  ActionResult,
  OsWindow,
  WindowContext,
} from "./types.js";
import {
  getWindowFocusTimestamp,
  recordWindowFocus,
  useWindowStore,
} from "./window-store.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  buildTerminalLaunchIdentity,
  reserveTrackedTerminalLaunch,
} from "./terminal-launch-lifecycle.js";
import type { FsTargetRef } from "@/api/ownership.js";
import { createIntent, dispatchIntent } from "./intents.js";
import { getActiveShellDelegate } from "./action-dispatch.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import {
  areBrowserOwnerScopesEqual,
  captureVerifiedBrowserOwner,
  extractBrowserOwnerScopeFromSnapshot,
  isCapturedBrowserOwnerCurrent,
} from "./browser/browser-owner-scope.js";
import {
  isOwnerAddressSuppressed,
  loadBrowserRecoveryDisk,
  resetAddressSuppression,
  saveBrowserRecoveryDisk,
  withBrowserRecoveryLock,
} from "./browser/browser-recovery-store.js";
import {
  createBlankBrowserTab,
  createInitialBrowserWindowState,
} from "./browser/browser-tab-state.js";
import type { BrowserTabRuntime, BrowserWindowState } from "./browser/browser-tab-types.js";
import { normalizeBrowserCommittedUrl } from "./browser/browser-url-normalization.js";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function canExecuteAction(
  request: ActionRequest,
): { canExecute: true } | { canExecute: false; reason: string } {
  const descriptor = getActionDescriptor(request.id);
  const ctx = request.context;

  if (descriptor.contextRequirement === "none") {
    return { canExecute: true };
  }

  const profileId = ctx.owner?.profileId ?? ctx.windowContext?.profileId;
  if (!profileId) {
    return {
      canExecute: false,
      reason: `Action '${descriptor.id}' requires an active profile connection`,
    };
  }

  if (descriptor.contextRequirement === "project") {
    const projectId = ctx.windowContext?.projectId;
    if (!projectId) {
      return {
        canExecute: false,
        reason: `Action '${descriptor.id}' requires a project context`,
      };
    }
  }

  if (descriptor.contextRequirement === "worktree") {
    const hasWorktreeOrTarget =
      Boolean(ctx.windowContext?.worktreeId) ||
      Boolean(ctx.windowContext?.projectId) ||
      Boolean(ctx.windowContext?.target);
    if (!hasWorktreeOrTarget) {
      return {
        canExecute: false,
        reason: `Action '${descriptor.id}' requires a project or worktree target`,
      };
    }
  }

  if (descriptor.contextRequirement === "exact-filesystem") {
    if (ctx.kind === "editor" && ctx.filePath) {
      return { canExecute: true };
    }
    const hasTarget = Boolean(ctx.windowContext?.target) || Boolean(ctx.windowContext?.projectId);
    if (!hasTarget && request.id === "app.editor.open") {
      // Allowed to open chooser
      return { canExecute: true };
    }
  }

  if (descriptor.contextRequirement === "review-target") {
    if (ctx.kind === "running-window" && ctx.runtimeIdentity?.kind === "review") {
      return { canExecute: true };
    }
    return {
      canExecute: false,
      reason: "Session Changes requires an active ReviewTarget tuple",
    };
  }

  if (descriptor.contextRequirement === "conflict-target") {
    const op = ctx.windowContext?.operation;
    const root = ctx.windowContext?.gitRootId;
    if (!op || !root) {
      return {
        canExecute: false,
        reason: "Conflict Resolver requires an active git conflict operation and root",
      };
    }
  }

  return { canExecute: true };
}

/**
 * Executes a requested OS action against the active window store and runtime environment.
 *
 * Invariants (Architecture Contracts C1, C2, C10, C12, C13):
 * - Open/Focus prefers current desktop, then monotonically updated runtime focus order.
 * - New Window for terminals obeys durable ordinary-launch safety journal (C3 & C12).
 * - New Window for editor/browser opens an independent chooser (C10).
 * - Settings Appearance delivery token passed to settings appState for repeated navigation (C13).
 */
export async function executeAction(
  request: ActionRequest,
): Promise<ActionResult> {
  const check = canExecuteAction(request);
  if (!check.canExecute) {
    return { kind: "disabled", reason: check.reason };
  }

  const descriptor = getActionDescriptor(request.id);
  const state = useWindowStore.getState();
  const session = state.session;
  const activeDesktopId = session.activeDesktopId;

  // 1. Non-window scalar actions
  if (descriptor.launchMode === "action") {
    if (request.id === "privacy.cognito") {
      const chord = useSettingsStore.getState().cognitoModeShortcut ?? "Mod+Alt+KeyB";
      useCognitoModeStore.getState().toggle(chord);
      return { kind: "executed" };
    }

    if (request.id === "terminal.font-increase") {
      const cur = useSettingsStore.getState().terminalFontSize;
      if (cur < 32) {
        useSettingsStore.getState().saveDebounced({ terminalFontSize: cur + 1 });
      }
      return { kind: "executed" };
    }

    if (request.id === "terminal.font-decrease") {
      const cur = useSettingsStore.getState().terminalFontSize;
      if (cur > 10) {
        useSettingsStore.getState().saveDebounced({ terminalFontSize: cur - 1 });
      }
      return { kind: "executed" };
    }

    if (request.id === "os.palette") {
      getActiveShellDelegate()?.togglePalette();
      return { kind: "executed" };
    }

    if (request.id === "os.cycle-focus") {
      const activeDesktop = session.desktops.find((d) => d.id === activeDesktopId);
      if (activeDesktop) {
        const desktopWindows = Object.values(session.windows).filter(
          (w) => w.desktopId === activeDesktopId && !w.minimized,
        );
        if (desktopWindows.length > 1) {
          const currentIndex = desktopWindows.findIndex(
            (w) => w.id === activeDesktop.focusedWindowId,
          );
          const nextIndex = (currentIndex + 1) % desktopWindows.length;
          const nextWin = desktopWindows[nextIndex];
          if (nextWin) {
            state.focusWindow(nextWin.id);
            recordWindowFocus(nextWin.id);
            return { kind: "focused", windowId: nextWin.id };
          }
        }
      }
      return { kind: "executed" };
    }

    if (request.id === "search.filename") {
      const profileId = request.context.owner?.profileId ?? request.context.windowContext?.profileId ?? "default";
      const generation = request.context.owner?.generation ?? 1;
      const target: FsTargetRef = request.context.target ?? {
        kind: "workspace",
        profileId,
      };
      void dispatchIntent(
        createIntent("search:query", {
          profileId,
          generation,
          target,
          projectId: request.context.windowContext?.projectId,
          worktreeId: request.context.windowContext?.worktreeId,
          mode: "filename",
          query: "",
        }),
      );
      return { kind: "executed" };
    }

    if (request.id === "file.reveal-active") {
      if (request.context.kind === "editor" && request.context.filePath) {
        void dispatchIntent(
          createIntent("file:reveal", {
            profileId: request.context.owner.profileId,
            generation: request.context.owner.generation,
            target: request.context.target,
            projectId: request.context.windowContext.projectId,
            worktreeId: request.context.windowContext.worktreeId,
            filePath: request.context.filePath,
          }),
        );
      }
      return { kind: "executed" };
    }

    return { kind: "executed" };
  }

  // 2. New Window Actions
  if (descriptor.launchMode === "new-window") {
    if (request.id === "app.terminals.new-window") {
      const profileId =
        request.context.owner?.profileId ??
        request.context.windowContext?.profileId;
      if (!profileId) {
        return {
          kind: "disabled",
          reason: "No profile connection available for terminal creation",
        };
      }
      const generation = request.context.owner?.generation ?? 1;
      const terminalCreate =
        "terminalCreate" in request ? request.terminalCreate : undefined;
      const target: FsTargetRef =
        terminalCreate?.target ??
        request.context.target ??
        (request.context.windowContext?.projectId
          ? {
              kind: "project",
              profileId,
              project: request.context.windowContext.projectId,
              worktreePath: request.context.windowContext.worktreeId,
            }
          : { kind: "workspace", profileId });
      const cwd = terminalCreate?.cwd ?? null;
      const directoryKind =
        terminalCreate?.directoryKind ??
        (cwd ? "explicit-folder" : "profile-default");

      const identityParams = buildTerminalLaunchIdentity({
        profileId,
        target,
        fallbackProjectId: request.context.windowContext?.projectId,
        fallbackWorktreeId: request.context.windowContext?.worktreeId,
        cwd,
      });

      const reserveResult = await reserveTrackedTerminalLaunch(identityParams, {
        generation,
        desktopId: activeDesktopId,
        explicitRequestedTerminalId: terminalCreate?.requestedTerminalId,
      });

      if (reserveResult.status === "blocked") {
        return { kind: "blocked", reason: reserveResult.reason };
      }

      const terminalWindowId = `terminals-${generateUUID().slice(0, 8)}`;
      const manifest = getAppManifest("terminals");

      const windowCtx: WindowContext = {
        profileId,
        generation,
        projectId: identityParams.projectId ?? undefined,
        worktreeId: identityParams.worktreeId ?? undefined,
        target,
      };

      // Create window
      state.openWindow(
        {
          id: terminalWindowId,
          appId: "terminals",
          title: manifest?.displayName ?? "Terminals",
          ctx: windowCtx,
          mode: manifest?.defaultPlacement ?? "float",
          appState: {
            sessionId: reserveResult.requestedTerminalId,
            terminalId: reserveResult.requestedTerminalId,
            requestedTerminalId: reserveResult.requestedTerminalId,
            attemptId: reserveResult.attemptId,
            cwd,
            directoryKind,
          },
        },
        activeDesktopId,
      );

      recordWindowFocus(terminalWindowId);
      return { kind: "opened", windowId: terminalWindowId };
    }

    if (request.id === "app.editor.new-window") {
      const windowId = `editor-${generateUUID().slice(0, 8)}`;
      const manifest = getAppManifest("editor");
      const profileId =
        request.context.owner?.profileId ??
        request.context.windowContext?.profileId ??
        "default";
      const generation = request.context.owner?.generation ?? 1;

      state.openWindow(
        {
          id: windowId,
          appId: "editor",
          title: manifest?.displayName ?? "Editor",
          ctx: {
            profileId,
            generation,
            projectId: request.context.windowContext?.projectId,
            worktreeId: request.context.windowContext?.worktreeId,
            target: request.context.target,
          },
          mode: manifest?.defaultPlacement ?? "float",
          appState: {
            presentation: {
              kind: "choose-target",
              capturedContext: request.context,
              ownerGeneration: generation,
              destinationDesktopId: activeDesktopId,
              deliveryToken: generateUUID(),
            },
          },
        },
        activeDesktopId,
      );

      recordWindowFocus(windowId);
      return { kind: "opened", windowId };
    }

    if (request.id === "app.browser.new-window") {
      const windowId = `browser-${generateUUID().slice(0, 8)}`;
      const manifest = getAppManifest("browser");
      const profileId =
        request.context.owner?.profileId ??
        request.context.windowContext?.profileId ??
        "default";
      const generation = request.context.owner?.generation ?? 1;
      const ownerScope = extractBrowserOwnerScopeFromSnapshot(getConnectionSnapshot(profileId));
      const blankTab = createBlankBrowserTab();
      const initialAppState = createInitialBrowserWindowState({
        ...(ownerScope ? { ownerScope } : {}),
        tabs: [blankTab],
        activeTabId: blankTab.tabId,
      });

      state.openWindow(
        {
          id: windowId,
          appId: "browser",
          title: manifest?.displayName ?? "Browser Preview",
          ctx: {
            profileId,
            generation,
          },
          mode: manifest?.defaultPlacement ?? "float",
          appState: initialAppState as unknown as Record<string, unknown>,
        },
        activeDesktopId,
      );

      recordWindowFocus(windowId);
      return { kind: "opened", windowId };
    }
  }

  // 3. Open / Focus Actions
  const appId = descriptor.appId;
  if (!appId) {
    return { kind: "disabled", reason: `No appId associated with ${request.id}` };
  }

  const manifest = getAppManifest(appId);
  const targetProfileId =
    request.context.owner?.profileId ??
    request.context.windowContext?.profileId ??
    "default";
  const targetGeneration = request.context.owner?.generation ?? 1;

  const targetCtx: WindowContext = {
    profileId: targetProfileId,
    generation: targetGeneration,
    projectId: request.context.windowContext?.projectId,
    worktreeId: request.context.windowContext?.worktreeId,
    gitRootId: request.context.windowContext?.gitRootId,
    operation: request.context.windowContext?.operation,
    target: request.context.target,
  };

  // Check for existing compatible window (multi-instance search included)
  const allWindows = Object.values(session.windows);
  let candidates: OsWindow[] = [];

  if (manifest?.instancing === "single-instance") {
    candidates = allWindows.filter((w) => w.appId === appId);
  } else if (manifest?.instancing === "profile-instance") {
    candidates = allWindows.filter(
      (w) => w.appId === appId && w.ctx.profileId === targetProfileId,
    );
  } else if (manifest?.instancing === "project-instance") {
    candidates = allWindows.filter(
      (w) =>
        w.appId === appId &&
        w.ctx.profileId === targetProfileId &&
        w.ctx.projectId === targetCtx.projectId,
    );
  } else if (manifest?.instancing === "worktree-instance") {
    candidates = allWindows.filter(
      (w) =>
        w.appId === appId &&
        w.ctx.profileId === targetProfileId &&
        w.ctx.projectId === targetCtx.projectId &&
        w.ctx.worktreeId === targetCtx.worktreeId,
    );
  } else if (manifest?.instancing === "multi-instance") {
    const verifiedScope = extractBrowserOwnerScopeFromSnapshot(getConnectionSnapshot(targetProfileId));
    candidates = allWindows.filter((w) => {
      if (w.appId !== appId || w.ctx.profileId !== targetProfileId) return false;
      if (appId !== "browser") return true;
      const bState = w.appState as Partial<BrowserWindowState> | undefined;
      if (bState?.closing) return false;
      if (bState?.ownerScope && verifiedScope && !areBrowserOwnerScopesEqual(bState.ownerScope, verifiedScope)) {
        return false;
      }
      return true;
    });
  }

  // Sort candidates: prefer active desktop, then MRU focus timestamp descending, ties broken by window id
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const aOnActive = a.desktopId === activeDesktopId ? 1 : 0;
      const bOnActive = b.desktopId === activeDesktopId ? 1 : 0;
      if (aOnActive !== bOnActive) return bOnActive - aOnActive;

      const aTime = getWindowFocusTimestamp(a.id);
      const bTime = getWindowFocusTimestamp(b.id);
      if (aTime !== bTime) return bTime - aTime;

      return a.id.localeCompare(b.id);
    });

    const chosen = candidates[0];

    // Handle Settings Appearance repeated delivery
    if (appId === "settings" && request.id === "app.settings.open") {
      const settingsReq = request as { settingsSection?: string };
      if (settingsReq.settingsSection === "appearance") {
        state.updateAppState(chosen.id, {
          section: "appearance",
          settingsSection: "appearance",
          deliveryId: generateUUID(),
          activeTab: "general",
        });
      }
    } else if (appId === "search" && request.id === "app.search.open") {
      const editorQuery =
        request.context.kind === "editor" && request.context.selectedText?.trim()
          ? request.context.selectedText.trim()
          : undefined;
      state.updateAppState(chosen.id, {
        mode: "content",
        searchMode: "content",
        scope: targetCtx.projectId ? "project" : "workspace",
        ...(editorQuery !== undefined ? { query: editorQuery } : {}),
        deliveryId: generateUUID(),
      });
    }

    if (chosen.minimized) {
      state.restoreWindow(chosen.id);
    }
    if (chosen.desktopId !== activeDesktopId) {
      state.switchDesktop(chosen.desktopId);
    }
    state.focusWindow(chosen.id);
    recordWindowFocus(chosen.id);
    return { kind: "focused", windowId: chosen.id };
  }

  // No existing window: open new
  const newWindowId = `${appId}-${generateUUID().slice(0, 8)}`;
  let initialAppState: Record<string, unknown> | undefined;

  if (appId === "settings") {
    const settingsReq = request as { settingsSection?: string };
    if (settingsReq.settingsSection === "appearance") {
      initialAppState = {
        section: "appearance",
        settingsSection: "appearance",
        deliveryId: generateUUID(),
        activeTab: "general",
      };
    }
  } else if (appId === "search" && request.id === "app.search.open") {
    const editorQuery =
      request.context.kind === "editor" && request.context.selectedText?.trim()
        ? request.context.selectedText.trim()
        : undefined;
    initialAppState = {
      mode: "content",
      searchMode: "content",
      scope: targetCtx.projectId ? "project" : "workspace",
      ...(editorQuery !== undefined ? { query: editorQuery } : {}),
      deliveryId: generateUUID(),
    };
  } else if (appId === "editor") {
    if (request.context.kind === "editor" && request.context.filePath) {
      initialAppState = {
        presentation: {
          kind: "resource",
          target: request.context.target,
          filePath: request.context.filePath,
        },
        filePath: request.context.filePath,
      };
    } else {
      initialAppState = {
        presentation: {
          kind: "choose-target",
          capturedContext: request.context,
          ownerGeneration: targetGeneration,
          destinationDesktopId: activeDesktopId,
          deliveryToken: generateUUID(),
        },
      };
    }
  } else if (appId === "browser") {
    let reqUrl: string | undefined;
    if (request.context && typeof request.context === "object" && "url" in request.context) {
      const raw = (request.context as Record<string, unknown>).url;
      if (typeof raw === "string") reqUrl = raw;
    }
    if (!reqUrl && typeof request === "object" && "url" in request) {
      const raw = (request as Record<string, unknown>).url;
      if (typeof raw === "string") reqUrl = raw;
    }
    const verified = captureVerifiedBrowserOwner(targetProfileId);
    const ownerVerifiedForLaunch = Boolean(verified && verified.owner.generation === targetGeneration);
    const validReqUrl = reqUrl ? normalizeBrowserCommittedUrl(reqUrl) : undefined;

    if (reqUrl) {
      if (validReqUrl && ownerVerifiedForLaunch && verified) {
        try {
          await resetAddressSuppression(verified.scope);
        } catch (err) {
          return { kind: "blocked", reason: err instanceof Error ? err.message : String(err) };
        }
        if (!isCapturedBrowserOwnerCurrent(verified.owner, verified.scope)) {
          return { kind: "blocked", reason: "Profile disconnected or generation changed before opening browser URL" };
        }
        const creationKey = generateUUID();
        const tab: BrowserTabRuntime = {
          ...createBlankBrowserTab({ draftValue: validReqUrl, dirty: false }),
          committedUrl: validReqUrl,
          phase: "creating",
          createIntent: {
            operationId: generateUUID(),
            creationKey,
            request: { creationKey, url: validReqUrl, viewport: { width: 1280, height: 800, dpr: 1 } },
          },
        };
        initialAppState = createInitialBrowserWindowState({
          ownerScope: verified.scope,
          tabs: [tab],
          activeTabId: tab.tabId,
        }) as unknown as Record<string, unknown>;
      } else {
        const tab = createBlankBrowserTab();
        initialAppState = createInitialBrowserWindowState({
          ...(verified ? { ownerScope: verified.scope } : {}),
          tabs: [tab],
          activeTabId: tab.tabId,
        }) as unknown as Record<string, unknown>;
      }
    } else if (ownerVerifiedForLaunch && verified) {
      try {
        const lockedResult = await withBrowserRecoveryLock<ActionResult>(() => {
          if (!isCapturedBrowserOwnerCurrent(verified.owner, verified.scope)) {
            return { kind: "blocked", reason: "Profile disconnected or generation changed before opening browser" };
          }
          const currentStore = useWindowStore.getState();
          const existingEligible = Object.values(currentStore.session.windows).find((w) => {
            if (w.appId !== "browser" || w.ctx.profileId !== targetProfileId) return false;
            const bState = w.appState as Partial<BrowserWindowState> | undefined;
            if (bState?.closing) return false;
            return !bState?.ownerScope || areBrowserOwnerScopesEqual(bState.ownerScope, verified.scope);
          });
          if (existingEligible) {
            if (existingEligible.minimized) currentStore.restoreWindow(existingEligible.id);
            if (existingEligible.desktopId !== currentStore.session.activeDesktopId) {
              currentStore.switchDesktop(existingEligible.desktopId);
            }
            currentStore.focusWindow(existingEligible.id);
            recordWindowFocus(existingEligible.id);
            return { kind: "focused", windowId: existingEligible.id };
          }

          const disk = loadBrowserRecoveryDisk();
          const suppressed = isOwnerAddressSuppressed(verified.scope, disk);
          const targetGroup = !suppressed
            ? disk.groups.find((g) => areBrowserOwnerScopesEqual(g.ownerScope, verified.scope))
            : undefined;
          const groupBlocked = targetGroup
            ? disk.operations.some((op) =>
                areBrowserOwnerScopesEqual(op.ownerScope, verified.scope) &&
                op.groupId === targetGroup.groupId &&
                (op.status === "pending" || op.status === "unknown"))
            : false;

          let nextAppState: BrowserWindowState;
          if (targetGroup && !groupBlocked) {
            const validAddresses = targetGroup.addresses
              .map((addr) => normalizeBrowserCommittedUrl(addr))
              .filter((u): u is string => Boolean(u));
            if (validAddresses.length > 0) {
              saveBrowserRecoveryDisk({
                ...disk,
                groups: disk.groups.filter((g) => g.groupId !== targetGroup.groupId),
              });
              const activeIdx = Math.min(Math.max(0, targetGroup.activeIndex), validAddresses.length - 1);
              const tabs: BrowserTabRuntime[] = validAddresses.map((addr, idx) => {
                if (idx === activeIdx) {
                  const creationKey = generateUUID();
                  return {
                    ...createBlankBrowserTab({ draftValue: addr, dirty: false }),
                    committedUrl: addr,
                    phase: "creating",
                    createIntent: {
                      operationId: generateUUID(),
                      creationKey,
                      request: { creationKey, url: addr, viewport: { width: 1280, height: 800, dpr: 1 } },
                    },
                  };
                }
                return {
                  ...createBlankBrowserTab({ draftValue: addr, dirty: false }),
                  committedUrl: addr,
                  phase: "deferred",
                };
              });
              nextAppState = createInitialBrowserWindowState({
                ownerScope: verified.scope,
                tabs,
                activeTabId: tabs[activeIdx]!.tabId,
                restoreGroupId: targetGroup.groupId,
              });
            } else {
              saveBrowserRecoveryDisk({
                ...disk,
                groups: disk.groups.filter((g) => g.groupId !== targetGroup.groupId),
              });
              const blank = createBlankBrowserTab();
              nextAppState = createInitialBrowserWindowState({
                ownerScope: verified.scope,
                tabs: [blank],
                activeTabId: blank.tabId,
              });
            }
          } else {
            const blank = createBlankBrowserTab();
            nextAppState = createInitialBrowserWindowState({
              ownerScope: verified.scope,
              tabs: [blank],
              activeTabId: blank.tabId,
            });
          }

          currentStore.openWindow(
            {
              id: newWindowId,
              appId: "browser",
              title: manifest?.displayName ?? "Browser Preview",
              ctx: targetCtx,
              mode: manifest?.defaultPlacement ?? "float",
              appState: nextAppState as unknown as Record<string, unknown>,
            },
            activeDesktopId,
          );
          recordWindowFocus(newWindowId);
          return { kind: "opened", windowId: newWindowId };
        });
        return lockedResult;
      } catch (err) {
        return { kind: "blocked", reason: err instanceof Error ? err.message : String(err) };
      }
    } else {
      const blank = createBlankBrowserTab();
      initialAppState = createInitialBrowserWindowState({
        tabs: [blank],
        activeTabId: blank.tabId,
      }) as unknown as Record<string, unknown>;
    }
  }

  state.openWindow(
    {
      id: newWindowId,
      appId,
      title: manifest?.displayName ?? appId,
      ctx: targetCtx,
      mode: manifest?.defaultPlacement ?? "float",
      appState: initialAppState,
    },
    activeDesktopId,
  );

  recordWindowFocus(newWindowId);
  return { kind: "opened", windowId: newWindowId };
}
