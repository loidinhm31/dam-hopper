import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Upload } from "lucide-react";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { CommitDetailsPanel } from "@/components/organisms/CommitDetailsPanel.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";
import { isGitUnavailableError, normalizeProjectTarget } from "@/api/client.js";
import type { DiffFileEntry, VcsRoot, ProjectTargetRef } from "@/api/client.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { GitHistoryToolbar } from "@/components/molecules/GitHistoryToolbar.js";
import { Button } from "@/components/atoms/Button.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { GitForcePushDialog } from "@/components/organisms/GitForcePushDialog.js";
import { SshRetryStatusMessage } from "@/components/atoms/SshRetryStatusMessage.js";
import { useGitWithSshRetry } from "@/hooks/use-git-with-ssh-retry.js";
import { useLeasedGitPush } from "@/hooks/use-leased-git-push.js";
import { useGitPush } from "@/api/queries.js";
import { useGitHistoryView } from "@/hooks/use-git-history-view.js";
import { GitSquashFlow } from "@/components/organisms/GitSquashFlow.js";
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
  formatProjectInfoRootLabel,
} from "@/components/organisms/ProjectInfoPanel.js";
import { projectTargetKey } from "@/api/ownership.js";
import { useConnectionSnapshot } from "@/api/connections.js";
import type {
  GitCommitRevealOwner,
  GitCommitRevealRequest,
} from "@/lib/git-commit-reveal.js";

export interface WorkspaceGitPanelProps {
  project: string;
  target?: ProjectTargetRef;
  available?: boolean;
  revealRequest?: GitCommitRevealRequest | null;
  onRevealRequestConsumed?: (nonce: number) => void;
}

interface InspectionState {
  owner: GitCommitRevealOwner;
  targetKey: string;
  rootId: string;
  hash: string;
  nonce: number;
}

const DEFAULT_GIT_ROOT_ID = ".";

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

