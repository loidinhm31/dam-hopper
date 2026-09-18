import { useMemo } from "react";
import type { Worktree } from "@/api/client.js";
import { projectKey, type ProjectRef } from "@/api/ownership.js";
import {
  createProjectTargetSnapshot,
  useProjectTargetStore,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";

export function useProjectTarget(
  project: ProjectRef | string | null,
  worktree?: Worktree,
): ProjectTargetSnapshot | null {
  const selectedPath = useProjectTargetStore((state) => {
    if (!project) return null;
    if (typeof project === "string") return state.activeTargetByProject[project] ?? null;
    const scopedKey = project.profileId ? projectKey(project) : null;
    return (
      (scopedKey ? state.activeTargetByProject[scopedKey] : null) ??
      state.activeTargetByProject[project.project] ??
      null
    );
  });

  return useMemo(
    () =>
      project
        ? createProjectTargetSnapshot(project, selectedPath, worktree)
        : null,
    [project, selectedPath, worktree],
  );
}
