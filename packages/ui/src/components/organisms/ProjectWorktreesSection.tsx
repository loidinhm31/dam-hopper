import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  useRemoveWorktree,
  useTerminalSessions,
  useWorktrees,
} from "@/api/queries.js";
import { isProjectTargetError, type Worktree } from "@/api/client.js";
import { Button } from "@/components/atoms/Button.js";
import { ProjectTargetSelector } from "@/components/organisms/ProjectTargetSelector.js";
import {
  isSelectableWorktree,
  useProjectTargetStore,
  type ProjectTargetSnapshot,
  worktreeTargetKey,
} from "@/stores/project-target.js";
import { WorktreeAddForm } from "@/components/organisms/WorktreeAddForm.js";
import { countDirtyTabsForTarget, useEditorStore } from "@/stores/editor.js";
import { countLiveTerminalSessionsForTarget } from "@/hooks/use-terminal-tree.js";
import { formatWorktreeRemovalBlockerMessage } from "./ProjectInfoHelpers.js";

const EMPTY_UNAVAILABLE_TARGET_PATHS: string[] = [];

function isTargetLossError(error: unknown): boolean {
  const values: string[] = [];
  if (typeof error === "string") values.push(error);
  if (error instanceof Error) values.push(error.message);
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["code", "message", "error", "reason"]) {
      const value = record[key];
      if (typeof value === "string") values.push(value);
    }
  }
  return isProjectTargetError(...values);
}

function recoveredTargetPaths(
  projectName: string,
  unavailablePaths: string[],
  worktrees: ReadonlyArray<Worktree> | undefined,
) {
  return unavailablePaths.filter((path) =>
    worktrees?.some(
      (worktree) =>
        worktreeTargetKey(projectName, worktree.path) ===
          worktreeTargetKey(projectName, path) &&
        isSelectableWorktree(worktree),
    ),
  );
}

interface ProjectWorktreesSectionProps {
  projectName: string;
  projectRoot: string;
  target: ProjectTargetSnapshot;
  isVisible: boolean;
}

