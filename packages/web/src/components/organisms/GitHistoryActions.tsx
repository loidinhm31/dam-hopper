import { useCallback, useState } from "react";
import { useGitCherryPick, useGitReset } from "@/api/queries.js";
import type { GitLogEntry, ResetMode } from "@/api/client.js";
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
    description: "Move HEAD and reset the index, but keep working tree changes.",
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
  error: string | null;
  message: string | null;
  className?: string;
}

export function GitHistoryStatusBanner({
  error,
  message,
  className,
}: GitHistoryStatusBannerProps) {
  if (!error && !message) return null;

  return (
    <div
      className={cn(
        "rounded border px-2 py-1 text-[10px]",
        error
          ? "border-[var(--color-danger)]/20 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
        className,
      )}
    >
      {error ?? message}
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

export function useGitHistoryActions(project: string) {
  const [resetCommitState, setResetCommitState] = useState<{
    project: string;
    commit: GitLogEntry | null;
  }>({ project: "", commit: null });
  const [messageState, setMessageState] = useState<{
    project: string;
    value: string | null;
  }>({ project: "", value: null });
  const [errorState, setErrorState] = useState<{
    project: string;
    value: string | null;
  }>({ project: "", value: null });
  const cherryPickMutation = useGitCherryPick(project);
  const resetMutation = useGitReset(project);
  const resetCommit =
    resetCommitState.project === project ? resetCommitState.commit : null;
  const message = messageState.project === project ? messageState.value : null;
  const error = errorState.project === project ? errorState.value : null;

  async function handleCherryPick(entry: GitLogEntry) {
    if (!project) return;
    setErrorState({ project, value: null });
    setMessageState({ project, value: null });
    try {
      const result = await cherryPickMutation.mutateAsync(entry.hash);
      if (result.ok) {
        setMessageState({
          project,
          value: result.message ?? `Cherry-picked ${entry.hash.slice(0, 7)}`,
        });
        return;
      }
      setErrorState({
        project,
        value: result.message ?? `Cherry-pick failed for ${entry.hash.slice(0, 7)}`,
      });
    } catch (caughtError) {
      setErrorState({
        project,
        value:
          caughtError instanceof Error ? caughtError.message : "Cherry-pick failed",
      });
    }
  }

  async function handleReset(mode: ResetMode) {
    if (!project || !resetCommit) return;
    setErrorState({ project, value: null });
    setMessageState({ project, value: null });
    try {
      const result = await resetMutation.mutateAsync({
        hash: resetCommit.hash,
        mode,
      });
      if (result.ok) {
        setMessageState({
          project,
          value: result.message ?? `Reset ${mode} to ${resetCommit.hash.slice(0, 7)}`,
        });
        setResetCommitState({ project, commit: null });
        return;
      }
      setErrorState({
        project,
        value: result.message ?? `Reset ${mode} failed`,
      });
    } catch (caughtError) {
      setErrorState({
        project,
        value: caughtError instanceof Error ? caughtError.message : "Reset failed",
      });
    }
  }

  const clearStatus = useCallback(() => {
    setMessageState((current) => ({ ...current, value: null }));
    setErrorState((current) => ({ ...current, value: null }));
  }, []);

  const resetScope = useCallback(() => {
    setResetCommitState((current) => ({ ...current, commit: null }));
    clearStatus();
  }, [clearStatus]);

  return {
    error,
    message,
    resetCommit,
    setResetCommit: (commit: GitLogEntry | null) =>
      setResetCommitState({ project, commit }),
    handleCherryPick,
    handleReset,
    clearStatus,
    resetScope,
  };
}
