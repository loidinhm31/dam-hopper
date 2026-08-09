import type { TreeApi } from "react-arborist";
import type { FsArborNode } from "@/api/fs-types.js";

export interface FileTreeRevealRequest {
  project: string;
  path: string;
  nonce: number;
}

interface RevealFileTreePathOptions {
  path: string;
  nodes: FsArborNode[];
  tree: Pick<
    TreeApi<FsArborNode>,
    "focus" | "openParents" | "scrollTo" | "select"
  >;
  loadChildren: (nodeId: string) => Promise<FsArborNode[]>;
  /** Live-tree render revision before a lazy child request starts. */
  getTreeCommitVersion?: () => number;
  /** Resolves after Arborist has committed a render newer than `version`. */
  waitForTreeCommitAfter?: (version: number) => Promise<void>;
}

export function getAncestorDirectoryIds(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function replaceNodeChildren(
  nodes: FsArborNode[],
  targetId: string,
  children: FsArborNode[],
): FsArborNode[] {
  return nodes.map((node) => {
    if (node.id === targetId) return { ...node, children };
    if (!node.children || node.children.length === 0) return node;
    return {
      ...node,
      children: replaceNodeChildren(node.children, targetId, children),
    };
  });
}

export function findNodeById(
  nodes: readonly FsArborNode[],
  targetId: string,
): FsArborNode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (!node.children || node.children.length === 0) continue;
    const nested = findNodeById(node.children, targetId);
    if (nested) return nested;
  }
  return null;
}

export async function revealFileTreePath({
  path,
  nodes: initialNodes,
  tree,
  loadChildren,
  getTreeCommitVersion,
  waitForTreeCommitAfter,
}: RevealFileTreePathOptions) {
  try {
    let nodes = initialNodes;

    for (const ancestorId of getAncestorDirectoryIds(path)) {
      const ancestor = findNodeById(nodes, ancestorId);
      if (!ancestor || ancestor.kind !== "dir") return false;
      if (ancestor.children !== null) continue;
      const commitVersion = getTreeCommitVersion?.();
      const children = await loadChildren(ancestorId);
      nodes = replaceNodeChildren(nodes, ancestorId, children);
      if (commitVersion !== undefined && waitForTreeCommitAfter) {
        await waitForTreeCommitAfter(commitVersion);
      }
    }

    const target = findNodeById(nodes, path);
    if (!target) return false;

    tree.openParents(path);
    tree.select(path);
    tree.focus(path, { scroll: false });
    await Promise.resolve(tree.scrollTo(path));
    return true;
  } catch {
    return false;
  }
}
