import type {
  FloatBounds,
  OsDesktop,
  OsSessionV1,
  OsWindow,
  WindowContext,
  WindowMode,
} from "./types.js";
import type { TileDockTarget, TileNode } from "@/types/tile-tree.js";
import {
  collectTilePanes,
  dockItemIntoTileTree,
  findTilePaneById,
  findTilePaneContaining,
  insertItemIntoTilePane,
  newTilePaneNode,
  removeItemFromTilePane,
  removeTilePane,
  updateTilePane,
  updateTileSizes,
} from "@/lib/tile-tree.js";

export const DEFAULT_FLOAT_BOUNDS: FloatBounds = {
  x: 60,
  y: 60,
  width: 720,
  height: 520,
};

export const MIN_FLOAT_WIDTH = 280;
export const MIN_FLOAT_HEIGHT = 200;

export function clampFloatBounds(
  bounds: FloatBounds,
  viewport?: { width: number; height: number },
): FloatBounds {
  const width = Math.max(MIN_FLOAT_WIDTH, bounds.width);
  const height = Math.max(MIN_FLOAT_HEIGHT, bounds.height);
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    return { ...bounds, width, height };
  }
  const maxX = Math.max(0, viewport.width - 50);
  const maxY = Math.max(0, viewport.height - 50);
  const x = Math.max(0, Math.min(bounds.x, maxX));
  const y = Math.max(0, Math.min(bounds.y, maxY));
  return { x, y, width, height };
}

export type ResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

export function resizeFloatBounds(
  bounds: FloatBounds,
  deltaX: number,
  deltaY: number,
  direction: ResizeDirection,
  viewport?: { width: number; height: number },
): FloatBounds {
  let { x, y, width, height } = bounds;

  if (direction.includes("e")) {
    width += deltaX;
  }
  if (direction.includes("s")) {
    height += deltaY;
  }
  if (direction.includes("w")) {
    const nextWidth = width - deltaX;
    if (nextWidth >= MIN_FLOAT_WIDTH) {
      width = nextWidth;
      x += deltaX;
    } else {
      x += width - MIN_FLOAT_WIDTH;
      width = MIN_FLOAT_WIDTH;
    }
  }
  if (direction.includes("n")) {
    const nextHeight = height - deltaY;
    if (nextHeight >= MIN_FLOAT_HEIGHT) {
      height = nextHeight;
      y += deltaY;
    } else {
      y += height - MIN_FLOAT_HEIGHT;
      height = MIN_FLOAT_HEIGHT;
    }
  }

  width = Math.max(MIN_FLOAT_WIDTH, width);
  height = Math.max(MIN_FLOAT_HEIGHT, height);

  return clampFloatBounds({ x, y, width, height }, viewport);
}

export function getVisibleFloatBounds(
  bounds: FloatBounds,
  viewport?: { width: number; height: number },
): FloatBounds {
  return clampFloatBounds(bounds, viewport);
}

export function createDefaultOsSession(
  desktopId: string = "desktop-1",
  name: string = "Main",
): OsSessionV1 {
  const defaultDesktop: OsDesktop = {
    id: desktopId,
    name,
    tree: null,
    floatingWindowIds: [],
    focusedWindowId: null,
  };
  return {
    schema: 1,
    activeDesktopId: desktopId,
    desktops: [defaultDesktop],
    windows: {},
  };
}

function findDesktop(
  session: OsSessionV1,
  desktopId: string,
): OsDesktop | undefined {
  return session.desktops.find((d) => d.id === desktopId);
}

function updateDesktop(
  session: OsSessionV1,
  desktopId: string,
  updater: (desktop: OsDesktop) => OsDesktop,
): OsSessionV1 {
  const desktops = session.desktops.map((d) =>
    d.id === desktopId ? updater(d) : d,
  );
  return { ...session, desktops };
}

export function removeWindowFromDesktopTree(
  tree: TileNode<string> | null,
  windowId: string,
): TileNode<string> | null {
  if (!tree) return null;
  const pane = findTilePaneContaining(tree, (id) => id === windowId);
  if (!pane) return tree;

  if (pane.items.length > 1) {
    return removeItemFromTilePane(tree, pane.id, windowId);
  }

  // Exactly one item in pane -> remove entire pane
  return removeTilePane(tree, pane.id);
}

