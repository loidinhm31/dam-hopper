import type {
  DockEdge,
  SplitDirection,
  TileDockTarget,
  TileNode,
  TilePaneNode,
  TileSplitNode,
} from "@/types/tile-tree.js";
import type { LayoutNode, PaneNode, PersistedLayout, SplitNode } from "@/types/terminal-layout.js";
import { generateUUID } from "@/lib/utils.js";

export function normalizeActiveItem<T>(
  items: T[],
  active: T | null,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): T | null {
  if (active !== null && items.some((item) => isEqual(item, active))) {
    return active;
  }
  return items[0] ?? null;
}

export function newTilePaneNode<T>(
  items: T[] = [],
  active: T | null = null,
  id: string = generateUUID(),
  isEqual?: (a: T, b: T) => boolean,
): TilePaneNode<T> {
  return {
    type: "pane",
    id,
    items,
    active: normalizeActiveItem(items, active, isEqual),
  };
}

export function createTileSplitNode<T>(
  direction: SplitDirection,
  children: [TileNode<T>, TileNode<T>],
  sizes: [number, number] = [50, 50],
  id: string = generateUUID(),
): TileSplitNode<T> {
  return {
    type: "split",
    id,
    direction,
    sizes,
    children,
  };
}

export function isValidTileNode<T>(
  node: unknown,
  isItemValid: (item: unknown) => item is T = (_item): _item is T => true,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): node is TileNode<T> {
  if (typeof node !== "object" || node === null) return false;
  const candidate = node as Record<string, unknown>;
  if (candidate.type === "pane") {
    if (typeof candidate.id !== "string" || !candidate.id) return false;
    if (!Array.isArray(candidate.items)) return false;
    if (!candidate.items.every(isItemValid)) return false;
    for (let i = 0; i < candidate.items.length; i++) {
      for (let j = i + 1; j < candidate.items.length; j++) {
        if (isEqual(candidate.items[i], candidate.items[j])) return false;
      }
    }
    if (candidate.items.length > 0) {
      if (
        candidate.active === null ||
        !candidate.items.some((item) => isEqual(item, candidate.active as T))
      ) {
        return false;
      }
    } else {
      if (candidate.active !== null) return false;
    }
    return true;
  }
  if (candidate.type === "split") {
    return (
      typeof candidate.id === "string" &&
      Boolean(candidate.id) &&
      (candidate.direction === "horizontal" || candidate.direction === "vertical") &&
      Array.isArray(candidate.sizes) &&
      candidate.sizes.length === 2 &&
      candidate.sizes.every((s) => typeof s === "number" && Number.isFinite(s) && s > 0) &&
      Array.isArray(candidate.children) &&
      candidate.children.length === 2 &&
      isValidTileNode(candidate.children[0], isItemValid, isEqual) &&
      isValidTileNode(candidate.children[1], isItemValid, isEqual)
    );
  }
  return false;
}

export function collectTilePaneIds<T>(node: TileNode<T>): string[] {
  if (node.type === "pane") return [node.id];
  return [
    ...collectTilePaneIds(node.children[0]),
    ...collectTilePaneIds(node.children[1]),
  ];
}

export function collectTilePanes<T>(node: TileNode<T>): TilePaneNode<T>[] {
  if (node.type === "pane") return [node];
  return [
    ...collectTilePanes(node.children[0]),
    ...collectTilePanes(node.children[1]),
  ];
}

export function findTilePaneById<T>(
  node: TileNode<T>,
  paneId: string,
): TilePaneNode<T> | undefined {
  return collectTilePanes(node).find((pane) => pane.id === paneId);
}

export function findTilePaneContaining<T>(
  node: TileNode<T>,
  predicate: (item: T) => boolean,
): TilePaneNode<T> | undefined {
  return collectTilePanes(node).find((pane) => pane.items.some(predicate));
}

