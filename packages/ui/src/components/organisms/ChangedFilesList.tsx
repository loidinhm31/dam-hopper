import {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ComponentPropsWithoutRef,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useGitDiff, useGitUntracked } from "@/api/queries.js";
import { api } from "@/api/client.js";
import type { DiffFileEntry } from "@/api/client.js";
import { FilePathLabel } from "@/components/atoms/FilePathLabel.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";

// ---------------------------------------------------------------------------
// ChangedFilesList — IntelliJ-style local changes panel
// ---------------------------------------------------------------------------

export interface ChangedFilesListProps {
  project: string;
  selectedFile: string | null;
  onSelectFile: (path: string, isConflict: boolean) => void;
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
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
        )}
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

type GitFileRowProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "onClick" | "role"
> & {
  entry: DiffFileEntry;
  isSelected: boolean;
  checked: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onToggle: () => void;
};

const GitFileRow = forwardRef<HTMLDivElement, GitFileRowProps>(
  function GitFileRow(
    { entry, isSelected, checked, isMutating, onSelect, onToggle, ...props },
    ref,
  ) {
    const filename = entry.path.split("/").pop() ?? entry.path;
    const color = gitStatusColor(entry.status, checked);
    const badge = gitStatusBadge(entry.status, checked);

    return (
      <div
        {...props}
        ref={ref}
        role="row"
        className={cn(
          "flex items-center gap-1.5 px-2 py-[3px] cursor-pointer",
          "hover:bg-[var(--color-surface-2)] transition-colors",
          isSelected && "bg-[var(--color-primary)]/15",
        )}
        onClick={onSelect}
      >
        {isMutating ? (
          <span className="h-3 w-3 shrink-0 inline-block animate-spin rounded-full border border-current border-t-transparent opacity-40" />
        ) : (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="h-3 w-3 shrink-0 cursor-pointer accent-[var(--color-primary)]"
            aria-label={checked ? `Unstage ${filename}` : `Stage ${filename}`}
          />
        )}
        <span
          className={cn(
            "text-[9px] font-bold w-3 shrink-0 text-center leading-none",
            color,
          )}
        >
          {badge}
        </span>
        <FilePathLabel
          path={entry.path}
          className={cn(
            "text-[11px]",
            color,
            isSelected && "!text-[var(--color-primary)]",
          )}
          fileNameClassName="text-[11px] text-current font-normal"
          dirClassName="text-[9px] text-[var(--color-text-muted)]/60"
        />
      </div>
    );
  },
);

