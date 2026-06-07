import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, Upload } from "lucide-react";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { CommitDetailsPanel } from "@/components/organisms/CommitDetailsPanel.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";
import { api } from "@/api/client.js";
import {
  useBranches,
  useGitLog,
  useGitPush,
  useGitRoots,
} from "@/api/queries.js";
import type {
  Branch,
  GitLogEntry,
  DiffFileEntry,
  VcsRoot,
} from "@/api/client.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { Button } from "@/components/atoms/Button.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { GitForcePushDialog } from "@/components/organisms/GitForcePushDialog.js";
import { SshRetryStatusMessage } from "@/components/atoms/SshRetryStatusMessage.js";
import { useGitWithSshRetry } from "@/hooks/use-git-with-ssh-retry.js";
import {
  GitDropCommitDialog,
  GitEditCommitMessageDialog,
  GitHistoryStatusBanner,
  GitRevertCommitDialog,
  GitResetDialog,
  GitUndoLastCommitDialog,
  useGitHistoryActions,
} from "@/components/organisms/GitHistoryActions.js";
import {
  buildProjectInfoPushTarget,
  buildProjectInfoPushTargetWithMode,
  formatProjectInfoRootLabel,
} from "@/components/organisms/ProjectInfoPanel.js";

interface WorkspaceGitPanelProps {
  project: string;
}

const WORKSPACE_GIT_LOG_LIMIT = 200;

interface WorkspaceHistoryBranchState {
  project: string;
  root: string;
  branch: string;
  followsActive: boolean;
}

const DEFAULT_GIT_ROOT_ID = ".";

export function resolveWorkspaceGitSelection(
  selectedHash: string | null,
  logs: GitLogEntry[],
) {
  if (!selectedHash) {
    return null;
  }

  return logs.find((entry) => entry.hash === selectedHash) ?? null;
}

export function resolveWorkspaceHistoryRef(
  branches: Branch[],
  selectedBranch: string,
) {
  if (!selectedBranch) {
    return undefined;
  }

  return (
    branches.find((branch) => branch.name === selectedBranch)?.lastCommit ??
    selectedBranch
  );
}

export function resolveWorkspaceHistoryBranchState(
  current: WorkspaceHistoryBranchState,
  project: string,
  root: string,
  activeBranch: string,
): WorkspaceHistoryBranchState {
  if (current.project !== project || current.root !== root) {
    return {
      project,
      root,
      branch: activeBranch,
      followsActive: true,
    };
  }

  if (!current.branch && activeBranch) {
    return {
      project,
      root,
      branch: activeBranch,
      followsActive: true,
    };
  }

  if (current.followsActive && activeBranch && current.branch !== activeBranch) {
    return {
      project,
      root,
      branch: activeBranch,
      followsActive: true,
    };
  }

  return current;
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
  ref?: string,
  root = DEFAULT_GIT_ROOT_ID,
) {
  const rootKey = root || DEFAULT_GIT_ROOT_ID;
  const queryKeys = [
    ["branches", project, rootKey],
    ["project-status", project],
    ["git-log", project, rootKey],
  ];

  if (selectedHash) {
    queryKeys.push(["git-commit-files", project, rootKey, selectedHash]);
  }

  await Promise.all(
    queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );

  const [logs] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: [
        "git-log",
        project,
        rootKey,
        WORKSPACE_GIT_LOG_LIMIT,
        offset,
        ref ?? null,
      ],
      queryFn: () =>
        api.git.log(project, WORKSPACE_GIT_LOG_LIMIT, offset, ref, root),
    }),
    queryClient.refetchQueries({ queryKey: ["branches", project, rootKey] }),
    queryClient.refetchQueries({ queryKey: ["project-status", project] }),
    selectedHash
      ? queryClient.refetchQueries({
          queryKey: ["git-commit-files", project, rootKey, selectedHash],
        })
      : Promise.resolve(),
  ]);

  return resolveWorkspaceGitSelection(selectedHash, logs);
}

export function formatVcsRootLabel(root: VcsRoot) {
  return root.rootId === DEFAULT_GIT_ROOT_ID ? "Project root" : root.path;
}

export function describeVcsRoot(root: VcsRoot) {
  if (root.kind === "primary") return "Primary";
  if (root.mappingState === "uninitialized") return "Uninitialized";
  if (root.mappingState === "missing") return "Missing mapping";
  if (root.mappingState === "unmapped") return "Unmapped";
  return root.kind === "submodule" ? "Submodule" : "Nested repo";
}

