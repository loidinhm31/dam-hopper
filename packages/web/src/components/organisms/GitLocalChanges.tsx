import React, { useState } from "react";
import { 
  useGitDiff, 
  useGitStage, 
  useGitUnstage, 
  useGitDiscard, 
  useGitCommit 
} from "@/api/queries.js";
import { Button } from "@/components/atoms/Button.js";

interface GitLocalChangesProps {
  project: string;
}

export function GitLocalChanges({ project }: GitLocalChangesProps) {
  const { data: diff, isLoading, refetch } = useGitDiff(project);
  const [commitMessage, setCommitMessage] = useState("");
  
  const stageMutation = useGitStage(project);
  const unstageMutation = useGitUnstage(project);
  const discardMutation = useGitDiscard(project);
  const commitMutation = useGitCommit(project);

  const stagedFiles = diff?.entries.filter(e => e.staged) || [];
  const unstagedFiles = diff?.entries.filter(e => !e.staged) || [];

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    await commitMutation.mutateAsync(commitMessage);
    setCommitMessage("");
    refetch();
  };

  if (isLoading) return <div className="p-4 text-sm text-[var(--color-text-muted)]">Loading changes...</div>;

  const totalChanges = stagedFiles.length + unstagedFiles.length;

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md overflow-hidden">
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Staged Changes */}
        <div>
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)] rounded">
            <span>Staged ({stagedFiles.length})</span>
            {stagedFiles.length > 0 && (
              <button 
                onClick={() => unstageMutation.mutate(stagedFiles.map(f => f.path))}
                className="hover:text-[var(--color-text)] transition-colors"
              >
                Unstage All
              </button>
            )}
          </div>
          <div className="mt-1 space-y-0.5">
            {stagedFiles.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-[var(--color-text-muted)] italic">No staged changes</div>
            ) : (
              stagedFiles.map(file => (
                <FileItem 
                  key={file.path} 
                  file={file} 
                  onAction={() => unstageMutation.mutate([file.path])}
                  actionLabel="-"
                  actionClass="text-amber-600"
                />
              ))
            )}
          </div>
        </div>

        {/* Unstaged Changes */}
        <div>
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)] rounded">
            <span>Unstaged ({unstagedFiles.length})</span>
            {unstagedFiles.length > 0 && (
              <button 
                onClick={() => stageMutation.mutate(unstagedFiles.map(f => f.path))}
                className="hover:text-[var(--color-text)] transition-colors"
              >
                Stage All
              </button>
            )}
          </div>
          <div className="mt-1 space-y-0.5">
            {unstagedFiles.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-[var(--color-text-muted)] italic">No local changes</div>
            ) : (
              unstagedFiles.map(file => (
                <div key={file.path} className="group flex items-center justify-between px-2 py-1 hover:bg-[var(--color-border)]/20 rounded cursor-default">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusIcon status={file.status} />
                    <span className="text-xs truncate text-[var(--color-text)]">{file.path}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => stageMutation.mutate([file.path])}
                      className="p-1 hover:bg-[var(--color-background)] rounded text-[var(--color-success)]"
                      title="Stage"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => {
                        if (confirm(`Discard changes in ${file.path}?`)) {
                          discardMutation.mutate(file.path);
                        }
                      }}
                      className="p-1 hover:bg-[var(--color-background)] rounded text-[var(--color-danger)]"
                      title="Discard"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Commit Area */}
      <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-background)]/50">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message..."
          className="w-full h-20 p-2 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none mb-2"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {stagedFiles.length} files staged
          </span>
          <Button 
            size="sm" 
            variant="primary" 
            disabled={stagedFiles.length === 0 || !commitMessage.trim() || commitMutation.isPending}
            onClick={handleCommit}
          >
            {commitMutation.isPending ? "Committing..." : "Commit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileItem({ file, onAction, actionLabel, actionClass }: any) {
  return (
    <div className="group flex items-center justify-between px-2 py-1 hover:bg-[var(--color-border)]/20 rounded cursor-default">
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon status={file.status} />
        <span className="text-xs truncate text-[var(--color-text)]">{file.path}</span>
      </div>
      <button 
        onClick={onAction}
        className={`opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center font-bold hover:bg-[var(--color-background)] rounded ${actionClass}`}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const color = status === "added" ? "text-emerald-500" : status === "deleted" ? "text-rose-500" : "text-blue-500";
  const char = status === "added" ? "A" : status === "deleted" ? "D" : "M";
  return (
    <span className={`w-4 h-4 flex items-center justify-center text-[10px] font-black rounded-[2px] ${color} border border-current opacity-70`}>
      {char}
    </span>
  );
}
