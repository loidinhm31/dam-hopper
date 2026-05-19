import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { CommitDetailsPanel } from "@/components/organisms/CommitDetailsPanel.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";
import { api } from "@/api/client.js";
import { useGitLog } from "@/api/queries.js";
import type { GitLogEntry, DiffFileEntry } from "@/api/client.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import {
  GitDropCommitDialog,
  GitHistoryStatusBanner,
  GitResetDialog,
  useGitHistoryActions,
} from "@/components/organisms/GitHistoryActions.js";

interface WorkspaceGitPanelProps {
  project: string;
}

const WORKSPACE_GIT_LOG_LIMIT = 200;

export function resolveWorkspaceGitSelection(
  selectedHash: string | null,
  logs: GitLogEntry[],
) {
  if (!selectedHash) {
    return null;
  }

  return logs.find((entry) => entry.hash === selectedHash) ?? null;
}

export async function refreshWorkspaceGitPanelQueries(
  queryClient: {
    invalidateQueries: (args: { queryKey: unknown[] }) => Promise<unknown>;
    refetchQueries: (args: { queryKey: unknown[] }) => Promise<unknown>;
    fetchQuery: <T>(args: {
      queryKey: unknown[];
      queryFn: () => Promise<T>;
    }) => Promise<T>;
  },
  project: string,
  selectedHash: string | null,
  offset = 0,
) {
  const queryKeys = [
    ["branches", project],
    ["project-status", project],
    ["git-log", project],
  ];

  if (selectedHash) {
    queryKeys.push(["git-commit-files", project, selectedHash]);
  }

  await Promise.all(
    queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );

  const [logs] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: ["git-log", project, WORKSPACE_GIT_LOG_LIMIT, offset],
      queryFn: () => api.git.log(project, WORKSPACE_GIT_LOG_LIMIT, offset),
    }),
    queryClient.refetchQueries({ queryKey: ["branches", project] }),
    queryClient.refetchQueries({ queryKey: ["project-status", project] }),
    selectedHash
      ? queryClient.refetchQueries({
          queryKey: ["git-commit-files", project, selectedHash],
        })
      : Promise.resolve(),
  ]);

  return resolveWorkspaceGitSelection(selectedHash, logs);
}

export function WorkspaceGitPanel({ project }: WorkspaceGitPanelProps) {
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const openDiff = useEditorStore((s) => s.openDiff);
  const historyActions = useGitHistoryActions(project);
  const queryClient = useQueryClient();
  const offset = page * WORKSPACE_GIT_LOG_LIMIT;
  const { data: logs = [], isLoading: isLogLoading } = useGitLog(
    project,
    WORKSPACE_GIT_LOG_LIMIT,
    offset,
  );
  const hasPreviousPage = page > 0;
  const hasNextPage = logs.length === WORKSPACE_GIT_LOG_LIMIT;

  useEffect(() => {
    if (!selectedCommit) return;
    if (!logs.some((entry) => entry.hash === selectedCommit.hash)) {
      setSelectedCommit(null);
    }
  }, [logs, selectedCommit]);

  const handleGitFileDoubleClick = (file: DiffFileEntry) => {
    if (selectedCommit) {
      openDiff(
        project,
        file.path,
        file.status,
        file.additions,
        file.deletions,
        selectedCommit.hash,
      );
    }
  };

  const handleDropCommitConfirm = async () => {
    const droppedHash = await historyActions.handleDropCommit();
    if (!droppedHash) return;
    setSelectedCommit((current) =>
      current?.hash === droppedHash ? null : current,
    );
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      const refreshedSelection = await refreshWorkspaceGitPanelQueries(
        queryClient,
        project,
        selectedCommit?.hash ?? null,
        offset,
      );
      setSelectedCommit(refreshedSelection);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <>
      <div className="flex h-full overflow-hidden bg-[var(--color-surface)]">
        <div
          className={cn(
            "flex min-h-0 flex-col min-w-0 transition-all duration-200",
            selectedCommit
              ? "w-0 md:w-[60%] lg:w-[65%] border-r border-[var(--color-border)]"
              : "w-full",
          )}
        >
          <div className="p-3 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Branch
              </span>
            </div>
            <GitBranchControl project={project} className="w-full" />
            <GitHistoryStatusBanner
              className="mt-2"
              status={historyActions.status}
            />
          </div>
          <div className="flex flex-1 min-h-0 flex-col">
            <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-surface-2)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span>History</span>
                {logs.length > 0 && (
                  <span className="text-[10px] font-medium normal-case tracking-normal text-[var(--color-text-muted)]">
                    {offset + 1}-{offset + logs.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={!hasPreviousPage || isLogLoading}
                  aria-label="Previous history page"
                  title="Previous history page"
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={!hasNextPage || isLogLoading}
                  aria-label="Next history page"
                  title="Next history page"
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                  aria-label="Refresh git history"
                  title="Refresh git history"
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    className={cn("h-3 w-3", isRefreshing && "animate-spin")}
                  />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <GitLogTree
                logs={logs}
                isLoading={isLogLoading}
                selectedHash={selectedCommit?.hash}
                onSelectCommit={setSelectedCommit}
                onCherryPick={(entry) =>
                  void historyActions.handleCherryPick(entry)
                }
                onDropCommit={historyActions.setDropCommit}
                onReset={historyActions.setResetCommit}
              />
            </div>
          </div>
        </div>

        {selectedCommit && (
          <div className="flex-1 min-h-0 min-w-0 md:w-[40%] lg:w-[35%]">
            <CommitDetailsPanel
              project={project}
              commit={selectedCommit}
              onClose={() => setSelectedCommit(null)}
              onFileDoubleClick={handleGitFileDoubleClick}
              onCherryPickSelectedChanges={(commit, files) =>
                void historyActions.handleCherryPickFiles(commit, files)
              }
              onDropSelectedChanges={(commit, files) =>
                void historyActions.handleDropFiles(commit, files)
              }
            />
          </div>
        )}
      </div>

      <GitResetDialog
        commit={historyActions.resetCommit}
        onClose={() => historyActions.setResetCommit(null)}
        onConfirm={(mode) => void historyActions.handleReset(mode)}
      />
      <GitDropCommitDialog
        commit={historyActions.dropCommit}
        loading={historyActions.isDropCommitPending}
        onClose={() => historyActions.setDropCommit(null)}
        onConfirm={() => void handleDropCommitConfirm()}
      />
    </>
  );
}
