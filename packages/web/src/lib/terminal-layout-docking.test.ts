import { describe, expect, it } from "vitest";
import { dockSessionInLayout } from "./terminal-layout-docking.js";
import type { DockEdge, LayoutNode, PaneNode } from "@/types/terminal-layout.js";

function pane(
  id: string,
  sessionIds: string[],
  activeSessionId: string | null = sessionIds[0] ?? null,
): PaneNode {
  return { type: "pane", id, sessionIds, activeSessionId };
}

function split(
  id: string,
  direction: "horizontal" | "vertical",
  left: LayoutNode,
  right: LayoutNode,
): LayoutNode {
  return {
    type: "split",
    id,
    direction,
    sizes: [50, 50],
    children: [left, right],
  };
}

describe("dockSessionInLayout", () => {
  it("moves a tab to another pane center and collapses an empty source pane", () => {
    const root = split("root", "horizontal", pane("left", ["s1"]), pane("right", ["s2"]));
    const result = dockSessionInLayout(root, "s1", "left", {
      kind: "pane-center",
      paneId: "right",
    });

    expect(result.focusedPaneId).toBe("right");
    expect(result.root).toEqual(pane("right", ["s2", "s1"], "s1"));
  });

  it.each([
    ["left", "horizontal", 0],
    ["right", "horizontal", 1],
    ["top", "vertical", 0],
    ["bottom", "vertical", 1],
  ] satisfies [DockEdge, "horizontal" | "vertical", 0 | 1][])(
    "splits a pane on %s edge with predictable child ordering",
    (edge, direction, dockedIndex) => {
      const root = split("root", "horizontal", pane("source", ["s1"]), pane("target", ["s2"]));
      const result = dockSessionInLayout(root, "s1", "source", {
        kind: "pane-edge",
        paneId: "target",
        edge,
      });

      expect(result.changed).toBe(true);
      expect(result.root).toMatchObject({
        type: "split",
        direction,
      });

      const children = (result.root as Extract<LayoutNode, { type: "split" }>).children;
      expect(children[dockedIndex]).toMatchObject({
        type: "pane",
        sessionIds: ["s1"],
        activeSessionId: "s1",
      });
      expect(children[dockedIndex === 0 ? 1 : 0]).toEqual(pane("target", ["s2"]));
    },
  );

  it("reorders tabs within the same pane by tab index", () => {
    const root = pane("pane-a", ["s1", "s2", "s3"], "s1");
    const result = dockSessionInLayout(root, "s3", "pane-a", {
      kind: "tab-index",
      paneId: "pane-a",
      index: 1,
    });

    expect(result.root).toEqual(pane("pane-a", ["s1", "s3", "s2"], "s3"));
    expect(result.focusedPaneId).toBe("pane-a");
  });

  it("moves a tab into another pane at an insertion index", () => {
    const root = split(
      "root",
      "horizontal",
      pane("left", ["s1", "s2"], "s1"),
      pane("right", ["s3"], "s3"),
    );
    const result = dockSessionInLayout(root, "s2", "left", {
      kind: "tab-index",
      paneId: "right",
      index: 0,
    });

    expect(result.root).toEqual(
      split(
        "root",
        "horizontal",
        pane("left", ["s1"], "s1"),
        pane("right", ["s2", "s3"], "s2"),
      ),
    );
  });

  it("keeps an empty target pane usable", () => {
    const root = split("root", "horizontal", pane("left", ["s1"]), pane("empty", [], null));
    const result = dockSessionInLayout(root, "s1", "left", {
      kind: "pane-center",
      paneId: "empty",
    });

    expect(result.root).toEqual(pane("empty", ["s1"], "s1"));
    expect(result.focusedPaneId).toBe("empty");
  });
});
