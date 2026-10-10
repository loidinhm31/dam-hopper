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
import { useWorktreeTargetReconciliation } from "@/hooks/use-worktree-target-reconciliation.js";

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
  const targetRef = target?.target ?? projectName;
  const projectScope = target?.target?.profileId
    ? { profileId: target.target.profileId, project: projectName }
    : projectName;
  const {
    data,
    dataUpdatedAt,
    isLoading,
    isFetching,
    isFetched,
    isError,
    refetch,
  } = useWorktrees(targetRef, {
    enabled: isVisible,
    pollWhileVisible: isVisible,
  });
  const { data: sessions = [] } = useTerminalSessions(target?.target?.profileId ? { profileId: target.target.profileId } : undefined);
  const worktrees = useMemo<Worktree[]>(() => data ?? [], [data]);
  const removeWorktree = useRemoveWorktree(targetRef);
  const selectTarget = useProjectTargetStore((state) => state.selectTarget);
  const editorTabs = useEditorStore((state) => state.tabs);
  const [showAdd, setShowAdd] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const previousVisible = useRef(false);
  const selectedPath = target.target.worktreePath ?? null;
  const {
    unavailableTargetPaths,
    fallbackNotice,
    markTargetAsUnavailable,
    markTargetAsAvailable,
    reconcileRecoveredTargets,
    pendingUnavailableRecovery,
  } = useWorktreeTargetReconciliation({
    projectName,
    projectScope,
    worktrees,
    selectedPath,
    dataUpdatedAt,
    isFetched,
    isFetching,
    isError,
    enabled: isVisible,
  });

  useEffect(() => {
    const becameVisible = isVisible && !previousVisible.current;
    previousVisible.current = isVisible;
    if (becameVisible && !isFetching) void refetch();
  }, [isFetching, isVisible, refetch]);

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

      const removalTargetRef = {
        project: projectName,
        worktreePath: path,
        ...(target?.target?.profileId ? { profileId: target.target.profileId } : {}),
      } as const;
      const blockerMessage = formatWorktreeRemovalBlockerMessage(
        countDirtyTabsForTarget(editorTabs, removalTargetRef),
        countLiveTerminalSessionsForTarget(sessions, removalTargetRef, projectRoot),
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
        markTargetAsUnavailable(path);
      }
      await refetch();
    } catch (error) {
      if (isTargetLossError(error)) {
        const unavailableKey = worktreeTargetKey(projectName, path);
        pendingUnavailableRecovery.current.add(unavailableKey);
        markTargetAsUnavailable(path);
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
            markTargetAsAvailable(path);
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
      reconcileRecoveredTargets(result.data);
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
        onSelect={(path) => selectTarget(projectScope, path)}
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
          target={target?.target}
          onCancel={() => setShowAdd(false)}
          onAdded={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
