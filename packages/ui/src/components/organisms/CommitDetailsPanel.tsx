import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type {
  GitLogEntry,
  DiffFileEntry,
  ProjectTargetRef,
} from "@/api/client.js";
import { normalizeProjectTarget } from "@/api/client.js";
import { useGitCommitFiles, useGitCommitDetails } from "@/api/queries.js";
import { AlertCircle, Check, Copy, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { formatGitCommitAuthorTimestamp } from "@/lib/git-commit-reveal.js";

interface CommitDetailsPanelBaseProps {
  project: string;
  target?: ProjectTargetRef;
  root?: string;
  onClose: () => void;
  onFileDoubleClick: (file: DiffFileEntry) => void;
}

export interface CommitDetailsPanelHistoryProps extends CommitDetailsPanelBaseProps {
  mode: "history";
  commit: GitLogEntry;
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

export interface CommitDetailsPanelInspectProps extends CommitDetailsPanelBaseProps {
  mode: "inspect";
  commitHash: string;
  outsideViewNotice?: boolean;
}

export type CommitDetailsPanelProps =
  | CommitDetailsPanelHistoryProps
  | CommitDetailsPanelInspectProps;

interface FileSelectionState {
  commitHash: string;
  paths: Set<string>;
  lastSelectedIndex: number | null;
}

export function CommitDetailsPanel(props: CommitDetailsPanelProps) {
  const { project, target, root, onClose, onFileDoubleClick } = props;
  const targetRef = normalizeProjectTarget(target ?? project);
  const commitHash =
    props.mode === "inspect" ? props.commitHash : props.commit.hash;

  const { data: details, error: detailsError } = useGitCommitDetails(
    targetRef,
    commitHash,
    root,
    Boolean(commitHash),
  );

  const { data: files, isLoading: filesLoading } = useGitCommitFiles(
    targetRef,
    commitHash,
    root,
  );

  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const [selection, setSelection] = useState<FileSelectionState>({
    commitHash,
    paths: new Set(),
    lastSelectedIndex: null,
  });

  const handleCopyHash = () => {
    if (!commitHash) return;
    void navigator.clipboard.writeText(commitHash).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const selectedPaths =
    selection.commitHash === commitHash ? selection.paths : new Set<string>();
  const selectedFiles =
    files?.filter((file) => selectedPaths.has(file.path)) ?? [];

  const subject =
    details?.subject ??
    (props.mode === "history"
      ? props.commit.message
      : commitHash.substring(0, 7));

  const authorName =
    details?.authorName ??
    (props.mode === "history" ? props.commit.authorName : "...");

  const authorEmail =
    details?.authorEmail ??
    (props.mode === "history" ? props.commit.authorEmail : "");

  const timestampSeconds =
    details?.authorTimestamp ??
    (props.mode === "history" ? props.commit.timestamp : 0);

  const formattedTimestamp = timestampSeconds
    ? formatGitCommitAuthorTimestamp(
        timestampSeconds,
        details?.authorTimezoneOffsetMinutes,
      )
    : "";

  const committerName = details?.committerName ?? "";
  const committerEmail = details?.committerEmail ?? "";
  const committerTimestampSeconds = details?.committerTimestamp ?? 0;
  const formattedCommitterTimestamp = committerTimestampSeconds
    ? formatGitCommitAuthorTimestamp(
        committerTimestampSeconds,
        details?.committerTimezoneOffsetMinutes,
      )
    : "";

  const fullMessage =
    details?.fullMessage ??
    (props.mode === "history" ? props.commit.message : "");
  function selectFile(file: DiffFileEntry, index: number, event: MouseEvent) {
    if (!files) return;

    if (event.shiftKey && selection.lastSelectedIndex !== null) {
      const start = Math.min(selection.lastSelectedIndex, index);
      const end = Math.max(selection.lastSelectedIndex, index);
      setSelection({
        commitHash,
        paths: new Set(files.slice(start, end + 1).map((entry) => entry.path)),
        lastSelectedIndex: selection.lastSelectedIndex,
      });
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      setSelection((current) => {
        const basePaths =
          current.commitHash === commitHash ? current.paths : new Set<string>();
        const next = new Set(basePaths);
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
        return {
          commitHash,
          paths: next,
          lastSelectedIndex: index,
        };
      });
      return;
    }

    setSelection({
      commitHash,
      paths: new Set([file.path]),
      lastSelectedIndex: index,
    });
  }

  function selectContextFile(file: DiffFileEntry, index: number) {
    if (!selectedPaths.has(file.path)) {
      setSelection({
        commitHash,
        paths: new Set([file.path]),
        lastSelectedIndex: index,
      });
    }
  }

  function handleCherryPickSelectedChanges() {
    if (props.mode === "history") {
      props.onCherryPickSelectedChanges?.(props.commit, selectedFiles);
    }
  }

  function handleRevertSelectedChanges() {
    if (props.mode === "history") {
      props.onRevertSelectedChanges?.(props.commit, selectedFiles);
    }
  }

  function handleDropSelectedChanges() {
    if (props.mode === "history") {
      props.onDropSelectedChanges?.(props.commit, selectedFiles);
    }
  }
  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-hidden animate-in slide-in-from-right duration-200">
      {props.mode === "inspect" && props.outsideViewNotice && (
        <div
          data-testid="outside-history-view-notice"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-400 font-medium"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>
            Commit opened from annotation; outside current history view
          </span>
        </div>
      )}
      {detailsError && (
        <div
          data-testid="commit-details-error"
          className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 border-b border-rose-500/20 text-[11px] text-rose-400"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          <span>
            Failed to load commit details:{" "}
            {detailsError.message || "Commit not found"}
          </span>
        </div>
      )}
      <div className="shrink-0 flex items-start justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex flex-col min-w-0 pr-2">
          <span
            className="text-[12px] font-semibold text-[var(--color-text)] truncate"
            title={subject}
          >
            {subject}
          </span>
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] text-[var(--color-text-muted)]">
            <span
              className="font-medium text-[var(--color-text)] truncate max-w-[150px]"
              title={
                authorEmail ? `${authorName} <${authorEmail}>` : authorName
              }
            >
              {authorName}
            </span>
            {authorEmail && (
              <span className="text-[var(--color-text-muted)] truncate max-w-[180px]">
                &lt;{authorEmail}&gt;
              </span>
            )}
            {formattedTimestamp && (
              <>
                <span className="opacity-40">•</span>
                <span>{formattedTimestamp}</span>
              </>
            )}
            <button
              type="button"
              onClick={handleCopyHash}
              title={`Click to copy full commit hash: ${commitHash}`}
              className="font-mono text-[10px] bg-[var(--color-background)] hover:bg-[var(--color-surface)] px-1.5 py-0.5 rounded border border-[var(--color-border)] flex items-center gap-1 transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-1"
            >
              <span>{commitHash.substring(0, 7)}</span>
              {copied ? (
                <Check className="w-2.5 h-2.5 text-emerald-500" />
              ) : (
                <Copy className="w-2.5 h-2.5 opacity-60" />
              )}
            </button>
          </div>
          {Boolean(committerName || committerEmail) && (
            <div
              data-testid="commit-details-committer"
              className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] text-[var(--color-text-muted)]"
            >
              <span className="opacity-70">Committed by</span>
              <span
                className="font-medium text-[var(--color-text)] truncate max-w-[150px]"
                title={
                  committerEmail
                    ? `${committerName} <${committerEmail}>`
                    : committerName
                }
              >
                {committerName}
              </span>
              {committerEmail && (
                <span className="text-[var(--color-text-muted)] truncate max-w-[180px]">
                  &lt;{committerEmail}&gt;
                </span>
              )}
              {formattedCommitterTimestamp && (
                <>
                  <span className="opacity-40">•</span>
                  <span>{formattedCommitterTimestamp}</span>
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 hover:bg-[var(--color-surface)] rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          title="Close commit details"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {fullMessage && (
        <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-background)]/30 max-h-36 overflow-y-auto">
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-[var(--color-text)]/90 leading-relaxed select-text">
            {fullMessage}
          </pre>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {filesLoading ? (
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
              const fileItem = (
                <div
                  tabIndex={0}
                  aria-selected={isSelected}
                  aria-haspopup={props.mode === "history" ? "menu" : undefined}
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
              );

              if (props.mode === "history") {
                return (
                  <CommitFileContextMenu
                    key={file.path}
                    count={selectedFiles.length}
                    canDrop={
                      Boolean(props.onDropSelectedChanges) &&
                      !props.commit.isPushed
                    }
                    onOpen={() => selectContextFile(file, index)}
                    onCherryPick={handleCherryPickSelectedChanges}
                    onRevert={handleRevertSelectedChanges}
                    onDrop={handleDropSelectedChanges}
                  >
                    {fileItem}
                  </CommitFileContextMenu>
                );
              }

              return <div key={file.path}>{fileItem}</div>;
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
