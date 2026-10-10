import { useMemo } from "react";
import type { Worktree } from "@/api/client.js";
import type { ProjectRef } from "@/api/ownership.js";
import {
  createProjectTargetSnapshot,
  projectScopeKey,
  useProjectTargetStore,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";

export function useProjectTarget(
  project: ProjectRef | string | null,
  worktree?: Worktree,
): ProjectTargetSnapshot | null {
  const selectedPath = useProjectTargetStore((state) => {
    if (!project) return null;
    return state.activeTargetByProject[projectScopeKey(project)] ?? null;
  });

  return useMemo(
    () =>
      project
        ? createProjectTargetSnapshot(project, selectedPath, worktree)
        : null,
    [project, selectedPath, worktree],
  );
}
