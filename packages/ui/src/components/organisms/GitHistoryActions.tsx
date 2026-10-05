import { useCallback, useEffect, useState } from "react";
import {
  useGitCherryPick,
  useGitCherryPickCommitFiles,
  useGitCommitMessage,
  useGitDropCommit,
  useGitDropCommitFiles,
  useGitEditCommitMessage,
  useGitRevertCommit,
  useGitRevertCommitFiles,
  useGitReset,
  useGitUndoLastCommit,
  resolveTargetOwner,
} from "@/api/queries.js";
import { useConnectionSnapshot } from "@/api/connections.js";
import type {
  DiffFileEntry,
  GitActionResult,
  GitLogEntry,
  ResetMode,
  ProjectTargetInput,
} from "@/api/client.js";
import { normalizeProjectTarget, projectTargetCacheKey } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/atoms/Button.js";
import { normalizeCommitMessage } from "@/lib/git-squash-selection.js";
import {
  useGitSquashActions,
  type GitSquashContext,
} from "@/hooks/use-git-squash.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";

export const RESET_OPTIONS: Array<{
  mode: ResetMode;
  label: string;
  description: string;
  danger?: boolean;
}> = [
  {
    mode: "soft",
    label: "Soft",
    description: "Move HEAD only and keep index plus working tree changes.",
  },
  {
    mode: "mixed",
    label: "Mixed",
    description:
      "Move HEAD and reset the index, but keep working tree changes.",
  },
  {
    mode: "hard",
    label: "Hard",
    description: "Move HEAD and discard index plus working tree changes.",
    danger: true,
  },
  {
    mode: "keep",
    label: "Keep",
    description: "Move HEAD while keeping working tree changes when possible.",
  },
];

interface GitHistoryStatusBannerProps {
  status: GitHistoryActionStatus | null;
  className?: string;
}

export type GitHistoryActionStatusKind =
  | "success"
  | "blocked"
  | "conflict"
  | "dirty"
  | "error";

export interface GitHistoryActionStatus {
  kind: GitHistoryActionStatusKind;
  message: string;
  detail?: string;
}

export function formatGitActionStatus(
  result: GitActionResult,
  successFallback: string,
  errorFallback: string,
): GitHistoryActionStatus {
  if (result.ok) {
    return {
      kind: "success",
      message: result.message ?? successFallback,
      detail: result.recommendation,
    };
  }

  if (result.conflict) {
    return {
      kind: "conflict",
      message: result.message ?? errorFallback,
      detail:
        result.recovery?.canAbort || result.recovery?.canContinue
          ? "Resolve the active operation before continuing."
          : result.recommendation,
    };
  }

  if (result.dirty) {
    return {
      kind: "dirty",
      message: result.message ?? errorFallback,
      detail:
        result.recommendation ?? "Commit, stash, or discard local changes.",
    };
  }

  if (result.blockedReason) {
    return {
      kind: "blocked",
      message: result.message ?? errorFallback,
      detail: result.recommendation ?? result.blockedReason,
    };
  }

  return {
    kind: "error",
    message: result.message ?? errorFallback,
    detail: result.recommendation,
  };
}

export function GitHistoryStatusBanner({
  status,
  className,
}: GitHistoryStatusBannerProps) {
  if (!status) return null;

  const tone =
    status.kind === "success"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
      : status.kind === "blocked"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : status.kind === "dirty"
          ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
          : "border-[var(--color-danger)]/20 bg-[var(--color-danger)]/10 text-[var(--color-danger)]";

  return (
    <div
      className={cn("rounded border px-2 py-1 text-[10px]", tone, className)}
    >
      <div>{status.message}</div>
      {status.detail && (
        <div className="mt-0.5 opacity-80">{status.detail}</div>
      )}
    </div>
  );
}

interface GitResetDialogProps {
  commit: GitLogEntry | null;
  onClose: () => void;
  onConfirm: (mode: ResetMode) => void;
}

