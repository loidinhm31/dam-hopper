import { describe, expect, it } from "vitest";
import {
  addDesktop,
  bringWindowToFront,
  clampFloatBounds,
  closeWindow,
  createDefaultOsSession,
  dockWindowInDesktopTree,
  focusWindow,
  getVisibleFloatBounds,
  minimizeWindow,
  moveTabWithinPane,
  moveWindowToDesktop,
  openWindow,
  removeDesktop,
  removeWindowFromDesktopTree,
  renameDesktop,
  resizeFloatBounds,
  restoreWindow,
  selectPaneTab,
  sendWindowToBack,
  setDefaultCtx,
  setWindowMode,
  splitWindow,
  switchDesktop,
  toggleMaximizeWindow,
  updateDesktopTreeSizes,
  updateFloatBounds,
} from "./window-ops.js";
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

  it("supports desktop CRUD (add, rename, setDefaultCtx, remove with window migration)", () => {
    let session = createDefaultOsSession("desk-1", "Main");
    session = addDesktop(session, "Code", { profileId: "p1", projectId: "proj1" });
    expect(session.desktops.length).toBe(2);
    const codeDesk = session.desktops[1];
    expect(codeDesk.name).toBe("Code");
    expect(codeDesk.defaultCtx?.projectId).toBe("proj1");

    session = renameDesktop(session, codeDesk.id, "Workspace");
    expect(session.desktops[1].name).toBe("Workspace");

    session = setDefaultCtx(session, codeDesk.id, {
      profileId: "p1",
      projectId: "proj2",
      worktreeId: "wt-feat",
    });
    expect(session.desktops[1].defaultCtx?.worktreeId).toBe("wt-feat");

    // Open window on codeDesk
    session = openWindow(
      session,
      {
        id: "win-code",
        appId: "editor",
        title: "Editor",
        ctx: { profileId: "p1" },
        mode: "tile",
      },
      codeDesk.id,
    );
    expect(session.windows["win-code"].desktopId).toBe(codeDesk.id);

    // Remove codeDesk: win-code must migrate to desk-1, not be destroyed
    session = removeDesktop(session, codeDesk.id, "desk-1");
    expect(session.desktops.length).toBe(1);
    expect(session.windows["win-code"]).toBeDefined();
    expect(session.windows["win-code"].desktopId).toBe("desk-1");

    // Refuses to remove the only remaining desktop
    const singleDeskAttempt = removeDesktop(session, "desk-1");
    expect(singleDeskAttempt.desktops.length).toBe(1);
  });

  it("handles 8-way float resize and non-destructive visible bounds", () => {
    const initialBounds = { x: 100, y: 100, width: 400, height: 300 };

    // East resize
    const east = resizeFloatBounds(initialBounds, 50, 0, "e");
    expect(east.width).toBe(450);
    expect(east.x).toBe(100);

    // South-East resize
    const se = resizeFloatBounds(initialBounds, 50, 60, "se");
    expect(se.width).toBe(450);
    expect(se.height).toBe(360);

    // West resize (changes x and width)
    const west = resizeFloatBounds(initialBounds, -30, 0, "w");
    expect(west.x).toBe(70);
    expect(west.width).toBe(430);

    // Minimum bounds clamp
    const small = resizeFloatBounds(initialBounds, -300, -200, "e");
    expect(small.width).toBe(280); // MIN_FLOAT_WIDTH

    // Non-destructive visible projection
    const visible = getVisibleFloatBounds({ x: 2000, y: 1500, width: 500, height: 400 }, { width: 1280, height: 800 });
    expect(visible.x).toBeLessThanOrEqual(1230);
    expect(visible.y).toBeLessThanOrEqual(750);
  });

  it("reorders floating window Z-index via bringWindowToFront and sendWindowToBack", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "f1",
      appId: "terminals",
      title: "F1",
      ctx: testCtx,
      mode: "float",
    });
    session = openWindow(session, {
      id: "f2",
      appId: "editor",
      title: "F2",
      ctx: testCtx,
      mode: "float",
    });
    session = openWindow(session, {
      id: "f3",
      appId: "browser",
      title: "F3",
      ctx: testCtx,
      mode: "float",
    });

    expect(session.desktops[0].floatingWindowIds).toEqual(["f1", "f2", "f3"]);

    // Bring f1 to front
    session = bringWindowToFront(session, "f1");
    expect(session.desktops[0].floatingWindowIds).toEqual(["f2", "f3", "f1"]);
    expect(session.desktops[0].focusedWindowId).toBe("f1");

    // Send f1 to back
    session = sendWindowToBack(session, "f1");
    expect(session.desktops[0].floatingWindowIds).toEqual(["f1", "f2", "f3"]);
  });

  it("manages pane tabs and allows splitting windows via splitWindow", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "w1",
      appId: "terminals",
      title: "W1",
      ctx: testCtx,
      mode: "tile",
    });
    session = openWindow(session, {
      id: "w2",
      appId: "editor",
      title: "W2",
      ctx: testCtx,
      mode: "tile",
    });

    const panes = collectTilePanes(session.desktops[0].tree!);
    const paneId = panes[0].id;

    // Select active tab
    session = selectPaneTab(session, paneId, "w1");
    const afterSelect = collectTilePanes(session.desktops[0].tree!);
    expect(afterSelect[0].active).toBe("w1");

    // Move tab within pane
    session = moveTabWithinPane(session, paneId, 0, 1);
    const afterMove = collectTilePanes(session.desktops[0].tree!);
    expect(afterMove[0].items).toEqual(["w2", "w1"]);

    // Open floating window and split it into right of w1
    session = openWindow(session, {
      id: "w3",
      appId: "browser",
      title: "W3",
      ctx: testCtx,
      mode: "float",
    });
    session = splitWindow(session, "w3", "w1", "right");
    expect(session.windows["w3"].mode).toBe("tile");
    const splitPanes = collectTilePanes(session.desktops[0].tree!);
    expect(splitPanes.length).toBe(2);
  });
});
