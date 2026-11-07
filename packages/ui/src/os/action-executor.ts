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
    // Multi-instance search: search compatible views for profile
    candidates = allWindows.filter(
      (w) => w.appId === appId && w.ctx.profileId === targetProfileId,
    );
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
  } else if (appId === "editor") {
    // Generic editor open with no existing window opens chooser if no selected resource
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
