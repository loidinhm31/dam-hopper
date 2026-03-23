import { useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button } from "@/components/atoms/Button.js";
import { ProgressList } from "@/components/organisms/ProgressList.js";
import { useProjects, useGitFetch, useGitPull } from "@/api/queries.js";
import type { GitOpResult } from "@/api/client.js";
import { Badge } from "@/components/atoms/Badge.js";

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
          {r.projectName}: {r.error}
        </div>
      ))}
    </div>
  );
}

export function GitPage() {
  const { data: projects = [] } = useProjects();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [fetchResults, setFetchResults] = useState<GitOpResult[] | null>(null);
  const [pullResults, setPullResults] = useState<GitOpResult[] | null>(null);

  const gitFetch = useGitFetch();
  const gitPull = useGitPull();

  const allSelected = selected.size === 0; // empty = all
  const selectedList = allSelected ? undefined : [...selected];
  const projectNames = projects.map((p) => p.name);

  function toggleProject(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <AppLayout title="Git Operations">
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
                gitFetch.mutate(selectedList, {
                  onSuccess: (r) => setFetchResults(r),
                });
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
                gitPull.mutate(selectedList, {
                  onSuccess: (r) => setPullResults(r),
                });
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
    </AppLayout>
  );
}