export function pruneEmptyTileSplits<T>(node: TileNode<T>): TileNode<T> | null {
  if (node.type === "pane") return node;
  const left = pruneEmptyTileSplits(node.children[0]);
  const right = pruneEmptyTileSplits(node.children[1]);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

export function replaceTileNode<T>(
  tree: TileNode<T>,
  targetId: string,
  replacement: TileNode<T>,
): TileNode<T> | null {
  if (tree.type === "pane") {
    return tree.id === targetId ? replacement : null;
  }
  if (tree.id === targetId) {
    return replacement;
  }
  const left = replaceTileNode(tree.children[0], targetId, replacement);
  if (left) return { ...tree, children: [left, tree.children[1]] };
  const right = replaceTileNode(tree.children[1], targetId, replacement);
  if (right) return { ...tree, children: [tree.children[0], right] };
  return null;
}

export function removeTilePane<T>(
  tree: TileNode<T>,
  paneId: string,
): TileNode<T> | null {
  if (tree.type === "pane") {
    return tree.id === paneId ? null : tree;
  }
  const left = removeTilePane(tree.children[0], paneId);
  const right = removeTilePane(tree.children[1], paneId);
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;
  return { ...tree, children: [left, right] };
}

export function updateTileSizes<T>(
  tree: TileNode<T>,
  nodeId: string,
  sizes: [number, number],
): TileNode<T> {
  if (tree.type === "pane") return tree;
  if (tree.id === nodeId) return { ...tree, sizes };
  const left = updateTileSizes(tree.children[0], nodeId, sizes);
  const right = updateTileSizes(tree.children[1], nodeId, sizes);
  return left === tree.children[0] && right === tree.children[1]
    ? tree
    : { ...tree, children: [left, right] };
}

export function updateTilePane<T>(
  tree: TileNode<T>,
  paneId: string,
  updater: (pane: TilePaneNode<T>) => TilePaneNode<T>,
): TileNode<T> {
  if (tree.type === "pane") {
    return tree.id === paneId ? updater(tree) : tree;
  }
  const left = updateTilePane(tree.children[0], paneId, updater);
  const right = updateTilePane(tree.children[1], paneId, updater);
  return left === tree.children[0] && right === tree.children[1]
    ? tree
    : { ...tree, children: [left, right] };
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

function reorderItems<T>(
  items: T[],
  item: T,
  index?: number,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): T[] {
  const next = items.filter((existing) => !isEqual(existing, item));
  const insertAt = clampIndex(index ?? next.length, next.length);
  next.splice(insertAt, 0, item);
  return next;
}

export function insertItemIntoTilePane<T>(
  tree: TileNode<T>,
  paneId: string,
  item: T,
  index?: number,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): TileNode<T> {
  return updateTilePane(tree, paneId, (pane) => {
    const items = reorderItems(pane.items, item, index, isEqual);
    const active = item;
    return { ...pane, items, active };
  });
}

export function removeItemFromTilePane<T>(
  tree: TileNode<T>,
  paneId: string,
  item: T,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): TileNode<T> {
  return updateTilePane(tree, paneId, (pane) => {
    if (!pane.items.some((i) => isEqual(i, item))) return pane;
    const items = pane.items.filter((i) => !isEqual(i, item));
    const active = normalizeActiveItem(items, pane.active, isEqual);
    return { ...pane, items, active };
  });
}

export function splitTilePaneWithItem<T>(
  tree: TileNode<T>,
  paneId: string,
  edge: DockEdge,
  item: T,
  newPaneId: string = generateUUID(),
): { root: TileNode<T>; newPaneId: string } {
  const targetPane = findTilePaneById(tree, paneId);
  if (!targetPane) return { root: tree, newPaneId: paneId };

  const newPane = newTilePaneNode([item], item, newPaneId);
  const direction: SplitDirection =
    edge === "left" || edge === "right" ? "horizontal" : "vertical";
  const children: [TileNode<T>, TileNode<T>] =
    edge === "left" || edge === "top"
      ? [newPane, targetPane]
      : [targetPane, newPane];
  const splitNode = createTileSplitNode(direction, children);
  return {
    root: replaceTileNode(tree, paneId, splitNode) ?? tree,
    newPaneId: newPane.id,
  };
}

export function dockItemIntoTileTree<T>(
  tree: TileNode<T>,
  item: T,
  target: TileDockTarget,
  sourcePaneId?: string,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): { root: TileNode<T>; targetPaneId: string } {
  const currentSourcePane = sourcePaneId
    ? findTilePaneById(tree, sourcePaneId)
    : findTilePaneContaining(tree, (i) => isEqual(i, item));
  if (
    target.kind === "pane-edge" &&
    currentSourcePane &&
    target.paneId === currentSourcePane.id &&
    currentSourcePane.items.length <= 1
  ) {
    return { root: tree, targetPaneId: target.paneId };
  }

  const shouldCollapse =
    currentSourcePane &&
    currentSourcePane.id !== target.paneId &&
    currentSourcePane.items.length === 1 &&
    collectTilePanes(tree).length > 1;

  let workingTree = currentSourcePane
    ? shouldCollapse
      ? (removeTilePane(tree, currentSourcePane.id) ?? tree)
      : removeItemFromTilePane(tree, currentSourcePane.id, item, isEqual)
    : tree;

  if (target.kind === "pane-center") {
    if (currentSourcePane && currentSourcePane.id === target.paneId) {
      return {
        root: updateTilePane(tree, target.paneId, (pane) => ({
          ...pane,
          active: item,
        })),
        targetPaneId: target.paneId,
      };
    }
    return {
      root: insertItemIntoTilePane(workingTree, target.paneId, item, undefined, isEqual),
      targetPaneId: target.paneId,
    };
  }

  if (target.kind === "tab-index") {
    return {
      root: insertItemIntoTilePane(workingTree, target.paneId, item, target.index, isEqual),
      targetPaneId: target.paneId,
    };
  }

  const split = splitTilePaneWithItem(workingTree, target.paneId, target.edge, item);
  return { root: split.root, targetPaneId: split.newPaneId };
}

// -----------------------------------------------------------------------------
// Terminal Wire Codec: Lossless bi-directional translation for LayoutNode (v2/v3)
// -----------------------------------------------------------------------------

export function tileNodeToLayoutNode(node: TileNode<string>): LayoutNode {
  if (node.type === "pane") {
    return {
      type: "pane",
      id: node.id,
      sessionIds: [...node.items],
      activeSessionId: node.active,
    };
  }
  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    sizes: [...node.sizes] as [number, number],
    children: [
      tileNodeToLayoutNode(node.children[0]),
      tileNodeToLayoutNode(node.children[1]),
    ],
  };
}

export function layoutNodeToTileNode(node: LayoutNode): TileNode<string> {
  if (node.type === "pane") {
    return {
      type: "pane",
      id: node.id,
      items: [...node.sessionIds],
      active: node.activeSessionId,
    };
  }
  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    sizes: [...node.sizes] as [number, number],
    children: [
      layoutNodeToTileNode(node.children[0]),
      layoutNodeToTileNode(node.children[1]),
    ],
  };
}

