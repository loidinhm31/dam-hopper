import { useState } from "react";
import { Plus, Minus, RefreshCw, AlertTriangle } from "lucide-react";
import { CollapsibleSection } from "@/components/atoms/CollapsibleSection.js";
import { ChangedFileEntry } from "@/components/molecules/ChangedFileEntry.js";
import { Button } from "@/components/atoms/Button.js";
import {
  useGitDiff,
  useGitStage,
  useGitUnstage,
  useGitDiscard,
} from "@/api/queries.js";
import type { DiffFileEntry } from "@/api/client.js";

interface DiscardConfirm {
  path: string;
}

interface Props {
  project: string;
  selectedFile: string | null;
  onSelectFile: (path: string, isConflict: boolean) => void;
}

export function ChangedFilesList({ project, selectedFile, onSelectFile }: Props) {
  const [discardConfirm, setDiscardConfirm] = useState<DiscardConfirm | null>(null);
  const [mutatingPaths, setMutatingPaths] = useState<Set<string>>(new Set());
  const [batchMutating, setBatchMutating] = useState<"stage" | "unstage" | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const { data: files = [], isLoading, isError, refetch } = useGitDiff(project);
  const stageMutation = useGitStage(project);
  const unstageMutation = useGitUnstage(project);
  const discardMutation = useGitDiscard(project);

  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);
  const conflicts = files.filter((f) => f.status === "conflicted");
  const stageableUnstaged = unstaged.filter((f) => f.status !== "conflicted");

  function trackPath(path: string) {
    setMutatingPaths((prev) => new Set([...prev, path]));
    return () => setMutatingPaths((prev) => { const next = new Set(prev); next.delete(path); return next; });
  }

  async function handleStage(path: string) {
    const untrack = trackPath(path);
    setMutationError(null);
    try {
      await stageMutation.mutateAsync([path]);
    } catch {
      setMutationError(`Failed to stage ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleUnstage(path: string) {
    const untrack = trackPath(path);
    setMutationError(null);
    try {
      await unstageMutation.mutateAsync([path]);
    } catch {
      setMutationError(`Failed to unstage ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleStageAll() {
    const paths = stageableUnstaged.map((f) => f.path);
    if (paths.length === 0) return;
    setBatchMutating("stage");
    setMutationError(null);
    try {
      await stageMutation.mutateAsync(paths);
    } catch {
      setMutationError("Failed to stage all files");
    } finally {
      setBatchMutating(null);
    }
  }

  async function handleUnstageAll() {
    const paths = staged.map((f) => f.path);
    if (paths.length === 0) return;
    setBatchMutating("unstage");
    setMutationError(null);
    try {
      await unstageMutation.mutateAsync(paths);
    } catch {
      setMutationError("Failed to unstage all files");
    } finally {
      setBatchMutating(null);
    }
  }

  function handleDiscardRequest(path: string) {
    setDiscardConfirm({ path });
  }

  async function handleDiscardConfirm() {
    if (!discardConfirm) return;
    const { path } = discardConfirm;
    const untrack = trackPath(path);
    setMutationError(null);
    try {
      await discardMutation.mutateAsync(path);
      setDiscardConfirm(null);
    } catch {
      setMutationError(`Failed to discard changes in ${path.split("/").pop()}`);
      setDiscardConfirm(null);
    } finally {
      untrack();
    }
  }

  function handleSelect(entry: DiffFileEntry) {
    onSelectFile(entry.path, entry.status === "conflicted");
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20" role="status" aria-live="polite">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
        <span className="sr-only">Loading changes...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-xs text-[var(--color-danger)]">
        <AlertTriangle className="h-5 w-5" />
        <span>Failed to load changes</span>
        <Button size="sm" variant="ghost" onClick={() => void refetch()}>
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-xs text-[var(--color-text-muted)]">
        <span className="text-2xl opacity-20">✓</span>
        <span>No changes</span>
        <button
          onClick={() => void refetch()}
          className="text-[10px] text-[var(--color-primary)]/60 hover:text-[var(--color-primary)] transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto text-xs">
      {/* Error banner */}
      {mutationError && (
        <div
          role="alert"
          className="shrink-0 px-3 py-2 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 flex items-center justify-between gap-2"
        >
          <span className="text-[var(--color-danger)] text-[11px]">{mutationError}</span>
          <button
            onClick={() => setMutationError(null)}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px]"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Discard confirmation banner */}
      {discardConfirm && (
        <div
          role="alertdialog"
          aria-modal="false"
          className="shrink-0 px-3 py-2 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)]"
          onKeyDown={(e) => { if (e.key === "Escape") setDiscardConfirm(null); }}
        >
          <p className="font-medium mb-1 text-[11px]">Discard changes to:</p>
          <p className="font-mono text-[10px] mb-2 truncate opacity-80">{discardConfirm.path}</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="danger" onClick={() => void handleDiscardConfirm()}>Discard</Button>
            <Button size="sm" variant="ghost" onClick={() => setDiscardConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Conflicts — always at top */}
      {conflicts.length > 0 && (
        <CollapsibleSection
          title="Conflicts"
          badge={conflicts.length}
          defaultOpen
          headerClassName="text-[var(--color-danger)]"
        >
          {conflicts.map((f) => (
            <ChangedFileEntry
              key={f.path}
              entry={f}
              isSelected={selectedFile === f.path}
              onSelect={() => handleSelect(f)}
              isMutating={mutatingPaths.has(f.path)}
            />
          ))}
        </CollapsibleSection>
      )}

      {/* Staged */}
      <CollapsibleSection
        title="Staged"
        badge={staged.length}
        defaultOpen={staged.length > 0}
      >
        {staged.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1 border-b border-[var(--color-border)]/50">
            <button
              onClick={() => void handleUnstageAll()}
              disabled={batchMutating === "unstage"}
              aria-label="Unstage all staged files"
              className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
            >
              {batchMutating === "unstage" ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Minus className="h-3 w-3" />
              )}
              Unstage all
            </button>
          </div>
        )}
        {staged.length === 0 ? (
          <p className="px-3 py-2 text-[10px] text-[var(--color-text-muted)] italic">Nothing staged</p>
        ) : (
          staged.map((f) => (
            <ChangedFileEntry
              key={f.path}
              entry={f}
              isSelected={selectedFile === f.path}
              onSelect={() => handleSelect(f)}
              onUnstage={(path) => void handleUnstage(path)}
              isMutating={mutatingPaths.has(f.path) || batchMutating === "unstage"}
            />
          ))
        )}
      </CollapsibleSection>

      {/* Unstaged */}
      <CollapsibleSection
        title="Unstaged"
        badge={stageableUnstaged.length}
        defaultOpen
      >
        {stageableUnstaged.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--color-border)]/50">
            <button
              onClick={() => void handleStageAll()}
              disabled={batchMutating === "stage"}
              aria-label="Stage all unstaged files"
              className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
            >
              {batchMutating === "stage" ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Stage all
            </button>
          </div>
        )}
        {stageableUnstaged.length === 0 ? (
          <p className="px-3 py-2 text-[10px] text-[var(--color-text-muted)] italic">Nothing unstaged</p>
        ) : (
          stageableUnstaged.map((f) => (
            <ChangedFileEntry
              key={f.path}
              entry={f}
              isSelected={selectedFile === f.path}
              onSelect={() => handleSelect(f)}
              onStage={(path) => void handleStage(path)}
              onDiscard={handleDiscardRequest}
              isMutating={mutatingPaths.has(f.path) || batchMutating === "stage"}
            />
          ))
        )}
      </CollapsibleSection>

      <div className="mt-auto px-3 py-2 border-t border-[var(--color-border)]/50 flex justify-end">
        <button
          onClick={() => void refetch()}
          aria-label="Refresh changes list"
          className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
    </div>
  );
}
