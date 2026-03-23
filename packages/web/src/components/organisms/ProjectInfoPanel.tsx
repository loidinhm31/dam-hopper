import { useState } from "react";
import {
  GitBranch,
  GitMerge,
  Folder,
  Terminal,
  RefreshCw,
  Download,
  Upload,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { CollapsibleSection } from "@/components/atoms/CollapsibleSection.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  useProject,
  useWorktrees,
  useBranches,
  useGitFetch,
  useGitPull,
  useGitPush,
  useAddWorktree,
  useRemoveWorktree,
} from "@/api/queries.js";
import type { TreeCommand } from "@/hooks/useTerminalTree.js";

interface Props {
  projectName: string;
  onLaunchCommand?: (command: TreeCommand) => void;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] font-mono">
      {type}
    </span>
  );
}

function StatusBadge({ isClean }: { isClean: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs font-medium",
        isClean
          ? "bg-green-500/15 text-green-600"
          : "bg-amber-500/15 text-amber-600",
      )}
    >
      {isClean ? "clean" : "dirty"}
    </span>
  );
}

function GitSection({ projectName }: { projectName: string }) {
  const { data: branches = [] } = useBranches(projectName);
  const gitFetch = useGitFetch();
  const gitPull = useGitPull();
  const gitPush = useGitPush();

  return (
    <div className="px-3 py-2 space-y-2">
      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="secondary"
          loading={gitFetch.isPending}
          onClick={() => gitFetch.mutate([projectName])}
        >
          <RefreshCw className="h-3 w-3" />
          Fetch
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={gitPull.isPending}
          onClick={() => gitPull.mutate([projectName])}
        >
          <Download className="h-3 w-3" />
          Pull
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={gitPush.isPending}
          onClick={() => gitPush.mutate(projectName)}
        >
          <Upload className="h-3 w-3" />
          Push
        </Button>
      </div>

      {/* Branch list */}
      {branches.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-xs text-[var(--color-text-muted)] font-medium">Branches</p>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {branches.map((b) => (
              <div
                key={b.name}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs",
                  b.isCurrent
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "text-[var(--color-text-muted)]",
                )}
              >
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{b.name}</span>
                {b.isCurrent && <span className="ml-auto text-[10px] opacity-60">current</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorktreesSection({ projectName }: { projectName: string }) {
  const { data: worktrees = [] } = useWorktrees(projectName);
  const addWorktree = useAddWorktree(projectName);
  const removeWorktree = useRemoveWorktree(projectName);
  const [showAdd, setShowAdd] = useState(false);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);

  function handleAdd() {
    if (!path || !branch) return;
    addWorktree.mutate(
      { path, branch, createBranch },
      {
        onSuccess: () => {
          setShowAdd(false);
          setPath("");
          setBranch("");
          setCreateBranch(false);
        },
      },
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      {worktrees.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No worktrees</p>
      ) : (
        <div className="space-y-1">
          {worktrees.map((wt) => (
            <div
              key={wt.path}
              className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"
            >
              <GitMerge className="h-3 w-3 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate font-mono text-[var(--color-text)]">{wt.branch}</p>
                <p className="truncate opacity-60">{wt.path}</p>
              </div>
              {!wt.isMain && (
                <button
                  type="button"
                  onClick={() => removeWorktree.mutate(wt.path)}
                  className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 transition-colors shrink-0"
                  title="Remove worktree"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!showAdd ? (
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Plus className="h-3 w-3" />
          Add Worktree
        </Button>
      ) : (
        <div className="space-y-1.5">
          <input
            type="text"
            placeholder="Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Branch name"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className={inputClass}
          />
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={createBranch}
              onChange={(e) => setCreateBranch(e.target.checked)}
              className="rounded"
            />
            Create new branch
          </label>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              loading={addWorktree.isPending}
              onClick={handleAdd}
            >
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommandsSection({
  projectName,
  onLaunchCommand,
}: {
  projectName: string;
  onLaunchCommand?: (cmd: TreeCommand) => void;
}) {
  const { data: project } = useProject(projectName);

  const allCommands: Array<{ key: string; command: string; type: "build" | "run" | "custom" }> = [];

  if (project?.services?.[0]?.buildCommand) {
    allCommands.push({ key: "build", command: project.services[0].buildCommand, type: "build" });
  }
  if (project?.services?.[0]?.runCommand) {
    allCommands.push({ key: "run", command: project.services[0].runCommand, type: "run" });
  }
  for (const [key, cmd] of Object.entries(project?.commands ?? {})) {
    allCommands.push({ key, command: cmd, type: "custom" });
  }

  if (allCommands.length === 0) {
    return (
      <div className="px-3 py-2">
        <p className="text-xs text-[var(--color-text-muted)]">No commands configured</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-1">
      {allCommands.map(({ key, command, type }) => (
        <div key={key} className="flex items-center gap-2 group">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--color-text)] truncate">{key}</p>
            <p className="text-xs font-mono text-[var(--color-text-muted)] truncate opacity-70">{command}</p>
          </div>
          {onLaunchCommand && (
            <button
              type="button"
              onClick={() =>
                onLaunchCommand({
                  key,
                  type,
                  command,
                  sessionId:
                    type === "build"
                      ? `build:${projectName}`
                      : type === "run"
                        ? `run:${projectName}`
                        : `custom:${projectName}:${key}`,
                })
              }
              title={`Launch ${key}`}
              className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-2)] transition-all text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <Terminal className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProjectInfoPanel({ projectName, onLaunchCommand }: Props) {
  const { data: project, isLoading } = useProject(projectName);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        Project not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 flex-wrap">
          <Folder className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{project.name}</h2>
          <TypeBadge type={project.type} />
          {project.status && (
            <>
              <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <GitBranch className="h-3 w-3" />
                {project.status.branch}
              </span>
              <StatusBadge isClean={project.status.isClean} />
            </>
          )}
        </div>
      </div>

      {/* Sections */}
      <div className="flex-1">
        <CollapsibleSection
          title="Git Operations"
          icon={GitBranch}
          defaultOpen={true}
        >
          <GitSection projectName={projectName} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Worktrees"
          icon={GitMerge}
          defaultOpen={false}
        >
          <WorktreesSection projectName={projectName} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Commands"
          icon={Terminal}
          defaultOpen={true}
        >
          <CommandsSection
            projectName={projectName}
            onLaunchCommand={onLaunchCommand}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
