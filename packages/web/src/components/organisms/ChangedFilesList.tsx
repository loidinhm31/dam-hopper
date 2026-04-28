import { useRef, useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { 
  useGitDiff, 
  useGitUntracked, 
  useGitStage, 
  useGitUnstage, 
  useGitDiscard, 
  useGitCommit 
} from "@/api/queries.js";
import type { DiffFileEntry } from "@/api/client.js";

// ---------------------------------------------------------------------------
// ChangedFilesList — IntelliJ-style local changes panel
// ---------------------------------------------------------------------------

export interface ChangedFilesListProps {
  project: string;
  selectedFile: string | null;
  onSelectFile: (path: string, isConflict: boolean) => void;
}

interface GitContextMenuState {
  x: number;
  y: number;
  entry: DiffFileEntry;
  section: "changes" | "unversioned";
}

function gitStatusColor(status: string, staged: boolean): string {
  if (status === "conflicted") return "text-red-400";
  if (staged) return "text-green-400";
  if (status === "deleted") return "text-red-400/80";
  if (status === "added") return "text-green-400";
  return "text-blue-400";
}

function gitStatusBadge(status: string, staged: boolean): string {
  if (status === "conflicted") return "C";
  if (staged) {
    if (status === "added") return "A";
    if (status === "deleted") return "D";
    if (status === "renamed") return "R";
    return "M";
  }
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "added") return "?";
  return "M";
}

function GitSectionHeader({
  label,
  count,
  open,
  onToggle,
  checkState,
  onCheckAll,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  checkState: "all" | "some" | "none";
  onCheckAll: () => void;
}) {
  const checkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkRef.current) {
      checkRef.current.indeterminate = checkState === "some";
    }
  }, [checkState]);

  return (
    <div className="flex items-center gap-1 px-2 py-1 select-none bg-[var(--color-surface)] sticky top-0 z-10 border-b border-[var(--color-border)]/40">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 min-w-0 text-left"
      >
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />}
        <span className="text-[10px] font-semibold text-[var(--color-text)] truncate">
          {label}
        </span>
        <span className="text-[9px] text-[var(--color-text-muted)] ml-1 shrink-0">
          {count} {count === 1 ? "file" : "files"}
        </span>
      </button>
      {count > 0 && (
        <input
          ref={checkRef}
          type="checkbox"
          checked={checkState === "all"}
          onChange={onCheckAll}
          onClick={(e) => e.stopPropagation()}
          className="h-3 w-3 shrink-0 cursor-pointer accent-[var(--color-primary)]"
          aria-label={`Select all ${label}`}
        />
      )}
    </div>
  );
}

