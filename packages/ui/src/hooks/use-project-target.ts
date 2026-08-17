import { useMemo } from "react";
import type { Worktree } from "@/api/client.js";
import {
  createProjectTargetSnapshot,
  useProjectTargetStore,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";

export function useProjectTarget(
  project: string | null,
  worktree?: Worktree,
): ProjectTargetSnapshot | null {
  const selectedPath = useProjectTargetStore((state) =>
    project ? (state.activeTargetByProject[project] ?? null) : null,
  );

  return useMemo(
    () =>
      project
        ? createProjectTargetSnapshot(project, selectedPath, worktree)
        : null,
    [project, selectedPath, worktree],
  );
}
