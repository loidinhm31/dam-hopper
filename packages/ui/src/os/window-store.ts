import { create } from "zustand";
import type { FloatBounds, OsSessionV1, OsWindow, WindowMode } from "./types.js";
import type { TileDockTarget } from "@/types/tile-tree.js";
import {
  clampFloatBounds,
  closeWindow,
  createDefaultOsSession,
  dockWindowInDesktopTree,
  focusWindow,
  minimizeWindow,
  moveWindowToDesktop,
  openWindow,
  restoreWindow,
  setWindowMode,
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
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  session: createDefaultOsSession(),
  viewport: { width: 1280, height: 800 },
  setViewport: (viewport) => {
    set((state) => {
      const updatedWindows = { ...state.session.windows };
      let changed = false;
      for (const [winId, win] of Object.entries(updatedWindows)) {
        if (win.mode === "float" && win.floatBounds) {
          const clamped = clampFloatBounds(win.floatBounds, viewport);
          if (
            clamped.x !== win.floatBounds.x ||
            clamped.y !== win.floatBounds.y ||
            clamped.width !== win.floatBounds.width ||
            clamped.height !== win.floatBounds.height
          ) {
            updatedWindows[winId] = { ...win, floatBounds: clamped };
            changed = true;
          }
        }
      }
      return {
        viewport,
        session: changed
          ? { ...state.session, windows: updatedWindows }
          : state.session,
      };
    });
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
}));