function GitContextMenuPopover({
  entry,
  section,
  onStage,
  onUnstage,
  onDiscard,
  children,
}: {
  entry: DiffFileEntry;
  section: "changes" | "unversioned";
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  children: React.ReactElement;
}) {
  type Action = { label: string; onClick: () => void; danger?: boolean };
  const actions: Action[] = [];

  if (section === "unversioned" || !entry.staged) {
    actions.push({ label: "Add to commit", onClick: onStage });
  }
  if (entry.staged) {
    actions.push({ label: "Remove from commit", onClick: onUnstage });
  }
  if (section !== "unversioned" && entry.status !== "conflicted") {
    actions.push({
      label: "Discard changes",
      onClick: onDiscard,
      danger: true,
    });
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="w-44">
          {actions.map((action) => (
            <ContextMenu.Item
              key={action.label}
              onSelect={action.onClick}
              className={cn(
                action.danger &&
                  "text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]",
              )}
            >
              {action.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const PRIMARY_ROOT_ID = ".";
const AGGREGATE_ROOT_ID = "*";
const UNTRACKED_PAGE_SIZE = 500;

export function entryRootId(entry: DiffFileEntry) {
  return entry.rootId ?? PRIMARY_ROOT_ID;
}

export function entryRootLabel(entry: DiffFileEntry) {
  return (
    entry.rootPath ??
    (entryRootId(entry) === PRIMARY_ROOT_ID
      ? "Project root"
      : entryRootId(entry))
  );
}

export function projectPathForEntry(entry: DiffFileEntry) {
  const rootId = entryRootId(entry);
  if (rootId === PRIMARY_ROOT_ID || entry.path.startsWith(`${rootId}/`)) {
    return entry.path;
  }
  return `${rootId}/${entry.path}`;
}

export function groupedByRoot(entries: DiffFileEntry[]) {
  const groups = new Map<string, { label: string; entries: DiffFileEntry[] }>();
  for (const entry of entries) {
    const rootId = entryRootId(entry);
    const existing = groups.get(rootId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(rootId, { label: entryRootLabel(entry), entries: [entry] });
    }
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === PRIMARY_ROOT_ID) return -1;
    if (b === PRIMARY_ROOT_ID) return 1;
    return a.localeCompare(b);
  });
}

export function stagedRootIdsForEntries(entries: DiffFileEntry[]) {
  return [...new Set(entries.filter((f) => f.staged).map(entryRootId))];
}

export function ChangedFilesList({
  project,
  selectedFile,
  onSelectFile,
}: ChangedFilesListProps) {
  const queryClient = useQueryClient();
  const [commitMsg, setCommitMsg] = useState("");
  const [amendCommit, setAmendCommit] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [mutatingPaths, setMutatingPaths] = useState<Set<string>>(new Set());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState<DiffFileEntry | null>(
    null,
  );
  const [changesOpen, setChangesOpen] = useState(true);
  const [unversionedOpen, setUnversionedOpen] = useState(true);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);
  const [untrackedPage, setUntrackedPage] = useState(0);
  const [extraUntracked, setExtraUntracked] = useState<DiffFileEntry[]>([]);

  const { data, isLoading, isError, refetch } = useGitDiff(
    project,
    AGGREGATE_ROOT_ID,
  );

  // Guard against stale cache holding old DiffFileEntry[] shape before response format changed
  const isLegacyShape = Array.isArray(data);
  const entries = isLegacyShape
    ? (data as unknown as DiffFileEntry[])
    : (data?.entries ?? []);
  const untrackedTruncated = isLegacyShape
    ? false
    : (data?.untrackedTruncated ?? false);
  const untrackedTotal = isLegacyShape ? 0 : (data?.untrackedTotal ?? 0);

  // Fetch next page of untracked files when user clicks "Load more"
  const { data: nextPageData, isFetching: isLoadingMore } = useGitUntracked(
    project,
    (untrackedPage + 1) * UNTRACKED_PAGE_SIZE,
    UNTRACKED_PAGE_SIZE,
    false,
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

  const changedFiles = entries.filter(
    (f) => !(f.status === "added" && !f.staged),
  );
  const unversionedFiles = [
    ...entries.filter((f) => f.status === "added" && !f.staged),
    ...extraUntracked,
  ];
  const changedFileGroups = groupedByRoot(changedFiles);
  const unversionedFileGroups = groupedByRoot(unversionedFiles);
  const hasMultipleUnversionedRoots = unversionedFileGroups.length > 1;
  const stagedCount = entries.filter((f) => f.staged).length;
  const stagedRootIds = stagedRootIdsForEntries(entries);
  const hasMixedStagedRoots = stagedRootIds.length > 1;
  const commitRootId = stagedRootIds[0] ?? PRIMARY_ROOT_ID;
  const hasMoreUntracked = false;

  async function invalidateChanges() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["git-diff", project] }),
      queryClient.invalidateQueries({ queryKey: ["git-untracked", project] }),
      queryClient.invalidateQueries({ queryKey: ["project-status", project] }),
    ]);
  }

  function handleLoadMoreUntracked() {
    setUntrackedPage((p) => p + 1);
  }

  const trackMutating = useCallback((path: string) => {
    setMutatingPaths((p) => new Set([...p, path]));
    return () =>
      setMutatingPaths((p) => {
        const n = new Set(p);
        n.delete(path);
        return n;
      });
  }, []);

  async function handleStage(entry: DiffFileEntry) {
    const key = projectPathForEntry(entry);
    const untrack = trackMutating(key);
    setMutationError(null);
    try {
      await api.git.stage(project, [entry.path], entryRootId(entry));
      await invalidateChanges();
    } catch {
      setMutationError(`Failed to stage ${entry.path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleUnstage(entry: DiffFileEntry) {
    const key = projectPathForEntry(entry);
    const untrack = trackMutating(key);
    setMutationError(null);
    try {
      await api.git.unstage(project, [entry.path], entryRootId(entry));
      await invalidateChanges();
    } catch {
      setMutationError(`Failed to unstage ${entry.path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleDiscard(entry: DiffFileEntry) {
    const key = projectPathForEntry(entry);
    const untrack = trackMutating(key);
    setMutationError(null);
    try {
      await api.git.discard(project, entry.path, entryRootId(entry));
      await invalidateChanges();
      setDiscardConfirm(null);
    } catch {
      setMutationError(`Failed to discard ${entry.path.split("/").pop()}`);
    } finally {
      untrack();
    }
  }

  async function handleStageAll(files: DiffFileEntry[]) {
    if (files.length === 0) return;
    setMutationError(null);
    try {
      await Promise.all(
        groupedByRoot(files).map(([rootId, group]) =>
          api.git.stage(
            project,
            group.entries.map((entry) => entry.path),
            rootId,
          ),
        ),
      );
      await invalidateChanges();
    } catch {
      setMutationError("Failed to stage all");
    }
  }

  async function handleUnstageAll(files: DiffFileEntry[]) {
    if (files.length === 0) return;
    setMutationError(null);
    try {
      await Promise.all(
        groupedByRoot(files).map(([rootId, group]) =>
          api.git.unstage(
            project,
            group.entries.map((entry) => entry.path),
            rootId,
          ),
        ),
      );
      await invalidateChanges();
    } catch {
      setMutationError("Failed to unstage all");
    }
  }

  async function handleCommit() {
    if (!commitMsg.trim() || stagedCount === 0 || hasMixedStagedRoots) return;
    setMutationError(null);
    setIsCommitting(true);
    try {
      const result = await api.git.commit(
        project,
        commitMsg,
        amendCommit,
        commitRootId,
      );
      await invalidateChanges();
      setCommitMsg("");
      setAmendCommit(false);
      setCommitSuccess(result.hash.slice(0, 7));
      setTimeout(() => setCommitSuccess(null), 3000);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setIsCommitting(false);
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
        <button
          onClick={() => void refetch()}
          className="text-[10px] text-[var(--color-primary)] hover:underline"
        >
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
          <span className="text-[var(--color-danger)] text-[10px] truncate">
            {mutationError}
          </span>
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
          <p className="font-mono text-[9px] mb-2 truncate opacity-80">
            {projectPathForEntry(discardConfirm)}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleDiscard(discardConfirm)}
              disabled={mutatingPaths.has(projectPathForEntry(discardConfirm))}
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
                {changedFileGroups.map(([rootId, group]) => {
                  const stageable = group.entries.filter(
                    (f) => f.status !== "conflicted",
                  );
                  const staged = stageable.filter((f) => f.staged).length;
                  const checkState: "all" | "some" | "none" =
                    stageable.length === 0
                      ? "none"
                      : staged === stageable.length
                        ? "all"
                        : staged > 0
                          ? "some"
                          : "none";
                  return (
                    <div key={rootId}>
                      <GitSectionHeader
                        label={`Changes · ${group.label}`}
                        count={group.entries.length}
                        open={changesOpen}
                        onToggle={() => setChangesOpen((v) => !v)}
                        checkState={checkState}
                        onCheckAll={() =>
                          checkState === "all"
                            ? void handleUnstageAll(stageable)
                            : void handleStageAll(
                                stageable.filter((f) => !f.staged),
                              )
                        }
                      />
                      {changesOpen &&
                        group.entries.map((f) => {
                          const projectPath = projectPathForEntry(f);
                          return (
                            <GitContextMenuPopover
                              key={projectPath}
                              entry={f}
                              section="changes"
                              onStage={() => void handleStage(f)}
                              onUnstage={() => void handleUnstage(f)}
                              onDiscard={() => setDiscardConfirm(f)}
                            >
                              <GitFileRow
                                entry={{ ...f, path: projectPath }}
                                isSelected={selectedFile === projectPath}
                                checked={f.staged}
                                isMutating={mutatingPaths.has(projectPath)}
                                onSelect={() =>
                                  onSelectFile(
                                    projectPath,
                                    f.status === "conflicted",
                                  )
                                }
                                onToggle={() =>
                                  void (f.staged
                                    ? handleUnstage(f)
                                    : handleStage(f))
                                }
                              />
                            </GitContextMenuPopover>
                          );
                        })}
                    </div>
                  );
                })}
              </>
            )}

            {(unversionedFiles.length > 0 || untrackedTruncated) && (
              <>
                <GitSectionHeader
                  label="Unversioned Files"
                  count={
                    untrackedTruncated
                      ? untrackedTotal
                      : unversionedFiles.length
                  }
                  open={unversionedOpen}
                  onToggle={() => setUnversionedOpen((v) => !v)}
                  checkState="none"
                  onCheckAll={() => void handleStageAll(unversionedFiles)}
                />
                {unversionedOpen && (
                  <>
                    {untrackedTruncated && (
                      <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)]/50 border-b border-[var(--color-border)]/40">
                        Showing {unversionedFiles.length} of{" "}
                        {untrackedTotal.toLocaleString()} unversioned files
                      </div>
                    )}
                    {unversionedFileGroups.map(([rootId, group]) => (
                      <div key={rootId}>
                        {hasMultipleUnversionedRoots && (
                          <div className="px-2 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-surface)]/70">
                            {group.label}
                          </div>
                        )}
                        {group.entries.map((f) => {
                          const projectPath = projectPathForEntry(f);
                          return (
                            <GitContextMenuPopover
                              key={projectPath}
                              entry={f}
                              section="unversioned"
                              onStage={() => void handleStage(f)}
                              onUnstage={() => void handleUnstage(f)}
                              onDiscard={() => setDiscardConfirm(f)}
                            >
                              <GitFileRow
                                entry={{ ...f, path: projectPath }}
                                isSelected={selectedFile === projectPath}
                                checked={false}
                                isMutating={mutatingPaths.has(projectPath)}
                                onSelect={() =>
                                  onSelectFile(projectPath, false)
                                }
                                onToggle={() => void handleStage(f)}
                              />
                            </GitContextMenuPopover>
                          );
                        })}
                      </div>
                    ))}
                    {hasMoreUntracked && (
                      <button
                        onClick={handleLoadMoreUntracked}
                        disabled={isLoadingMore}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] text-[var(--color-primary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 border-t border-[var(--color-border)]/40"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />{" "}
                            Loading…
                          </>
                        ) : (
                          `Load ${Math.min(UNTRACKED_PAGE_SIZE, untrackedTotal - unversionedFiles.length).toLocaleString()} more`
                        )}
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
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
              void handleCommit();
          }}
          placeholder="Commit message…"
          rows={2}
          className="w-full resize-none rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/50 transition-colors"
        />
        <label className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={amendCommit}
            onChange={(event) => setAmendCommit(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-primary)]"
          />
          Amend previous commit
        </label>
        {hasMixedStagedRoots && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
            Commit blocked: staged files span multiple VCS roots. Unstage files
            until one root remains.
          </div>
        )}
        <button
          onClick={() => void handleCommit()}
          disabled={
            !commitMsg.trim() ||
            stagedCount === 0 ||
            hasMixedStagedRoots ||
            isCommitting
          }
          className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium rounded-sm bg-[var(--color-primary)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {isCommitting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {amendCommit ? "Amend Commit" : "Commit"}
          {stagedCount > 0
            ? ` ${stagedCount} file${stagedCount !== 1 ? "s" : ""}`
            : ""}
        </button>
      </div>
    </div>
  );
}
