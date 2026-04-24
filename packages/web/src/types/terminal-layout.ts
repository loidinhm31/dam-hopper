// Layout data model for recursive binary-tree split panel layout.
// Persisted in localStorage under key "dam-hopper:terminal-layout".

export type SplitDirection = "horizontal" | "vertical";

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

export interface PersistedLayout {
  version: 1;
  root: LayoutNode;
}
