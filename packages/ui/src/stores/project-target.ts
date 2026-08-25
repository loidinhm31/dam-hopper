import { create } from "zustand";
import {
  normalizeProjectTarget,
  type ProjectTargetRef,
  type ProjectTargetInput,
  type Worktree,
} from "@/api/client.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

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
  /** The last target replaced after discovery found it unavailable. */
  unavailableTargetByProject: Record<string, string>;
  /** All unavailable targets retained for orphan-session reconciliation. */
  unavailableTargetsByProject: Record<string, string[]>;
  selectTarget: (project: string, worktreePath: string | null) => void;
  resetTarget: (project: string) => void;
  markTargetUnavailable: (project: string, worktreePath: string) => void;
  clearUnavailableTarget: (project: string, worktreePath?: string) => void;
}

export function worktreeTargetKey(_project: string, worktreePath: string) {
  return `worktree:${normalizeProjectTargetPath(worktreePath)}`;
}

export const normalizeWorktreePath = normalizeProjectTargetPath;

function sameWorktreePath(left: string, right: string): boolean {
  return normalizeProjectTargetPath(left) === normalizeProjectTargetPath(right);
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
  unavailableTargetsByProject: {},
  selectTarget: (project, worktreePath) =>
    set((state) => {
      if (worktreePath == null) {
        const next = { ...state.activeTargetByProject };
        delete next[project];
        return {
          activeTargetByProject: next,
        };
      }
      return {
        activeTargetByProject: {
          ...state.activeTargetByProject,
          [project]: worktreePath,
        },
      };
    }),
  resetTarget: (project) =>
    set((state) => {
      const next = { ...state.activeTargetByProject };
      delete next[project];
      const nextUnavailable = { ...state.unavailableTargetByProject };
      delete nextUnavailable[project];
      const nextUnavailableTargets = { ...state.unavailableTargetsByProject };
      delete nextUnavailableTargets[project];
      return {
        activeTargetByProject: next,
        unavailableTargetByProject: nextUnavailable,
        unavailableTargetsByProject: nextUnavailableTargets,
      };
    }),
  markTargetUnavailable: (project, worktreePath) =>
    set((state) => {
      const next = { ...state.activeTargetByProject };
      if (next[project] && sameWorktreePath(next[project], worktreePath)) {
        delete next[project];
      }
      const existing = state.unavailableTargetsByProject[project] ?? [];
      const targets = existing.some((path) =>
        sameWorktreePath(path, worktreePath),
      )
        ? existing
        : [...existing, worktreePath];
      return {
        activeTargetByProject: next,
        unavailableTargetByProject: {
          ...state.unavailableTargetByProject,
          [project]: worktreePath,
        },
        unavailableTargetsByProject: {
          ...state.unavailableTargetsByProject,
          [project]: targets,
        },
      };
    }),
  clearUnavailableTarget: (project, worktreePath) =>
    set((state) => {
      if (!(project in state.unavailableTargetByProject)) return state;
      if (worktreePath == null) {
        const next = { ...state.unavailableTargetByProject };
        const nextTargets = { ...state.unavailableTargetsByProject };
        delete next[project];
        delete nextTargets[project];
        return {
          unavailableTargetByProject: next,
          unavailableTargetsByProject: nextTargets,
        };
      }

      const remaining = (
        state.unavailableTargetsByProject[project] ?? []
      ).filter((path) => !sameWorktreePath(path, worktreePath));
      const next = { ...state.unavailableTargetByProject };
      const nextTargets = { ...state.unavailableTargetsByProject };
      if (remaining.length === 0) {
        delete next[project];
        delete nextTargets[project];
      } else {
        nextTargets[project] = remaining;
        if (next[project] && sameWorktreePath(next[project], worktreePath)) {
          next[project] = remaining[remaining.length - 1]!;
        }
      }
      return {
        unavailableTargetByProject: next,
        unavailableTargetsByProject: nextTargets,
      };
    }),
}));

/** Persist target loss even when the worktree panel is not mounted. */
export function markProjectTargetUnavailable(target: ProjectTargetInput): void {
  const normalized = normalizeProjectTarget(target);
  if (normalized.worktreePath == null) return;
  useProjectTargetStore
    .getState()
    .markTargetUnavailable(normalized.project, normalized.worktreePath);
}
