import type { VcsRoot } from "@/api/client.js";

export const DEFAULT_GIT_ROOT_ID = ".";

export function projectInfoRootOptions(roots: VcsRoot[]): VcsRoot[] {
  return roots.length > 0
    ? roots
    : [
        {
          rootId: DEFAULT_GIT_ROOT_ID,
          path: ".",
          absolutePath: "",
          kind: "primary" as const,
          warnings: [],
        },
      ];
}

export function formatProjectInfoRootLabel(root: VcsRoot) {
  return root.rootId === DEFAULT_GIT_ROOT_ID ? "Project root" : root.path;
}

export function describeProjectInfoRoot(root: VcsRoot) {
  if (root.kind === "primary") return "Primary";
  if (root.mappingState === "uninitialized") return "Uninitialized";
  if (root.mappingState === "missing") return "Missing mapping";
  if (root.mappingState === "unmapped") return "Unmapped";
  return root.kind === "submodule" ? "Submodule" : "Nested repo";
}

export function buildProjectInfoPushTarget(project: string, rootId: string) {
  return buildProjectInfoPushTargetWithMode(project, rootId, false);
}

export function buildProjectInfoPushTargetWithMode(
  project: string,
  rootId: string,
  force: boolean,
) {
  const target =
    rootId === DEFAULT_GIT_ROOT_ID ? { project } : { project, root: rootId };
  return force ? { ...target, force: true } : target;
}
