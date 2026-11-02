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
  dockWindowInDesktopTree,
  focusWindow,
  minimizeWindow,
  moveTabWithinPane,
  moveWindowToDesktop,
  openWindow,
  removeDesktop,
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
  updateDesktopTreeSizes,
  updateFloatBounds,
} from "./window-ops.js";
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
  splitWindow: (
    sourceWindowId: string,
    targetWindowId: string,
    direction: "left" | "right" | "top" | "bottom" | "center",
  ) => void;
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  session: createDefaultOsSession(),
  viewport: { width: 1280, height: 800 },
  setViewport: (viewport) => {
    set({ viewport });
  },
  setSession: (session) => set({ session }),

  openWindow: (window, desktopId) => {
    set((state) => ({
      session: openWindow(state.session, window, desktopId),
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
      session: setWindowMode(state.session, windowId, mode),
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
}));