export function ProjectWorktreesSection({
  projectName,
  projectRoot,
  target,
  isVisible,
}: ProjectWorktreesSectionProps) {
  const {
    data,
    dataUpdatedAt,
    isLoading,
    isFetching,
    isFetched,
    isError,
    refetch,
  } = useWorktrees(projectName, {
    enabled: isVisible,
    pollWhileVisible: isVisible,
  });
  const { data: sessions = [] } = useTerminalSessions();
  const worktrees = useMemo<Worktree[]>(() => data ?? [], [data]);
  const removeWorktree = useRemoveWorktree(projectName);
  const selectTarget = useProjectTargetStore((state) => state.selectTarget);
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
  const editorTabs = useEditorStore((state) => state.tabs);
  const unavailableTargetPaths = useProjectTargetStore(
    (state) =>
      state.unavailableTargetsByProject[projectName] ??
      EMPTY_UNAVAILABLE_TARGET_PATHS,
  );
  const [showAdd, setShowAdd] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const previousVisible = useRef(false);
  const pendingUnavailableRecovery = useRef(new Set<string>());
  const unavailableDiscoveryVersions = useRef(new Map<string, number>());
  const selectedPath = target.target.worktreePath ?? null;
  const selectedWorktree = selectedPath
    ? worktrees.find(
        (worktree) =>
          worktreeTargetKey(projectName, worktree.path) ===
          worktreeTargetKey(projectName, selectedPath),
      )
    : undefined;
  const fallbackNotice =
    unavailableTargetPaths.length === 0
      ? null
      : unavailableTargetPaths.length === 1
        ? `Worktree ${unavailableTargetPaths[0]} is unavailable. Using Project root for new operations.`
        : `${unavailableTargetPaths.length} worktrees are unavailable. Using Project root for new operations.`;

  useEffect(() => {
    const becameVisible = isVisible && !previousVisible.current;
    previousVisible.current = isVisible;
    if (becameVisible && !isFetching) void refetch();
  }, [isFetching, isVisible, refetch]);

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
      if (!activeKeys.has(key))
        unavailableDiscoveryVersions.current.delete(key);
    }
  }, [dataUpdatedAt, projectName, unavailableTargetPaths]);

  useEffect(() => {
    if (!isVisible || !isFetched || isFetching || isError) return;
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
      if (
        pendingUnavailableRecovery.current.has(
          worktreeTargetKey(projectName, path),
        )
      ) {
        continue;
      }
      markEditorTargetAvailable(projectName, path);
      clearUnavailableTarget(projectName, path);
    }
    if (
      selectedPath == null ||
      (selectedWorktree && isSelectableWorktree(selectedWorktree))
    ) {
      return;
    }
    markEditorTargetUnavailable(projectName, selectedPath);
    markTargetUnavailable(projectName, selectedPath);
  }, [
    clearUnavailableTarget,
    isError,
    isFetching,
    isFetched,
    isVisible,
    dataUpdatedAt,
    markEditorTargetAvailable,
    markEditorTargetUnavailable,
    markTargetUnavailable,
    projectName,
    selectedPath,
    selectedWorktree,
    unavailableTargetPaths,
    worktrees,
  ]);

  async function handleRemove(path: string) {
    setMutationError(null);
    setRemovingPath(path);
    try {
      const refreshed = await refetch();
      if (refreshed.isError || refreshed.data == null) {
        throw new Error("Worktree discovery failed; refresh and retry.");
      }
      const latestWorktrees = refreshed.data;
      if (
        !latestWorktrees.some(
          (worktree) =>
            worktreeTargetKey(projectName, worktree.path) ===
            worktreeTargetKey(projectName, path),
        )
      ) {
        throw new Error("Worktree is no longer registered; refresh and retry.");
      }

      const targetRef = { project: projectName, worktreePath: path } as const;
      const blockerMessage = formatWorktreeRemovalBlockerMessage(
        countDirtyTabsForTarget(editorTabs, targetRef),
        countLiveTerminalSessionsForTarget(sessions, targetRef, projectRoot),
      );
      if (blockerMessage) {
        setMutationError(blockerMessage);
        return;
      }

      await removeWorktree.mutateAsync(path);
      if (
        selectedPath != null &&
        worktreeTargetKey(projectName, selectedPath) ===
          worktreeTargetKey(projectName, path)
      ) {
        markEditorTargetUnavailable(projectName, path);
        markTargetUnavailable(projectName, path);
      }
      await refetch();
    } catch (error) {
      if (isTargetLossError(error)) {
        const unavailableKey = worktreeTargetKey(projectName, path);
        pendingUnavailableRecovery.current.add(unavailableKey);
        markEditorTargetUnavailable(projectName, path);
        markTargetUnavailable(projectName, path);
        // The target may have disappeared after preflight. Reconcile the
        // selector immediately so new operations return to Project root.
        void refetch().then((result) => {
          pendingUnavailableRecovery.current.delete(unavailableKey);
          if (result.isError || result.data == null) return;
          const recovered = result.data.some(
            (worktree) =>
              worktreeTargetKey(projectName, worktree.path) ===
                unavailableKey && isSelectableWorktree(worktree),
          );
          if (recovered) {
            markEditorTargetAvailable(projectName, path);
            clearUnavailableTarget(projectName, path);
          }
        });
      }
      setMutationError(
        error instanceof Error ? error.message : "Failed to remove worktree",
      );
    } finally {
      setRemovingPath(null);
    }
  }

  function handleReconnect() {
    void refetch().then((result) => {
      if (result.isError || result.data == null) return;
      for (const path of recoveredTargetPaths(
        projectName,
        unavailableTargetPaths,
        result.data,
      )) {
        markEditorTargetAvailable(projectName, path);
        clearUnavailableTarget(projectName, path);
      }
    });
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <ProjectTargetSelector
        projectRoot={projectRoot}
        target={target}
        worktrees={worktrees}
        isLoading={isLoading}
        isFetching={isFetching}
        isFetched={isFetched}
        isError={isError}
        fallbackNotice={fallbackNotice}
        fallbackTargetPaths={unavailableTargetPaths}
        removePendingPath={removingPath}
        onSelect={(path) => selectTarget(projectName, path)}
        onRefresh={() => void refetch()}
        onRemove={handleRemove}
      />

      {unavailableTargetPaths.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={handleReconnect}
          disabled={isFetching}
          aria-label="Reconnect unavailable worktrees"
        >
          {isFetching
            ? "Checking worktrees…"
            : "Reconnect unavailable worktrees"}
        </Button>
      )}

      {mutationError && (
        <p className="text-xs text-[var(--color-danger)]" role="alert">
          {mutationError}
        </p>
      )}

      {!showAdd ? (
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add Worktree
        </Button>
      ) : (
        <WorktreeAddForm
          projectName={projectName}
          onCancel={() => setShowAdd(false)}
          onAdded={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
