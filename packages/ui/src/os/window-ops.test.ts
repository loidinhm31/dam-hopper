import { describe, expect, it } from "vitest";
import {
  addDesktop,
  bringWindowToFront,
  calculateNextFloatBounds,
  CASCADE_STEP,
  clampFloatBounds,
  closeWindow,
  createDefaultOsSession,
  DEFAULT_FLOAT_BOUNDS,
  dockWindowInDesktopTree,
  focusWindow,
  getVisibleFloatBounds,
  maximizeWindow,
  minimizeWindow,
  moveTabWithinPane,
  moveWindowToDesktop,
  openWindow,
  projectFloatBounds,
  removeDesktop,

  renameDesktop,
  resizeFloatBounds,
  restoreWindow,
  presentWindowAsFloat,
  revealWindow,
  selectPaneTab,
  sendWindowToBack,
  setDefaultCtx,
  setWindowMode,
  splitWindow,
  switchDesktop,
  toggleMaximizeWindow,
  toggleWindowMode,
  updateDesktopTreeSizes,
  updateFloatBounds,
} from "./window-ops.js";
import { validateOsSession } from "./persistence.js";
import type { FloatBounds, OsDesktop, OsSessionV1, WindowContext } from "./types.js";
import { collectTilePanes, newTilePaneNode } from "@/lib/tile-tree.js";
import { getWindowFocusTimestamp, useWindowStore } from "./window-store.js";

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
    expect(visible.y).toBe(800 - 40); // Preserve 40px of reachable titlebar.
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

  it("updates window context via updateWindowContext while preserving unrelated fields", () => {
    const store = useWindowStore.getState();
    store.openWindow({
      id: "win-ctx-test",
      appId: "files",
      title: "Files",
      ctx: { profileId: "prof-a", projectId: "proj-old", worktreeId: "wt-old" },
      mode: "tile",
    });
    expect(useWindowStore.getState().session.windows["win-ctx-test"]?.ctx).toEqual({
      profileId: "prof-a",
      projectId: "proj-old",
      worktreeId: "wt-old",
    });

    useWindowStore.getState().updateWindowContext("win-ctx-test", {
      projectId: "proj-new",
      worktreeId: undefined,
    });
    expect(useWindowStore.getState().session.windows["win-ctx-test"]?.ctx).toEqual({
      profileId: "prof-a",
      projectId: "proj-new",
      worktreeId: undefined,
    });
  });

  it("cascades unpositioned floating windows by 28px deterministic steps", () => {
    const viewport = { width: 1440, height: 900 };
    let session = createDefaultOsSession("desk-cascade");

    const bounds1 = calculateNextFloatBounds(session, "desk-cascade", viewport);
    expect(bounds1).toEqual({ x: 60, y: 60, width: 720, height: 520 });

    session = openWindow(
      session,
      { id: "f1", appId: "terminals", title: "Term 1", ctx: testCtx, mode: "float" },
      "desk-cascade",
      viewport,
    );
    expect(session.windows["f1"].floatBounds).toEqual(bounds1);

    const bounds2 = calculateNextFloatBounds(session, "desk-cascade", viewport);
    expect(bounds2).toEqual({
      x: 60 + CASCADE_STEP,
      y: 60 + CASCADE_STEP,
      width: 720,
      height: 520,
    });

    session = openWindow(
      session,
      { id: "f2", appId: "terminals", title: "Term 2", ctx: testCtx, mode: "float" },
      "desk-cascade",
      viewport,
    );
    expect(session.windows["f2"].floatBounds).toEqual(bounds2);
  });

  it("wraps cascade and ensures titlebar controls are reachable on small viewport", () => {
    const smallViewport = { width: 500, height: 350 };
    const session = createDefaultOsSession("desk-small");

    const bounds = calculateNextFloatBounds(session, "desk-small", smallViewport);
    expect(bounds.x).toBeLessThanOrEqual(smallViewport.width - 100);
    expect(bounds.y).toBeLessThanOrEqual(smallViewport.height - 40);
    expect(bounds.width).toBeLessThanOrEqual(smallViewport.width);
    expect(bounds.height).toBeLessThanOrEqual(smallViewport.height);
  });

  it("projectFloatBounds derives clamped projection on shrink and restores on widen without mutating saved bounds", () => {
    const original: FloatBounds = { x: 120, y: 120, width: 800, height: 600 };
    const shrinkViewport = { width: 640, height: 480 };

    const projected = projectFloatBounds(original, shrinkViewport);
    expect(projected.width).toBeLessThanOrEqual(shrinkViewport.width);
    expect(projected.height).toBeLessThanOrEqual(shrinkViewport.height);
    expect(projected.x).toBeLessThanOrEqual(shrinkViewport.width - 50);
    expect(projected.y).toBeLessThanOrEqual(shrinkViewport.height - 40);

    // Original saved object was never mutated
    expect(original).toEqual({ x: 120, y: 120, width: 800, height: 600 });

    // Re-widening restores exact original bounds
    const widened = projectFloatBounds(original, { width: 1440, height: 900 });
    expect(widened).toEqual(original);
  });

  it("toggleWindowMode atomically exits maximization and switches between tile and float", () => {
    let session = createDefaultOsSession("desk-toggle");
    session = openWindow(session, {
      id: "w-tile",
      appId: "terminals",
      title: "Term",
      ctx: testCtx,
      mode: "tile",
    });

    // Maximize the tiled window
    session = toggleMaximizeWindow(session, "w-tile");
    expect(session.windows["w-tile"].maximized).toBe(true);
    expect(session.windows["w-tile"].mode).toBe("tile");

    // toggleWindowMode: must unmaximize AND switch to float atomically
    session = toggleWindowMode(session, "w-tile", { width: 1280, height: 800 });
    expect(session.windows["w-tile"].maximized).toBe(false);
    expect(session.windows["w-tile"].mode).toBe("float");
    expect(session.desktops[0].floatingWindowIds).toContain("w-tile");
    expect(session.desktops[0].focusedWindowId).toBe("w-tile");

    // toggle again: switches back to tile
    session = toggleWindowMode(session, "w-tile", { width: 1280, height: 800 });
    expect(session.windows["w-tile"].maximized).toBe(false);
    expect(session.windows["w-tile"].mode).toBe("tile");
    expect(session.desktops[0].floatingWindowIds).not.toContain("w-tile");
    expect(session.desktops[0].tree).not.toBeNull();
  });

  it("placeExistingTerminal properly removes window from previous tree and float placements (tile->float, float->float, cross-desktop)", () => {
    let session = createDefaultOsSession("desk-1");
    session = addDesktop(session, "Secondary");
    const desk2Id = session.desktops[1].id;

    // Open a tiled window on desk-1
    session = openWindow(session, {
      id: "term-1",
      appId: "terminals",
      title: "Terminal 1",
      ctx: testCtx,
      mode: "tile",
    }, "desk-1");

    // Open a floating hub on desk2Id
    session = openWindow(session, {
      id: "hub-1",
      appId: "agent-hub",
      title: "Agent Hub",
      ctx: testCtx,
      mode: "float",
    }, desk2Id);

    useWindowStore.getState().setSession(session);
    const currentWin = useWindowStore.getState().session.windows["term-1"];

    // Move term-1 beside floating hub-1 on desk-2 (tile on desk-1 -> float on desk-2)
    useWindowStore.getState().placeExistingTerminal({
      sourceHubWindowId: "hub-1",
      terminalWindow: currentWin,
      action: "move-beside",
    });
    const updated = useWindowStore.getState().session;
    const desk1 = updated.desktops.find((d) => d.id === "desk-1")!;
    const desk2 = updated.desktops.find((d) => d.id === desk2Id)!;

    // term-1 must NOT remain in desk-1 tree
    expect(desk1.tree).toBeNull();
    expect(desk1.floatingWindowIds).toEqual([]);

    // term-1 must be on desk-2 floating list exactly once
    expect(desk2.floatingWindowIds).toContain("term-1");
    expect(desk2.floatingWindowIds.filter((id) => id === "term-1").length).toBe(1);
    expect(updated.windows["term-1"].desktopId).toBe(desk2Id);
    expect(updated.windows["term-1"].mode).toBe("float");
    expect(validateOsSession(updated).valid).toBe(true);
  });

  it("placeExistingTerminal with minimized window clears restorePlacement and places on destination desktop exactly once", () => {
    let session = createDefaultOsSession("desk-1");
    session = addDesktop(session, "Secondary");
    const desk2Id = session.desktops[1].id;

    // Open a tiled window on desk-1, then minimize it
    session = openWindow(session, {
      id: "term-min",
      appId: "terminals",
      title: "Terminal Min",
      ctx: testCtx,
      mode: "tile",
    }, "desk-1");
    session = minimizeWindow(session, "term-min");

    // Open a floating hub on desk2Id
    session = openWindow(session, {
      id: "hub-2",
      appId: "agent-hub",
      title: "Agent Hub 2",
      ctx: testCtx,
      mode: "float",
    }, desk2Id);

    useWindowStore.getState().setSession(session);
    const minWin = useWindowStore.getState().session.windows["term-min"];
    expect(minWin.minimized).toBe(true);
    expect(minWin.restorePlacement?.desktopId).toBe("desk-1");

    // Move minimized term-min beside floating hub-2 on desk-2
    useWindowStore.getState().placeExistingTerminal({
      sourceHubWindowId: "hub-2",
      terminalWindow: minWin,
      action: "move-beside",
    });

    const updated = useWindowStore.getState().session;
    const placedWin = updated.windows["term-min"];
    const desk1 = updated.desktops.find((d) => d.id === "desk-1")!;
    const desk2 = updated.desktops.find((d) => d.id === desk2Id)!;

    // Invariant: exactly one placement across all desktops
    expect(validateOsSession(updated).valid).toBe(true);
    expect(placedWin.minimized).toBe(false);
    expect(placedWin.restorePlacement).toBeUndefined();
    expect(placedWin.desktopId).toBe(desk2Id);
    expect(placedWin.mode).toBe("float");

    // desk-1 has zero placements of term-min
    expect(desk1.floatingWindowIds).toEqual([]);
    expect(desk1.tree).toBeNull();

    // desk-2 has term-min in float list exactly once
    expect(desk2.floatingWindowIds.filter((id) => id === "term-min").length).toBe(1);
  });
  it("preserves tile tree structure and floatBounds across maximize and restoreWindow", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "tile-win-1",
      appId: "editor",
      title: "Editor 1",
      ctx: testCtx,
      mode: "tile",
    });
    session = openWindow(session, {
      id: "tile-win-2",
      appId: "terminals",
      title: "Terminal 2",
      ctx: testCtx,
      mode: "tile",
    });

    const originalTree = JSON.parse(JSON.stringify(session.desktops[0].tree));

    // Maximize tiled window
    session = maximizeWindow(session, "tile-win-1");
    expect(session.windows["tile-win-1"].maximized).toBe(true);
    // Tree topology must be completely preserved
    expect(session.desktops[0].tree).toEqual(originalTree);

    // Restore tiled window from maximized
    session = restoreWindow(session, "tile-win-1");
    expect(session.windows["tile-win-1"].maximized).toBe(false);
    expect(session.desktops[0].tree).toEqual(originalTree);
  });

  it("preserves saved floatBounds across maximize and restoreWindow for floating window", () => {
    let session = createDefaultOsSession("desk-1");
    const customBounds: FloatBounds = { x: 120, y: 150, width: 600, height: 400 };
    session = openWindow(session, {
      id: "float-win-1",
      appId: "browser",
      title: "Browser 1",
      ctx: testCtx,
      mode: "float",
    });
    session = updateFloatBounds(session, "float-win-1", customBounds);
    expect(session.windows["float-win-1"].floatBounds).toEqual(customBounds);

    // Maximize floating window
    session = maximizeWindow(session, "float-win-1");
    expect(session.windows["float-win-1"].maximized).toBe(true);
    // floatBounds must NOT be overwritten by maximize
    expect(session.windows["float-win-1"].floatBounds).toEqual(customBounds);

    // Restore floating window
    session = restoreWindow(session, "float-win-1");
    expect(session.windows["float-win-1"].maximized).toBe(false);
    expect(session.windows["float-win-1"].floatBounds).toEqual(customBounds);
  });

  it("retains maximization when un-minimizing a window that was minimized while maximized", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "win-max",
      appId: "terminals",
      title: "Term",
      ctx: testCtx,
      mode: "float",
    });
    session = maximizeWindow(session, "win-max");
    expect(session.windows["win-max"].maximized).toBe(true);

    // Minimize while maximized
    session = minimizeWindow(session, "win-max");
    expect(session.windows["win-max"].minimized).toBe(true);
    expect(session.windows["win-max"].maximized).toBe(true);
    expect(session.windows["win-max"].restorePlacement).toBeDefined();

    // First restoreWindow: un-minimizes and preserves maximized state
    session = restoreWindow(session, "win-max");
    expect(session.windows["win-max"].minimized).toBe(false);
    expect(session.windows["win-max"].maximized).toBe(true);

    // Second restoreWindow: un-maximizes back to normal floating
    session = restoreWindow(session, "win-max");
    expect(session.windows["win-max"].minimized).toBe(false);
    expect(session.windows["win-max"].maximized).toBe(false);
  });

  it("setWindowMode exits maximization atomically and switches mode", () => {
    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "win-mode",
      appId: "editor",
      title: "Editor",
      ctx: testCtx,
      mode: "tile",
    });
    session = maximizeWindow(session, "win-mode");
    expect(session.windows["win-mode"].maximized).toBe(true);

    // setWindowMode to float
    session = setWindowMode(session, "win-mode", "float");
    expect(session.windows["win-mode"].mode).toBe("float");
    expect(session.windows["win-mode"].maximized).toBe(false);
  });

  describe("revealWindow", () => {
    it("switches to holder's desktop and focuses window when on a different desktop", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[session.desktops.length - 1].id;

      session = openWindow(
        session,
        {
          id: "win-target",
          appId: "editor",
          title: "Target Editor",
          ctx: testCtx,
          mode: "float",
        },
        desk2Id,
      );

      // Active desktop is desk-1, window is on desk-2
      expect(session.activeDesktopId).toBe("desk-1");
      expect(session.windows["win-target"].desktopId).toBe(desk2Id);

      const revealed = revealWindow(session, "win-target");
      expect(revealed.activeDesktopId).toBe(desk2Id);
      const desk2Obj = revealed.desktops.find((d) => d.id === desk2Id)!;
      expect(desk2Obj.focusedWindowId).toBe("win-target");
      expect(validateOsSession(revealed).valid).toBe(true);
    });

    it("un-minimizes a minimized window and switches to its destination desktop", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[session.desktops.length - 1].id;

      session = openWindow(
        session,
        {
          id: "win-min",
          appId: "terminals",
          title: "Terminal",
          ctx: testCtx,
          mode: "float",
        },
        desk2Id,
      );
      session = minimizeWindow(session, "win-min");
      expect(session.windows["win-min"].minimized).toBe(true);

      // Active desktop is desk-1
      session = switchDesktop(session, "desk-1");
      expect(session.activeDesktopId).toBe("desk-1");

      const revealed = revealWindow(session, "win-min");
      expect(revealed.activeDesktopId).toBe(desk2Id);
      expect(revealed.windows["win-min"].minimized).toBe(false);
      const desk2Obj = revealed.desktops.find((d) => d.id === desk2Id)!;
      expect(desk2Obj.focusedWindowId).toBe("win-min");
      expect(desk2Obj.floatingWindowIds).toContain("win-min");
      expect(validateOsSession(revealed).valid).toBe(true);
    });

    it("reveals a minimized window whose restorePlacement.desktopId differs from its current desktopId", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[session.desktops.length - 1].id;

      session = openWindow(
        session,
        {
          id: "win-relocated",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "float",
        },
        "desk-1",
      );
      session = minimizeWindow(session, "win-relocated");
      // Manually set restorePlacement to desk2Id (relocated destination)
      session = {
        ...session,
        windows: {
          ...session.windows,
          "win-relocated": {
            ...session.windows["win-relocated"],
            restorePlacement: {
              mode: "float",
              desktopId: desk2Id,
              floatBounds: DEFAULT_FLOAT_BOUNDS,
            },
          },
        },
      };

      const revealed = revealWindow(session, "win-relocated");
      expect(revealed.activeDesktopId).toBe(desk2Id);
      expect(revealed.windows["win-relocated"].desktopId).toBe(desk2Id);
      expect(revealed.windows["win-relocated"].minimized).toBe(false);
      const desk2Obj = revealed.desktops.find((d) => d.id === desk2Id)!;
      expect(desk2Obj.focusedWindowId).toBe("win-relocated");
      expect(validateOsSession(revealed).valid).toBe(true);
    });

    it("preserves maximized state when un-minimizing a window that was minimized while maximized", () => {
      let session = createDefaultOsSession("desk-1");
      session = openWindow(session, {
        id: "win-min-max",
        appId: "terminals",
        title: "Terminal",
        ctx: testCtx,
        mode: "float",
      });
      session = maximizeWindow(session, "win-min-max");
      session = minimizeWindow(session, "win-min-max");
      expect(session.windows["win-min-max"].minimized).toBe(true);
      expect(session.windows["win-min-max"].maximized).toBe(true);

      const revealed = revealWindow(session, "win-min-max");
      expect(revealed.windows["win-min-max"].minimized).toBe(false);
      expect(revealed.windows["win-min-max"].maximized).toBe(true);
      expect(revealed.desktops[0].focusedWindowId).toBe("win-min-max");
      expect(validateOsSession(revealed).valid).toBe(true);
    });

    it("preserves maximized state when revealing a maximized window", () => {
      let session = createDefaultOsSession("desk-1");
      session = openWindow(session, {
        id: "win-max",
        appId: "editor",
        title: "Maximized Editor",
        ctx: testCtx,
        mode: "float",
      });
      session = maximizeWindow(session, "win-max");
      expect(session.windows["win-max"].maximized).toBe(true);

      const revealed = revealWindow(session, "win-max");
      expect(revealed.windows["win-max"].maximized).toBe(true);
      expect(revealed.windows["win-max"].minimized).toBe(false);
      expect(revealed.desktops[0].focusedWindowId).toBe("win-max");
      expect(validateOsSession(revealed).valid).toBe(true);
    });

    it("returns the exact same session object for unknown window id", () => {
      const session = createDefaultOsSession("desk-1");
      const revealed = revealWindow(session, "non-existent-window");
      expect(revealed).toBe(session);
    });

    it("executes store revealWindow atomically with a single subscriber notification", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[session.desktops.length - 1].id;

      session = openWindow(
        session,
        {
          id: "store-win",
          appId: "terminals",
          title: "Store Terminal",
          ctx: testCtx,
          mode: "float",
        },
        desk2Id,
      );
      session = minimizeWindow(session, "store-win");
      useWindowStore.getState().setSession(session);

      let notificationCount = 0;
      let subscriberSession: OsSessionV1 | null = null;
      const unsub = useWindowStore.subscribe((state) => {
        notificationCount++;
        subscriberSession = state.session;
      });

      const counterBefore = getWindowFocusTimestamp("store-win");
      useWindowStore.getState().revealWindow("store-win");
      unsub();

      expect(notificationCount).toBe(1);
      expect(subscriberSession).not.toBeNull();
      expect(subscriberSession!.activeDesktopId).toBe(desk2Id);
      expect(subscriberSession!.windows["store-win"].minimized).toBe(false);
      const targetDesktop = subscriberSession!.desktops.find(
        (d) => d.id === desk2Id,
      )!;
      expect(targetDesktop.focusedWindowId).toBe("store-win");
      expect(validateOsSession(subscriberSession!).valid).toBe(true);
      expect(getWindowFocusTimestamp("store-win")).toBeGreaterThan(
        counterBefore,
      );
    });
  });

  describe("presentWindowAsFloat", () => {
    it("converts a tiled window to float on requested desktop and validates session", () => {
      let session = createDefaultOsSession("desk-1");
      session = openWindow(
        session,
        {
          id: "win-tiled",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
          appState: { filePath: "/foo/bar.ts", line: 12 },
        },
        "desk-1",
      );
      const initialWin = session.windows["win-tiled"];
      expect(initialWin.mode).toBe("tile");

      const updated = presentWindowAsFloat(session, "win-tiled", "desk-1");
      const win = updated.windows["win-tiled"];
      expect(win.mode).toBe("float");
      expect(win.minimized).toBe(false);
      expect(win.maximized).toBe(false);
      expect(win.desktopId).toBe("desk-1");
      expect(win.floatBounds).toBeDefined();
      // Invariant: id, appState, ctx unchanged
      expect(win.id).toBe(initialWin.id);
      expect(win.appState).toEqual(initialWin.appState);
      expect(win.ctx).toEqual(initialWin.ctx);

      const desk = updated.desktops.find((d) => d.id === "desk-1")!;
      expect(desk.floatingWindowIds).toContain("win-tiled");
      expect(desk.focusedWindowId).toBe("win-tiled");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("un-minimizes a window minimized from tile and presents as float", () => {
      let session = createDefaultOsSession("desk-1");
      session = openWindow(
        session,
        {
          id: "win-min-tile",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
        },
        "desk-1",
      );
      session = minimizeWindow(session, "win-min-tile");
      expect(session.windows["win-min-tile"].minimized).toBe(true);
      expect(session.windows["win-min-tile"].restorePlacement?.mode).toBe("tile");

      const updated = presentWindowAsFloat(session, "win-min-tile", "desk-1");
      const win = updated.windows["win-min-tile"];
      expect(win.minimized).toBe(false);
      expect(win.maximized).toBe(false);
      expect(win.mode).toBe("float");
      expect(win.restorePlacement).toBeUndefined();
      expect(win.desktopId).toBe("desk-1");

      const desk = updated.desktops.find((d) => d.id === "desk-1")!;
      expect(desk.floatingWindowIds).toContain("win-min-tile");
      expect(desk.focusedWindowId).toBe("win-min-tile");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("un-minimizes a window minimized from float and preserves floatBounds", () => {
      let session = createDefaultOsSession("desk-1");
      const customBounds: FloatBounds = { x: 120, y: 140, width: 600, height: 400 };
      session = openWindow(
        session,
        {
          id: "win-min-float",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "float",
          floatBounds: customBounds,
        },
        "desk-1",
      );
      session = minimizeWindow(session, "win-min-float");
      expect(session.windows["win-min-float"].minimized).toBe(true);

      const updated = presentWindowAsFloat(session, "win-min-float", "desk-1");
      const win = updated.windows["win-min-float"];
      expect(win.minimized).toBe(false);
      expect(win.maximized).toBe(false);
      expect(win.mode).toBe("float");
      expect(win.restorePlacement).toBeUndefined();
      expect(win.floatBounds).toEqual(customBounds);
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("un-maximizes a maximized window and presents as float", () => {
      let session = createDefaultOsSession("desk-1");
      session = openWindow(
        session,
        {
          id: "win-max",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
        },
        "desk-1",
      );
      session = toggleMaximizeWindow(session, "win-max");
      expect(session.windows["win-max"].maximized).toBe(true);

      const updated = presentWindowAsFloat(session, "win-max", "desk-1");
      const win = updated.windows["win-max"];
      expect(win.maximized).toBe(false);
      expect(win.mode).toBe("float");
      expect(win.minimized).toBe(false);

      const desk = updated.desktops.find((d) => d.id === "desk-1")!;
      expect(desk.floatingWindowIds).toContain("win-max");
      expect(desk.focusedWindowId).toBe("win-max");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("moves window from other desktop to target desktop as float and switches desktop", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[1].id;
      session = openWindow(
        session,
        {
          id: "win-other",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
        },
        desk2Id,
      );
      expect(session.windows["win-other"].desktopId).toBe(desk2Id);

      const updated = presentWindowAsFloat(session, "win-other", "desk-1");
      const win = updated.windows["win-other"];
      expect(win.desktopId).toBe("desk-1");
      expect(win.mode).toBe("float");
      expect(updated.activeDesktopId).toBe("desk-1");

      const desk1 = updated.desktops.find((d) => d.id === "desk-1")!;
      const desk2 = updated.desktops.find((d) => d.id === desk2Id)!;
      expect(desk1.floatingWindowIds).toContain("win-other");
      expect(desk1.focusedWindowId).toBe("win-other");
      expect(desk2.floatingWindowIds).not.toContain("win-other");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("moves minimized window from other desktop to target desktop as float", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[1].id;
      session = openWindow(
        session,
        {
          id: "win-other-min",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
        },
        desk2Id,
      );
      session = minimizeWindow(session, "win-other-min");

      const updated = presentWindowAsFloat(session, "win-other-min", "desk-1");
      const win = updated.windows["win-other-min"];
      expect(win.desktopId).toBe("desk-1");
      expect(win.minimized).toBe(false);
      expect(win.mode).toBe("float");
      expect(win.restorePlacement).toBeUndefined();
      expect(updated.activeDesktopId).toBe("desk-1");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("is a no-op apart from focus and active desktop when already float on same desktop", () => {
      let session = createDefaultOsSession("desk-1");
      const customBounds: FloatBounds = { x: 50, y: 60, width: 500, height: 350 };
      session = openWindow(
        session,
        {
          id: "win-float-same",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "float",
          floatBounds: customBounds,
        },
        "desk-1",
      );
      session = openWindow(
        session,
        {
          id: "win-float-other",
          appId: "editor",
          title: "Other",
          ctx: testCtx,
          mode: "float",
        },
        "desk-1",
      );
      expect(session.desktops[0].focusedWindowId).toBe("win-float-other");

      const updated = presentWindowAsFloat(session, "win-float-same", "desk-1");
      const win = updated.windows["win-float-same"];
      expect(win.floatBounds).toEqual(customBounds);
      expect(updated.desktops[0].focusedWindowId).toBe("win-float-same");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("preserves other maximized windows when presenting window as float", () => {
      let session = createDefaultOsSession("desk-1");
      session = openWindow(
        session,
        {
          id: "win-max-1",
          appId: "terminals",
          title: "Hub",
          ctx: testCtx,
          mode: "tile",
        },
        "desk-1",
      );
      session = toggleMaximizeWindow(session, "win-max-1");
      session = openWindow(
        session,
        {
          id: "win-to-float",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
        },
        "desk-1",
      );
      expect(session.windows["win-max-1"].maximized).toBe(true);

      const updated = presentWindowAsFloat(session, "win-to-float", "desk-1");
      expect(updated.windows["win-max-1"].maximized).toBe(true);
      expect(updated.windows["win-to-float"].maximized).toBe(false);
      expect(updated.windows["win-to-float"].mode).toBe("float");
      expect(updated.desktops[0].focusedWindowId).toBe("win-to-float");
      expect(validateOsSession(updated).valid).toBe(true);
    });

    it("returns session untouched for unknown windowId or unknown desktopId", () => {
      const session = createDefaultOsSession("desk-1");
      const updated1 = presentWindowAsFloat(session, "nonexistent", "desk-1");
      expect(updated1).toBe(session);

      const sessionWithWin = openWindow(
        session,
        {
          id: "w1",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "float",
        },
        "desk-1",
      );
      const updated2 = presentWindowAsFloat(sessionWithWin, "w1", "nonexistent-desk");
      expect(updated2).toBe(sessionWithWin);
    });

    it("executes store presentWindowAsFloat atomically with a single subscriber notification and updates focus timestamp", () => {
      let session = createDefaultOsSession("desk-1");
      session = addDesktop(session, "Desk 2");
      const desk2Id = session.desktops[1].id;
      session = openWindow(
        session,
        {
          id: "store-float-win",
          appId: "editor",
          title: "Editor",
          ctx: testCtx,
          mode: "tile",
        },
        desk2Id,
      );
      session = minimizeWindow(session, "store-float-win");
      useWindowStore.getState().setSession(session);

      let notificationCount = 0;
      let subscriberSession: OsSessionV1 | null = null;
      const unsub = useWindowStore.subscribe((state) => {
        notificationCount++;
        subscriberSession = state.session;
      });

      const counterBefore = getWindowFocusTimestamp("store-float-win");
      useWindowStore.getState().presentWindowAsFloat("store-float-win", "desk-1");
      unsub();

      expect(notificationCount).toBe(1);
      expect(subscriberSession).not.toBeNull();
      expect(subscriberSession!.activeDesktopId).toBe("desk-1");
      const placedWin = subscriberSession!.windows["store-float-win"];
      expect(placedWin.minimized).toBe(false);
      expect(placedWin.mode).toBe("float");
      expect(placedWin.desktopId).toBe("desk-1");
      const desk1 = subscriberSession!.desktops.find((d) => d.id === "desk-1")!;
      expect(desk1.focusedWindowId).toBe("store-float-win");
      expect(validateOsSession(subscriberSession!).valid).toBe(true);
      expect(getWindowFocusTimestamp("store-float-win")).toBeGreaterThan(counterBefore);
    });
  });
});