function pickNextFocus(
  desktop: OsDesktop,
  closedId: string,
  allWindows: Record<string, OsWindow>,
): string | null {
  if (desktop.focusedWindowId !== closedId) {
    return desktop.focusedWindowId;
  }
  const remainingFloating = desktop.floatingWindowIds.filter(
    (id) => id !== closedId && !allWindows[id]?.minimized,
  );
  if (remainingFloating.length > 0) {
    return remainingFloating[remainingFloating.length - 1] ?? null;
  }
  if (desktop.tree) {
    const panes = collectTilePanes(desktop.tree);
    for (const pane of panes) {
      const live = pane.items.find(
        (id) => id !== closedId && !allWindows[id]?.minimized,
      );
      if (live) return live;
    }
  }
  return null;
}

export function openWindow(
  session: OsSessionV1,
  windowConfig: Omit<OsWindow, "desktopId" | "maximized" | "minimized">,
  targetDesktopId: string = session.activeDesktopId,
): OsSessionV1 {
  const desktop = findDesktop(session, targetDesktopId) ?? session.desktops[0];
  if (!desktop) return session;

  const window: OsWindow = {
    ...windowConfig,
    desktopId: desktop.id,
    maximized: false,
    minimized: false,
    floatBounds: windowConfig.floatBounds ?? { ...DEFAULT_FLOAT_BOUNDS },
  };

  const updatedWindows = { ...session.windows, [window.id]: window };

  return updateDesktop(
    { ...session, windows: updatedWindows },
    desktop.id,
    (d) => {
      if (window.mode === "float") {
        const floatingWindowIds = [
          ...d.floatingWindowIds.filter((id) => id !== window.id),
          window.id,
        ];
        return { ...d, floatingWindowIds, focusedWindowId: window.id };
      }
      let tree: TileNode<string>;
      if (!d.tree) {
        tree = newTilePaneNode([window.id], window.id);
      } else {
        const panes = collectTilePanes(d.tree);
        const targetPane = panes[0];
        tree = targetPane
          ? insertItemIntoTilePane(d.tree, targetPane.id, window.id)
          : newTilePaneNode([window.id], window.id);
      }
      return { ...d, tree, focusedWindowId: window.id };
    },
  );
}

export function closeWindow(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window) return session;

  const desktop = findDesktop(session, window.desktopId);
  const nextWindows = { ...session.windows };
  delete nextWindows[windowId];

  if (!desktop) {
    return { ...session, windows: nextWindows };
  }

  return updateDesktop(
    { ...session, windows: nextWindows },
    desktop.id,
    (d) => {
      const nextFloating = d.floatingWindowIds.filter((id) => id !== windowId);
      const nextTree = removeWindowFromDesktopTree(d.tree, windowId);
      const nextFocus = pickNextFocus(d, windowId, nextWindows);
      return {
        ...d,
        floatingWindowIds: nextFloating,
        tree: nextTree,
        focusedWindowId: nextFocus,
      };
    },
  );
}

export function focusWindow(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window) return session;

  return updateDesktop(session, window.desktopId, (d) => {
    let tree = d.tree;
    if (tree) {
      const pane = findTilePaneContaining(tree, (id) => id === windowId);
      if (pane && pane.active !== windowId) {
        tree = updateTilePane(tree, pane.id, (p) => ({
          ...p,
          active: windowId,
        }));
      }
    }
    const isFloating = d.floatingWindowIds.includes(windowId);
    const floatingWindowIds = isFloating
      ? [...d.floatingWindowIds.filter((id) => id !== windowId), windowId]
      : d.floatingWindowIds;
    return { ...d, tree, floatingWindowIds, focusedWindowId: windowId };
  });
}

export function switchDesktop(
  session: OsSessionV1,
  targetDesktopId: string,
): OsSessionV1 {
  if (session.activeDesktopId === targetDesktopId) return session;
  if (!findDesktop(session, targetDesktopId)) return session;
  return { ...session, activeDesktopId: targetDesktopId };
}

