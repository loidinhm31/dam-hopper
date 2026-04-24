import { useState, useCallback, useRef, useEffect } from "react";
import type { LayoutNode, PaneNode, PersistedLayout, SplitDirection, SplitNode } from "@/types/terminal-layout.js";
import { generateUUID } from "@/lib/utils.js";

const STORAGE_KEY = "dam-hopper:terminal-layout";

// ─── helpers ────────────────────────────────────────────────────────────────

function newPaneNode(sessionIds: string[] = [], activeSessionId: string | null = null): PaneNode {
  return { type: "pane", id: generateUUID(), sessionIds, activeSessionId };
}

function defaultLayout(): LayoutNode {
  return newPaneNode();
}

/** Recursively validate that a parsed value conforms to the LayoutNode schema. */
function isValidNode(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  if (n.type === "pane") {
    return (
      typeof n.id === "string" &&
      Array.isArray(n.sessionIds) &&
      (n.sessionIds as unknown[]).every((s) => typeof s === "string") &&
      (n.activeSessionId === null || typeof n.activeSessionId === "string")
    );
  }
  if (n.type === "split") {
    return (
      typeof n.id === "string" &&
      (n.direction === "horizontal" || n.direction === "vertical") &&
      Array.isArray(n.sizes) &&
      (n.sizes as unknown[]).length === 2 &&
      (n.sizes as unknown[]).every((s) => typeof s === "number") &&
      Array.isArray(n.children) &&
      (n.children as unknown[]).length === 2 &&
      isValidNode((n.children as unknown[])[0]) &&
      isValidNode((n.children as unknown[])[1])
    );
  }
  return false;
}

/** Defensively parse layout from localStorage. Returns null on any invalid data. */
function loadLayout(): LayoutNode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as PersistedLayout).version !== 1 ||
      !isValidNode((parsed as PersistedLayout).root)
    ) {
      return null;
    }
    return (parsed as PersistedLayout).root;
  } catch {
    return null;
  }
}

function saveLayout(root: LayoutNode): void {
  try {
    const layout: PersistedLayout = { version: 1, root };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage may be full or unavailable — silently continue
  }
}

/** Collect all pane node IDs from a tree. */
function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}

/** Prune dead sessionIds from all pane nodes. Returns mutated copy. */
function pruneDeadSessions(node: LayoutNode, liveSessions: Set<string>): LayoutNode {
  if (node.type === "pane") {
    const sessionIds = node.sessionIds.filter((id) => liveSessions.has(id));
    const activeSessionId = sessionIds.includes(node.activeSessionId ?? "")
      ? node.activeSessionId
      : (sessionIds[0] ?? null);
    return { ...node, sessionIds, activeSessionId };
  }
  return {
    ...node,
    children: [
      pruneDeadSessions(node.children[0], liveSessions),
      pruneDeadSessions(node.children[1], liveSessions),
    ],
  };
}

