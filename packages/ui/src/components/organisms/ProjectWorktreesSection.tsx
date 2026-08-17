import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useRemoveWorktree, useWorktrees } from "@/api/queries.js";
import type { Worktree } from "@/api/client.js";
import { Button } from "@/components/atoms/Button.js";
import { ProjectTargetSelector } from "@/components/organisms/ProjectTargetSelector.js";
import {
  isSelectableWorktree,
  useProjectTargetStore,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";
import { WorktreeAddForm } from "@/components/organisms/WorktreeAddForm.js";
import { useEditorStore } from "@/stores/editor.js";

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
  const { data, isLoading, isFetching, isFetched, isError, refetch } =
    useWorktrees(projectName, {
      enabled: isVisible,
      pollWhileVisible: isVisible,
    });
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
  const unavailableTargetPath = useProjectTargetStore(
    (state) => state.unavailableTargetByProject[projectName] ?? null,
  );
  const [showAdd, setShowAdd] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const previousVisible = useRef(false);
  const selectedPath = target.target.worktreePath ?? null;
  const selectedWorktree = selectedPath
    ? worktrees.find((worktree) => worktree.path === selectedPath)
    : undefined;
  const fallbackNotice = unavailableTargetPath
    ? `Worktree ${unavailableTargetPath} is unavailable. Using Project root for new operations.`
    : null;

  useEffect(() => {
    const becameVisible = isVisible && !previousVisible.current;
    previousVisible.current = isVisible;
    if (becameVisible && !isFetching) void refetch();
  }, [isFetching, isVisible, refetch]);

  useEffect(() => {
    if (!isVisible || !isFetched || isFetching || isError) return;
    if (
      unavailableTargetPath != null &&
      worktrees.some(
        (worktree) =>
          worktree.path === unavailableTargetPath &&
          isSelectableWorktree(worktree),
      )
    ) {
      markEditorTargetAvailable(projectName, unavailableTargetPath);
      clearUnavailableTarget(projectName);
      return;
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
    markEditorTargetAvailable,
    markEditorTargetUnavailable,
    markTargetUnavailable,
    projectName,
    selectedPath,
    selectedWorktree,
    unavailableTargetPath,
    worktrees,
  ]);

  function handleRemove(path: string) {
    setMutationError(null);
    setRemovingPath(path);
    removeWorktree.mutate(path, {
      onError: (error) => {
        setMutationError(
          error instanceof Error ? error.message : "Failed to remove worktree",
        );
      },
      onSettled: () => setRemovingPath(null),
    });
  }

  function handleReconnect() {
    const path = unavailableTargetPath;
    if (!path) return;
    void refetch().then((result) => {
      if (
        result.data?.some(
          (worktree) =>
            worktree.path === path && isSelectableWorktree(worktree),
        )
      ) {
        selectTarget(projectName, path);
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
        removePendingPath={removingPath}
        onSelect={(path) => selectTarget(projectName, path)}
        onRefresh={() => void refetch()}
        onRemove={handleRemove}
      />

      {unavailableTargetPath && (
        <Button
          size="sm"
          variant="secondary"
          onClick={handleReconnect}
          disabled={isFetching}
        >
          {isFetching ? "Checking worktree…" : "Reconnect unavailable worktree"}
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