export function moveWindowToDesktop(
  session: OsSessionV1,
  windowId: string,
  targetDesktopId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window || window.desktopId === targetDesktopId) return session;
  const targetDesktop = findDesktop(session, targetDesktopId);
  if (!targetDesktop) return session;

  // Remove from source desktop
  const withoutWindowSession = updateDesktop(
    session,
    window.desktopId,
    (d) => {
      const floatingWindowIds = d.floatingWindowIds.filter(
        (id) => id !== windowId,
      );
      const tree = removeWindowFromDesktopTree(d.tree, windowId);
      const focusedWindowId =
        d.focusedWindowId === windowId ? null : d.focusedWindowId;
      return { ...d, floatingWindowIds, tree, focusedWindowId };
    },
  );

  const updatedWindow: OsWindow = {
    ...window,
    desktopId: targetDesktopId,
    restorePlacement: window.restorePlacement
      ? { ...window.restorePlacement, desktopId: targetDesktopId }
      : undefined,
  };
  const updatedWindows = {
    ...withoutWindowSession.windows,
    [windowId]: updatedWindow,
  };

  // If window is minimized, update desktop membership without inserting into visible layout
  if (window.minimized) {
    return { ...withoutWindowSession, windows: updatedWindows };
  }

  // Insert into target desktop layout
  return updateDesktop(
    { ...withoutWindowSession, windows: updatedWindows },
    targetDesktopId,
    (d) => {
      if (updatedWindow.mode === "float") {
        return {
          ...d,
          floatingWindowIds: [...d.floatingWindowIds, windowId],
          focusedWindowId: windowId,
        };
      }
      let tree = d.tree;
      if (!tree) {
        tree = newTilePaneNode([windowId], windowId);
      } else {
        const targetPane = collectTilePanes(tree)[0];
        tree = targetPane
          ? insertItemIntoTilePane(tree, targetPane.id, windowId)
          : newTilePaneNode([windowId], windowId);
      }
      return { ...d, tree, focusedWindowId: windowId };
    },
  );
}

export function setWindowMode(
  session: OsSessionV1,
  windowId: string,
  mode: WindowMode,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window || window.mode === mode) return session;

  const updatedWindow: OsWindow = {
    ...window,
    mode,
    floatBounds: window.floatBounds ?? { ...DEFAULT_FLOAT_BOUNDS },
  };
  const updatedWindows = { ...session.windows, [windowId]: updatedWindow };

  return updateDesktop(
    { ...session, windows: updatedWindows },
    window.desktopId,
    (d) => {
      if (mode === "float") {
        const tree = removeWindowFromDesktopTree(d.tree, windowId);
        const floatingWindowIds = [
          ...d.floatingWindowIds.filter((id) => id !== windowId),
          windowId,
        ];
        return { ...d, tree, floatingWindowIds, focusedWindowId: windowId };
      }
      // Mode is "tile"
      const floatingWindowIds = d.floatingWindowIds.filter(
        (id) => id !== windowId,
      );
      let tree = d.tree;
      if (!tree) {
        tree = newTilePaneNode([windowId], windowId);
      } else {
        const targetPane = collectTilePanes(tree)[0];
        tree = targetPane
          ? insertItemIntoTilePane(tree, targetPane.id, windowId)
          : newTilePaneNode([windowId], windowId);
      }
      return { ...d, tree, floatingWindowIds, focusedWindowId: windowId };
    },
  );
}

export function toggleMaximizeWindow(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window) return session;

  const updatedWindow: OsWindow = {
    ...window,
    maximized: !window.maximized,
  };
  return {
    ...session,
    windows: { ...session.windows, [windowId]: updatedWindow },
  };
}

export function minimizeWindow(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window || window.minimized) return session;

  const updatedWindow: OsWindow = {
    ...window,
    minimized: true,
    restorePlacement: {
      mode: window.mode,
      desktopId: window.desktopId,
      floatBounds: window.floatBounds,
    },
  };
  const updatedWindows = { ...session.windows, [windowId]: updatedWindow };

  return updateDesktop(
    { ...session, windows: updatedWindows },
    window.desktopId,
    (d) => {
      const floatingWindowIds = d.floatingWindowIds.filter(
        (id) => id !== windowId,
      );
      const tree = removeWindowFromDesktopTree(d.tree, windowId);
      const focusedWindowId = pickNextFocus(d, windowId, updatedWindows);
      return { ...d, floatingWindowIds, tree, focusedWindowId };
    },
  );
}

export function restoreWindow(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window || !window.minimized) return session;

  const mode = window.restorePlacement?.mode ?? window.mode;
  const desktopId = window.restorePlacement?.desktopId ?? window.desktopId;
  const floatBounds = window.restorePlacement?.floatBounds ?? window.floatBounds;

  const updatedWindow: OsWindow = {
    ...window,
    minimized: false,
    mode,
    desktopId,
    floatBounds,
    restorePlacement: undefined,
  };
  const updatedWindows = { ...session.windows, [windowId]: updatedWindow };

  return updateDesktop(
    { ...session, windows: updatedWindows },
    desktopId,
    (d) => {
      if (mode === "float") {
        const floatingWindowIds = [
          ...d.floatingWindowIds.filter((id) => id !== windowId),
          windowId,
        ];
        return { ...d, floatingWindowIds, focusedWindowId: windowId };
      }
      let tree = d.tree;
      if (!tree) {
        tree = newTilePaneNode([windowId], windowId);
      } else {
        const targetPane = collectTilePanes(tree)[0];
        tree = targetPane
          ? insertItemIntoTilePane(tree, targetPane.id, windowId)
          : newTilePaneNode([windowId], windowId);
      }
      return { ...d, tree, focusedWindowId: windowId };
    },
  );
}

