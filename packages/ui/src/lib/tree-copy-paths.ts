/**
 * Compute clipboard-friendly paths for an Explorer tree node.
 *
 * - `projectRoot`: absolute project root (from `useProject(name).data.path`;
 *   the server canonicalizes project paths).
 * - `subPath`: FileTree `path` prop — relative to project root; "" or "." = root.
 * - `nodeId`: `node.id` — relative to the subscribed root, which equals the
 *   project root when `subPath` is empty.
 */

export interface TreeCopyPaths {
  absolutePath: string;
  relativePath: string;
}

function normalizeSegment(seg: string): string {
  return seg.replace(/^[/\\]+|[/\\]+$/g, "").trim();
}

/** Join `subPath` and `nodeId` into a single forward-slash project-relative path. */
export function joinRelativePath(subPath: string, nodeId: string): string {
  const parts: string[] = [];
  const sub = normalizeSegment(subPath);
  if (sub && sub !== ".") parts.push(sub);
  const node = normalizeSegment(nodeId);
  if (node && node !== ".") parts.push(node);
  return parts.join("/");
}

/** Detect the native path separator from an absolute project root. */
function detectSeparator(root: string): string {
  // Windows roots use backslashes; prefer backslash unless the root already
  // mixes forward slashes (e.g. a POSIX-style absolute path on the same string).
  return root.includes("\\") && !root.includes("/") ? "\\" : "/";
}

export function buildTreeCopyPaths(args: {
  projectRoot: string;
  subPath: string;
  nodeId: string;
}): TreeCopyPaths {
  const { projectRoot, subPath, nodeId } = args;
  // relativePath is always forward-slash (POSIX) — cross-tool compatible.
  const relativePath = joinRelativePath(subPath, nodeId);
  const trimmedRoot = projectRoot.replace(/[/\\]+$/, "");

  let absolutePath: string;
  if (!trimmedRoot) {
    // No project root known — fall back to the relative path (no leading slash).
    absolutePath = relativePath;
  } else if (!relativePath) {
    absolutePath = trimmedRoot;
  } else {
    const sep = detectSeparator(trimmedRoot);
    const nativeRelative =
      sep === "\\" ? relativePath.replace(/\//g, "\\") : relativePath;
    absolutePath = `${trimmedRoot}${sep}${nativeRelative}`;
  }
  return { absolutePath, relativePath };
}
