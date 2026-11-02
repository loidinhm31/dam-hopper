import { describe, expect, it } from "vitest";
import {
  collectTilePaneIds,
  collectTilePanes,
  createTileSplitNode,
  dockItemIntoTileTree,
  findTilePaneById,
  findTilePaneContaining,
  insertItemIntoTilePane,
  isValidTileNode,
  layoutNodeToTileNode,
  newTilePaneNode,
  parsePersistedTerminalLayout,
  pruneEmptyTileSplits,
  removeItemFromTilePane,
  removeTilePane,
  replaceTileNode,
  serializeTerminalLayout,
  splitTilePaneWithItem,
  tileNodeToLayoutNode,
  updateTileSizes,
} from "./tile-tree.js";
import type { LayoutNode, PersistedLayout } from "@/types/terminal-layout.js";

describe("tile-tree generic algorithms", () => {
  it("creates a single pane node with normalized active item", () => {
    const pane = newTilePaneNode(["item-1", "item-2"], "item-2", "pane-1");
    expect(pane.type).toBe("pane");
    expect(pane.id).toBe("pane-1");
    expect(pane.items).toEqual(["item-1", "item-2"]);
    expect(pane.active).toBe("item-2");

    const fallbackPane = newTilePaneNode(["item-1", "item-2"], "non-existent", "pane-2");
    expect(fallbackPane.active).toBe("item-1");
  });

  it("validates tile tree structure recursively", () => {
    const paneA = newTilePaneNode(["a"], "a", "pane-a");
    const paneB = newTilePaneNode(["b"], "b", "pane-b");
    const split = createTileSplitNode("horizontal", [paneA, paneB], [50, 50], "split-1");

    expect(isValidTileNode(paneA)).toBe(true);
    expect(isValidTileNode(split)).toBe(true);
    expect(isValidTileNode({ type: "pane", id: 123 })).toBe(false);
    expect(isValidTileNode({ type: "split", id: "s", sizes: [50] })).toBe(false);
  });

  it("collects pane IDs and panes", () => {
    const p1 = newTilePaneNode(["1"], "1", "p1");
    const p2 = newTilePaneNode(["2"], "2", "p2");
    const split = createTileSplitNode("vertical", [p1, p2], [40, 60], "s1");

    expect(collectTilePaneIds(split)).toEqual(["p1", "p2"]);
    expect(collectTilePanes(split)).toEqual([p1, p2]);
    expect(findTilePaneById(split, "p2")).toEqual(p2);
    expect(findTilePaneContaining(split, (i) => i === "2")).toEqual(p2);
  });

  it("updates sizes in tree", () => {
    const p1 = newTilePaneNode(["1"], "1", "p1");
    const p2 = newTilePaneNode(["2"], "2", "p2");
    const split = createTileSplitNode("vertical", [p1, p2], [50, 50], "s1");

    const updated = updateTileSizes(split, "s1", [30, 70]);
    if (updated.type === "split") {
      expect(updated.sizes).toEqual([30, 70]);
    } else {
      expect.fail("Expected split node");
    }
  });

  it("inserts and removes items from pane", () => {
    const p1 = newTilePaneNode(["1"], "1", "p1");
    const withItem = insertItemIntoTilePane(p1, "p1", "2");
    if (withItem.type === "pane") {
      expect(withItem.items).toEqual(["1", "2"]);
      expect(withItem.active).toBe("2");
    }

    const removed = removeItemFromTilePane(withItem, "p1", "2");
    if (removed.type === "pane") {
      expect(removed.items).toEqual(["1"]);
      expect(removed.active).toBe("1");
    }
  });

  it("splits pane with item on dock edge", () => {
    const p1 = newTilePaneNode(["1"], "1", "p1");
    const { root, newPaneId } = splitTilePaneWithItem(p1, "p1", "right", "2", "p2");

    expect(newPaneId).toBe("p2");
    expect(root.type).toBe("split");
    if (root.type === "split") {
      expect(root.direction).toBe("horizontal");
      expect(root.children[0].id).toBe("p1");
      expect(root.children[1].id).toBe("p2");
    }
  });

  it("docks item into target pane center and tab index", () => {
    const p1 = newTilePaneNode(["1", "2"], "1", "p1");
    const p2 = newTilePaneNode(["3"], "3", "p2");
    const tree = createTileSplitNode("horizontal", [p1, p2], [50, 50], "s1");

    // Move '2' from p1 into p2 center
    const { root: afterCenter } = dockItemIntoTileTree(tree, "2", {
      kind: "pane-center",
      paneId: "p2",
    });

    const pane1After = findTilePaneById(afterCenter, "p1");
    const pane2After = findTilePaneById(afterCenter, "p2");
    expect(pane1After?.items).toEqual(["1"]);
    expect(pane2After?.items).toEqual(["3", "2"]);

    // Move '2' from p2 to p1 at tab index 0
    const { root: afterIndex } = dockItemIntoTileTree(afterCenter, "2", {
      kind: "tab-index",
      paneId: "p1",
      index: 0,
    });
    const pane1Final = findTilePaneById(afterIndex, "p1");
    expect(pane1Final?.items).toEqual(["2", "1"]);
  });

  it("collapses source pane when moving the last item to another pane", () => {
    const p1 = newTilePaneNode(["only-one"], "only-one", "p1");
    const p2 = newTilePaneNode(["target"], "target", "p2");
    const tree = createTileSplitNode("horizontal", [p1, p2], [50, 50], "s1");

    const { root } = dockItemIntoTileTree(tree, "only-one", {
      kind: "pane-center",
      paneId: "p2",
    });

    // p1 should be removed and tree collapsed directly to p2
    expect(root.type).toBe("pane");
    if (root.type === "pane") {
      expect(root.id).toBe("p2");
      expect(root.items).toEqual(["target", "only-one"]);
    }
  });
});