export function GitResetDialog({
  commit,
  onClose,
  onConfirm,
}: GitResetDialogProps) {
  return (
    <Dialog open={commit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Reset to commit</DialogTitle>
          <DialogDescription>
            Choose how to reset to <strong>{commit?.hash.slice(0, 7)}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {RESET_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => onConfirm(option.mode)}
              className={cn(
                "rounded border px-3 py-2 text-left transition-colors",
                option.danger
                  ? "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 hover:bg-[var(--color-danger)]/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              <div className="text-xs font-medium text-[var(--color-text)]">
                {option.label}
              </div>
              <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                {option.description}
              </div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GitDropCommitDialogProps {
  commit: GitLogEntry | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GitDropCommitDialog({
  commit,
  loading,
  onClose,
  onConfirm,
}: GitDropCommitDialogProps) {
  return (
    <Dialog open={commit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Drop commit</DialogTitle>
          <DialogDescription>
            This rewrites local history and removes commit{" "}
            <strong>{commit?.hash.slice(0, 7)}</strong> from the current branch.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          Only available for commits that have not been pushed upstream.
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">
          DamHopper will remove this local commit through the server Git
          operation and refresh branch history afterward.
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={loading}
            onClick={onConfirm}
          >
            Drop commit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function canSubmitEditedCommitMessage(
  message: string,
  originalMessage: string | undefined,
  loading: boolean,
) {
  return (
    !loading &&
    message.trim().length > 0 &&
    originalMessage !== undefined &&
    normalizeCommitMessage(message) !== normalizeCommitMessage(originalMessage)
  );
}

interface GitEditCommitMessageDialogProps {
  commit: GitLogEntry | null;
  originalMessage?: string;
  loading: boolean;
  saving: boolean;
  error?: string;
  signatureConsentRequired?: boolean;
  onClose: () => void;
  onConfirm: (message: string, allowSignatureRemoval?: boolean) => void;
}

export function GitEditCommitMessageDialog({
  commit,
  originalMessage,
  loading,
  saving,
  error,
  signatureConsentRequired,
  onClose,
  onConfirm,
}: GitEditCommitMessageDialogProps) {
  const isHead =
    commit?.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD ->")) ??
    false;

  return (
    <Dialog open={commit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Edit Commit Message</DialogTitle>
          <DialogDescription>
            Change the full message for{" "}
            <strong>{commit?.hash.slice(0, 7)}</strong>.
          </DialogDescription>
        </DialogHeader>
        <GitEditCommitMessageForm
          key={`${commit?.hash ?? ""}\0${originalMessage ?? ""}`}
          originalMessage={originalMessage}
          loading={loading}
          saving={saving}
          error={error}
          signatureConsentRequired={signatureConsentRequired}
          isHead={isHead}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function GitEditCommitMessageForm({
  originalMessage,
  loading,
  saving,
  error,
  signatureConsentRequired,
  isHead,
  onClose,
  onConfirm,
}: Omit<GitEditCommitMessageDialogProps, "commit"> & { isHead: boolean }) {
  const [message, setMessage] = useState(originalMessage ?? "");
  const [allowSignatureRemoval, setAllowSignatureRemoval] = useState(false);

  return (
    <>
      <textarea
        aria-label="Commit message"
        value={message}
        disabled={loading || saving}
        onChange={(event) => setMessage(event.target.value)}
        className="min-h-40 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]/60 disabled:opacity-60"
        placeholder={loading ? "Loading commit message..." : "Commit message"}
      />
      {error ? (
        <div className="text-xs text-[var(--color-danger)]">{error}</div>
      ) : (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {isHead
            ? "This rewrites the selected local commit hash. If pushed, remote update will require leased publication."
            : "Editing an older commit rewrites that commit and all descendant hashes. If pushed, remote update will require leased publication."}
        </div>
      )}
      {signatureConsentRequired && (
        <div className="flex flex-col gap-2 rounded border border-amber-500/40 bg-amber-500/15 p-2.5 text-xs text-amber-200">
          <span>
            This commit or its descendants contain signatures that will be
            invalidated and removed by rewriting history.
          </span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allowSignatureRemoval}
              onChange={(e) => setAllowSignatureRemoval(e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
            <span>Allow removal of invalidated signatures</span>
          </label>
        </div>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          loading={saving}
          disabled={
            saving ||
            Boolean(error) ||
            (signatureConsentRequired && !allowSignatureRemoval) ||
            !canSubmitEditedCommitMessage(message, originalMessage, loading)
          }
          onClick={() =>
            onConfirm(
              message,
              signatureConsentRequired ? allowSignatureRemoval : undefined,
            )
          }
        >
          Edit Commit Message
        </Button>
      </DialogFooter>
    </>
  );
}

interface GitRevertCommitDialogProps {
  commit: GitLogEntry | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GitRevertCommitDialog({
  commit,
  loading,
  onClose,
  onConfirm,
}: GitRevertCommitDialogProps) {
  return (
    <Dialog open={commit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Revert commit</DialogTitle>
          <DialogDescription>
            Create a new commit that reverses{" "}
            <strong>{commit?.hash.slice(0, 7)}</strong>. History is preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="text-xs text-[var(--color-text-muted)]">
          This is the safe action for pushed or shared commits.
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={loading}
            onClick={onConfirm}
          >
            Revert commit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GitUndoLastCommitDialogProps {
  commit: GitLogEntry | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GitUndoLastCommitDialog({
  commit,
  loading,
  onClose,
  onConfirm,
}: GitUndoLastCommitDialogProps) {
  return (
    <Dialog open={commit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Undo Last Commit</DialogTitle>
          <DialogDescription>
            Move HEAD back one commit and keep changes from{" "}
            <strong>{commit?.hash.slice(0, 7)}</strong> as unstaged local
            changes.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          This rewrites local branch history. Use Revert for pushed commits.
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={loading}
            onClick={onConfirm}
          >
            Undo Last Commit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GitSelectedChangesDialogProps {
  operation: GitSelectedChangesOperation | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GitSelectedChangesDialog({
  operation,
  loading,
  onClose,
  onConfirm,
}: GitSelectedChangesDialogProps) {
  const isDrop = operation?.kind === "drop";
  return (
    <Dialog
      open={operation !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isDrop ? "Drop Selected Changes" : "Revert Selected Changes"}
          </DialogTitle>
          <DialogDescription>
            {isDrop
              ? "Rewrite local history to remove the selected file changes from this commit."
              : "Apply the inverse of the selected file changes to the working tree."}
          </DialogDescription>
        </DialogHeader>
        <div className="text-xs text-[var(--color-text-muted)]">
          {operation?.files.length ?? 0} file change
          {(operation?.files.length ?? 0) === 1 ? "" : "s"} selected from{" "}
          <strong>{operation?.commit.hash.slice(0, 7)}</strong>.
        </div>
        {isDrop && (
          <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            Drop is only available for commits that have not been pushed
            upstream.
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={isDrop ? "danger" : "primary"}
            loading={loading}
            onClick={onConfirm}
          >
            {isDrop ? "Drop Selected Changes" : "Revert Selected Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface GitSelectedChangesOperation {
  kind: "revert" | "drop";
  commit: GitLogEntry;
  files: DiffFileEntry[];
}

export function useGitHistoryActions(
  target: ProjectTargetInput,
  root: string | undefined,
  squashContext: GitSquashContext,
) {
  const targetRef = normalizeProjectTarget(target);
  const squash = useGitSquashActions(target, root, squashContext);
  const project = targetRef.project;
  const scope = `${project}\0${projectTargetCacheKey(targetRef)}\0${root ?? "."}`;
  const owner = resolveTargetOwner(targetRef.profileId);
  const connectionSnapshot = useConnectionSnapshot(targetRef.profileId ?? "");
  const connectionGeneration =
    connectionSnapshot?.owner.generation ?? owner?.generation ?? 0;
  const editBranch = squashContext.branchRef;
  const editScope = JSON.stringify([
    project,
    projectTargetCacheKey(targetRef),
    root ?? ".",
    editBranch,
    connectionGeneration,
  ]);
  const [resetCommitState, setResetCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [dropCommitState, setDropCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [editCommitState, setEditCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [revertCommitState, setRevertCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [undoLastCommitState, setUndoLastCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [selectedChangesState, setSelectedChangesState] = useState<{
    project: string;
    operation: GitSelectedChangesOperation | null;
  }>({ project: "", operation: null });
  const [statusState, setStatusState] = useState<{
    project: string;
    value: GitHistoryActionStatus | null;
  }>({ project: "", value: null });
  const cherryPickMutation = useGitCherryPick(targetRef, root);
  const resetMutation = useGitReset(targetRef, root);
  const undoLastCommitMutation = useGitUndoLastCommit(targetRef, root);
  const cherryPickFilesMutation = useGitCherryPickCommitFiles(targetRef, root);
  const revertFilesMutation = useGitRevertCommitFiles(targetRef, root);
  const dropFilesMutation = useGitDropCommitFiles(targetRef, root);
  const dropCommitMutation = useGitDropCommit(targetRef, root);
  const editCommitMutation = useGitEditCommitMessage(targetRef, root);
  const revertCommitMutation = useGitRevertCommit(targetRef, root);
  const resetCommit =
    resetCommitState.project === scope ? resetCommitState.commit : null;
  const dropCommit =
    dropCommitState.project === scope ? dropCommitState.commit : null;
  const editCommit =
    editCommitState.project === editScope ? editCommitState.commit : null;
  const revertCommit =
    revertCommitState.project === scope ? revertCommitState.commit : null;
  const undoLastCommit =
    undoLastCommitState.project === scope ? undoLastCommitState.commit : null;
  const selectedChangesOperation =
    selectedChangesState.project === scope
      ? selectedChangesState.operation
      : null;
  const status = statusState.project === scope ? statusState.value : null;
  const commitMessageQuery = useGitCommitMessage(
    targetRef,
    editCommit?.hash ?? "",
    root,
    editBranch,
  );
  const [signatureConsentRequired, setSignatureConsentRequired] =
    useState(false);
  const [frozenSnapshot, setFrozenSnapshot] = useState<{
    hash: string;
    message: string;
    branch: string;
    headOid: string;
    scope: string;
  } | null>(null);
  const [branchMismatch, setBranchMismatch] = useState(false);

  useEffect(() => {
    if (
      resetCommit ||
      dropCommit ||
      editCommit ||
      revertCommit ||
      undoLastCommit ||
      selectedChangesOperation ||
      status
    ) {
      squash.revokePublication();
    }
  }, [
    resetCommit,
    dropCommit,
    editCommit,
    revertCommit,
    undoLastCommit,
    selectedChangesOperation,
    status,
  ]);
  useEffect(() => {
    if (!editCommit) {
      setFrozenSnapshot(null);
      setSignatureConsentRequired(false);
      setBranchMismatch(false);
      return;
    }
    if (
      frozenSnapshot?.hash === editCommit.hash &&
      frozenSnapshot?.scope === editScope
    ) {
      return;
    }
    if (commitMessageQuery.data && !commitMessageQuery.isLoading) {
      const dataBranch = commitMessageQuery.data.branch;
      if (
        !editBranch ||
        !editBranch.startsWith("refs/heads/") ||
        dataBranch !== editBranch
      ) {
        setBranchMismatch(true);
        setFrozenSnapshot(null);
      } else {
        setBranchMismatch(false);
        setFrozenSnapshot({
          hash: editCommit.hash,
          message: commitMessageQuery.data.message,
          branch: dataBranch,
          headOid: commitMessageQuery.data.headOid,
          scope: editScope,
        });
      }
    }
  }, [
    editCommit,
    commitMessageQuery.data,
    commitMessageQuery.isLoading,
    editScope,
    editBranch,
    frozenSnapshot?.hash,
    frozenSnapshot?.scope,
  ]);

  function setStatus(value: GitHistoryActionStatus | null) {
    setStatusState({ project: scope, value });
  }

  async function handleCherryPick(entry: GitLogEntry) {
    if (!project) return;
    setStatus(null);
    try {
      const result = await cherryPickMutation.mutateAsync(entry.hash);
      setStatus(
        formatGitActionStatus(
          result,
          `Cherry-picked ${entry.hash.slice(0, 7)}`,
          `Cherry-pick failed for ${entry.hash.slice(0, 7)}`,
        ),
      );
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Cherry-pick failed",
      });
    }
  }

  async function handleReset(mode: ResetMode) {
    if (!project || !resetCommit) return;
    setStatus(null);
    try {
      const result = await resetMutation.mutateAsync({
        hash: resetCommit.hash,
        mode,
      });
      setStatus(
        formatGitActionStatus(
          result,
          `Reset ${mode} to ${resetCommit.hash.slice(0, 7)}`,
          `Reset ${mode} failed`,
        ),
      );
      if (result.ok) {
        setResetCommitState({ project: scope, commit: null });
      }
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error ? caughtError.message : "Reset failed",
      });
    }
  }

  async function handleRevertCommit() {
    if (!project || !revertCommit) return null;
    const targetHash = revertCommit.hash;
    setStatus(null);
    try {
      const result = await revertCommitMutation.mutateAsync({
        hash: targetHash,
      });
      setStatus(
        formatGitActionStatus(
          result,
          `Reverted commit ${targetHash.slice(0, 7)}`,
          `Revert commit failed for ${targetHash.slice(0, 7)}`,
        ),
      );
      if (result.ok) {
        setRevertCommitState({ project: scope, commit: null });
      }
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Revert commit failed",
      });
    }
    return targetHash;
  }

  async function handleUndoLastCommit() {
    if (!project || !undoLastCommit) return null;
    const targetHash = undoLastCommit.hash;
    setStatus(null);
    try {
      const result = await undoLastCommitMutation.mutateAsync();
      setStatus(
        formatGitActionStatus(
          result,
          `Undid last commit ${targetHash.slice(0, 7)}`,
          "Undo Last Commit failed",
        ),
      );
      if (result.ok) {
        setUndoLastCommitState({ project: scope, commit: null });
        return targetHash;
      }
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Undo Last Commit failed",
      });
    }
    return null;
  }

  async function handleCherryPickFiles(
    commit: GitLogEntry,
    files: DiffFileEntry[],
  ) {
    if (!project || files.length === 0) return;
    const paths = files.map((file) => file.path);
    setStatus(null);
    try {
      const result = await cherryPickFilesMutation.mutateAsync({
        hash: commit.hash,
        paths,
      });
      setStatus(
        formatGitActionStatus(
          result,
          `Cherry-picked ${files.length} selected file change(s)`,
          "Cherry-pick selected changes failed",
        ),
      );
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Cherry-pick selected changes failed",
      });
    }
  }

  async function handleDropFiles(commit: GitLogEntry, files: DiffFileEntry[]) {
    if (!project || files.length === 0) return;
    const paths = files.map((file) => file.path);
    setStatus(null);
    try {
      const result = await dropFilesMutation.mutateAsync({
        hash: commit.hash,
        paths,
      });
      setStatus(
        formatGitActionStatus(
          result,
          `Dropped ${files.length} selected file change(s)`,
          "Drop selected changes failed",
        ),
      );
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Drop selected changes failed",
      });
    }
  }

  async function handleRevertFiles(
    commit: GitLogEntry,
    files: DiffFileEntry[],
  ) {
    if (!project || files.length === 0) return;
    const paths = files.map((file) => file.path);
    setStatus(null);
    try {
      const result = await revertFilesMutation.mutateAsync({
        hash: commit.hash,
        paths,
      });
      setStatus(
        formatGitActionStatus(
          result,
          `Reverted ${files.length} selected file change(s)`,
          "Revert selected changes failed",
        ),
      );
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Revert selected changes failed",
      });
    }
  }

  function requestSelectedChangesOperation(
    kind: GitSelectedChangesOperation["kind"],
    commit: GitLogEntry,
    files: DiffFileEntry[],
  ) {
    if (files.length === 0) return;
    setSelectedChangesState({
      project: scope,
      operation: { kind, commit, files },
    });
  }

  async function handleSelectedChangesOperation() {
    if (!selectedChangesOperation) return;
    const operation = selectedChangesOperation;
    if (operation.kind === "drop" && operation.commit.isPushed) {
      setStatus({
        kind: "blocked",
        message:
          "Drop selected changes is only available for commits not pushed upstream",
        detail: "Use Revert Selected Changes for shared history.",
      });
      setSelectedChangesState({ project: scope, operation: null });
      return;
    }
    if (operation.kind === "drop") {
      await handleDropFiles(operation.commit, operation.files);
    } else {
      await handleRevertFiles(operation.commit, operation.files);
    }
    setSelectedChangesState({ project: scope, operation: null });
  }

  async function handleDropCommit() {
    if (!project || !dropCommit) return null;
    const targetHash = dropCommit.hash;
    if (dropCommit.isPushed) {
      setStatus({
        kind: "blocked",
        message:
          "Drop commit is only available for commits not pushed upstream",
        detail: "Use revert for shared history.",
      });
      return null;
    }

    setStatus(null);
    try {
      const result = await dropCommitMutation.mutateAsync({
        hash: targetHash,
      });
      setStatus(
        formatGitActionStatus(
          result,
          `Dropped commit ${targetHash.slice(0, 7)}`,
          `Drop commit failed for ${targetHash.slice(0, 7)}`,
        ),
      );
      if (result.ok) {
        setDropCommitState({ project: scope, commit: null });
        return targetHash;
      }
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Drop commit failed",
      });
    }
    return null;
  }

  async function handleEditCommitMessage(
    message: string,
    allowSignatureRemoval?: boolean,
  ) {
    if (
      !project ||
      !editCommit ||
      !frozenSnapshot ||
      frozenSnapshot.scope !== editScope ||
      frozenSnapshot.hash !== editCommit.hash ||
      !frozenSnapshot.branch ||
      frozenSnapshot.branch !== editBranch
    ) {
      return null;
    }
    const targetHash = editCommit.hash;
    setStatus(null);
    try {
      const result = await editCommitMutation.mutateAsync({
        hash: targetHash,
        input: {
          message,
          expectedBranch: frozenSnapshot.branch,
          expectedHeadOid: frozenSnapshot.headOid,
          allowSignatureRemoval,
        },
      });
      if (
        editCommitState.project !== editScope ||
        frozenSnapshot.scope !== editScope
      ) {
        return null;
      }
      if (result.blockedReason === "signature-consent-required") {
        setSignatureConsentRequired(true);
        setStatus({
          kind: "blocked",
          message: "Commit signatures would be invalidated",
          detail: "Check the box to allow removing signatures and retry.",
        });
        return null;
      }
      setStatus(
        formatGitActionStatus(
          result,
          `Edited commit message for ${targetHash.slice(0, 7)}`,
          `Edit Commit Message failed for ${targetHash.slice(0, 7)}`,
        ),
      );
      if (result.ok) {
        setEditCommitState({ project: editScope, commit: null });
        setFrozenSnapshot(null);
        setSignatureConsentRequired(false);
        setBranchMismatch(false);
        return targetHash;
      }
    } catch (caughtError) {
      if (
        editCommitState.project !== editScope ||
        frozenSnapshot.scope !== editScope
      ) {
        return null;
      }
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Edit Commit Message failed",
      });
    }
    return null;
  }

  const clearStatus = useCallback(() => {
    setStatusState((current) => ({ ...current, value: null }));
  }, []);

  const resetScope = useCallback(() => {
    setResetCommitState((current) => ({ ...current, commit: null }));
    setDropCommitState((current) => ({ ...current, commit: null }));
    setEditCommitState((current) => ({ ...current, commit: null }));
    setRevertCommitState((current) => ({ ...current, commit: null }));
    setUndoLastCommitState((current) => ({ ...current, commit: null }));
    setSelectedChangesState((current) => ({ ...current, operation: null }));
    setFrozenSnapshot(null);
    setSignatureConsentRequired(false);
    setBranchMismatch(false);
    clearStatus();
  }, [clearStatus]);

  return {
    squash,
    dropCommit,
    isDropCommitPending: dropCommitMutation.isPending,
    editCommit,
    editCommitMessage:
      frozenSnapshot?.hash === editCommit?.hash
        ? frozenSnapshot?.message
        : !branchMismatch && commitMessageQuery.data?.branch === editBranch
          ? commitMessageQuery.data?.message
          : undefined,
    editCommitMessageLoading: commitMessageQuery.isLoading,
    editCommitMessageError:
      commitMessageQuery.error instanceof Error
        ? commitMessageQuery.error.message
        : branchMismatch
          ? "Branch changed while loading commit message. Refresh history."
          : undefined,
    signatureConsentRequired,
    isEditCommitMessagePending: editCommitMutation.isPending,
    revertCommit,
    isRevertCommitPending: revertCommitMutation.isPending,
    undoLastCommit,
    isUndoLastCommitPending: undoLastCommitMutation.isPending,
    selectedChangesOperation,
    isSelectedChangesPending:
      dropFilesMutation.isPending || revertFilesMutation.isPending,
    status,
    resetCommit,
    setDropCommit: (commit: GitLogEntry | null) =>
      setDropCommitState({ project: scope, commit }),
    setEditCommit: (commit: GitLogEntry | null) =>
      setEditCommitState({ project: editScope, commit }),
    setRevertCommit: (commit: GitLogEntry | null) =>
      setRevertCommitState({ project: scope, commit }),
    setUndoLastCommit: (commit: GitLogEntry | null) =>
      setUndoLastCommitState({ project: scope, commit }),
    setResetCommit: (commit: GitLogEntry | null) =>
      setResetCommitState({ project: scope, commit }),
    handleCherryPick,
    handleCherryPickFiles,
    handleDropCommit,
    handleEditCommitMessage,
    handleDropFiles,
    handleRevertCommit,
    handleRevertFiles,
    handleReset,
    handleUndoLastCommit,
    handleSelectedChangesOperation,
    requestDropFiles: (commit: GitLogEntry, files: DiffFileEntry[]) =>
      requestSelectedChangesOperation("drop", commit, files),
    requestRevertFiles: (commit: GitLogEntry, files: DiffFileEntry[]) =>
      requestSelectedChangesOperation("revert", commit, files),
    clearSelectedChangesOperation: () =>
      setSelectedChangesState({ project: scope, operation: null }),
    clearStatus,
    resetScope,
  };
}