export function isValidLayoutNode(node: unknown): node is LayoutNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  if (typeof n.id !== "string" || !n.id) return false;
  if (n.type === "pane") {
    if (!Array.isArray(n.sessionIds)) return false;
    for (const s of n.sessionIds) {
      if (typeof s !== "string") return false;
    }
    if (n.activeSessionId !== null && typeof n.activeSessionId !== "string") {
      return false;
    }
    if (n.activeSessionId !== null && n.sessionIds.length > 0) {
      if (!n.sessionIds.includes(n.activeSessionId)) return false;
    }
    return true;
  }
  if (n.type === "split") {
    if (n.direction !== "horizontal" && n.direction !== "vertical") return false;
    if (!Array.isArray(n.sizes) || n.sizes.length !== 2) return false;
    if (typeof n.sizes[0] !== "number" || typeof n.sizes[1] !== "number") return false;
    if (!Number.isFinite(n.sizes[0]) || !Number.isFinite(n.sizes[1])) return false;
    if (n.sizes[0] <= 0 || n.sizes[1] <= 0) return false;
    if (!Array.isArray(n.children) || n.children.length !== 2) return false;
    return isValidLayoutNode(n.children[0]) && isValidLayoutNode(n.children[1]);
  }
  return false;
}

export function parsePersistedTerminalLayout(raw: string | null): TileNode<string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedLayout;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed.version !== 1 && parsed.version !== 2)
    ) {
      return null;
    }
    if (!isValidLayoutNode(parsed.root)) {
      return null;
    }
    const tileRoot = layoutNodeToTileNode(parsed.root);
    if (!isValidTileNode(tileRoot, (item): item is string => typeof item === "string")) {
      return null;
    }
    return tileRoot;
  } catch {
    return null;
  }
}

export function serializeTerminalLayout(
  tree: TileNode<string>,
  version: 1 | 2 = 2,
): string {
  const root = tileNodeToLayoutNode(tree);
  const payload: PersistedLayout = { version, root };
  return JSON.stringify(payload);
}
