import { useState } from "react";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { CommitDetailsPanel } from "@/components/organisms/CommitDetailsPanel.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";
import type { GitLogEntry, DiffFileEntry } from "@/api/client.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import {
  GitDropCommitDialog,
  GitHistoryStatusBanner,
  GitResetDialog,
  useGitHistoryActions,
} from "@/components/organisms/GitHistoryActions.js";

interface WorkspaceGitPanelProps {
  project: string;
}

export function WorkspaceGitPanel({ project }: WorkspaceGitPanelProps) {
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(
    null,
  );
  const openDiff = useEditorStore((s) => s.openDiff);
  const historyActions = useGitHistoryActions(project);

  const handleGitFileDoubleClick = (file: DiffFileEntry) => {
    if (selectedCommit) {
      openDiff(
        project,
        file.path,
        file.status,
        file.additions,
        file.deletions,
        selectedCommit.hash,
      );
    }
  };

  const handleDropCommitConfirm = async () => {
    const droppedHash = await historyActions.handleDropCommit();
    if (!droppedHash) return;
    setSelectedCommit((current) =>
      current?.hash === droppedHash ? null : current,
    );
  };

  return (
    <>
      <div className="flex h-full overflow-hidden bg-[var(--color-surface)]">
        <div
          className={cn(
            "flex flex-col min-w-0 transition-all duration-200",
            selectedCommit
              ? "w-0 md:w-[60%] lg:w-[65%] border-r border-[var(--color-border)]"
              : "w-full",
          )}
        >
          <div className="p-3 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Branch
              </span>
            </div>
            <GitBranchControl project={project} className="w-full" />
            <GitHistoryStatusBanner
              className="mt-2"
              error={historyActions.error}
              message={historyActions.message}
            />
          </div>
          <div className="flex-1 min-h-0">
            <div className="px-3 py-2 border-b border-[var(--color-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-surface-2)]">
              History
            </div>
            <GitLogTree
              project={project}
              selectedHash={selectedCommit?.hash}
              onSelectCommit={setSelectedCommit}
              onCherryPick={(entry) =>
                void historyActions.handleCherryPick(entry)
              }
              onDropCommit={historyActions.setDropCommit}
              onReset={historyActions.setResetCommit}
            />
          </div>
        </div>

        {selectedCommit && (
          <div className="flex-1 min-w-0 md:w-[40%] lg:w-[35%]">
            <CommitDetailsPanel
              project={project}
              commit={selectedCommit}
              onClose={() => setSelectedCommit(null)}
              onFileDoubleClick={handleGitFileDoubleClick}
              onCherryPickSelectedChanges={(commit, files) =>
                void historyActions.handleCherryPickFiles(commit, files)
              }
              onDropSelectedChanges={(commit, files) =>
                void historyActions.handleDropFiles(commit, files)
              }
            />
          </div>
        )}
      </div>

      <GitResetDialog
        commit={historyActions.resetCommit}
        onClose={() => historyActions.setResetCommit(null)}
        onConfirm={(mode) => void historyActions.handleReset(mode)}
      />
      <GitDropCommitDialog
        commit={historyActions.dropCommit}
        loading={historyActions.isDropCommitPending}
        onClose={() => historyActions.setDropCommit(null)}
        onConfirm={() => void handleDropCommitConfirm()}
      />
    </>
  );
}
