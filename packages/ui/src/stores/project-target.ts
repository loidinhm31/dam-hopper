import { create } from "zustand";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetRef,
  type Worktree,
} from "@/api/client.js";

export const ROOT_TARGET_KEY = "root";

export interface ProjectTargetSnapshot {
  project: string;
  target: ProjectTargetRef;
  targetKey: string;
  label: string;
  isRoot: boolean;
  available: boolean;
  worktree?: Worktree;
}

interface ProjectTargetState {
  /** Only non-root worktree paths are stored; absence means configured root. */
  activeTargetByProject: Record<string, string>;
  /** The last target automatically replaced after discovery found it unavailable. */
  unavailableTargetByProject: Record<string, string>;
  selectTarget: (project: string, worktreePath: string | null) => void;
  resetTarget: (project: string) => void;
  markTargetUnavailable: (project: string, worktreePath: string) => void;
  clearUnavailableTarget: (project: string) => void;
}

export function worktreeTargetKey(project: string, worktreePath: string) {
  return projectTargetCacheKey({ project, worktreePath });
}

export function isSelectableWorktree(worktree: Worktree) {
  return worktree.isAvailable && !worktree.isPrunable;
}

export function worktreeStatusLabel(worktree: Worktree) {
  if (worktree.isPrunable) return "Prunable — unavailable";
  if (!worktree.isAvailable) {
    return worktree.isBare ? "Bare — unavailable" : "Unavailable";
  }

  const details = [
    worktree.isDetached ? "Detached" : null,
    worktree.isLocked ? "Locked" : null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join(" · ") : "Available";
}

export function createProjectTargetSnapshot(
  project: string,
  worktreePath: string | null | undefined,
  worktree?: Worktree,
): ProjectTargetSnapshot {
  const target = normalizeProjectTarget(
    worktreePath == null ? { project } : { project, worktreePath },
  );
  const targetPath = target.worktreePath;
  const isRoot = targetPath == null;

  if (targetPath == null) {
    return {
      project,
      target: { project },
      targetKey: ROOT_TARGET_KEY,
      label: "Project root",
      isRoot: true,
      available: true,
      worktree,
    };
  }

  return {
    project,
    target,
    targetKey: worktreeTargetKey(project, targetPath),
    label: worktree?.branch || targetPath,
    isRoot,
    available: worktree != null && isSelectableWorktree(worktree),
    worktree,
  };
}

export const useProjectTargetStore = create<ProjectTargetState>((set) => ({
  activeTargetByProject: {},
  unavailableTargetByProject: {},
  selectTarget: (project, worktreePath) =>
    set((state) => {
      const nextUnavailable = { ...state.unavailableTargetByProject };
      delete nextUnavailable[project];
      if (worktreePath == null) {
        const next = { ...state.activeTargetByProject };
        delete next[project];
        return {
          activeTargetByProject: next,
          unavailableTargetByProject: nextUnavailable,
        };
      }
      return {
        activeTargetByProject: {
          ...state.activeTargetByProject,
          [project]: worktreePath,
        },
        unavailableTargetByProject: nextUnavailable,
      };
    }),
  resetTarget: (project) =>
    set((state) => {
      const next = { ...state.activeTargetByProject };
      delete next[project];
      const nextUnavailable = { ...state.unavailableTargetByProject };
      delete nextUnavailable[project];
      return {
        activeTargetByProject: next,
        unavailableTargetByProject: nextUnavailable,
      };
    }),
  markTargetUnavailable: (project, worktreePath) =>
    set((state) => {
      if (state.activeTargetByProject[project] !== worktreePath) {
        return state;
      }

      const next = { ...state.activeTargetByProject };
      delete next[project];
      return {
        activeTargetByProject: next,
        unavailableTargetByProject: {
          ...state.unavailableTargetByProject,
          [project]: worktreePath,
        },
      };
    }),
  clearUnavailableTarget: (project) =>
    set((state) => {
      if (!(project in state.unavailableTargetByProject)) return state;
      const next = { ...state.unavailableTargetByProject };
      delete next[project];
      return { unavailableTargetByProject: next };
    }),
}));
