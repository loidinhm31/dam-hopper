import type {
  ExplorerLanguageFilter,
  FsArborNode,
  LanguageFile,
} from "@/api/fs-types.js";

/** A path segment is valid only when it stays relative to the project root. */
export function normalizeExplorerLanguagePath(path: string): string[] | null {
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.includes("\0")
  ) {
    return null;
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments;
}

function compareNodes(left: FsArborNode, right: FsArborNode): number {
  if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
  const byName = compareCaseInsensitive(left.name, right.name);
  return byName || compareCaseInsensitive(left.id, right.id);
}

/** Use code-unit ordering so scan navigation is identical in every UI locale. */
function compareCaseInsensitive(left: string, right: string): number {
  const leftFolded = left.toLowerCase();
  const rightFolded = right.toLowerCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Build a complete, navigation-only Arborist hierarchy from scan metadata.
 *
 * The source response is never mutated. Invalid paths are ignored defensively
 * even though the server validates them, since this function sits at a trust
 * boundary before IDs are handed to file-system operations.
 */
export function buildExplorerLanguageTree(
  files: readonly LanguageFile[],
  filter: Exclude<ExplorerLanguageFilter, "all">,
  showHidden: boolean,
): FsArborNode[] {
  const roots: FsArborNode[] = [];
  const byPath = new Map<string, FsArborNode>();

  for (const file of files) {
    if (file.language !== filter) continue;
    const segments = normalizeExplorerLanguagePath(file.path);
    if (!segments) continue;
    if (!showHidden && segments.some((segment) => segment.startsWith("."))) {
      continue;
    }

    let parentChildren = roots;
    let parentPath = "";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const nodePath = parentPath ? `${parentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let node = byPath.get(nodePath);

      if (!node) {
        node = isFile
          ? {
              id: nodePath,
              name: segment,
              kind: "file",
              size: file.size,
              mtime: file.mtime,
              isSymlink: false,
              children: null,
            }
          : {
              id: nodePath,
              name: segment,
              kind: "dir",
              size: 0,
              mtime: 0,
              isSymlink: false,
              children: [],
            };
        byPath.set(nodePath, node);
        parentChildren.push(node);
      } else if (isFile && node.kind === "file") {
        // Duplicate scan entries are harmless; retain the first exact metadata
        // so hierarchy construction remains deterministic and source-immutable.
        parentPath = nodePath;
        parentChildren = node.children ?? [];
        continue;
      } else if (isFile) {
        // A malformed response cannot make a directory executable as a file.
        break;
      }

      if (!isFile) {
        parentPath = nodePath;
        parentChildren = node.children ?? [];
      }
    }
  }

  function sort(nodes: FsArborNode[]) {
    nodes.sort(compareNodes);
    for (const node of nodes) {
      if (node.children) sort(node.children);
    }
  }
  sort(roots);
  return roots;
}

export function collectExplorerLanguageTreeIds(
  nodes: readonly FsArborNode[],
): Set<string> {
  const ids = new Set<string>();
  const visit = (entries: readonly FsArborNode[]) => {
    for (const node of entries) {
      ids.add(node.id);
      if (node.children) visit(node.children);
    }
  };
  visit(nodes);
  return ids;
}
