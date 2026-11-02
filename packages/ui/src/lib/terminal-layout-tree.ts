import type {
  LayoutNode,
  PaneNode,
  PersistedLayout,
  SplitNode,
} from "@/types/terminal-layout.js";
import { generateUUID } from "@/lib/utils.js";
import {
  collectTilePaneIds,
  collectTilePanes,
  findTilePaneById as findTilePaneByIdGeneric,
  isValidLayoutNode,
  layoutNodeToTileNode,
  newTilePaneNode,
  parsePersistedTerminalLayout,
  pruneEmptyTileSplits as pruneEmptyTileSplitsGeneric,
  removeTilePane,
  replaceTileNode,
  tileNodeToLayoutNode,
  updateTileSizes,
} from "@/lib/tile-tree.js";

function normalizeActiveSessionId(
  sessionIds: string[],
  activeSessionId: string | null,
): string | null {
  return sessionIds.includes(activeSessionId ?? "")
    ? activeSessionId
    : (sessionIds[0] ?? null);
}

export function newPaneNode(
  sessionIds: string[] = [],
  activeSessionId: string | null = null,
): PaneNode {
  return {
    type: "pane",
    id: generateUUID(),
    sessionIds,
    activeSessionId: normalizeActiveSessionId(sessionIds, activeSessionId),
  };
}

export function isValidNode(node: unknown): boolean {
  return isValidLayoutNode(node);
}

export function loadPersistedLayout(raw: string | null): LayoutNode | null {
  const tileRoot = parsePersistedTerminalLayout(raw);
  return tileRoot ? tileNodeToLayoutNode(tileRoot) : null;
}

export function collectPaneIds(node: LayoutNode): string[] {
  return collectTilePaneIds(layoutNodeToTileNode(node));
}

export function collectPanes(node: LayoutNode): PaneNode[] {
  const tileTree = layoutNodeToTileNode(node);
  return collectTilePanes(tileTree).map((tilePane) => ({
    type: "pane",
    id: tilePane.id,
    sessionIds: [...tilePane.items],
    activeSessionId: tilePane.active,
  }));
}

export function findPaneById(
  node: LayoutNode,
  paneId: string,
): PaneNode | undefined {
  const tileTree = layoutNodeToTileNode(node);
  const found = findTilePaneByIdGeneric(tileTree, paneId);
  if (!found) return undefined;
  return {
    type: "pane",
    id: found.id,
    sessionIds: [...found.items],
    activeSessionId: found.active,
  };
}

export function pruneDeadSessions(
  node: LayoutNode,
  liveSessions: Set<string>,
): LayoutNode {
  if (node.type === "pane") {
    const sessionIds = node.sessionIds.filter((id) => liveSessions.has(id));
    return {
      ...node,
      sessionIds,
      activeSessionId: normalizeActiveSessionId(
        sessionIds,
        node.activeSessionId,
      ),
    };
  }
  return {
    ...node,
    children: [
      pruneDeadSessions(node.children[0], liveSessions),
      pruneDeadSessions(node.children[1], liveSessions),
    ],
  };
}

export function pruneEmptySplits(node: LayoutNode): LayoutNode | null {
  const tileTree = layoutNodeToTileNode(node);
  const pruned = pruneEmptyTileSplitsGeneric(tileTree);
  return pruned ? tileNodeToLayoutNode(pruned) : null;
}

export function replaceNode(
  tree: LayoutNode,
  paneId: string,
  replacement: LayoutNode,
): LayoutNode | null {
  const tileTree = layoutNodeToTileNode(tree);
  const tileReplacement = layoutNodeToTileNode(replacement);
  const replaced = replaceTileNode(tileTree, paneId, tileReplacement);
  return replaced ? tileNodeToLayoutNode(replaced) : null;
}

export function removePane(
  tree: LayoutNode,
  paneId: string,
): LayoutNode | null {
  const tileTree = layoutNodeToTileNode(tree);
  const removed = removeTilePane(tileTree, paneId);
  return removed ? tileNodeToLayoutNode(removed) : null;
}

export function updateSizesInTree(
  tree: LayoutNode,
  nodeId: string,
  sizes: [number, number],
): LayoutNode {
  const tileTree = layoutNodeToTileNode(tree);
  const updated = updateTileSizes(tileTree, nodeId, sizes);
  return tileNodeToLayoutNode(updated);
}

export function createSplitNode(
  target: PaneNode,
  direction: SplitNode["direction"],
  children: SplitNode["children"],
): SplitNode {
  return {
    type: "split",
    id: generateUUID(),
    direction,
    sizes: [50, 50],
    children,
  };
}