function GitFileRow({
  entry,
  isSelected,
  checked,
  isMutating,
  onSelect,
  onContextMenu,
  onToggle,
}: {
  entry: DiffFileEntry;
  isSelected: boolean;
  checked: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggle: () => void;
}) {
  const parts = entry.path.split("/");
  const filename = parts.pop()!;
  const dir = parts.join("/");
  const color = gitStatusColor(entry.status, checked);
  const badge = gitStatusBadge(entry.status, checked);

  return (
    <div
      role="row"
      className={cn(
        "flex items-center gap-1.5 px-2 py-[3px] cursor-pointer",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected && "bg-[var(--color-primary)]/15",
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {isMutating ? (
        <span className="h-3 w-3 shrink-0 inline-block animate-spin rounded-full border border-current border-t-transparent opacity-40" />
      ) : (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="h-3 w-3 shrink-0 cursor-pointer accent-[var(--color-primary)]"
          aria-label={checked ? `Unstage ${filename}` : `Stage ${filename}`}
        />
      )}
      <span className={cn("text-[9px] font-bold w-3 shrink-0 text-center leading-none", color)}>
        {badge}
      </span>
      <span className={cn("text-[11px] truncate flex-1", color, isSelected && "!text-[var(--color-primary)]")}>
        {filename}
      </span>
      {dir && (
        <span className="text-[9px] text-[var(--color-text-muted)]/60 truncate max-w-[45%] shrink-0 pl-1">
          {dir}
        </span>
      )}
    </div>
  );
}

function GitContextMenuPopover({
  x, y,
  entry,
  section,
  onStage,
  onUnstage,
  onDiscard,
  onClose,
}: {
  x: number;
  y: number;
  entry: DiffFileEntry;
  section: "changes" | "unversioned";
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  type Action = { label: string; onClick: () => void; danger?: boolean };
  const actions: Action[] = [];

  if (section === "unversioned" || !entry.staged) {
    actions.push({ label: "Add to commit", onClick: onStage });
  }
  if (entry.staged) {
    actions.push({ label: "Remove from commit", onClick: onUnstage });
  }
  if (section !== "unversioned" && entry.status !== "conflicted") {
    actions.push({ label: "Discard changes", onClick: onDiscard, danger: true });
  }

  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 60,
    top: Math.min(y, window.innerHeight - 120),
    left: Math.min(x, window.innerWidth - 170),
  };

  return (
    <div
      ref={ref}
      style={style}
      className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1"
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => { a.onClick(); onClose(); }}
          className={cn(
            "w-full flex items-center px-3 py-1.5 text-xs text-left transition-colors",
            a.danger
              ? "text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

const UNTRACKED_PAGE_SIZE = 500;

export function ChangedFilesList({ project, selectedFile, onSelectFile }: ChangedFilesListProps) {
  const [commitMsg, setCommitMsg] = useState("");
  const [mutatingPaths, setMutatingPaths] = useState<Set<string>>(new Set());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<GitContextMenuState | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(true);
  const [unversionedOpen, setUnversionedOpen] = useState(true);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);
  const [untrackedPage, setUntrackedPage] = useState(0);
  const [extraUntracked, setExtraUntracked] = useState<DiffFileEntry[]>([]);

  const { data, isLoading, isError, refetch } = useGitDiff(project);
  const stageMutation = useGitStage(project);
  const unstageMutation = useGitUnstage(project);
  const discardMutation = useGitDiscard(project);
  const commitMutation = useGitCommit(project);

  // Guard against stale cache holding old DiffFileEntry[] shape before response format changed
  const isLegacyShape = Array.isArray(data);
  const entries = isLegacyShape ? (data as unknown as DiffFileEntry[]) : (data?.entries ?? []);
  const untrackedTruncated = isLegacyShape ? false : (data?.untrackedTruncated ?? false);
  const untrackedTotal = isLegacyShape ? 0 : (data?.untrackedTotal ?? 0);

  // Fetch next page of untracked files when user clicks "Load more"
  const { data: nextPageData, isFetching: isLoadingMore } = useGitUntracked(
    project,
    (untrackedPage + 1) * UNTRACKED_PAGE_SIZE,
    UNTRACKED_PAGE_SIZE,
    untrackedTruncated && untrackedPage >= 0,
  );

  // Accumulate loaded pages; reset when project or base diff changes
  useEffect(() => {
    setExtraUntracked([]);
    setUntrackedPage(0);
  }, [project, data]);

  useEffect(() => {
    if (nextPageData && untrackedPage > 0) {
      setExtraUntracked((prev) => {
        const existingPaths = new Set(prev.map((f) => f.path));
        const fresh = nextPageData.filter((f) => !existingPaths.has(f.path));
        return [...prev, ...fresh];
      });
    }
  }, [nextPageData, untrackedPage]);

  const changedFiles = entries.filter((f) => !(f.status === "added" && !f.staged));
  const unversionedFiles = [
    ...entries.filter((f) => f.status === "added" && !f.staged),
    ...extraUntracked,
  ];
  const stagedCount = entries.filter((f) => f.staged).length;
  const hasMoreUntracked = untrackedTruncated && unversionedFiles.length < untrackedTotal;

  function handleLoadMoreUntracked() {
    setUntrackedPage((p) => p + 1);
  }

  const trackMutating = useCallback((path: string) => {
    setMutatingPaths((p) => new Set([...p, path]));
    return () => setMutatingPaths((p) => { const n = new Set(p); n.delete(path); return n; });
  }, []);

  async function handleStage(path: string) {
    const untrack = trackMutating(path);
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
    const untrack = trackMutating(path);
    setMutationError(null);
    try {
      await unstageMutation.mutateAsync([path]);
    } catch {
      setMutationError(`Failed to unstage ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleDiscard(path: string) {
    const untrack = trackMutating(path);
    setMutationError(null);
    try {
      await discardMutation.mutateAsync(path);
      setDiscardConfirm(null);
    } catch {
      setMutationError(`Failed to discard ${path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleStageAll(paths: string[]) {
    if (paths.length === 0) return;
    setMutationError(null);
    try {
      await stageMutation.mutateAsync(paths);
    } catch {
      setMutationError("Failed to stage all");
    }
  }

  async function handleUnstageAll(paths: string[]) {
    if (paths.length === 0) return;
    setMutationError(null);
    try {
      await unstageMutation.mutateAsync(paths);
    } catch {
      setMutationError("Failed to unstage all");
    }
  }

  async function handleCommit() {
    if (!commitMsg.trim() || stagedCount === 0) return;
    setMutationError(null);
    try {
      const result = await commitMutation.mutateAsync(commitMsg);
      setCommitMsg("");
      setCommitSuccess(result.hash.slice(0, 7));
      setTimeout(() => setCommitSuccess(null), 3000);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Commit failed");
    }
  }

  const changedStageable = changedFiles.filter((f) => f.status !== "conflicted");
  const changedStagedCount = changedStageable.filter((f) => f.staged).length;
  const changedCheckState: "all" | "some" | "none" =
    changedStageable.length === 0
      ? "none"
      : changedStagedCount === changedStageable.length
        ? "all"
        : changedStagedCount > 0
          ? "some"
          : "none";

  function handleChangesCheckAll() {
    if (changedCheckState === "all") {
      void handleUnstageAll(changedStageable.map((f) => f.path));
    } else {
      void handleStageAll(changedStageable.filter((f) => !f.staged).map((f) => f.path));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading changes…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-xs text-[var(--color-danger)]">
        <AlertTriangle className="h-5 w-5" />
        <span>Failed to load changes</span>
        <button onClick={() => void refetch()} className="text-[10px] text-[var(--color-primary)] hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 text-xs overflow-hidden min-h-0">
      {/* Panel header */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-bold tracking-widest text-[var(--color-text-muted)] uppercase">
          Local Changes
        </span>
        <button
          onClick={() => void refetch()}
          aria-label="Refresh changes"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Error banner */}
      {mutationError && (
        <div
          role="alert"
          className="shrink-0 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 flex items-center justify-between gap-2"
        >
          <span className="text-[var(--color-danger)] text-[10px] truncate">{mutationError}</span>
          <button
            onClick={() => setMutationError(null)}
            aria-label="Dismiss error"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px] shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Commit success flash */}
      {commitSuccess && (
        <div className="shrink-0 px-3 py-1.5 bg-green-500/10 border-b border-green-500/20 text-[10px] text-green-400">
          Committed {commitSuccess}
        </div>
      )}

      {/* Discard confirm */}
      {discardConfirm && (
        <div
          role="alertdialog"
          className="shrink-0 px-3 py-2 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)]"
        >
          <p className="text-[10px] font-medium mb-1">Discard changes to:</p>
          <p className="font-mono text-[9px] mb-2 truncate opacity-80">{discardConfirm}</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleDiscard(discardConfirm)}
              disabled={mutatingPaths.has(discardConfirm)}
              className="px-2 py-0.5 text-[10px] bg-[var(--color-danger)] text-white rounded-sm hover:opacity-80 disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={() => setDiscardConfirm(null)}
              className="px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-sm border border-[var(--color-border)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && !untrackedTruncated ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-[var(--color-text-muted)]">
            <span className="text-2xl opacity-20">✓</span>
            <span className="text-[11px]">No local changes</span>
          </div>
        ) : (
          <>
            {changedFiles.length > 0 && (
              <>
                <GitSectionHeader
                  label="Changes"
                  count={changedFiles.length}
                  open={changesOpen}
                  onToggle={() => setChangesOpen((v) => !v)}
                  checkState={changedCheckState}
                  onCheckAll={handleChangesCheckAll}
                />
                {changesOpen && changedFiles.map((f) => (
                  <GitFileRow
                    key={f.path}
                    entry={f}
                    isSelected={selectedFile === f.path}
                    checked={f.staged}
                    isMutating={mutatingPaths.has(f.path)}
                    onSelect={() => onSelectFile(f.path, f.status === "conflicted")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, entry: f, section: "changes" });
                    }}
                    onToggle={() => void (f.staged ? handleUnstage(f.path) : handleStage(f.path))}
                  />
                ))}
              </>
            )}

            {(unversionedFiles.length > 0 || untrackedTruncated) && (
              <>
                <GitSectionHeader
                  label="Unversioned Files"
                  count={untrackedTruncated ? untrackedTotal : unversionedFiles.length}
                  open={unversionedOpen}
                  onToggle={() => setUnversionedOpen((v) => !v)}
                  checkState="none"
                  onCheckAll={() => void handleStageAll(unversionedFiles.map((f) => f.path))}
                />
                {unversionedOpen && (
                  <>
                    {untrackedTruncated && (
                      <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)]/50 border-b border-[var(--color-border)]/40">
                        Showing {unversionedFiles.length} of {untrackedTotal.toLocaleString()} unversioned files
                      </div>
                    )}
                    {unversionedFiles.map((f) => (
                      <GitFileRow
                        key={f.path}
                        entry={f}
                        isSelected={selectedFile === f.path}
                        checked={false}
                        isMutating={mutatingPaths.has(f.path)}
                        onSelect={() => onSelectFile(f.path, false)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, entry: f, section: "unversioned" });
                        }}
                        onToggle={() => void handleStage(f.path)}
                      />
                    ))}
                    {hasMoreUntracked && (
                      <button
                        onClick={handleLoadMoreUntracked}
                        disabled={isLoadingMore}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] text-[var(--color-primary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 border-t border-[var(--color-border)]/40"
                      >
                        {isLoadingMore
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                          : `Load ${Math.min(UNTRACKED_PAGE_SIZE, untrackedTotal - unversionedFiles.length).toLocaleString()} more`}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Commit area */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-2 flex flex-col gap-1.5">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleCommit();
          }}
          placeholder="Commit message…"
          rows={2}
          className="w-full resize-none rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/50 transition-colors"
        />
        <button
          onClick={() => void handleCommit()}
          disabled={!commitMsg.trim() || stagedCount === 0 || commitMutation.isPending}
          className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium rounded-sm bg-[var(--color-primary)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {commitMutation.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Check className="h-3 w-3" />}
          Commit{stagedCount > 0 ? ` ${stagedCount} file${stagedCount !== 1 ? "s" : ""}` : ""}
        </button>
      </div>

      {/* Git file context menu */}
      {contextMenu && (
        <GitContextMenuPopover
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          section={contextMenu.section}
          onStage={() => void handleStage(contextMenu.entry.path)}
          onUnstage={() => void handleUnstage(contextMenu.entry.path)}
          onDiscard={() => setDiscardConfirm(contextMenu.entry.path)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
