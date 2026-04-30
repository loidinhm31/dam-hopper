import { useState, useEffect } from "react";
import { GitCommit, GitBranch, History } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button } from "@/components/atoms/Button.js";
import { ProgressList } from "@/components/organisms/ProgressList.js";
import { useProjects, useGitFetch, useGitPull, useProjectStatus } from "@/api/queries.js";
import type { GitOpResult, GitLogEntry, DiffFileEntry } from "@/api/client.js";
import { Badge } from "@/components/atoms/Badge.js";
import { useGitWithSshRetry } from "@/hooks/useGitWithSshRetry.js";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { GitLocalChanges } from "@/components/organisms/GitLocalChanges.js";
import { CommitDetailsPanel } from "@/components/organisms/CommitDetailsPanel.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";

interface SectionResults {
  results: GitOpResult[];
}

function ResultsSummary({ results }: SectionResults) {
  const ok = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success);
  return (
    <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-3 text-sm">
      <div className="flex gap-3 mb-2">
        <span className="text-[var(--color-success)]">✓ {ok} succeeded</span>
        {fail.length > 0 && (
          <span className="text-[var(--color-danger)]">
            ✗ {fail.length} failed
          </span>
        )}
      </div>
      {fail.map((r) => (
        <div
          key={r.projectName}
          className="text-[var(--color-danger)] font-mono text-xs"
        >
          {r.projectName}: {typeof r.error === "string" ? r.error : (r.error as unknown as { message?: string })?.message ?? String(r.error)}
        </div>
      ))}
    </div>
  );
}

export function GitPage() {
  const { data: projects = [] } = useProjects();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(null);

  const [fetchResults, setFetchResults] = useState<GitOpResult[] | null>(null);
  const [pullResults, setPullResults] = useState<GitOpResult[] | null>(null);

  const gitFetch = useGitFetch();
  const gitPull = useGitPull();
  const { PassphraseDialogElement, executeWithRetry } = useGitWithSshRetry();
  const openDiff = useEditorStore((s) => s.openDiff);

  const allSelected = selected.size === 0; // empty = all
  const selectedList = allSelected ? undefined : [...selected];
  const projectNames = projects.map((p) => p.name);

  const selectedProjectName = selected.size === 1 ? [...selected][0] : null;
  const { data: projectStatus } = useProjectStatus(selectedProjectName ?? "");

  useEffect(() => {
    setSelectedCommit(null);
  }, [selectedProjectName]);

  function toggleProject(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleFileDoubleClick(file: DiffFileEntry) {
    if (selectedProjectName && selectedCommit) {
      openDiff(
        selectedProjectName,
        file.path,
        file.status,
        file.additions,
        file.deletions,
        selectedCommit.hash
      );
    }
  }

  return (
    <AppLayout title="Git Operations">
      {PassphraseDialogElement}
      {/* Project selector */}
      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4 mb-6">
        <p className="text-sm font-medium text-[var(--color-text)] mb-3">
          Select projects (empty = all)
        </p>
        <div className="flex flex-wrap gap-2">
          {projectNames.map((name) => (
            <label
              key={name}
              className="flex items-center gap-1.5 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(name)}
                onChange={() => toggleProject(name)}
              />
              {name}
            </label>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="primary">{selected.size} selected</Badge>
            <button
              className="text-xs text-[var(--color-text-muted)] hover:underline"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Fetch */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              Bulk Fetch
            </h2>
            <Button
              variant="primary"
              size="sm"
              loading={gitFetch.isPending}
              onClick={() => {
                setFetchResults(null);
                void executeWithRetry(() =>
                  gitFetch.mutateAsync(selectedList),
                ).then((r) => setFetchResults(r)).catch(() => {});
              }}
            >
              Start Fetch
            </Button>
          </div>
          <ProgressList
            initialProjects={
              gitFetch.isPending ? (selectedList ?? projectNames) : []
            }
          />
          {fetchResults && <ResultsSummary results={fetchResults} />}
        </section>

        {/* Pull */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              Bulk Pull
            </h2>
            <Button
              variant="primary"
              size="sm"
              loading={gitPull.isPending}
              onClick={() => {
                setPullResults(null);
                void executeWithRetry(() =>
                  gitPull.mutateAsync(selectedList),
                ).then((r) => setPullResults(r)).catch(() => {});
              }}
            >
              Start Pull
            </Button>
          </div>
          <ProgressList
            initialProjects={
              gitPull.isPending ? (selectedList ?? projectNames) : []
            }
          />
          {pullResults && <ResultsSummary results={pullResults} />}
        </section>
      </div>

      {/* Git Graph View */}
      {selectedProjectName ? (
        <div className="mt-8 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2">
             Git Repository: {selectedProjectName}
             {projectStatus?.branch && (
               <Badge variant="outline" className="ml-1 text-[var(--color-primary)] bg-[var(--color-primary)]/5 border-[var(--color-primary)]/20">
                 <GitBranch className="w-3 h-3 mr-1" />
                 {projectStatus.branch}
               </Badge>
             )}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[700px]">
            {/* Sidebar: Commit / Local Changes */}
            <div className="lg:col-span-1 flex flex-col h-full overflow-hidden">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-2">
                <GitCommit className="w-3.5 h-3.5" />
                Local Changes
              </div>
              <GitLocalChanges project={selectedProjectName} />
            </div>

            {/* Main: Git Log Graph + Details */}
            <div className="lg:col-span-3 flex h-full overflow-hidden border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
              <div className={cn("flex flex-col min-w-0 flex-1", selectedCommit ? "w-[65%]" : "w-full")}>
                <div className="shrink-0 mb-0 px-4 py-2 border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-2 bg-[var(--color-background)]">
                  <History className="w-3.5 h-3.5" />
                  Commits
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <GitLogTree 
                    project={selectedProjectName} 
                    selectedHash={selectedCommit?.hash}
                    onSelectCommit={setSelectedCommit}
                  />
                </div>
              </div>
              
              {selectedCommit && (
                <div className="w-[35%] h-full shrink-0">
                  <CommitDetailsPanel
                    project={selectedProjectName}
                    commit={selectedCommit}
                    onClose={() => setSelectedCommit(null)}
                    onFileDoubleClick={handleFileDoubleClick}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 p-8 flex flex-col items-center justify-center text-center border-2 border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]/50">
           <GitBranch className="w-12 h-12 text-[var(--color-text-muted)] mb-3" />
           <h3 className="font-medium text-[var(--color-text)]">No Project Selected</h3>
           <p className="mt-1 text-sm text-[var(--color-text-muted)]">
             Select exactly one project above to view its Git history graph, structured similarly to IDE tools.
           </p>
        </div>
      )}
    </AppLayout>
  );
}
