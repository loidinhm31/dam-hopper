import { getConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { generateUUID } from "@/lib/utils.js";
import type { OsSessionV1, OsWindow } from "../types.js";
import { closeWindow } from "../window-ops.js";
import { closeBrowserTarget } from "./browser-close-lifecycle.js";
import { extractBrowserOwnerScopeFromSnapshot } from "./browser-owner-scope.js";
import { createRememberedBrowserGroup } from "./browser-persistence.js";
import {
  settleRecoveryOperation,
  stageRecoveryOperation,
} from "./browser-recovery-store.js";
import { isOperationRiskAcknowledged } from "./browser-session-inventory.js";
import type {
  BrowserOwnerScope,
  BrowserTabPhase,
  BrowserWindowState,
} from "./browser-tab-types.js";

interface WindowStoreStateSlice {
  session: OsSessionV1;
}

const activeCoordinators = new Set<string>();

export function coordinateBrowserWindowClose(
  windowId: string,
  win: OsWindow,
  get: () => WindowStoreStateSlice,
  set: (updater: (state: WindowStoreStateSlice) => Partial<WindowStoreStateSlice>) => void,
): void {
  const currentWin = get().session.windows[windowId];
  if (!currentWin || currentWin.appId !== "browser" || activeCoordinators.has(windowId)) return;

  const appState = currentWin.appState as BrowserWindowState | { sessionId?: string } | undefined;
  if (appState && "closing" in appState && appState.closing) {
    if (appState.closing.status === "unknown" && isOperationRiskAcknowledged(appState.closing.operationId)) {
      set((state) => ({ session: closeWindow(state.session, windowId) }));
    }
    return;
  }

  const profileId = currentWin.ctx?.profileId ?? "default";
  const snapshot = getConnectionSnapshot(profileId);
  const owner: ConnectionRef = { profileId, generation: snapshot?.owner.generation ?? 0 };
  const scope: BrowserOwnerScope | null = (appState && "ownerScope" in appState && appState.ownerScope)
    ? appState.ownerScope : extractBrowserOwnerScopeFromSnapshot(snapshot);

  if (appState && "tabs" in appState && Array.isArray(appState.tabs)) {
    const windowOpId = generateUUID();
    const rememberedGroup = scope ? createRememberedBrowserGroup(scope, appState) : null;
    activeCoordinators.add(windowId);

    void (async () => {
      try {
        if (scope) {
          await stageRecoveryOperation({
            operationId: windowOpId,
            ownerScope: scope,
            kind: "close-window",
            groupId: rememberedGroup?.groupId,
            windowId,
            status: "pending",
          }, rememberedGroup);
        }

        // Mark tabs & window closing with post-stage fence
        set((state) => {
          const target = state.session.windows[windowId];
          if (!target || target.appId !== "browser" || !target.appState) return state;
          const curState = target.appState as unknown as BrowserWindowState;
          if (curState.closing && curState.closing.operationId !== windowOpId) return state;
          const nextTabs = curState.tabs.map((t) => ({ ...t, phase: (t.sessionId ? "closing" : t.phase) as BrowserTabPhase }));
          return {
            session: {
              ...state.session,
              windows: { ...state.session.windows, [windowId]: { ...target, appState: { ...curState, tabs: nextTabs, closing: { operationId: windowOpId, status: "pending" } } } },
            },
          };
        });

        const tabsWithSessions = appState.tabs.filter((t) => typeof t.sessionId === "string" && Boolean(t.sessionId));
        let hasNonClosed = false;

        if (scope) {
          for (const tab of tabsWithSessions) {
            const targetOpId = generateUUID();
            const outcome = await closeBrowserTarget({
              owner,
              scope,
              sessionId: tab.sessionId!,
              windowId,
              tabId: tab.tabId,
              operationId: targetOpId,
              groupId: rememberedGroup?.groupId,
              runtime: tab.snapshot,
            });
            if (outcome.kind !== "closed" && outcome.kind !== "released") hasNonClosed = true;
          }
        }

        const latestWin = get().session.windows[windowId];
        if (!latestWin || latestWin.appId !== "browser") return;
        const latestState = latestWin.appState as unknown as BrowserWindowState;
        if (latestState?.closing?.operationId !== windowOpId) return;

        if (hasNonClosed) {
          if (scope) {
            await stageRecoveryOperation({ operationId: windowOpId, ownerScope: scope, kind: "close-window", groupId: rememberedGroup?.groupId, windowId, status: "unknown" }).catch(() => {});
          }
          set((state) => {
            const target = state.session.windows[windowId];
            if (!target || target.appId !== "browser" || !target.appState) return state;
            const curState = target.appState as unknown as BrowserWindowState;
            if (curState.closing?.operationId !== windowOpId) return state;
            return {
              session: { ...state.session, windows: { ...state.session.windows, [windowId]: { ...target, appState: { ...curState, closing: { operationId: windowOpId, status: "unknown" } } } } },
            };
          });
        } else {
          if (scope) await settleRecoveryOperation(windowOpId);
          set((state) => {
            const target = state.session.windows[windowId];
            if (!target || target.appId !== "browser" || !target.appState) return state;
            const curState = target.appState as unknown as BrowserWindowState;
            if (curState.closing?.operationId !== windowOpId) return state;
            return { session: closeWindow(state.session, windowId) };
          });
        }
      } catch (err) {
        set((state) => {
          const target = state.session.windows[windowId];
          if (!target || target.appId !== "browser" || !target.appState) return state;
          const curState = target.appState as unknown as BrowserWindowState;
          if (curState.closing?.operationId !== windowOpId) return state;
          return {
            session: { ...state.session, windows: { ...state.session.windows, [windowId]: { ...target, appState: { ...curState, closing: { operationId: windowOpId, status: "unknown" } } } } },
          };
        });
      } finally {
        activeCoordinators.delete(windowId);
      }
    })();
    return;
  }

  const legacySessionId = appState && "sessionId" in appState ? appState.sessionId : undefined;
  if (scope && legacySessionId) {
    activeCoordinators.add(windowId);
    void closeBrowserTarget({ owner, scope, sessionId: legacySessionId, windowId })
      .then((outcome) => {
        if (outcome.kind === "closed" || outcome.kind === "released") {
          set((state) => ({ session: closeWindow(state.session, windowId) }));
        }
      })
      .finally(() => {
        activeCoordinators.delete(windowId);
      });
  } else {
    set((state) => ({ session: closeWindow(state.session, windowId) }));
  }
}