export function updateFloatBounds(
  session: OsSessionV1,
  windowId: string,
  bounds: FloatBounds,
  viewport?: { width: number; height: number },
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window) return session;
  const clamped = clampFloatBounds(bounds, viewport);
  return {
    ...session,
    windows: {
      ...session.windows,
      [windowId]: { ...window, floatBounds: clamped },
    },
  };
}

export function dockWindowInDesktopTree(
  session: OsSessionV1,
  desktopId: string,
  windowId: string,
  target: TileDockTarget,
  sourcePaneId?: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window) return session;

  const targetDesk = session.desktops.find((d) => d.id === desktopId);
  if (!targetDesk) return session;

  if (targetDesk.tree !== null) {
    const destPane = findTilePaneById(targetDesk.tree, target.paneId);
    if (!destPane) {
      // Stale or missing destination pane: harmless no-op without destructive mutation
      return session;
    }
  }

  // 1. Remove window from any other desktop or current floating list
  let updatedSession = session;
  for (const desk of updatedSession.desktops) {
    const hasFloat = desk.floatingWindowIds.includes(windowId);
    const hasInOtherTree =
      desk.id !== desktopId &&
      desk.tree !== null &&
      Boolean(findTilePaneContaining(desk.tree, (id) => id === windowId));
    if (hasFloat || hasInOtherTree) {
      updatedSession = updateDesktop(updatedSession, desk.id, (d) => {
        const nextTree =
          desk.id !== desktopId
            ? removeWindowFromDesktopTree(d.tree, windowId)
            : d.tree;
        const nextFloats = d.floatingWindowIds.filter((id) => id !== windowId);
        const nextFocus =
          d.focusedWindowId === windowId
            ? pickNextFocus(d, windowId, session.windows)
            : d.focusedWindowId;
        return {
          ...d,
          floatingWindowIds: nextFloats,
          tree: nextTree,
          focusedWindowId: nextFocus,
        };
      });
    }
  }

  // 2. Set window mode to tile and target desktop
  const updatedWindow: OsWindow = {
    ...window,
    desktopId,
    mode: "tile",
    minimized: false,
  };
  updatedSession = {
    ...updatedSession,
    windows: {
      ...updatedSession.windows,
      [windowId]: updatedWindow,
    },
  };

  // 3. Dock into target desktop's tree
  return updateDesktop(updatedSession, desktopId, (d) => {
    if (!d.tree) {
      return {
        ...d,
        tree: newTilePaneNode([windowId], windowId),
        floatingWindowIds: d.floatingWindowIds.filter((id) => id !== windowId),
        focusedWindowId: windowId,
      };
    }
    const { root } = dockItemIntoTileTree(
      d.tree,
      windowId,
      target,
      sourcePaneId,
    );
    return {
      ...d,
      tree: root,
      floatingWindowIds: d.floatingWindowIds.filter((id) => id !== windowId),
      focusedWindowId: windowId,
    };
  });
}

export function updateDesktopTreeSizes(
  session: OsSessionV1,
  desktopId: string,
  splitId: string,
  sizes: [number, number],
): OsSessionV1 {
  return updateDesktop(session, desktopId, (d) => {
    if (!d.tree) return d;
    return { ...d, tree: updateTileSizes(d.tree, splitId, sizes) };
  });
}

export function addDesktop(
  session: OsSessionV1,
  name?: string,
  defaultCtx?: WindowContext,
): OsSessionV1 {
  const nextIndex = session.desktops.length + 1;
  const id = `desktop-${Date.now()}-${nextIndex}`;
  const desktopName = name?.trim() || `Desktop ${nextIndex}`;
  const newDesktop: OsDesktop = {
    id,
    name: desktopName,
    defaultCtx,
    tree: null,
    floatingWindowIds: [],
    focusedWindowId: null,
  };
  return {
    ...session,
    desktops: [...session.desktops, newDesktop],
  };
}

export function renameDesktop(
  session: OsSessionV1,
  desktopId: string,
  name: string,
): OsSessionV1 {
  const trimmed = name.trim();
  if (!trimmed) return session;
  return updateDesktop(session, desktopId, (d) => ({
    ...d,
    name: trimmed,
  }));
}

export function setDefaultCtx(
  session: OsSessionV1,
  desktopId: string,
  defaultCtx?: WindowContext,
): OsSessionV1 {
  return updateDesktop(session, desktopId, (d) => ({
    ...d,
    defaultCtx,
  }));
}

