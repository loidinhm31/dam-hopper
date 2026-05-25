import type { LayoutNode, PaneNode, PersistedLayout, SplitNode } from "@/types/terminal-layout.js";
import { generateUUID } from "@/lib/utils.js";

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
  if (typeof node !== "object" || node === null) return false;
  const candidate = node as Record<string, unknown>;
  if (candidate.type === "pane") {
    return (
      typeof candidate.id === "string" &&
      Array.isArray(candidate.sessionIds) &&
      candidate.sessionIds.every((sessionId) => typeof sessionId === "string") &&
      (candidate.activeSessionId === null ||
        typeof candidate.activeSessionId === "string")
    );
  }
  if (candidate.type === "split") {
    return (
      typeof candidate.id === "string" &&
      (candidate.direction === "horizontal" ||
        candidate.direction === "vertical") &&
      Array.isArray(candidate.sizes) &&
      candidate.sizes.length === 2 &&
      candidate.sizes.every((size) => typeof size === "number") &&
      Array.isArray(candidate.children) &&
      candidate.children.length === 2 &&
      isValidNode(candidate.children[0]) &&
      isValidNode(candidate.children[1])
    );
  }
  return false;
}

export function loadPersistedLayout(raw: string | null): LayoutNode | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as PersistedLayout;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    parsed.version !== 1 ||
    !isValidNode(parsed.root)
  ) {
    return null;
  }
  return parsed.root;
}

export function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}

export function collectPanes(node: LayoutNode): PaneNode[] {
  if (node.type === "pane") return [node];
  return [...collectPanes(node.children[0]), ...collectPanes(node.children[1])];
}

export function findPaneById(
  node: LayoutNode,
  paneId: string,
): PaneNode | undefined {
  return collectPanes(node).find((pane) => pane.id === paneId);
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
      activeSessionId: normalizeActiveSessionId(sessionIds, node.activeSessionId),
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
  if (node.type === "pane") return node;
  const left = pruneEmptySplits(node.children[0]);
  const right = pruneEmptySplits(node.children[1]);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

export function replaceNode(
  tree: LayoutNode,
  paneId: string,
  replacement: LayoutNode,
): LayoutNode | null {
  if (tree.type === "pane") {
    return tree.id === paneId ? replacement : null;
  }
  const left = replaceNode(tree.children[0], paneId, replacement);
  if (left) return { ...tree, children: [left, tree.children[1]] };
  const right = replaceNode(tree.children[1], paneId, replacement);
  if (right) return { ...tree, children: [tree.children[0], right] };
  return null;
}

export function removePane(tree: LayoutNode, paneId: string): LayoutNode | null {
  if (tree.type === "pane") {
    return tree.id === paneId ? null : tree;
  }
  const left = removePane(tree.children[0], paneId);
  const right = removePane(tree.children[1], paneId);
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;
  return { ...tree, children: [left, right] };
}

export function updateSizesInTree(
  tree: LayoutNode,
  nodeId: string,
  sizes: [number, number],
): LayoutNode {
  if (tree.type === "pane") return tree;
  if (tree.id === nodeId) return { ...tree, sizes };
  const left = updateSizesInTree(tree.children[0], nodeId, sizes);
  const right = updateSizesInTree(tree.children[1], nodeId, sizes);
  return left === tree.children[0] && right === tree.children[1]
    ? tree
    : { ...tree, children: [left, right] };
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