describe("terminal layout wire codec", () => {
  it("translates LayoutNode to TileNode and back losslessly", () => {
    const originalLayout: LayoutNode = {
      type: "split",
      id: "split-root",
      direction: "horizontal",
      sizes: [45, 55],
      children: [
        {
          type: "pane",
          id: "pane-left",
          sessionIds: ["term-1", "term-2"],
          activeSessionId: "term-2",
        },
        {
          type: "pane",
          id: "pane-right",
          sessionIds: ["term-3"],
          activeSessionId: "term-3",
        },
      ],
    };

    const tileNode = layoutNodeToTileNode(originalLayout);
    expect(tileNode.type).toBe("split");
    if (tileNode.type === "split") {
      const left = tileNode.children[0];
      if (left.type === "pane") {
        expect(left.items).toEqual(["term-1", "term-2"]);
        expect(left.active).toBe("term-2");
      }
    }

    const backToLayout = tileNodeToLayoutNode(tileNode);
    expect(backToLayout).toEqual(originalLayout);
  });

  it("parses and serializes persisted terminal layout strings", () => {
    const rawPayload: PersistedLayout = {
      version: 2,
      root: {
        type: "pane",
        id: "p1",
        sessionIds: ["sess-a"],
        activeSessionId: "sess-a",
      },
    };
    const rawJson = JSON.stringify(rawPayload);

    const parsedTileNode = parsePersistedTerminalLayout(rawJson);
    expect(parsedTileNode).not.toBeNull();
    expect(parsedTileNode?.id).toBe("p1");

    const serialized = serializeTerminalLayout(parsedTileNode!, 2);
    expect(JSON.parse(serialized)).toEqual(rawPayload);

    expect(parsePersistedTerminalLayout("invalid-json")).toBeNull();
    expect(parsePersistedTerminalLayout(null)).toBeNull();
    expect(parsePersistedTerminalLayout(JSON.stringify({ version: 99 }))).toBeNull();
  });
});
