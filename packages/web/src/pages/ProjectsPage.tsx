import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Badge } from "@/components/atoms/Badge.js";
import { BranchBadge } from "@/components/atoms/BranchBadge.js";
import { GitStatusBadge } from "@/components/atoms/GitStatusBadge.js";
import { Button } from "@/components/atoms/Button.js";
import {
  useProjects,
  useGitFetch,
  useGitPull,
} from "@/api/queries.js";
import type { ProjectWithStatus } from "@/api/client.js";
import { cn } from "@/lib/utils.js";

type SortKey = "name" | "type" | "status";

// W4: defined outside component to avoid unmount on every parent render
function SortBtn({
  sortKey,
  label,
  activeSort,
  onSort,
}: {
  sortKey: SortKey;
  label: string;
  activeSort: SortKey;
  onSort: (k: SortKey) => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1 hover:text-[var(--color-text)] transition-colors",
        activeSort === sortKey && "text-[var(--color-text)]",
      )}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

export function ProjectsPage() {
  const { data: projects = [], isLoading } = useProjects();
  const [sort, setSort] = useState<SortKey>("name");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const navigate = useNavigate();

  const gitFetch = useGitFetch();
  const gitPull = useGitPull();

  const types = [...new Set(projects.map((p) => p.type))];

  const filtered = projects
    .filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === "all" || p.type === typeFilter;
      return matchSearch && matchType;
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "type") return a.type.localeCompare(b.type);
      const aClean = a.status?.isClean ?? null;
      const bClean = b.status?.isClean ?? null;
      if (aClean === bClean) return 0;
      if (aClean === true) return -1;
      return 1;
    });

  return (
    <AppLayout title="Projects">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)] outline-none"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            loading={gitFetch.isPending}
            onClick={() => gitFetch.mutate(undefined)}
          >
            Fetch All
          </Button>
          <Button
            size="sm"
            loading={gitPull.isPending}
            onClick={() => gitPull.mutate(undefined)}
          >
            Pull All
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="px-4 py-3 text-left font-medium">
                <SortBtn
                  sortKey="name"
                  label="Name"
                  activeSort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">
                <SortBtn
                  sortKey="type"
                  label="Type"
                  activeSort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">Branch</th>
              <th className="px-4 py-3 text-left font-medium">
                <SortBtn
                  sortKey="status"
                  label="Status"
                  activeSort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">±</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                >
                  No projects found
                </td>
              </tr>
            )}
            {filtered.map((p: ProjectWithStatus) => (
              <tr
                key={p.name}
                className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)] cursor-pointer transition-colors"
                onClick={() => navigate(`/projects/${p.name}`)}
              >
                <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                  {p.name}
                </td>
                <td className="px-4 py-3">
                  <Badge>{p.type}</Badge>
                </td>
                <td className="px-4 py-3">
                  <BranchBadge branch={p.status?.branch} />
                </td>
                <td className="px-4 py-3">
                  <GitStatusBadge isClean={p.status?.isClean} />
                </td>
                <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs font-mono">
                  {p.status ? `+${p.status.ahead} -${p.status.behind}` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div
                    className="flex justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={
                        gitFetch.isPending && gitFetch.variables?.[0] === p.name
                      }
                      onClick={() => gitFetch.mutate([p.name])}
                    >
                      Fetch
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={
                        gitPull.isPending && gitPull.variables?.[0] === p.name
                      }
                      onClick={() => gitPull.mutate([p.name])}
                    >
                      Pull
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