export function WorkspaceGitPanel({
  project,
  target,
  available = true,
  revealRequest,
  onRevealRequestConsumed,
}: WorkspaceGitPanelProps) {
  const targetRef = useMemo(
    () => normalizeProjectTarget(target ?? project),
    [target, project],
  );

  const connectionSnapshot = useConnectionSnapshot(targetRef.profileId ?? "");
  const historyView = useGitHistoryView(targetRef, { available });
  const openDiff = useEditorStore((s) => s.openDiff);
  const [inspectionState, setInspectionState] =
    useState<InspectionState | null>(null);
  const lastConsumedNonceRef = useRef<number | null>(null);

  const historyActions = useGitHistoryActions(
    targetRef,
    historyView.rootId,
    historyView,
  );
  const gitPush = useGitPush();
  const { passphraseDialogProps, statusMessage, executeWithRetry } =
    useGitWithSshRetry();

  const leasedPushTarget = useMemo(
    () => ({
      ...targetRef,
      project,
    }),
    [project, targetRef],
  );
  const leasedPush = useLeasedGitPush(
    leasedPushTarget,
    historyView.rootId === DEFAULT_GIT_ROOT_ID ? undefined : historyView.rootId,
  );

  const selectedRoot =
    historyView.rootOptions.find(
      (root) => root.rootId === historyView.rootId,
    ) ?? historyView.rootOptions[0];
  const selectedRootLabel = selectedRoot
    ? formatProjectInfoRootLabel(selectedRoot)
    : "Project root";

  // Reset history mutation dialogs whenever effective scope changes
  useEffect(() => {
    historyActions.resetScope();
  }, [historyView.effectiveScopeKey, historyActions.resetScope]);
  // Consume reveal request once target, available roots, and requested root match
  useEffect(() => {
    if (!revealRequest) return;
    if (lastConsumedNonceRef.current === revealRequest.nonce) return;
    // Enforce target project, worktree, and profileId isolation
    if (
      projectTargetKey(revealRequest.target) !== projectTargetKey(targetRef)
    ) {
      return;
    }

    // Enforce connection owner profileId and generation isolation
    const currentOwner = connectionSnapshot?.owner;
    if (currentOwner) {
      if (
        revealRequest.owner.profileId !== currentOwner.profileId ||
        revealRequest.owner.generation !== currentOwner.generation
      ) {
        return;
      }
    } else if (targetRef.profileId || revealRequest.owner.profileId) {
      return;
    }

    if (historyView.rootOptions.length === 0) return;
    const rootMatches = historyView.rootOptions.some(
      (root) => root.rootId === revealRequest.rootId,
    );
    if (!rootMatches) return;

    if (historyView.rootId !== revealRequest.rootId) {
      historyView.setRootId(revealRequest.rootId);
      historyActions.resetScope();
      return;
    }

    lastConsumedNonceRef.current = revealRequest.nonce;
    historyView.clearSelectedCommit();
    setInspectionState({
      owner: revealRequest.owner,
      targetKey: projectTargetKey(targetRef),
      rootId: revealRequest.rootId,
      hash: revealRequest.hash,
      nonce: revealRequest.nonce,
    });
    onRevealRequestConsumed?.(revealRequest.nonce);
  }, [
    revealRequest,
    historyView.rootOptions,
    historyView.rootId,
    historyView.setRootId,
    historyView.clearSelectedCommit,
    historyActions.resetScope,
    targetRef,
    connectionSnapshot?.owner.profileId,
    connectionSnapshot?.owner.generation,
    onRevealRequestConsumed,
  ]);

  // Retire inspection when target, root, or generation changes
  useEffect(() => {
    if (!inspectionState) return;
    const currentGeneration = connectionSnapshot?.owner.generation;
    const currentProfileId = connectionSnapshot?.owner.profileId;
    if (
      inspectionState.rootId !== historyView.rootId ||
      inspectionState.targetKey !== projectTargetKey(targetRef) ||
      (currentProfileId !== undefined &&
        inspectionState.owner.profileId !== currentProfileId) ||
      (currentGeneration !== undefined &&
        inspectionState.owner.generation !== currentGeneration)
    ) {
      setInspectionState(null);
    }
  }, [
    historyView.rootId,
    targetRef,
    connectionSnapshot?.owner.profileId,
    connectionSnapshot?.owner.generation,
    inspectionState,
  ]);

  const isInspectedHashInVisibleLogs = useMemo(() => {
    if (!inspectionState) return false;
    return historyView.logs.some((entry) => entry.hash === inspectionState.hash);
  }, [inspectionState, historyView.logs]);

  const activeHash = inspectionState
    ? inspectionState.hash
    : historyView.selectedCommit?.hash;
  const activeRootId = inspectionState
    ? inspectionState.rootId
    : historyView.rootId;

  const handleCloseDetails = () => {
    if (inspectionState) {
      setInspectionState(null);
    } else {
      historyView.clearSelectedCommit();
    }
  };

  const handleGitFileDoubleClick = (file: DiffFileEntry) => {
    if (activeHash) {
      openDiff(
        targetRef,
        projectRelativePathForRoot(activeRootId, file.path),
        file.status,
        file.additions,
        file.deletions,
        activeHash,
      );
    }
  };

  const handleDropCommitConfirm = async () => {
    const droppedHash = await historyActions.handleDropCommit();
    if (!droppedHash) return;
    if (historyView.selectedCommit?.hash === droppedHash) {
      historyView.clearSelectedCommit();
    }
  };

  const handleEditCommitMessageConfirm = async (
    message: string,
    allowSignatureRemoval?: boolean,
  ) => {
    const editedHash = await historyActions.handleEditCommitMessage(
      message,
      allowSignatureRemoval,
    );
    if (!editedHash) return;
    if (historyView.selectedCommit?.hash === editedHash) {
      historyView.clearSelectedCommit();
    }
  };

  const handleRevertCommitConfirm = async () => {
    await historyActions.handleRevertCommit();
  };

  const handleUndoLastCommitConfirm = async () => {
    const undoneHash = await historyActions.handleUndoLastCommit();
    if (!undoneHash) return;
    if (historyView.selectedCommit?.hash === undoneHash) {
      historyView.clearSelectedCommit();
    }
  };

  if (!historyView.availability.isAvailable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text)]">
          {historyView.availability.reason || "Git history unavailable"}
        </span>
      </div>
    );
  }
  if (isGitUnavailableError(historyView.error)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text)]">
          Git is not initialized for this project
        </span>
        <span>
          Run <code className="font-mono">git init</code> to enable Git history
          and actions.
        </span>
      </div>
    );
  }

  return (
    <>
      <PassphraseDialog {...passphraseDialogProps} />
      <PassphraseDialog {...leasedPush.passphraseDialogProps} />
      <GitForcePushDialog
        open={leasedPush.state !== "closed"}
        project={project}
        rootLabel={selectedRootLabel}
        state={leasedPush.state}
        preview={leasedPush.preview}
        result={leasedPush.result}
        error={leasedPush.error}
        onPrepare={() => void leasedPush.prepare()}
        onPublish={() => void leasedPush.publish()}
        onClose={leasedPush.close}
      />
      <div className="flex flex-col md:flex-row h-full overflow-y-auto md:overflow-hidden bg-[var(--color-surface)]">
        <div
          className={cn(
            "flex flex-1 min-h-0 flex-col min-w-0 transition-all duration-200 motion-reduce:transition-none",
            historyView.selectedCommit || inspectionState
              ? "min-h-[480px] md:min-h-0 shrink-0 md:flex-none w-full md:w-[60%] lg:w-[65%] border-r border-[var(--color-border)]"
              : "w-full",
          )}
        >
          <div className="shrink-0 p-3 border-b border-[var(--color-border)]">
            <div className="mb-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  VCS Root
                </span>
                <select
                  value={historyView.rootId}
                  onChange={(event) => {
                    historyView.setRootId(event.target.value);
                    historyActions.resetScope();
                  }}
                  className="h-8 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[11px] font-medium text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]/60"
                >
                  {historyView.rootOptions.map((root) => (
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
                  target={targetRef}
                  root={historyView.rootId}
                  mode="view"
                  selectedBranchRef={historyView.branchRef}
                  onSelectedBranchRefChange={historyView.selectBranchRef}
                  selectedBranch={historyView.branchLabel}
                  onSelectedBranchChange={historyView.selectBranchRef}
                  className="w-full px-0"
                />
              </div>
            </div>
            {selectedRoot?.warnings.length ? (
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
                {selectedRoot.warnings.join(" ")}
              </div>
            ) : null}
            {!historyView.isViewingActiveBranch && historyView.activeBranch ? (
              <div className="mt-2 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-300">
                Viewing <strong>{historyView.branchLabel}</strong>. Cherry-pick
                and revert apply to checked-out branch{" "}
                <strong>{historyView.activeBranch}</strong>.
              </div>
            ) : null}
            <GitHistoryStatusBanner
              className="mt-2"
              status={historyActions.status}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <SshRetryStatusMessage
                message={statusMessage || leasedPush.sshStatus}
              />
              <Button
                size="sm"
                variant="secondary"
                data-testid="workspace-git-push-button"
                loading={gitPush.isPending}
                onClick={() =>
                  void executeWithRetry({ operation: "push" }, () =>
                    gitPush.mutateAsync(
                      buildProjectInfoPushTarget(
                        project,
                        historyView.rootId,
                        targetRef,
                      ),
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
                loading={
                  leasedPush.state === "preparing" ||
                  leasedPush.state === "publishing"
                }
                onClick={() => void leasedPush.prepare()}
              >
                <Upload className="h-3 w-3" />
                Force Push
              </Button>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 flex-col">
            <GitHistoryToolbar
              searchText={historyView.searchText}
              squashCount={historyView.squashSelection.count}
              squashDisabledReason={
                historyView.squashUnavailableReason ||
                historyView.squashSelection.disabledReason
              }
              squashBusy={
                historyActions.squash.open ||
                historyActions.squash.publication.state !== "closed"
              }
              onSquash={historyActions.squash.begin}
              onClearSquashSelection={historyView.clearSquashSelection}
              focusRef={historyActions.squash.toolbarRef}
              onSearchChange={historyView.setSearchText}
              onClearSearch={historyView.clearSearch}
              onCompositionStart={historyView.onCompositionStart}
              onCompositionEnd={historyView.onCompositionEnd}
              isFiltered={historyView.isFiltered}
              page={historyView.page}
              offset={historyView.offset}
              logsCount={historyView.logs.length}
              hasPreviousPage={historyView.hasPreviousPage}
              hasNextPage={historyView.hasNextPage}
              onPreviousPage={historyView.previousPage}
              onNextPage={historyView.nextPage}
              onRefresh={() => void historyView.refresh()}
              isRefreshing={historyView.isRefreshing}
              isLoading={historyView.isLoading}
              disabled={!historyView.availability.isAvailable}
              followActive={historyView.followActive}
              isViewingActiveBranch={historyView.isViewingActiveBranch}
              branchLabel={historyView.branchLabel}
              onFollowCheckedOutBranch={historyView.followCheckedOutBranch}
              notice={historyView.notice}
              onDismissNotice={historyView.dismissNotice}
              className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]"
            />
            <GitSquashFlow squash={historyActions.squash} />

            {historyView.error ? (
              <div className="m-3 flex items-center justify-between gap-2 rounded border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                  <span className="truncate">
                    Failed to load git history: {historyView.error.message}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void historyView.refresh()}
                  className="shrink-0 h-6 text-xs px-2"
                >
                  Retry
                </Button>
              </div>
            ) : null}

            <div className="flex-1 min-h-0 p-3">
              <GitLogTree
                squashSelectedHashes={historyView.squashSelectedHashes}
                onToggleSquashCommit={historyView.toggleSquashCommit}
                squashSelectionDisabled={
                  !historyView.squashAvailable ||
                  historyActions.squash.open ||
                  historyActions.squash.publication.state !== "closed"
                }
                logs={historyView.logs}
                isLoading={historyView.isLoading}
                presentation={historyView.isFiltered ? "list" : "graph"}
                emptyMessage={
                  historyView.isFiltered
                    ? "No matching commits found."
                    : "No commits found."
                }
                selectedHash={
                  inspectionState
                    ? inspectionState.hash
                    : historyView.selectedCommit?.hash
                }
                revealNonce={inspectionState?.nonce}
                onSelectCommit={(entry) => {
                  setInspectionState(null);
                  historyView.selectCommit(entry);
                }}
                onCherryPick={(entry) =>
                  void historyActions.handleCherryPick(entry)
                }
                onRevertCommit={historyActions.setRevertCommit}
                onUndoLastCommit={
                  historyView.isViewingActiveBranch
                    ? historyActions.setUndoLastCommit
                    : undefined
                }
                onDropCommit={
                  historyView.isViewingActiveBranch
                    ? historyActions.setDropCommit
                    : undefined
                }
                onEditCommitMessage={
                  historyView.isViewingLocalBranch
                    ? historyActions.setEditCommit
                    : undefined
                }
                onReset={
                  historyView.isViewingActiveBranch
                    ? historyActions.setResetCommit
                    : undefined
                }
              />
            </div>
          </div>
        </div>

        {(inspectionState || historyView.selectedCommit) && (
          <div className="flex-1 min-h-[240px] md:min-h-0 min-w-0 md:w-[40%] lg:w-[35%]">
            {inspectionState ? (
              <CommitDetailsPanel
                mode="inspect"
                project={project}
                target={targetRef}
                root={inspectionState.rootId}
                commitHash={inspectionState.hash}
                outsideViewNotice={!isInspectedHashInVisibleLogs}
                onClose={handleCloseDetails}
                onFileDoubleClick={handleGitFileDoubleClick}
              />
            ) : (
              historyView.selectedCommit && (
                <CommitDetailsPanel
                  mode="history"
                  project={project}
                  target={targetRef}
                  root={historyView.rootId}
                  commit={historyView.selectedCommit}
                  onClose={handleCloseDetails}
                  onFileDoubleClick={handleGitFileDoubleClick}
                  onCherryPickSelectedChanges={(commit, files) =>
                    void historyActions.handleCherryPickFiles(commit, files)
                  }
                  onRevertSelectedChanges={(commit, files) =>
                    void historyActions.handleRevertFiles(commit, files)
                  }
                  onDropSelectedChanges={
                    historyView.isViewingActiveBranch
                      ? (commit, files) =>
                          void historyActions.handleDropFiles(commit, files)
                      : undefined
                  }
                />
              )
            )}
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
        signatureConsentRequired={historyActions.signatureConsentRequired}
        onClose={() => historyActions.setEditCommit(null)}
        onConfirm={(message, allowSignatureRemoval) =>
          void handleEditCommitMessageConfirm(message, allowSignatureRemoval)
        }
      />
      <GitRevertCommitDialog
        commit={historyActions.revertCommit}
        loading={historyActions.isRevertCommitPending}
        onClose={() => historyActions.setRevertCommit(null)}
        onConfirm={() => void historyActions.handleRevertCommit()}
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
