import type { GitLogEntry, DiffFileEntry } from "@/api/client.js";
import { useGitCommitFiles } from "@/api/queries.js";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils.js";

interface CommitDetailsPanelProps {
  project: string;
  commit: GitLogEntry;
  onClose: () => void;
  onFileDoubleClick: (file: DiffFileEntry) => void;
}

export function CommitDetailsPanel({ project, commit, onClose, onFileDoubleClick }: CommitDetailsPanelProps) {
  const { data: files, isLoading } = useGitCommitFiles(project, commit.hash);

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-hidden animate-in slide-in-from-right duration-200">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-bold text-[var(--color-text)] truncate pr-2" title={commit.message}>
            {commit.message}
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-[var(--color-text-muted)] truncate">
              {commit.authorName}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]/40">•</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {new Date(commit.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
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
            {files?.map((file) => (
              <div
                key={file.path}
                onDoubleClick={() => onFileDoubleClick(file)}
                className="group flex items-center justify-between px-2 py-1 hover:bg-[var(--color-primary)]/5 rounded cursor-default select-none transition-colors"
                title="Double-click to see historical diff"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={file.status} />
                  <span className="text-[11px] truncate text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors">
                    {file.path}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono shrink-0 opacity-80 group-hover:opacity-100">
                  {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-rose-500">-{file.deletions}</span>}
                </div>
              </div>
            ))}
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

function StatusBadge({ status }: { status: string }) {
  const color = 
    status === "added" ? "text-emerald-500" : 
    status === "deleted" ? "text-rose-500" : 
    status === "renamed" ? "text-blue-500" : 
    "text-amber-500";
    
  const char = 
    status === "added" ? "A" : 
    status === "deleted" ? "D" : 
    status === "renamed" ? "R" : 
    "M";

  return (
    <span className={cn("w-3.5 h-3.5 flex items-center justify-center text-[9px] font-black rounded-[2px] border border-current opacity-70", color)}>
      {char}
    </span>
  );
}
