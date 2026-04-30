import { useState } from "react";
import { GitBranch } from "lucide-react";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { CommitDetailsPanel } from "@/components/organisms/CommitDetailsPanel.js";
import { useProjectStatus } from "@/api/queries.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";
import type { GitLogEntry, DiffFileEntry } from "@/api/client.js";

interface WorkspaceGitPanelProps {
  project: string;
}

export function WorkspaceGitPanel({ project }: WorkspaceGitPanelProps) {
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(null);
  const openDiff = useEditorStore((s) => s.openDiff);
  const { data: projectStatus } = useProjectStatus(project);

  const handleGitFileDoubleClick = (file: DiffFileEntry) => {
    if (selectedCommit) {
      openDiff(
        project,
        file.path,
        file.status,
        file.additions,
        file.deletions,
        selectedCommit.hash
      );
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-[var(--color-surface)]">
      <div className={cn(
        "flex flex-col min-w-0 transition-all duration-200",
        selectedCommit ? "w-0 md:w-[60%] lg:w-[65%] border-r border-[var(--color-border)]" : "w-full"
      )}>
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Current Branch
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]">
            <GitBranch className="w-3.5 h-3.5 text-[var(--color-primary)]" />
            {projectStatus?.branch ?? "..."}
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <div className="px-3 py-2 border-b border-[var(--color-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-surface-2)]">
            History
          </div>
          <GitLogTree 
            project={project} 
            selectedHash={selectedCommit?.hash}
            onSelectCommit={setSelectedCommit}
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
          />
        </div>
      )}
    </div>
  );
}
