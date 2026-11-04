import { create } from "zustand";
import type {
  FloatBounds,
  OsSessionV1,
  OsWindow,
  WindowContext,
  WindowMode,
} from "./types.js";
import type { TileDockTarget } from "@/types/tile-tree.js";
import {
  addDesktop,
  bringWindowToFront,
  clampFloatBounds,
  closeWindow,
  createDefaultOsSession,
  DEFAULT_FLOAT_BOUNDS,
  dockWindowInDesktopTree,
  focusWindow,
  minimizeWindow,
  moveTabWithinPane,
  moveWindowToDesktop,
  openWindow,
  removeDesktop,
  removeWindowFromAllDesktopPlacements,
  renameDesktop,
  type ResizeDirection,
  resizeFloatBounds,
  restoreWindow,
  selectPaneTab,
  setDefaultCtx,
  sendWindowToBack,
  setWindowMode,
  splitWindow,
  switchDesktop,
  toggleMaximizeWindow,
  toggleWindowMode,
  updateDesktopTreeSizes,
  updateFloatBounds,
} from "./window-ops.js";
import { collectTilePanes, findTilePaneContaining } from "@/lib/tile-tree.js";
import { useSettingsStore } from "@/stores/settings.js";

export interface WindowStoreState {
  session: OsSessionV1;
  viewport: { width: number; height: number };
  setViewport: (viewport: { width: number; height: number }) => void;
  setSession: (session: OsSessionV1) => void;
  openWindow: (
    window: Omit<OsWindow, "desktopId" | "maximized" | "minimized">,
    desktopId?: string,
  ) => void;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  switchDesktop: (desktopId: string) => void;
  moveWindowToDesktop: (windowId: string, desktopId: string) => void;
  setWindowMode: (windowId: string, mode: WindowMode) => void;
  toggleWindowMode: (windowId: string) => void;
  toggleMaximizeWindow: (windowId: string) => void;
  minimizeWindow: (windowId: string) => void;
  restoreWindow: (windowId: string) => void;
  updateFloatBounds: (windowId: string, bounds: FloatBounds) => void;
  dockWindow: (
    desktopId: string,
    windowId: string,
    target: TileDockTarget,
    sourcePaneId?: string,
  ) => void;
  updateTreeSizes: (
    desktopId: string,
    splitId: string,
    sizes: [number, number],
  ) => void;
  addDesktop: (name?: string, defaultCtx?: WindowContext) => void;
  removeDesktop: (desktopId: string, survivingDesktopId?: string) => void;
  renameDesktop: (desktopId: string, name: string) => void;
  setDefaultCtx: (desktopId: string, defaultCtx?: WindowContext) => void;
  bringWindowToFront: (windowId: string) => void;
  sendWindowToBack: (windowId: string) => void;
  resizeFloatBounds: (
    windowId: string,
    deltaX: number,
    deltaY: number,
    direction: ResizeDirection,
  ) => void;
  selectPaneTab: (paneId: string, windowId: string) => void;
  moveTabWithinPane: (
    paneId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  updateAppState: (windowId: string, patch: Record<string, unknown>) => void;
  updateWindowContext: (windowId: string, patch: Partial<WindowContext>) => void;
  splitWindow: (
    sourceWindowId: string,
    targetWindowId: string,
    direction: "left" | "right" | "top" | "bottom" | "center",
  ) => void;
  placeExistingTerminal: (params: {
    sourceHubWindowId: string;
    terminalWindow: OsWindow;
    action: "focus-existing" | "open-beside" | "move-beside";
  }) => string;
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  session: createDefaultOsSession(),
  viewport: { width: 1280, height: 800 },
  setViewport: (viewport) => {
    set({ viewport });
  },
  setSession: (session) => set({ session }),

  openWindow: (window, desktopId) => {
    const defaultMode = useSettingsStore.getState().defaultWindowPlacement ?? "float";
    const mode = window.mode ?? defaultMode;
    set((state) => ({
      session: openWindow(state.session, { ...window, mode }, desktopId, state.viewport),
    }));
  },

  closeWindow: (windowId) => {
    set((state) => ({
      session: closeWindow(state.session, windowId),
    }));
  },

  focusWindow: (windowId) => {
    set((state) => ({
      session: focusWindow(state.session, windowId),
    }));
  },

  switchDesktop: (desktopId) => {
    set((state) => ({
      session: switchDesktop(state.session, desktopId),
    }));
  },

  moveWindowToDesktop: (windowId, desktopId) => {
    set((state) => ({
      session: moveWindowToDesktop(state.session, windowId, desktopId),
    }));
  },

  setWindowMode: (windowId, mode) => {
    set((state) => ({
      session: setWindowMode(state.session, windowId, mode, state.viewport),
    }));
  },

  toggleWindowMode: (windowId) => {
    set((state) => ({
      session: toggleWindowMode(state.session, windowId, state.viewport),
    }));
  },
  toggleMaximizeWindow: (windowId) => {
    set((state) => ({
      session: toggleMaximizeWindow(state.session, windowId),
    }));
  },

  minimizeWindow: (windowId) => {
    set((state) => ({
      session: minimizeWindow(state.session, windowId),
    }));
  },

  restoreWindow: (windowId) => {
    set((state) => ({
      session: restoreWindow(state.session, windowId),
    }));
  },

  updateFloatBounds: (windowId, bounds) => {
    const { viewport } = get();
    set((state) => ({
      session: updateFloatBounds(state.session, windowId, bounds, viewport),
    }));
  },

  dockWindow: (desktopId, windowId, target, sourcePaneId) => {
    set((state) => ({
      session: dockWindowInDesktopTree(
        state.session,
        desktopId,
        windowId,
        target,
        sourcePaneId,
      ),
    }));
  },

  updateTreeSizes: (desktopId, splitId, sizes) => {
    set((state) => ({
      session: updateDesktopTreeSizes(state.session, desktopId, splitId, sizes),
    }));
  },

  addDesktop: (name, defaultCtx) => {
    set((state) => ({
      session: addDesktop(state.session, name, defaultCtx),
    }));
  },

  removeDesktop: (desktopId, survivingDesktopId) => {
    set((state) => ({
      session: removeDesktop(state.session, desktopId, survivingDesktopId),
    }));
  },

  renameDesktop: (desktopId, name) => {
    set((state) => ({
      session: renameDesktop(state.session, desktopId, name),
    }));
  },

  setDefaultCtx: (desktopId, defaultCtx) => {
    set((state) => ({
      session: setDefaultCtx(state.session, desktopId, defaultCtx),
    }));
  },

  bringWindowToFront: (windowId) => {
    set((state) => ({
      session: bringWindowToFront(state.session, windowId),
    }));
  },

  sendWindowToBack: (windowId) => {
    set((state) => ({
      session: sendWindowToBack(state.session, windowId),
    }));
  },

  resizeFloatBounds: (windowId, deltaX, deltaY, direction) => {
    const { viewport } = get();
    set((state) => {
      const win = state.session.windows[windowId];
      if (!win || win.mode !== "float" || !win.floatBounds) return state;
      const nextBounds = resizeFloatBounds(
        win.floatBounds,
        deltaX,
        deltaY,
        direction,
        viewport,
      );
      return {
        session: updateFloatBounds(
          state.session,
          windowId,
          nextBounds,
          viewport,
        ),
      };
    });
  },

  selectPaneTab: (paneId, windowId) => {
    set((state) => ({
      session: selectPaneTab(state.session, paneId, windowId),
    }));
  },

  moveTabWithinPane: (paneId, fromIndex, toIndex) => {
    set((state) => ({
      session: moveTabWithinPane(state.session, paneId, fromIndex, toIndex),
    }));
  },

  splitWindow: (sourceWindowId, targetWindowId, direction) => {
    set((state) => ({
      session: splitWindow(
        state.session,
        sourceWindowId,
        targetWindowId,
        direction,
      ),
    }));
  },

  updateAppState: (windowId, patch) => {
    set((state) => {
      const win = state.session.windows[windowId];
      if (!win) return state;
      return {
        session: {
          ...state.session,
          windows: {
            ...state.session.windows,
            [windowId]: {
              ...win,
              appState: { ...win.appState, ...patch },
            },
          },
        },
      };
    });
  },

  updateWindowContext: (windowId, patch) => {
    set((state) => {
      const win = state.session.windows[windowId];
      if (!win) return state;
      return {
        session: {
          ...state.session,
          windows: {
            ...state.session.windows,
            [windowId]: {
              ...win,
              ctx: { ...win.ctx, ...patch },
            },
          },
        },
      };
    });
  },

  placeExistingTerminal: ({ sourceHubWindowId, terminalWindow, action }) => {
    let targetWindowId = terminalWindow.id;
    set((state) => {
      const sourceHubWin = state.session.windows[sourceHubWindowId];
      if (!sourceHubWin) return state;

      const destDesktopId = sourceHubWin.desktopId;
      const destDesk = state.session.desktops.find((d) => d.id === destDesktopId);
      if (!destDesk) return state;

      const existingWin = state.session.windows[terminalWindow.id];

      if (action === "focus-existing") {
        if (existingWin) {
          let nextSession = state.session;
          if (existingWin.desktopId !== state.session.activeDesktopId) {
            nextSession = switchDesktop(nextSession, existingWin.desktopId);
          }
          if (existingWin.minimized) {
            nextSession = restoreWindow(nextSession, existingWin.id);
          }
          nextSession = focusWindow(nextSession, existingWin.id);
          targetWindowId = existingWin.id;
          return { session: nextSession };
        }
      }

      let nextSession = state.session;
      if (existingWin) {
        nextSession = removeWindowFromAllDesktopPlacements(nextSession, existingWin.id);
      }

      const winToPlace: OsWindow = existingWin
        ? {
            ...existingWin,
            ...terminalWindow,
            desktopId: destDesktopId,
            minimized: false,
            maximized: false,
            restorePlacement: undefined,
          }
        : {
            ...terminalWindow,
            desktopId: destDesktopId,
            minimized: false,
            maximized: false,
            restorePlacement: undefined,
          };
      nextSession = {
        ...nextSession,
        windows: {
          ...nextSession.windows,
          [winToPlace.id]: winToPlace,
        },
      };

      const currentDestDesk = nextSession.desktops.find((d) => d.id === destDesktopId) ?? destDesk;

      if (sourceHubWin.mode === "tile" && currentDestDesk.tree !== null) {
        const hubPane = findTilePaneContaining(
          currentDestDesk.tree,
          (id) => id === sourceHubWindowId,
        );
        if (hubPane) {
          const allPanes = collectTilePanes(currentDestDesk.tree);
          const adjacentTerminalsPane = allPanes.find(
            (p) =>
              p.id !== hubPane.id &&
              p.items.some((wId) => {
                const w = nextSession.windows[wId];
                return w && w.appId === "terminals" && w.id !== winToPlace.id;
              }),
          );

          if (adjacentTerminalsPane) {
            nextSession = dockWindowInDesktopTree(
              nextSession,
              destDesktopId,
              winToPlace.id,
              { kind: "pane-center", paneId: adjacentTerminalsPane.id },
            );
          } else {
            nextSession = dockWindowInDesktopTree(
              nextSession,
              destDesktopId,
              winToPlace.id,
              { kind: "pane-edge", paneId: hubPane.id, edge: "right" },
            );
          }
        } else {
          nextSession = dockWindowInDesktopTree(
            nextSession,
            destDesktopId,
            winToPlace.id,
            { kind: "pane-center", paneId: currentDestDesk.tree.id },
          );
        }
      } else {
        const sourceBounds = sourceHubWin.floatBounds ?? DEFAULT_FLOAT_BOUNDS;
        const newBounds = clampFloatBounds(
          {
            x: sourceBounds.x + 28,
            y: sourceBounds.y + 28,
            width: sourceBounds.width,
            height: sourceBounds.height,
          },
          state.viewport,
        );
        winToPlace.mode = "float";
        winToPlace.floatBounds = newBounds;
        nextSession = {
          ...nextSession,
          windows: {
            ...nextSession.windows,
            [winToPlace.id]: winToPlace,
          },
        };
        const latestDestDesk =
          nextSession.desktops.find((d) => d.id === destDesktopId) ?? destDesk;
        const currentFloats = latestDestDesk.floatingWindowIds.filter(
          (id) => id !== winToPlace.id,
        );
        const updatedDesktops = nextSession.desktops.map((d) =>
          d.id === destDesktopId
            ? { ...d, floatingWindowIds: [...currentFloats, winToPlace.id] }
            : {
                ...d,
                floatingWindowIds: d.floatingWindowIds.filter(
                  (id) => id !== winToPlace.id,
                ),
              },
        );
        nextSession = { ...nextSession, desktops: updatedDesktops };
      }

      nextSession = focusWindow(nextSession, winToPlace.id);
      targetWindowId = winToPlace.id;
      return { session: nextSession };
    });
    return targetWindowId;
  },
}));

declare global {
  interface Window {
    __DAM_HOPPER_WINDOW_STORE__?: typeof useWindowStore;
  }
}

if (typeof window !== "undefined") {
  window.__DAM_HOPPER_WINDOW_STORE__ = useWindowStore;
}