/** Collapse single-child splits after a pane removal. Empty panes are kept intact. */
function pruneEmptySplits(node: LayoutNode): LayoutNode | null {
  if (node.type === "pane") {
    // Keep pane even if empty — it can receive drop or user can close it manually
    return node;
  }
  const left = pruneEmptySplits(node.children[0]);
  const right = pruneEmptySplits(node.children[1]);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

/** Replace a pane node by id with a new node. Returns null if not found. */
function replaceNode(
  tree: LayoutNode,
  paneId: string,
  replacement: LayoutNode,
): LayoutNode | null {
  if (tree.type === "pane") {
    return tree.id === paneId ? replacement : null;
  }
  const newLeft = replaceNode(tree.children[0], paneId, replacement);
  if (newLeft) return { ...tree, children: [newLeft, tree.children[1]] };
  const newRight = replaceNode(tree.children[1], paneId, replacement);
  if (newRight) return { ...tree, children: [tree.children[0], newRight] };
  return null;
}

/** Remove a pane node by id making parent collapse to its sibling. */
function removePane(tree: LayoutNode, paneId: string): LayoutNode | null {
  if (tree.type === "pane") {
    return tree.id === paneId ? null : tree;
  }
  const newLeft = removePane(tree.children[0], paneId);
  const newRight = removePane(tree.children[1], paneId);
  if (newLeft === null && newRight === null) return null;
  if (newLeft === null) return newRight;
  if (newRight === null) return newLeft;
  return { ...tree, children: [newLeft, newRight] };
}

/** Update sizes on a split node by id. */
function updateSizesInTree(
  tree: LayoutNode,
  nodeId: string,
  sizes: [number, number],
): LayoutNode {
  if (tree.type === "pane") return tree;
  if (tree.id === nodeId) return { ...tree, sizes };
  return {
    ...tree,
    children: [
      updateSizesInTree(tree.children[0], nodeId, sizes),
      updateSizesInTree(tree.children[1], nodeId, sizes),
    ],
  };
}

/** Add sessionId to a specific pane. */
function addSessionToPane(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
): LayoutNode {
  if (tree.type === "pane") {
    if (tree.id !== paneId) return tree;
    if (tree.sessionIds.includes(sessionId)) return { ...tree, activeSessionId: sessionId };
    return { ...tree, sessionIds: [...tree.sessionIds, sessionId], activeSessionId: sessionId };
  }
  return {
    ...tree,
    children: [
      addSessionToPane(tree.children[0], paneId, sessionId),
      addSessionToPane(tree.children[1], paneId, sessionId),
    ],
  };
}

/** Remove sessionId from a specific pane. Collapses pane if empty. */
function removeSessionFromPane(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
): LayoutNode {
  if (tree.type === "pane") {
    if (tree.id !== paneId) return tree;
    const sessionIds = tree.sessionIds.filter((id) => id !== sessionId);
    const activeSessionId = sessionIds.includes(tree.activeSessionId ?? "")
      ? tree.activeSessionId
      : (sessionIds[0] ?? null);
    return { ...tree, sessionIds, activeSessionId };
  }
  return {
    ...tree,
    children: [
      removeSessionFromPane(tree.children[0], paneId, sessionId),
      removeSessionFromPane(tree.children[1], paneId, sessionId),
    ],
  };
}

/** Set active session in a pane. */
function setActivePaneSession(
  tree: LayoutNode,
  paneId: string,
  sessionId: string,
): LayoutNode {
  if (tree.type === "pane") {
    if (tree.id !== paneId) return tree;
    return { ...tree, activeSessionId: sessionId };
  }
  return {
    ...tree,
    children: [
      setActivePaneSession(tree.children[0], paneId, sessionId),
      setActivePaneSession(tree.children[1], paneId, sessionId),
    ],
  };
}

/** Collect all pane nodes in DFS order. */
function collectPanes(node: LayoutNode): PaneNode[] {
  if (node.type === "pane") return [node];
  return [...collectPanes(node.children[0]), ...collectPanes(node.children[1])];
}

// ─── hook ───────────────────────────────────────────────────────────────────

export interface UseTerminalLayoutResult {
  root: LayoutNode;
  focusedPaneId: string | null;
  setFocusedPaneId: (id: string | null) => void;
  splitPane: (paneId: string, direction: SplitDirection) => string; // returns new pane id
  closePane: (paneId: string) => void;
  updateSizes: (nodeId: string, sizes: [number, number]) => void;
  addSessionToPane: (paneId: string, sessionId: string) => void;
  removeSessionFromPane: (paneId: string, sessionId: string) => void;
  setActiveSession: (paneId: string, sessionId: string) => void;
  pruneSessions: (liveSessions: Set<string>) => void;
  getPanes: () => PaneNode[];
  getPaneById: (paneId: string) => PaneNode | undefined;
  getFirstPaneId: () => string | null;
}

export function useTerminalLayout(): UseTerminalLayoutResult {
  const [root, setRoot] = useState<LayoutNode>(() => loadLayout() ?? defaultLayout());
  // Always-current ref so getter callbacks never close over a stale root
  const rootRef = useRef<LayoutNode>(root);
  useEffect(() => { rootRef.current = root; }, [root]);

  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(() => {
    const loaded = loadLayout() ?? defaultLayout();
    const panes = collectPanes(loaded);
    return panes[0]?.id ?? null;
  });

  const splitPane = useCallback(
    (paneId: string, direction: SplitDirection): string => {
      const newPane = newPaneNode();
      setRoot((prev) => {
        const target = collectPanes(prev).find((p) => p.id === paneId);
        if (!target) return prev;
        const splitNode: SplitNode = {
          type: "split",
          id: generateUUID(),
          direction,
          sizes: [50, 50],
          children: [target, newPane],
        };
        const next = replaceNode(prev, paneId, splitNode) ?? prev;
        saveLayout(next);
        return next;
      });
      setFocusedPaneId(newPane.id);
      return newPane.id;
    },
    [],
  );

  const closePaneFn = useCallback((paneId: string) => {
    setRoot((prev) => {
      const next = removePane(prev, paneId) ?? defaultLayout();
      saveLayout(next);
      return next;
    });
    setFocusedPaneId((prev) => (prev === paneId ? null : prev));
  }, []);

  const updateSizesFn = useCallback((nodeId: string, sizes: [number, number]) => {
    setRoot((prev) => {
      const next = updateSizesInTree(prev, nodeId, sizes);
      saveLayout(next);
      return next;
    });
  }, []);

  const addSession = useCallback((paneId: string, sessionId: string) => {
    setRoot((prev) => {
      const next = addSessionToPane(prev, paneId, sessionId);
      saveLayout(next);
      return next;
    });
  }, []);

  const removeSession = useCallback((paneId: string, sessionId: string) => {
    setRoot((prev) => {
      const next = removeSessionFromPane(prev, paneId, sessionId);
      saveLayout(next);
      return next;
    });
  }, []);

  const setActiveSession = useCallback((paneId: string, sessionId: string) => {
    setRoot((prev) => {
      const next = setActivePaneSession(prev, paneId, sessionId);
      saveLayout(next);
      return next;
    });
  }, []);

  const pruneSessions = useCallback((liveSessions: Set<string>) => {
    setRoot((prev) => {
      const pruned = pruneDeadSessions(prev, liveSessions);
      const collapsed = pruneEmptySplits(pruned) ?? defaultLayout();
      saveLayout(collapsed);
      return collapsed;
    });
  }, []);

  const getPanes = useCallback((): PaneNode[] => {
    return collectPanes(rootRef.current);
  }, []);

  const getPaneById = useCallback((paneId: string): PaneNode | undefined => {
    return collectPanes(rootRef.current).find((p) => p.id === paneId);
  }, []);

  const getFirstPaneId = useCallback((): string | null => {
    const panes = collectPanes(rootRef.current);
    return panes[0]?.id ?? null;
  }, []);

  return {
    root,
    focusedPaneId,
    setFocusedPaneId,
    splitPane,
    closePane: closePaneFn,
    updateSizes: updateSizesFn,
    addSessionToPane: addSession,
    removeSessionFromPane: removeSession,
    setActiveSession,
    pruneSessions,
    getPanes,
    getPaneById,
    getFirstPaneId,
  };
}

// Re-export tree helpers for use in PaneContainer
export { collectPanes, collectPaneIds };