export function removeDesktop(
  session: OsSessionV1,
  desktopId: string,
  survivingDesktopId?: string,
): OsSessionV1 {
  if (session.desktops.length <= 1) {
    // Refuse to delete the only desktop
    return session;
  }
  const toDelete = session.desktops.find((d) => d.id === desktopId);
  if (!toDelete) return session;

  const targetDesk = survivingDesktopId
    ? session.desktops.find(
        (d) => d.id === survivingDesktopId && d.id !== desktopId,
      )
    : session.desktops.find((d) => d.id !== desktopId);

  if (!targetDesk) {
    // Fail-closed: invalid destination desktop ID provided, refuse deletion
    return session;
  }

  let updatedSession = session;
  const windowsToMove = Object.values(session.windows).filter(
    (w) => w.desktopId === desktopId,
  );

  for (const win of windowsToMove) {
    updatedSession = moveWindowToDesktop(updatedSession, win.id, targetDesk.id);
  }

  const remainingDesktops = updatedSession.desktops.filter(
    (d) => d.id !== desktopId,
  );
  const nextActive =
    updatedSession.activeDesktopId === desktopId
      ? targetDesk.id
      : updatedSession.activeDesktopId;

  return {
    ...updatedSession,
    activeDesktopId: nextActive,
    desktops: remainingDesktops,
  };
}

export function bringWindowToFront(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window || window.mode !== "float") return session;
  return updateDesktop(session, window.desktopId, (d) => {
    const floatingWindowIds = [
      ...d.floatingWindowIds.filter((id) => id !== windowId),
      windowId,
    ];
    return { ...d, floatingWindowIds, focusedWindowId: windowId };
  });
}

export function sendWindowToBack(
  session: OsSessionV1,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window || window.mode !== "float") return session;
  return updateDesktop(session, window.desktopId, (d) => {
    const floatingWindowIds = [
      windowId,
      ...d.floatingWindowIds.filter((id) => id !== windowId),
    ];
    return { ...d, floatingWindowIds };
  });
}

export function selectPaneTab(
  session: OsSessionV1,
  paneId: string,
  windowId: string,
): OsSessionV1 {
  const window = session.windows[windowId];
  if (!window) return session;
  return updateDesktop(session, window.desktopId, (d) => {
    if (!d.tree) return d;
    const targetPane = findTilePaneById(d.tree, paneId);
    if (!targetPane || !targetPane.items.includes(windowId)) return d;
    const tree = updateTilePane(d.tree, paneId, (p) => ({
      ...p,
      active: windowId,
    }));
    return { ...d, tree, focusedWindowId: windowId };
  });
}

export function moveTabWithinPane(
  session: OsSessionV1,
  paneId: string,
  fromIndex: number,
  toIndex: number,
): OsSessionV1 {
  const desktop = session.desktops.find((d) => d.id === session.activeDesktopId);
  if (!desktop || !desktop.tree) return session;
  const pane = findTilePaneById(desktop.tree, paneId);
  if (
    !pane ||
    fromIndex < 0 ||
    fromIndex >= pane.items.length ||
    toIndex < 0 ||
    toIndex >= pane.items.length
  ) {
    return session;
  }
  const nextItems = [...pane.items];
  const [removed] = nextItems.splice(fromIndex, 1);
  if (!removed) return session;
  nextItems.splice(toIndex, 0, removed);
  return updateDesktop(session, desktop.id, (d) => {
    if (!d.tree) return d;
    return {
      ...d,
      tree: updateTilePane(d.tree, paneId, (p) => ({
        ...p,
        items: nextItems,
      })),
    };
  });
}

export function splitWindow(
  session: OsSessionV1,
  sourceWindowId: string,
  targetWindowId: string,
  direction: "left" | "right" | "top" | "bottom" | "center",
): OsSessionV1 {
  const sourceWin = session.windows[sourceWindowId];
  const targetWin = session.windows[targetWindowId];
  if (!sourceWin || !targetWin) return session;
  const targetDesk = session.desktops.find((d) => d.id === targetWin.desktopId);
  if (!targetDesk || !targetDesk.tree) return session;

  const targetPane = findTilePaneContaining(
    targetDesk.tree,
    (id) => id === targetWindowId,
  );
  if (!targetPane) return session;

  const target: TileDockTarget =
    direction === "center"
      ? { kind: "pane-center", paneId: targetPane.id }
      : { kind: "pane-edge", paneId: targetPane.id, edge: direction };

  return dockWindowInDesktopTree(
    session,
    targetWin.desktopId,
    sourceWindowId,
    target,
  );
}

