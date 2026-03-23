import { useState, useEffect } from "react";
import {
  ChevronRight,
  FolderOpen,
  Folder,
  Play,
  Square,
  Plus,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { TreeProject, TreeCommand } from "@/hooks/useTerminalTree.js";

interface Props {
  projects: TreeProject[];
  selectedId: string | null;
  onSelectProject: (name: string) => void;
  onSelectTerminal: (sessionId: string) => void;
  onLaunchTerminal: (projectName: string, command: TreeCommand) => void;
  onKillTerminal: (sessionId: string) => void;
  onAddShell: (projectName: string) => void;
}

function StatusDot({ session }: { session: TreeCommand["session"] }) {
  if (!session) {
    return <span className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]/30 shrink-0" />;
  }
  if (session.alive) {
    return <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />;
  }
  if (session.exitCode !== 0 && session.exitCode !== null && session.exitCode !== undefined) {
    return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />;
  }
  return <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />;
}

function CommandRow({
  cmd,
  isSelected,
  onSelect,
  onLaunch,
  onKill,
}: {
  cmd: TreeCommand;
  isSelected: boolean;
  onSelect: () => void;
  onLaunch: () => void;
  onKill: () => void;
}) {
  const hasSession = !!cmd.session;
  const isAlive = cmd.session?.alive ?? false;

  return (
    <div
      onClick={hasSession ? onSelect : undefined}
      className={cn(
        "group flex items-center gap-1.5 pl-8 pr-2 py-1 text-xs cursor-pointer",
        "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected && "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
        !hasSession && "cursor-default",
      )}
    >
      <StatusDot session={cmd.session} />
      <Terminal className="h-3 w-3 shrink-0 opacity-60" />
      <span className="flex-1 truncate font-mono">{cmd.key}</span>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isAlive && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onLaunch(); }}
            title={`Launch ${cmd.key}`}
            className="rounded p-0.5 hover:bg-green-500/20 hover:text-green-500 transition-colors"
          >
            <Play className="h-3 w-3" />
          </button>
        )}
        {isAlive && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            title={`Kill ${cmd.key}`}
            className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function TerminalTreeView({
  projects,
  selectedId,
  onSelectProject,
  onSelectTerminal,
  onLaunchTerminal,
  onKillTerminal,
  onAddShell,
}: Props) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(projects.map((p) => p.name)),
  );

  // Auto-expand projects that are newly added (e.g. after workspace switch)
  useEffect(() => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const p of projects) {
        if (!next.has(p.name)) {
          next.add(p.name);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [projects]);

  function toggleProject(name: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-muted)] text-sm p-4">
        <FolderOpen className="h-8 w-8 opacity-40" />
        <span>No projects configured</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full py-1">
      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.name);
        const isProjectSelected = selectedId === `project:${project.name}`;

        return (
          <div key={project.name}>
            {/* Project header */}
            <div
              onClick={() => {
                toggleProject(project.name);
                onSelectProject(project.name);
              }}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium cursor-pointer",
                "text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors",
                isProjectSelected && "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
              )}
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150",
                  isExpanded && "rotate-90",
                )}
              />
              {isExpanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]/70" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
              )}
              <span className="flex-1 truncate">{project.name}</span>
              {project.activeCount > 0 && (
                <span className="rounded-full bg-green-500/20 px-1.5 text-green-600 text-[10px] font-medium">
                  {project.activeCount}
                </span>
              )}
            </div>

            {/* Commands */}
            {isExpanded && (
              <div>
                {project.commands.map((cmd) => (
                  <CommandRow
                    key={cmd.sessionId}
                    cmd={cmd}
                    isSelected={selectedId === `terminal:${cmd.sessionId}`}
                    onSelect={() => onSelectTerminal(cmd.sessionId)}
                    onLaunch={() => onLaunchTerminal(project.name, cmd)}
                    onKill={() => onKillTerminal(cmd.sessionId)}
                  />
                ))}

                {/* + Shell button */}
                <button
                  type="button"
                  onClick={() => onAddShell(project.name)}
                  className={cn(
                    "flex items-center gap-1.5 pl-8 pr-2 py-1 w-full text-xs",
                    "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                    "hover:bg-[var(--color-surface-2)] transition-colors",
                  )}
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  <span>Shell</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
