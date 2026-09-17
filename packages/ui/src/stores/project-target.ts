import { create } from "zustand";
import {
  normalizeProjectTarget,
  projectKey,
  type ProjectRef,
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

export function projectScopeKey(project: string | ProjectRef): string {
  if (
    typeof project === "object" &&
    project !== null &&
    "profileId" in project &&
    Boolean(project.profileId)
  ) {
    return projectKey(project);
  }
  return typeof project === "string" ? project : project.project;
}

interface ProjectTargetState {
  /** Only non-root worktree paths are stored; absence means configured root. */
  activeTargetByProject: Record<string, string>;
  /** The last target replaced after discovery found it unavailable. */
  unavailableTargetByProject: Record<string, string>;
  /** All unavailable targets retained for orphan-session reconciliation. */
  unavailableTargetsByProject: Record<string, string[]>;
  selectTarget: (
    project: string | ProjectRef,
    worktreePath: string | null,
  ) => void;
  resetTarget: (project: string | ProjectRef) => void;
  markTargetUnavailable: (
    project: string | ProjectRef,
    worktreePath: string,
  ) => void;
  clearUnavailableTarget: (
    project: string | ProjectRef,
    worktreePath?: string,
  ) => void;
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
  project: string | ProjectRef,
  worktreePath: string | null | undefined,
  worktree?: Worktree,
): ProjectTargetSnapshot {
  const profileId =
    typeof project === "object" && project !== null && "profileId" in project
      ? project.profileId
      : undefined;
  const projectName = typeof project === "string" ? project : project.project;
  const target = normalizeProjectTarget(
    worktreePath == null
      ? (profileId
          ? { profileId, project: projectName }
          : { project: projectName })
      : (profileId
          ? { profileId, project: projectName, worktreePath }
          : { project: projectName, worktreePath }),
  );
  const targetPath = target.worktreePath;
  const isRoot = targetPath == null;

  if (targetPath == null) {
    return {
      project: projectName,
      target: profileId
        ? { profileId, project: projectName }
        : { project: projectName },
      targetKey: ROOT_TARGET_KEY,
      label: "Project root",
      isRoot: true,
      available: true,
      worktree,
    };
  }

  return {
    project: projectName,
    target,
    targetKey: worktreeTargetKey(projectName, targetPath),
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
      const key = projectScopeKey(project);
      if (worktreePath == null) {
        const next = { ...state.activeTargetByProject };
        delete next[key];
        return {
          activeTargetByProject: next,
        };
      }
      return {
        activeTargetByProject: {
          ...state.activeTargetByProject,
          [key]: worktreePath,
        },
      };
    }),
  resetTarget: (project) =>
    set((state) => {
      const key = projectScopeKey(project);
      const next = { ...state.activeTargetByProject };
      delete next[key];
      const nextUnavailable = { ...state.unavailableTargetByProject };
      delete nextUnavailable[key];
      const nextUnavailableTargets = { ...state.unavailableTargetsByProject };
      delete nextUnavailableTargets[key];
      return {
        activeTargetByProject: next,
        unavailableTargetByProject: nextUnavailable,
        unavailableTargetsByProject: nextUnavailableTargets,
      };
    }),
  markTargetUnavailable: (project, worktreePath) =>
    set((state) => {
      const key = projectScopeKey(project);
      const next = { ...state.activeTargetByProject };
      if (next[key] && sameWorktreePath(next[key], worktreePath)) {
        delete next[key];
      }
      const existing = state.unavailableTargetsByProject[key] ?? [];
      const targets = existing.some((path) =>
        sameWorktreePath(path, worktreePath),
      )
        ? existing
        : [...existing, worktreePath];
      return {
        activeTargetByProject: next,
        unavailableTargetByProject: {
          ...state.unavailableTargetByProject,
          [key]: worktreePath,
        },
        unavailableTargetsByProject: {
          ...state.unavailableTargetsByProject,
          [key]: targets,
        },
      };
    }),
  clearUnavailableTarget: (project, worktreePath) =>
    set((state) => {
      const key = projectScopeKey(project);
      if (!(key in state.unavailableTargetByProject)) return state;
      if (worktreePath == null) {
        const next = { ...state.unavailableTargetByProject };
        const nextTargets = { ...state.unavailableTargetsByProject };
        delete next[key];
        delete nextTargets[key];
        return {
          unavailableTargetByProject: next,
          unavailableTargetsByProject: nextTargets,
        };
      }

      const remaining = (
        state.unavailableTargetsByProject[key] ?? []
      ).filter((path) => !sameWorktreePath(path, worktreePath));
      const next = { ...state.unavailableTargetByProject };
      const nextTargets = { ...state.unavailableTargetsByProject };
      if (remaining.length === 0) {
        delete next[key];
        delete nextTargets[key];
      } else {
        nextTargets[key] = remaining;
        if (next[key] && sameWorktreePath(next[key], worktreePath)) {
          next[key] = remaining[remaining.length - 1]!;
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
  const projectInput = normalized.profileId
    ? { profileId: normalized.profileId, project: normalized.project }
    : normalized.project;
  useProjectTargetStore
    .getState()
    .markTargetUnavailable(projectInput, normalized.worktreePath);
}
