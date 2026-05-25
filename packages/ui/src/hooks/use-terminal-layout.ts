import { useState, useCallback, useRef, useEffect } from "react";
import type {
  DockTarget,
  LayoutNode,
  PaneNode,
  PersistedLayout,
  SplitDirection,
  SplitNode,
} from "@/types/terminal-layout.js";
import {
  addSessionToPane,
  dockSessionInLayout,
  moveTabBetweenPanes,
  removeSessionFromPane,
  setActivePaneSession,
} from "@/lib/terminal-layout-docking.js";
import {
  collectPaneIds,
  collectPanes,
  createSplitNode,
  findPaneById,
  loadPersistedLayout,
  newPaneNode,
  pruneDeadSessions,
  pruneEmptySplits,
  removePane,
  replaceNode,
  updateSizesInTree,
} from "@/lib/terminal-layout-tree.js";

const STORAGE_KEY = "dam-hopper:terminal-layout";

function defaultLayout(): LayoutNode {
  return newPaneNode();
}

/** Defensively parse layout from localStorage. Returns null on any invalid data. */
function loadLayout(): LayoutNode | null {
  try {
    return loadPersistedLayout(localStorage.getItem(STORAGE_KEY));
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
  moveTabToPane: (
    sessionId: string,
    fromPaneId: string,
    toPaneId: string,
  ) => void;
  dockSession: (
    sessionId: string,
    sourcePaneId: string,
    target: DockTarget,
  ) => boolean;
  pruneSessions: (liveSessions: Set<string>) => void;
  getPanes: () => PaneNode[];
  getPaneById: (paneId: string) => PaneNode | undefined;
  getFirstPaneId: () => string | null;
}

export function useTerminalLayout(): UseTerminalLayoutResult {
  // ── Sync initialization: ensure root and focus use the SAME instance ────
  const [initialData] = useState(() => {
    const r = loadLayout() ?? defaultLayout();
    return {
      root: r,
      focus: collectPanes(r)[0]?.id ?? null,
    };
  });

  const [root, setRoot] = useState<LayoutNode>(initialData.root);
  // Always-current ref so getter callbacks never close over a stale root
  const rootRef = useRef<LayoutNode>(root);
  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(
    initialData.focus,
  );

  const splitPane = useCallback(
    (paneId: string, direction: SplitDirection): string => {
      const newPane = newPaneNode();
      setRoot((prev) => {
        const target = findPaneById(prev, paneId);
        if (!target) return prev;
        const splitNode: SplitNode = createSplitNode(target, direction, [
          target,
          newPane,
        ]);
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

  const updateSizesFn = useCallback(
    (nodeId: string, sizes: [number, number]) => {
      setRoot((prev) => {
        const next = updateSizesInTree(prev, nodeId, sizes);
        saveLayout(next);
        return next;
      });
    },
    [],
  );

  const addSession = useCallback((paneId: string, sessionId: string) => {
    setRoot((prev) => {
      const target = findPaneById(prev, paneId);
      if (
        target &&
        target.sessionIds.includes(sessionId) &&
        target.activeSessionId === sessionId
      ) {
        return prev;
      }
      const next = addSessionToPane(prev, paneId, sessionId);
      if (next === prev) return prev;
      saveLayout(next);
      return next;
    });
  }, []);

  const removeSession = useCallback((paneId: string, sessionId: string) => {
    setRoot((prev) => {
      const next = removeSessionFromPane(prev, paneId, sessionId);
      if (next === prev) return prev;
      saveLayout(next);
      return next;
    });
  }, []);

  const setActiveSession = useCallback((paneId: string, sessionId: string) => {
    setRoot((prev) => {
      const target = findPaneById(prev, paneId);
      if (target && target.activeSessionId === sessionId) {
        return prev;
      }
      const next = setActivePaneSession(prev, paneId, sessionId);
      if (next === prev) return prev;
      saveLayout(next);
      return next;
    });
  }, []);

  const moveTabToPane = useCallback(
    (sessionId: string, fromPaneId: string, toPaneId: string) => {
      setRoot((prev) => {
        const next = moveTabBetweenPanes(prev, sessionId, fromPaneId, toPaneId);
        saveLayout(next);
        return next;
      });
    },
    [],
  );

  const dockSession = useCallback(
    (sessionId: string, sourcePaneId: string, target: DockTarget) => {
      const result = dockSessionInLayout(
        rootRef.current,
        sessionId,
        sourcePaneId,
        target,
      );
      if (!result.changed) return false;
      rootRef.current = result.root;
      saveLayout(result.root);
      setRoot(result.root);
      setFocusedPaneId(result.focusedPaneId);
      return true;
    },
    [],
  );

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
    return findPaneById(rootRef.current, paneId);
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
    moveTabToPane,
    dockSession,
    pruneSessions,
    getPanes,
    getPaneById,
    getFirstPaneId,
  };
}

// Re-export tree helpers for use in PaneContainer
export { collectPanes, collectPaneIds };
