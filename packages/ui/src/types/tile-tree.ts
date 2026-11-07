export type SplitDirection = "horizontal" | "vertical";
export type DockEdge = "top" | "bottom" | "left" | "right";

export interface TileSplitNode<T> {
  type: "split";
  id: string; // stable UUID for this split node
  direction: SplitDirection;
  sizes: [number, number]; // percentages, must sum to 100
  children: [TileNode<T>, TileNode<T>]; // binary split
}

export interface TilePaneNode<T> {
  type: "pane";
  id: string; // stable pane UUID
  items: T[];
  active: T | null;
}

export type TileNode<T> = TileSplitNode<T> | TilePaneNode<T>;

export type TileDockTarget =
  | { kind: "pane-center"; paneId: string }
  | { kind: "pane-edge"; paneId: string; edge: DockEdge }
  | { kind: "tab-index"; paneId: string; index: number };

export interface PersistedTileTree<T> {
  version: 1;
  root: TileNode<T>;
}
