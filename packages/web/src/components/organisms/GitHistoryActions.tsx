import { useCallback, useState } from "react";
import {
  useGitCherryPick,
  useGitCherryPickCommitFiles,
  useGitDropCommit,
  useGitDropCommitFiles,
  useGitReset,
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

export function useGitHistoryActions(project: string) {
  const [resetCommitState, setResetCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [dropCommitState, setDropCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [statusState, setStatusState] = useState<{
    project: string;
    value: GitHistoryActionStatus | null;
  }>({ project: "", value: null });
  const cherryPickMutation = useGitCherryPick(project);
  const resetMutation = useGitReset(project);
  const cherryPickFilesMutation = useGitCherryPickCommitFiles(project);
  const dropFilesMutation = useGitDropCommitFiles(project);
  const dropCommitMutation = useGitDropCommit(project);
  const resetCommit =
    resetCommitState.project === project ? resetCommitState.commit : null;
  const dropCommit =
    dropCommitState.project === project ? dropCommitState.commit : null;
  const status = statusState.project === project ? statusState.value : null;

  function setStatus(value: GitHistoryActionStatus | null) {
    setStatusState({ project, value });
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
        setResetCommitState({ project, commit: null });
      }
    } catch (caughtError) {
      setStatus({
        kind: "error",
        message:
          caughtError instanceof Error ? caughtError.message : "Reset failed",
      });
    }
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
        setDropCommitState({ project, commit: null });
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
    clearStatus();
  }, [clearStatus]);

  return {
    dropCommit,
    isDropCommitPending: dropCommitMutation.isPending,
    status,
    resetCommit,
    setDropCommit: (commit: GitLogEntry | null) =>
      setDropCommitState({ project, commit }),
    setResetCommit: (commit: GitLogEntry | null) =>
      setResetCommitState({ project, commit }),
    handleCherryPick,
    handleCherryPickFiles,
    handleDropCommit,
    handleDropFiles,
    handleReset,
    clearStatus,
    resetScope,
  };
}
