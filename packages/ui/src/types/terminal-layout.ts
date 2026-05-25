// Layout data model for recursive binary-tree split panel layout.
// Persisted in localStorage under key "dam-hopper:terminal-layout".

export type SplitDirection = "horizontal" | "vertical";
export type DockEdge = "top" | "bottom" | "left" | "right";

export interface SplitNode {
  type: "split";
  id: string; // stable UUID for this split node
  direction: SplitDirection;
  sizes: [number, number]; // percentages, must sum to 100
  children: [LayoutNode, LayoutNode]; // always binary
}

export interface PaneNode {
  type: "pane";
  id: string; // stable pane UUID, NOT sessionId
  sessionIds: string[];
  activeSessionId: string | null;
}

export type LayoutNode = SplitNode | PaneNode;

export type DockTarget =
  | { kind: "pane-center"; paneId: string }
  | { kind: "pane-edge"; paneId: string; edge: DockEdge }
  | { kind: "tab-index"; paneId: string; index: number };

export interface PersistedLayout {
  version: 1;
  root: LayoutNode;
}
