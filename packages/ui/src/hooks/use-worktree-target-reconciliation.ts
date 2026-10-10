import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Worktree } from "@/api/client.js";
import type { ProjectRef } from "@/api/ownership.js";
import {
  isSelectableWorktree,
  projectScopeKey,
  useProjectTargetStore,
  worktreeTargetKey,
} from "@/stores/project-target.js";
import { useEditorStore } from "@/stores/editor.js";

const EMPTY_UNAVAILABLE_TARGET_PATHS: string[] = [];

export function recoveredTargetPaths(
  projectName: string,
  unavailablePaths: readonly string[],
  worktrees: ReadonlyArray<Worktree> | undefined,
): string[] {
  return unavailablePaths.filter((path) =>
    worktrees?.some(
      (worktree) =>
        worktreeTargetKey(projectName, worktree.path) ===
          worktreeTargetKey(projectName, path) &&
        isSelectableWorktree(worktree),
    ),
  );
}

export interface UseWorktreeTargetReconciliationOptions {
  projectName: string;
  projectScope: string | ProjectRef;
  worktrees: ReadonlyArray<Worktree> | undefined;
  selectedPath: string | null;
  dataUpdatedAt: number;
  isFetched: boolean;
  isFetching: boolean;
  isError: boolean;
  enabled?: boolean;
}

export interface UseWorktreeTargetReconciliationResult {
  unavailableTargetPaths: string[];
  isCurrentTargetUnavailable: boolean;
  fallbackNotice: string | null;
  selectedWorktree: Worktree | undefined;
  markTargetAsUnavailable: (path: string) => void;
  markTargetAsAvailable: (path: string) => void;
  reconcileRecoveredTargets: (latestWorktrees: ReadonlyArray<Worktree>) => void;
  pendingUnavailableRecovery: MutableRefObject<Set<string>>;
}

export function useWorktreeTargetReconciliation({
  projectName,
  projectScope,
  worktrees,
  selectedPath,
  dataUpdatedAt,
  isFetched,
  isFetching,
  isError,
  enabled = true,
}: UseWorktreeTargetReconciliationOptions): UseWorktreeTargetReconciliationResult {
  const projectScopeStr = projectScopeKey(projectScope);
  const markTargetUnavailable = useProjectTargetStore(
    (state) => state.markTargetUnavailable,
  );
  const clearUnavailableTarget = useProjectTargetStore(
    (state) => state.clearUnavailableTarget,
  );
  const markEditorTargetUnavailable = useEditorStore(
    (state) => state.markTargetUnavailable,
  );
  const markEditorTargetAvailable = useEditorStore(
    (state) => state.markTargetAvailable,
  );
  const unavailableTargetPaths = useProjectTargetStore(
    (state) =>
      state.unavailableTargetsByProject[projectScopeStr] ??
      EMPTY_UNAVAILABLE_TARGET_PATHS,
  );

  const pendingUnavailableRecovery = useRef(new Set<string>());
  const unavailableDiscoveryVersions = useRef(new Map<string, number>());

  const selectedWorktree = useMemo(() => {
    if (selectedPath == null || !worktrees) return undefined;
    return worktrees.find(
      (worktree) =>
        worktreeTargetKey(projectName, worktree.path) ===
        worktreeTargetKey(projectName, selectedPath),
    );
  }, [projectName, selectedPath, worktrees]);

  const isCurrentTargetUnavailable = useMemo(() => {
    if (selectedPath == null) return false;
    return unavailableTargetPaths.some(
      (path) =>
        worktreeTargetKey(projectName, path) ===
        worktreeTargetKey(projectName, selectedPath),
    );
  }, [projectName, selectedPath, unavailableTargetPaths]);

  const fallbackNotice = useMemo(() => {
    if (unavailableTargetPaths.length === 0) return null;
    if (unavailableTargetPaths.length === 1) {
      return `Worktree ${unavailableTargetPaths[0]} is unavailable. Using Project root for new operations.`;
    }
    return `${unavailableTargetPaths.length} worktrees are unavailable. Using Project root for new operations.`;
  }, [unavailableTargetPaths]);

  useEffect(() => {
    const activeKeys = new Set(
      unavailableTargetPaths.map((path) =>
        worktreeTargetKey(projectName, path),
      ),
    );
    for (const path of unavailableTargetPaths) {
      const key = worktreeTargetKey(projectName, path);
      if (!unavailableDiscoveryVersions.current.has(key)) {
        unavailableDiscoveryVersions.current.set(key, dataUpdatedAt);
      }
    }
    for (const key of unavailableDiscoveryVersions.current.keys()) {
      if (!activeKeys.has(key)) {
        unavailableDiscoveryVersions.current.delete(key);
      }
    }
  }, [dataUpdatedAt, projectName, unavailableTargetPaths]);

  useEffect(() => {
    if (!enabled || !isFetched || isFetching || isError) return;
    for (const path of recoveredTargetPaths(
      projectName,
      unavailableTargetPaths,
      worktrees,
    ).filter(
      (candidate) =>
        dataUpdatedAt >
        (unavailableDiscoveryVersions.current.get(
          worktreeTargetKey(projectName, candidate),
        ) ?? dataUpdatedAt),
    )) {
      const key = worktreeTargetKey(projectName, path);
      if (pendingUnavailableRecovery.current.has(key)) {
        continue;
      }
      markEditorTargetAvailable(projectScope, path);
      clearUnavailableTarget(projectScope, path);
    }
    if (
      selectedPath == null ||
      (selectedWorktree && isSelectableWorktree(selectedWorktree))
    ) {
      return;
    }
    markEditorTargetUnavailable(projectScope, selectedPath);
    markTargetUnavailable(projectScope, selectedPath);
  }, [
    clearUnavailableTarget,
    dataUpdatedAt,
    enabled,
    isError,
    isFetching,
    isFetched,
    markEditorTargetAvailable,
    markEditorTargetUnavailable,
    markTargetUnavailable,
    projectName,
    projectScope,
    selectedPath,
    selectedWorktree,
    unavailableTargetPaths,
    worktrees,
  ]);

  const markTargetAsUnavailable = useCallback(
    (path: string) => {
      markEditorTargetUnavailable(projectScope, path);
      markTargetUnavailable(projectScope, path);
    },
    [markEditorTargetUnavailable, markTargetUnavailable, projectScope],
  );

  const markTargetAsAvailable = useCallback(
    (path: string) => {
      markEditorTargetAvailable(projectScope, path);
      clearUnavailableTarget(projectScope, path);
    },
    [clearUnavailableTarget, markEditorTargetAvailable, projectScope],
  );

  const reconcileRecoveredTargets = useCallback(
    (latestWorktrees: ReadonlyArray<Worktree>) => {
      for (const path of recoveredTargetPaths(
        projectName,
        unavailableTargetPaths,
        latestWorktrees,
      )) {
        markEditorTargetAvailable(projectScope, path);
        clearUnavailableTarget(projectScope, path);
      }
    },
    [clearUnavailableTarget, markEditorTargetAvailable, projectName, projectScope, unavailableTargetPaths],
  );

  return {
    unavailableTargetPaths,
    isCurrentTargetUnavailable,
    fallbackNotice,
    selectedWorktree,
    markTargetAsUnavailable,
    markTargetAsAvailable,
    reconcileRecoveredTargets,
    pendingUnavailableRecovery,
  };
}
