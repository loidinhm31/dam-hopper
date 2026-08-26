import { useState } from "react";
import type { MouseEvent } from "react";
import type {
  GitLogEntry,
  DiffFileEntry,
  ProjectTargetRef,
} from "@/api/client.js";
import { normalizeProjectTarget } from "@/api/client.js";
import { useGitCommitFiles } from "@/api/queries.js";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";

interface CommitDetailsPanelProps {
  project: string;
  target?: ProjectTargetRef;
  root?: string;
  commit: GitLogEntry;
  onClose: () => void;
  onFileDoubleClick: (file: DiffFileEntry) => void;
  onCherryPickSelectedChanges?: (
    commit: GitLogEntry,
    files: DiffFileEntry[],
  ) => void;
  onRevertSelectedChanges?: (
    commit: GitLogEntry,
    files: DiffFileEntry[],
  ) => void;
  onDropSelectedChanges?: (commit: GitLogEntry, files: DiffFileEntry[]) => void;
}

interface FileSelectionState {
  commitHash: string;
  paths: Set<string>;
  lastSelectedIndex: number | null;
}

export function CommitDetailsPanel({
  project,
  target,
  root,
  commit,
  onClose,
  onFileDoubleClick,
  onCherryPickSelectedChanges,
  onRevertSelectedChanges,
  onDropSelectedChanges,
}: CommitDetailsPanelProps) {
  const targetRef = normalizeProjectTarget(target ?? project);
  const { data: files, isLoading } = useGitCommitFiles(
    targetRef,
    commit.hash,
    root,
  );
  const [selection, setSelection] = useState<FileSelectionState>({
    commitHash: commit.hash,
    paths: new Set(),
    lastSelectedIndex: null,
  });

  const selectedPaths =
    selection.commitHash === commit.hash ? selection.paths : new Set<string>();
  const selectedFiles =
    files?.filter((file) => selectedPaths.has(file.path)) ?? [];

  function selectFile(file: DiffFileEntry, index: number, event: MouseEvent) {
    if (!files) return;

    if (event.shiftKey && selection.lastSelectedIndex !== null) {
      const start = Math.min(selection.lastSelectedIndex, index);
      const end = Math.max(selection.lastSelectedIndex, index);
      setSelection({
        commitHash: commit.hash,
        paths: new Set(files.slice(start, end + 1).map((entry) => entry.path)),
        lastSelectedIndex: selection.lastSelectedIndex,
      });
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      setSelection((current) => {
        const basePaths =
          current.commitHash === commit.hash
            ? current.paths
            : new Set<string>();
        const next = new Set(basePaths);
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
        return {
          commitHash: commit.hash,
          paths: next,
          lastSelectedIndex: index,
        };
      });
      return;
    }

    setSelection({
      commitHash: commit.hash,
      paths: new Set([file.path]),
      lastSelectedIndex: index,
    });
  }

  function selectContextFile(file: DiffFileEntry, index: number) {
    if (!selectedPaths.has(file.path)) {
      setSelection({
        commitHash: commit.hash,
        paths: new Set([file.path]),
        lastSelectedIndex: index,
      });
    }
  }

  function handleCherryPickSelectedChanges() {
    onCherryPickSelectedChanges?.(commit, selectedFiles);
  }

  function handleRevertSelectedChanges() {
    onRevertSelectedChanges?.(commit, selectedFiles);
  }

  function handleDropSelectedChanges() {
    onDropSelectedChanges?.(commit, selectedFiles);
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-hidden animate-in slide-in-from-right duration-200">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex flex-col min-w-0">
          <span
            className="text-[11px] font-bold text-[var(--color-text)] truncate pr-2"
            title={commit.message}
          >
            {commit.message}
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-[var(--color-text-muted)] truncate">
              {commit.authorName}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]/40">
              •
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {new Date(commit.timestamp * 1000).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-background)] px-1 rounded ml-1">
              {commit.hash.substring(0, 7)}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 hover:bg-[var(--color-surface)] rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)] text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading files...
          </div>
        ) : (
          <div className="space-y-0.5">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] opacity-60">
              Files ({files?.length ?? 0})
            </div>
            {files?.map((file, index) => {
              const isSelected = selectedPaths.has(file.path);
              return (
                <CommitFileContextMenu
                  key={file.path}
                  count={selectedFiles.length}
                  canDrop={Boolean(onDropSelectedChanges) && !commit.isPushed}
                  onOpen={() => selectContextFile(file, index)}
                  onCherryPick={handleCherryPickSelectedChanges}
                  onRevert={handleRevertSelectedChanges}
                  onDrop={handleDropSelectedChanges}
                >
                  <div
                    tabIndex={0}
                    aria-selected={isSelected}
                    aria-haspopup="menu"
                    onClick={(event) => selectFile(file, index, event)}
                    onDoubleClick={() => onFileDoubleClick(file)}
                    className={cn(
                      "group flex items-center justify-between px-2 py-1 rounded cursor-default select-none transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40",
                      isSelected
                        ? "bg-[var(--color-primary)]/10"
                        : "hover:bg-[var(--color-primary)]/5",
                    )}
                    title="Double-click to see historical diff"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={file.status} />
                      <span className="text-[11px] truncate text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors">
                        {file.path}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono shrink-0 opacity-80 group-hover:opacity-100">
                      {file.additions > 0 && (
                        <span className="text-emerald-500">
                          +{file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-rose-500">-{file.deletions}</span>
                      )}
                    </div>
                  </div>
                </CommitFileContextMenu>
              );
            })}
            {!files?.length && (
              <div className="px-2 py-4 text-center text-xs text-[var(--color-text-muted)] italic">
                No file changes in this commit
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommitFileContextMenu({
  count,
  canDrop,
  onOpen,
  onCherryPick,
  onRevert,
  onDrop,
  children,
}: {
  count: number;
  canDrop: boolean;
  onOpen: () => void;
  onCherryPick: () => void;
  onRevert: () => void;
  onDrop: () => void;
  children: React.ReactElement;
}) {
  return (
    <ContextMenu.Root onOpenChange={(open) => open && onOpen()}>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="w-56">
          <ContextMenu.Item disabled={count === 0} onSelect={onCherryPick}>
            Cherry-Pick Selected Changes
          </ContextMenu.Item>
          <ContextMenu.Item disabled={count === 0} onSelect={onRevert}>
            Revert Selected Changes
          </ContextMenu.Item>
          <ContextMenu.Item
            disabled={count === 0 || !canDrop}
            title={
              canDrop
                ? undefined
                : "Drop Selected Changes is only available while viewing the checked-out branch and for commits not pushed upstream"
            }
            onSelect={onDrop}
            className="text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]"
          >
            Drop Selected Changes
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "added"
      ? "text-emerald-500"
      : status === "deleted"
        ? "text-rose-500"
        : status === "renamed"
          ? "text-blue-500"
          : "text-amber-500";

  const char =
    status === "added"
      ? "A"
      : status === "deleted"
        ? "D"
        : status === "renamed"
          ? "R"
          : "M";

  return (
    <span
      className={cn(
        "w-3.5 h-3.5 flex items-center justify-center text-[9px] font-black rounded-[2px] border border-current opacity-70",
        color,
      )}
    >
      {char}
    </span>
  );
}
