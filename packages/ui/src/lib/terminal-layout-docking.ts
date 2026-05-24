import type { DockEdge, DockTarget, LayoutNode, PaneNode } from "@/types/terminal-layout.js";
import {
  collectPanes,
  createSplitNode,
  findPaneById,
  newPaneNode,
  removePane,
  replaceNode,
} from "@/lib/terminal-layout-tree.js";

function updatePane(
  tree: LayoutNode,
  paneId: string,
  updater: (pane: PaneNode) => PaneNode,
): LayoutNode {
  if (tree.type === "pane") {
    return tree.id === paneId ? updater(tree) : tree;
  }
  const left = updatePane(tree.children[0], paneId, updater);
  const right = updatePane(tree.children[1], paneId, updater);
  return left === tree.children[0] && right === tree.children[1]
    ? tree
    : { ...tree, children: [left, right] };
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

function reorderSessionIds(
  sessionIds: string[],
  sessionId: string,
  index?: number,
): string[] {
  const next = sessionIds.filter((id) => id !== sessionId);
  const insertAt = clampIndex(index ?? next.length, next.length);
  next.splice(insertAt, 0, sessionId);
  return next;
}

function shouldCollapseSourcePane(
  tree: LayoutNode,
  sourcePaneId: string,
  sourcePane: PaneNode,
  targetPaneId: string,
): boolean {
  return (
    sourcePaneId !== targetPaneId &&
    sourcePane.sessionIds.length === 1 &&
    collectPanes(tree).length > 1
  );
}

function splitPaneWithSession(
  tree: LayoutNode,
  paneId: string,
  edge: DockEdge,
  sessionId: string,
): { root: LayoutNode; newPaneId: string } {
  const targetPane = findPaneById(tree, paneId);
  if (!targetPane) return { root: tree, newPaneId: paneId };

  const newPane = newPaneNode([sessionId], sessionId);
  const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical";
  const children: [LayoutNode, LayoutNode] =
    edge === "left" || edge === "top"
      ? [newPane, targetPane]
      : [targetPane, newPane];
  const splitNode = createSplitNode(targetPane, direction, children);
  return {
    root: replaceNode(tree, paneId, splitNode) ?? tree,
    newPaneId: newPane.id,
  };
}

export function addSessionToPane(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
): LayoutNode {
  return insertSessionIntoPane(tree, paneId, sessionId);
}

export function insertSessionIntoPane(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
  index?: number,
): LayoutNode {
  return updatePane(tree, paneId, (pane) => {
    const sessionIds = reorderSessionIds(pane.sessionIds, sessionId, index);
    const activeSessionId = sessionId;
    return pane.sessionIds.join("|") === sessionIds.join("|") &&
      pane.activeSessionId === activeSessionId
      ? pane
      : { ...pane, sessionIds, activeSessionId };
  });
}

export function removeSessionFromPane(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
): LayoutNode {
  return updatePane(tree, paneId, (pane) => {
    if (!pane.sessionIds.includes(sessionId)) return pane;
    const sessionIds = pane.sessionIds.filter((id) => id !== sessionId);
    return {
      ...pane,
      sessionIds,
      activeSessionId: sessionIds.includes(pane.activeSessionId ?? "")
        ? pane.activeSessionId
        : (sessionIds[0] ?? null),
    };
  });
}

export function setActivePaneSession(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
): LayoutNode {
  return updatePane(tree, paneId, (pane) =>
    pane.activeSessionId === sessionId ? pane : { ...pane, activeSessionId: sessionId },
  );
}

export function moveTabBetweenPanes(
  tree: LayoutNode,
  sessionId: string,
  fromPaneId: string,
  toPaneId: string,
): LayoutNode {
  const withoutSource = removeSessionFromPane(tree, fromPaneId, sessionId);
  return insertSessionIntoPane(withoutSource, toPaneId, sessionId);
}

export function dockSessionInLayout(
  tree: LayoutNode,
  sessionId: string,
  sourcePaneId: string,
  target: DockTarget,
): { root: LayoutNode; focusedPaneId: string; changed: boolean } {
  const sourcePane = findPaneById(tree, sourcePaneId);
  if (!sourcePane || !sourcePane.sessionIds.includes(sessionId)) {
    return { root: tree, focusedPaneId: sourcePaneId, changed: false };
  }

  if (target.kind === "pane-center" && target.paneId === sourcePaneId) {
    const root = setActivePaneSession(tree, sourcePaneId, sessionId);
    return { root, focusedPaneId: sourcePaneId, changed: root !== tree };
  }

  if (target.kind === "pane-edge" && target.paneId === sourcePaneId && sourcePane.sessionIds.length <= 1) {
    return { root: tree, focusedPaneId: sourcePaneId, changed: false };
  }

  if (target.kind === "tab-index" && target.paneId === sourcePaneId) {
    const root = insertSessionIntoPane(tree, sourcePaneId, sessionId, target.index);
    return { root, focusedPaneId: sourcePaneId, changed: root !== tree };
  }

  let next = removeSessionFromPane(tree, sourcePaneId, sessionId);
  if (shouldCollapseSourcePane(tree, sourcePaneId, sourcePane, target.paneId)) {
    next = removePane(next, sourcePaneId) ?? next;
  }

  if (target.kind === "pane-edge") {
    const split = splitPaneWithSession(next, target.paneId, target.edge, sessionId);
    return {
      root: split.root,
      focusedPaneId: split.newPaneId,
      changed: split.root !== tree,
    };
  }

  next = insertSessionIntoPane(
    next,
    target.paneId,
    sessionId,
    target.kind === "tab-index" ? target.index : undefined,
  );

  return {
    root: next,
    focusedPaneId: target.paneId,
    changed: next !== tree,
  };
}