export function workspaceGitRootOptions(roots: VcsRoot[]): VcsRoot[] {
  return roots.length > 0
    ? roots
    : [
        {
          rootId: DEFAULT_GIT_ROOT_ID,
          path: ".",
          absolutePath: "",
          kind: "primary" as const,
          warnings: [],
        },
      ];
}

export function projectRelativePathForRoot(root: string, path: string) {
  if (!path || root === DEFAULT_GIT_ROOT_ID) return path;
  if (path === root || path.startsWith(`${root}/`)) return path;
  return `${root}/${path}`;
}

export function WorkspaceGitPanel({ project }: WorkspaceGitPanelProps) {
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [historyScope, setHistoryScope] = useState<{
    project: string;
    root: string;
    branch: string;
    followsActive: boolean;
  }>({
    project: "",
    root: DEFAULT_GIT_ROOT_ID,
    branch: "",
    followsActive: true,
  });
  const [selectedRootId, setSelectedRootId] = useState(DEFAULT_GIT_ROOT_ID);
  const openDiff = useEditorStore((s) => s.openDiff);
  const historyActions = useGitHistoryActions(project, selectedRootId);
  const queryClient = useQueryClient();
  const gitPush = useGitPush();
  const [forcePushOpen, setForcePushOpen] = useState(false);
  const { passphraseDialogProps, statusMessage, executeWithRetry } =
    useGitWithSshRetry();
  const offset = page * WORKSPACE_GIT_LOG_LIMIT;
  const { data: roots = [] } = useGitRoots(project);
  const { data: branches = [] } = useBranches(project, selectedRootId);
  const rootOptions = workspaceGitRootOptions(roots);
  const selectedRoot =
    rootOptions.find((root) => root.rootId === selectedRootId) ??
    rootOptions[0];
  const selectedRootLabel = selectedRoot
    ? formatProjectInfoRootLabel(selectedRoot)
    : "Project root";
  const activeBranch =
    branches.find((branch) => branch.isCurrent)?.name ?? "";
  const historyBranch =
    historyScope.project === project && historyScope.root === selectedRootId
      ? historyScope.branch
      : "";
  const historyRef = resolveWorkspaceHistoryRef(branches, historyBranch);
  const { data: logs = [], isLoading: isLogLoading } = useGitLog(
    project,
    WORKSPACE_GIT_LOG_LIMIT,
    offset,
    historyRef,
    selectedRootId,
  );
  const isViewingActiveBranch = useMemo(
    () => !historyBranch || historyBranch === activeBranch,
    [activeBranch, historyBranch],
  );
  const hasPreviousPage = page > 0;
  const hasNextPage = logs.length === WORKSPACE_GIT_LOG_LIMIT;

  useEffect(() => {
    if (roots.length === 0) return;
    if (!roots.some((root) => root.rootId === selectedRootId)) {
      setSelectedRootId(DEFAULT_GIT_ROOT_ID);
    }
  }, [roots, selectedRootId]);

  useEffect(() => {
    const next = resolveWorkspaceHistoryBranchState(
      historyScope,
      project,
      selectedRootId,
      activeBranch,
    );
    if (
      next.project !== historyScope.project ||
      next.root !== historyScope.root ||
      next.branch !== historyScope.branch ||
      next.followsActive !== historyScope.followsActive
    ) {
      setSelectedCommit(null);
      setPage(0);
      setHistoryScope(next);
    }
  }, [activeBranch, historyScope, project, selectedRootId]);

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
        projectRelativePathForRoot(selectedRootId, file.path),
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

  const handleEditCommitMessageConfirm = async (message: string) => {
    const editedHash = await historyActions.handleEditCommitMessage(message);
    if (!editedHash) return;
    setSelectedCommit((current) =>
      current?.hash === editedHash ? null : current,
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
        historyRef,
        selectedRootId,
      );
      setSelectedCommit(refreshedSelection);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRevertCommitConfirm = async () => {
    await historyActions.handleRevertCommit();
  };

  const handleUndoLastCommitConfirm = async () => {
    const undoneHash = await historyActions.handleUndoLastCommit();
    if (!undoneHash) return;
    setSelectedCommit((current) =>
      current?.hash === undoneHash ? null : current,
    );
  };

  return (
    <>
      <PassphraseDialog {...passphraseDialogProps} />
      <GitForcePushDialog
        open={forcePushOpen}
        project={project}
        rootLabel={selectedRootLabel}
        loading={gitPush.isPending}
        onClose={() => setForcePushOpen(false)}
        onConfirm={() => {
          setForcePushOpen(false);
          void executeWithRetry({ operation: "push" }, () =>
            gitPush.mutateAsync(
              buildProjectInfoPushTargetWithMode(project, selectedRootId, true),
            ),
          ).catch(() => {});
        }}
      />
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
            <div className="mb-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  VCS Root
                </span>
                <select
                  value={selectedRootId}
                  onChange={(event) => {
                    setSelectedRootId(event.target.value);
                    setPage(0);
                    setSelectedCommit(null);
                    historyActions.resetScope();
                  }}
                  className="h-8 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[11px] font-medium text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]/60"
                >
                  {rootOptions.map((root) => (
                    <option key={root.rootId} value={root.rootId}>
                      {formatVcsRootLabel(root)} - {describeVcsRoot(root)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  History Branch
                </span>
                <GitBranchControl
                  project={project}
                  root={selectedRootId}
                  mode="view"
                  selectedBranch={historyBranch}
                  onSelectedBranchChange={(branch) => {
                    setPage(0);
                    setSelectedCommit(null);
                    setHistoryScope({
                      project,
                      root: selectedRootId,
                      branch,
                      followsActive: branch === activeBranch,
                    });
                  }}
                  className="w-full px-0"
                />
              </div>
            </div>
            {selectedRoot?.warnings.length ? (
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
                {selectedRoot.warnings.join(" ")}
              </div>
            ) : null}
            {!isViewingActiveBranch && activeBranch ? (
              <div className="mt-2 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-300">
                Viewing <strong>{historyBranch}</strong>. Cherry-pick and revert
                apply to checked-out branch <strong>{activeBranch}</strong>.
                Rewrite actions stay on the active branch.
              </div>
            ) : null}
            <GitHistoryStatusBanner
              className="mt-2"
              status={historyActions.status}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <SshRetryStatusMessage message={statusMessage} />
              <Button
                size="sm"
                variant="secondary"
                data-testid="workspace-git-push-button"
                loading={gitPush.isPending}
                onClick={() =>
                  void executeWithRetry({ operation: "push" }, () =>
                    gitPush.mutateAsync(
                      buildProjectInfoPushTarget(project, selectedRootId),
                    ),
                  ).catch(() => {})
                }
              >
                <Upload className="h-3 w-3" />
                Push
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={gitPush.isPending}
                onClick={() => setForcePushOpen(true)}
              >
                <Upload className="h-3 w-3" />
                Force Push
              </Button>
            </div>
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
                onRevertCommit={historyActions.setRevertCommit}
                onUndoLastCommit={
                  isViewingActiveBranch
                    ? historyActions.setUndoLastCommit
                    : undefined
                }
                onDropCommit={
                  isViewingActiveBranch ? historyActions.setDropCommit : undefined
                }
                onEditCommitMessage={
                  isViewingActiveBranch
                    ? historyActions.setEditCommit
                    : undefined
                }
                onReset={
                  isViewingActiveBranch ? historyActions.setResetCommit : undefined
                }
              />
            </div>
          </div>
        </div>

        {selectedCommit && (
          <div className="flex-1 min-h-0 min-w-0 md:w-[40%] lg:w-[35%]">
            <CommitDetailsPanel
              project={project}
              root={selectedRootId}
              commit={selectedCommit}
              onClose={() => setSelectedCommit(null)}
              onFileDoubleClick={handleGitFileDoubleClick}
              onCherryPickSelectedChanges={(commit, files) =>
                void historyActions.handleCherryPickFiles(commit, files)
              }
              onRevertSelectedChanges={(commit, files) =>
                void historyActions.handleRevertFiles(commit, files)
              }
              onDropSelectedChanges={(commit, files) =>
                isViewingActiveBranch
                  ? void historyActions.handleDropFiles(commit, files)
                  : undefined
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
      <GitEditCommitMessageDialog
        commit={historyActions.editCommit}
        originalMessage={historyActions.editCommitMessage}
        loading={historyActions.editCommitMessageLoading}
        saving={historyActions.isEditCommitMessagePending}
        error={historyActions.editCommitMessageError}
        onClose={() => historyActions.setEditCommit(null)}
        onConfirm={(message) => void handleEditCommitMessageConfirm(message)}
      />
      <GitRevertCommitDialog
        commit={historyActions.revertCommit}
        loading={historyActions.isRevertCommitPending}
        onClose={() => historyActions.setRevertCommit(null)}
        onConfirm={() => void handleRevertCommitConfirm()}
      />
      <GitUndoLastCommitDialog
        commit={historyActions.undoLastCommit}
        loading={historyActions.isUndoLastCommitPending}
        onClose={() => historyActions.setUndoLastCommit(null)}
        onConfirm={() => void handleUndoLastCommitConfirm()}
      />
    </>
  );
}
