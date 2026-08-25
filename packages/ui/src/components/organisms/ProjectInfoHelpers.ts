import type { ProjectTargetRef, VcsRoot } from "@/api/client.js";

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

export function buildProjectInfoPushTarget(
  project: string,
  rootId: string,
  target?: ProjectTargetRef,
) {
  return buildProjectInfoPushTargetWithMode(project, rootId, false, target);
}

export function buildProjectInfoPushTargetWithMode(
  project: string,
  rootId: string,
  force: boolean,
  target?: ProjectTargetRef,
) {
  const targetFields =
    target?.worktreePath == null
      ? { project }
      : { project, worktreePath: target.worktreePath };
  const pushTarget =
    rootId === DEFAULT_GIT_ROOT_ID
      ? targetFields
      : { ...targetFields, root: rootId };
  return force ? { ...pushTarget, force: true } : pushTarget;
}

export function formatWorktreeRemovalBlockerMessage(
  dirtyTabs: number,
  liveTerminals: number,
): string | null {
  const blockers: string[] = [];
  if (dirtyTabs > 0) {
    blockers.push(`${dirtyTabs} dirty editor tab${dirtyTabs === 1 ? "" : "s"}`);
  }
  if (liveTerminals > 0) {
    blockers.push(
      `${liveTerminals} live terminal session${liveTerminals === 1 ? "" : "s"}`,
    );
  }
  if (blockers.length === 0) return null;
  return `Cannot remove this worktree: ${blockers.join(" and ")}. Save or close editor tabs and stop terminal sessions before retrying.`;
}
