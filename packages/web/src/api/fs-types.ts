/**
 * FS types — mirrors server JSON shapes.
 * Duplication is intentional; web package must not import server crates.
 */

/** Single node in the file tree. id = path relative to subscribed root. */
export interface FsArborNode {
  id: string;
  name: string;
  kind: "file" | "dir";
  size: number;
  /** Unix seconds */
  mtime: number;
  isSymlink: boolean;
  /**
   * null  = dir whose children haven't been loaded yet
   * []    = empty dir (loaded)
   * [...] = loaded children
   */
  children: FsArborNode[] | null;
}

/** TanStack Query cache shape for ['fs-tree', project, path]. */
export interface FsTreeData {
  sub_id: number;
  nodes: FsArborNode[];
}

/** FS event pushed from server via fs:event WS message. Paths are absolute. */
export interface FsEventDto {
  kind: string;
  path: string;
  from?: string;
}

/** Entry returned by GET /api/fs/list */
export interface DirEntry {
  name: string;
  kind: "file" | "dir";
  size: number;
  mtime: number;
  isSymlink: boolean;
}

export interface FsListResponse {
  entries: DirEntry[];
}

export interface FsFileStat {
  kind: "file" | "dir";
  size: number;
  mtime: number;
  mime?: string;
  isBinary: boolean;
}

/** Raw TreeNode shape sent by the server in fs:tree_snapshot.nodes (camelCase from Rust serde). */
export interface ServerTreeNode {
  path: string;
  name: string;
  kind: string;
  size: number;
  mtime: number;
  isSymlink: boolean;
}

export interface HealthResponse {
  status: string;
  version: string;
  features: {
    ide_explorer: boolean;
  };
}

export interface FsOpResult {
  ok: boolean;
  error?: string;
}

export interface FsUploadResult {
  ok: boolean;
  newMtime?: number;
  error?: string;
}
