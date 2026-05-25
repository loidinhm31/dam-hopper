import { useCallback, useState } from "react";
import {
  useGitCherryPick,
  useGitCherryPickCommitFiles,
  useGitDropCommit,
  useGitDropCommitFiles,
  useGitRevertCommit,
  useGitRevertCommitFiles,
  useGitReset,
  useGitUndoLastCommit,
} from "@/api/queries.js";
import type {
  DiffFileEntry,
  GitActionResult,
  GitLogEntry,
  ResetMode,
} from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/atoms/Button.js";
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

export function useGitHistoryActions(project: string, root?: string) {
  const scope = `${project}\0${root ?? "."}`;
  const [resetCommitState, setResetCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [dropCommitState, setDropCommitState] = useState<{
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
  const cherryPickMutation = useGitCherryPick(project, root);
  const resetMutation = useGitReset(project, root);
  const undoLastCommitMutation = useGitUndoLastCommit(project, root);
  const cherryPickFilesMutation = useGitCherryPickCommitFiles(project, root);
  const revertFilesMutation = useGitRevertCommitFiles(project, root);
  const dropFilesMutation = useGitDropCommitFiles(project, root);
  const dropCommitMutation = useGitDropCommit(project, root);
  const revertCommitMutation = useGitRevertCommit(project, root);
  const resetCommit =
    resetCommitState.project === scope ? resetCommitState.commit : null;
  const dropCommit =
    dropCommitState.project === scope ? dropCommitState.commit : null;
  const revertCommit =
    revertCommitState.project === scope ? revertCommitState.commit : null;
  const undoLastCommit =
    undoLastCommitState.project === scope
      ? undoLastCommitState.commit
      : null;
  const selectedChangesOperation =
    selectedChangesState.project === scope
      ? selectedChangesState.operation
      : null;
  const status = statusState.project === scope ? statusState.value : null;

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

  const clearStatus = useCallback(() => {
    setStatusState((current) => ({ ...current, value: null }));
  }, []);

  const resetScope = useCallback(() => {
    setResetCommitState((current) => ({ ...current, commit: null }));
    setDropCommitState((current) => ({ ...current, commit: null }));
    setRevertCommitState((current) => ({ ...current, commit: null }));
    setUndoLastCommitState((current) => ({ ...current, commit: null }));
    setSelectedChangesState((current) => ({ ...current, operation: null }));
    clearStatus();
  }, [clearStatus]);

  return {
    dropCommit,
    isDropCommitPending: dropCommitMutation.isPending,
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
    setRevertCommit: (commit: GitLogEntry | null) =>
      setRevertCommitState({ project: scope, commit }),
    setUndoLastCommit: (commit: GitLogEntry | null) =>
      setUndoLastCommitState({ project: scope, commit }),
    setResetCommit: (commit: GitLogEntry | null) =>
      setResetCommitState({ project: scope, commit }),
    handleCherryPick,
    handleCherryPickFiles,
    handleDropCommit,
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
