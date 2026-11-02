import { describe, expect, it } from "vitest";
import {
  clampFloatBounds,
  closeWindow,
  createDefaultOsSession,
  dockWindowInDesktopTree,
  focusWindow,
  minimizeWindow,
  moveWindowToDesktop,
  openWindow,
  removeWindowFromDesktopTree,
  restoreWindow,
  setWindowMode,
  switchDesktop,
  toggleMaximizeWindow,
  updateDesktopTreeSizes,
  updateFloatBounds,
} from "./window-ops.js";
import type { WindowContext } from "./types.js";
import { collectTilePanes, newTilePaneNode } from "@/lib/tile-tree.js";

const testCtx: WindowContext = {
  profileId: "profile-1",
  projectId: "project-1",
};

describe("window-ops pure functions", () => {
  it("creates a clean default OS session", () => {
    const session = createDefaultOsSession("desk-1", "Main");
    expect(session.schema).toBe(1);
    expect(session.activeDesktopId).toBe("desk-1");
    expect(session.desktops.length).toBe(1);
    expect(session.desktops[0].id).toBe("desk-1");
    expect(session.desktops[0].name).toBe("Main");
    expect(session.desktops[0].tree).toBeNull();
    expect(session.desktops[0].floatingWindowIds).toEqual([]);
    expect(session.windows).toEqual({});
  });

  it("opens tiled and floating windows with valid focus", () => {
    let session = createDefaultOsSession("desk-1");

    session = openWindow(session, {
      id: "win-1",
      appId: "terminals",
      title: "Terminals",
      ctx: testCtx,
      mode: "tile",
    });

    expect(session.windows["win-1"]).toBeDefined();
    expect(session.windows["win-1"].desktopId).toBe("desk-1");
    expect(session.desktops[0].focusedWindowId).toBe("win-1");
    expect(session.desktops[0].tree).not.toBeNull();

    // Open a floating window
    session = openWindow(session, {
      id: "win-2",
      appId: "editor",
      title: "Editor",
      ctx: testCtx,
      mode: "float",
    });

    expect(session.windows["win-2"]).toBeDefined();
    expect(session.desktops[0].floatingWindowIds).toContain("win-2");
    expect(session.desktops[0].focusedWindowId).toBe("win-2");
  });

  it("preserves sibling windows when closing or floating one window in multi-item pane", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "win-a",
      appId: "terminals",
      title: "A",
      ctx: testCtx,
      mode: "tile",
    });
    session = openWindow(session, {
      id: "win-b",
      appId: "editor",
      title: "B",
      ctx: testCtx,
      mode: "tile",
    });

    // Both win-a and win-b are in the pane
    let panes = collectTilePanes(session.desktops[0].tree!);
    expect(panes[0].items).toEqual(["win-a", "win-b"]);

    // Float win-b -> win-a must stay in tree, win-b becomes float
    session = setWindowMode(session, "win-b", "float");
    expect(session.desktops[0].floatingWindowIds).toContain("win-b");
    panes = collectTilePanes(session.desktops[0].tree!);
    expect(panes[0].items).toEqual(["win-a"]);

    // Close win-a -> tree becomes null, win-a removed
    session = closeWindow(session, "win-a");
    expect(session.windows["win-a"]).toBeUndefined();
    expect(session.desktops[0].tree).toBeNull();
  });

  it("updates restorePlacement desktopId when moving a minimized window to another desktop", () => {
    let session = createDefaultOsSession("desk-1");
    session.desktops.push({
      id: "desk-2",
      name: "Desktop 2",
      tree: null,
      floatingWindowIds: [],
      focusedWindowId: null,
    });
    session = openWindow(session, {
      id: "win-1",
      appId: "browser",
      title: "Browser",
      ctx: testCtx,
      mode: "float",
    });

    session = minimizeWindow(session, "win-1");
    expect(session.windows["win-1"].minimized).toBe(true);
    expect(session.windows["win-1"].restorePlacement?.desktopId).toBe("desk-1");

    session = moveWindowToDesktop(session, "win-1", "desk-2");
    expect(session.windows["win-1"].desktopId).toBe("desk-2");
    expect(session.windows["win-1"].restorePlacement?.desktopId).toBe("desk-2");

    session = restoreWindow(session, "win-1");
    expect(session.windows["win-1"].minimized).toBe(false);
    expect(session.desktops[1].floatingWindowIds).toContain("win-1");
  });

  it("clamps float bounds to viewport", () => {
    const rawBounds = { x: -50, y: -20, width: 100, height: 50 };
    const clamped = clampFloatBounds(rawBounds, { width: 1200, height: 800 });

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
    expect(clamped.width).toBeGreaterThanOrEqual(280);
    expect(clamped.height).toBeGreaterThanOrEqual(200);
  });

  it("docks a floating window into desktop tree reconciling mode and float lists", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "win-1",
      appId: "browser",
      title: "Browser",
      ctx: testCtx,
      mode: "float",
    });
    expect(session.desktops[0].floatingWindowIds).toContain("win-1");

    session = dockWindowInDesktopTree(session, "desk-1", "win-1", {
      kind: "pane-center",
      paneId: "new-pane",
    });

    expect(session.windows["win-1"].mode).toBe("tile");
    expect(session.desktops[0].floatingWindowIds).not.toContain("win-1");
    expect(session.desktops[0].tree).not.toBeNull();
    const panes = collectTilePanes(session.desktops[0].tree!);
    expect(panes[0].items).toContain("win-1");
    expect(session.desktops[0].focusedWindowId).toBe("win-1");
  });

  it("focuses a window in a multi-window pane without changing tab ordering", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "win-a",
      appId: "editor",
      title: "Editor A",
      ctx: testCtx,
      mode: "tile",
    });
    session = openWindow(session, {
      id: "win-b",
      appId: "editor",
      title: "Editor B",
      ctx: testCtx,
      mode: "tile",
    });

    // Both in same pane
    const initialPanes = collectTilePanes(session.desktops[0].tree!);
    expect(initialPanes[0].items).toEqual(["win-a", "win-b"]);
    expect(initialPanes[0].active).toBe("win-b");

    // Focus win-a: tab order must remain ["win-a", "win-b"], active becomes "win-a"
    session = focusWindow(session, "win-a");
    const focusedPanes = collectTilePanes(session.desktops[0].tree!);
    expect(focusedPanes[0].items).toEqual(["win-a", "win-b"]);
    expect(focusedPanes[0].active).toBe("win-a");
    expect(session.desktops[0].focusedWindowId).toBe("win-a");
  });
});
