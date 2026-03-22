import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Badge } from "@/components/atoms/Badge.js";
import { BranchBadge } from "@/components/atoms/BranchBadge.js";
import { GitStatusBadge } from "@/components/atoms/GitStatusBadge.js";
import { Button } from "@/components/atoms/Button.js";
import { BuildLog } from "@/components/organisms/BuildLog.js";
import {
  useProject,
  useWorktrees,
  useBranches,
  useProcessLogs,
  useGitFetch,
  useGitPull,
  useGitPush,
  useBuild,
  useStartProcess,
  useStopProcess,
  useRestartProcess,
  useAddWorktree,
  useRemoveWorktree,
} from "@/api/queries.js";
import { cn } from "@/lib/utils.js";

type Tab = "overview" | "git" | "worktrees" | "build" | "run";

export function ProjectDetailPage() {
  const { name = "" } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [showAddWorktree, setShowAddWorktree] = useState(false);

  const { data: project, isLoading } = useProject(name);
  const { data: worktrees = [] } = useWorktrees(name);
  const { data: branches = [] } = useBranches(name);
  const { data: logs = [] } = useProcessLogs(tab === "run" ? name : "", 200);

  const gitFetch = useGitFetch();
  const gitPull = useGitPull();
  const gitPush = useGitPush();
  const build = useBuild();
  const startProcess = useStartProcess();
  const stopProcess = useStopProcess();
  const restartProcess = useRestartProcess();
  const addWorktree = useAddWorktree(name);
  const removeWorktree = useRemoveWorktree(name);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="text-[var(--color-text-muted)]">Loading…</div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="text-[var(--color-danger)]">
          Project "{name}" not found.
        </div>
      </AppLayout>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "git", label: "Git" },
    { key: "worktrees", label: "Worktrees" },
    { key: "build", label: "Build" },
    { key: "run", label: "Run" },
  ];

  function handleAddWorktree() {
    addWorktree.mutate(
      { path: worktreePath, branch: worktreeBranch, createBranch },
      {
        onSuccess: () => {
          setShowAddWorktree(false);
          setWorktreePath("");
          setWorktreeBranch("");
        },
      },
    );
  }

  return (
    <AppLayout>
      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            {project.name}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge>{project.type}</Badge>
            <BranchBadge branch={project.status?.branch} />
            <GitStatusBadge isClean={project.status?.isClean} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)] mb-5">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[var(--color-text-muted)]">Path</dt>
                <dd className="font-mono text-xs mt-0.5 text-[var(--color-text)]">
                  {project.path}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Type</dt>
                <dd className="mt-0.5">
                  <Badge>{project.type}</Badge>
                </dd>
              </div>
              {project.services && project.services.length > 0 && (
                <div>
                  <dt className="text-[var(--color-text-muted)]">Services</dt>
                  <dd className="flex gap-1 mt-0.5 flex-wrap">
                    {project.services.map((s) => (
                      <span
                        key={s.name}
                        className="font-mono text-xs bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded"
                      >
                        {s.name}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              {project.tags && project.tags.length > 0 && (
                <div>
                  <dt className="text-[var(--color-text-muted)]">Tags</dt>
                  <dd className="flex gap-1 mt-0.5 flex-wrap">
                    {project.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </dd>
                </div>
              )}
              {project.status && (
                <>
                  <div>
                    <dt className="text-[var(--color-text-muted)]">
                      Ahead / Behind
                    </dt>
                    <dd className="font-mono text-xs mt-0.5">
                      +{project.status.ahead} / -{project.status.behind}
                    </dd>
                  </div>
                  {project.status.modified.length > 0 && (
                    <div className="col-span-2">
                      <dt className="text-[var(--color-text-muted)]">
                        Modified files
                      </dt>
                      <dd className="mt-1 space-y-0.5">
                        {project.status.modified.map((f) => (
                          <div
                            key={f}
                            className="font-mono text-xs text-[var(--color-warning)]"
                          >
                            {f}
                          </div>
                        ))}
                      </dd>
                    </div>
                  )}
                </>
              )}
            </dl>
          </div>
        </div>
      )}

      {tab === "git" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              loading={gitFetch.isPending}
              onClick={() => gitFetch.mutate([name])}
            >
              Fetch
            </Button>
            <Button
              loading={gitPull.isPending}
              onClick={() => gitPull.mutate([name])}
            >
              Pull
            </Button>
            <Button
              loading={gitPush.isPending}
              onClick={() => gitPush.mutate(name)}
            >
              Push
            </Button>
          </div>
          {branches.length > 0 && (
            <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
              <div className="px-4 py-2.5 border-b border-[var(--color-border)] text-sm font-medium text-[var(--color-text)]">
                Branches
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {branches.map((b) => (
                  <li
                    key={b.name}
                    className="flex items-center justify-between px-4 py-2 text-sm"
                  >
                    <span
                      className={cn(
                        "font-mono",
                        b.isCurrent && "text-[var(--color-primary)]",
                      )}
                    >
                      {b.isCurrent && "* "}
                      {b.name}
                    </span>
                    <div className="flex gap-1">
                      {b.isCurrent && <Badge variant="primary">current</Badge>}
                      {b.isRemote && <Badge>remote</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "worktrees" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-medium text-[var(--color-text)]">
              Worktrees
            </h2>
            <Button
              size="sm"
              onClick={() => setShowAddWorktree(!showAddWorktree)}
            >
              <Plus className="h-3 w-3" /> Add Worktree
            </Button>
          </div>

          {showAddWorktree && (
            <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)]">
                    Path
                  </label>
                  <input
                    className="mt-1 w-full h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    value={worktreePath}
                    onChange={(e) => setWorktreePath(e.target.value)}
                    placeholder="../my-feature"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)]">
                    Branch
                  </label>
                  <input
                    className="mt-1 w-full h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    value={worktreeBranch}
                    onChange={(e) => setWorktreeBranch(e.target.value)}
                    placeholder="feature/my-branch"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={createBranch}
                  onChange={(e) => setCreateBranch(e.target.checked)}
                />
                Create new branch
              </label>
              <Button
                variant="primary"
                size="sm"
                loading={addWorktree.isPending}
                onClick={handleAddWorktree}
              >
                Create
              </Button>
            </div>
          )}

          <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
            {worktrees.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--color-text-muted)]">
                No worktrees found.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                    <th className="px-4 py-2.5 text-left font-medium">Path</th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Branch
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Main</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {worktrees.map((wt) => (
                    <tr
                      key={wt.path}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {wt.path}
                      </td>
                      <td className="px-4 py-2.5">
                        <BranchBadge branch={wt.branch} />
                      </td>
                      <td className="px-4 py-2.5">
                        {wt.isMain && <Badge variant="primary">main</Badge>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!wt.isMain && (
                          <Button
                            size="sm"
                            variant="danger"
                            loading={removeWorktree.isPending}
                            onClick={() => removeWorktree.mutate(wt.path)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "build" && (
        <div className="space-y-4">
          <Button
            variant="primary"
            loading={build.isPending}
            onClick={() => build.mutate(name)}
          >
            Build {name}
          </Button>
          {build.data && (
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                build.data.success
                  ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/30 text-[var(--color-success)]"
                  : "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30 text-[var(--color-danger)]",
              )}
            >
              {build.data.success
                ? "✓ Build succeeded"
                : `✗ Build failed (exit ${build.data.exitCode})`}
              {" — "}
              {(build.data.durationMs / 1000).toFixed(1)}s
            </div>
          )}
          <BuildLog project={name} />
        </div>
      )}

      {tab === "run" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={startProcess.isPending}
              onClick={() => startProcess.mutate(name)}
            >
              Start
            </Button>
            <Button
              variant="danger"
              loading={stopProcess.isPending}
              onClick={() => stopProcess.mutate(name)}
            >
              Stop
            </Button>
            <Button
              loading={restartProcess.isPending}
              onClick={() => restartProcess.mutate(name)}
            >
              Restart
            </Button>
          </div>
          <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="px-3 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
              Process Logs
            </div>
            <div className="log-container overflow-y-auto max-h-96 p-3 bg-[#0a0a0f]">
              {logs.length === 0 ? (
                <span className="text-[var(--color-text-muted)]">
                  No logs available.
                </span>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    className="whitespace-pre-wrap break-all text-[var(--color-text)]"
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
