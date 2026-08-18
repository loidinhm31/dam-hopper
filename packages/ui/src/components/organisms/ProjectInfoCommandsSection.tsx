import { Terminal } from "lucide-react";
import { useProject } from "@/api/queries.js";
import type { ProjectTargetInput } from "@/api/client.js";
import { targetScopedCommandSessionId } from "@/lib/terminal-target-identity.js";
import type { TreeCommand } from "@/hooks/use-terminal-tree.js";

interface ProjectInfoCommandsSectionProps {
  projectName: string;
  target?: ProjectTargetInput;
  onLaunchCommand?: (command: TreeCommand) => void;
}

export function ProjectInfoCommandsSection({
  projectName,
  target,
  onLaunchCommand,
}: ProjectInfoCommandsSectionProps) {
  const { data: project } = useProject(projectName);
  const commands: Array<{
    key: string;
    command: string;
    type: "build" | "run" | "custom";
  }> = [];

  if (project?.services?.[0]?.buildCommand) {
    commands.push({
      key: "build",
      command: project.services[0].buildCommand,
      type: "build",
    });
  }
  if (project?.services?.[0]?.runCommand) {
    commands.push({
      key: "run",
      command: project.services[0].runCommand,
      type: "run",
    });
  }
  for (const [key, command] of Object.entries(project?.commands ?? {})) {
    commands.push({ key, command, type: "custom" });
  }

  if (commands.length === 0) {
    return (
      <div className="px-3 py-2">
        <p className="text-xs text-[var(--color-text-muted)]">
          No commands configured
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-1">
      {commands.map(({ key, command, type }) => (
        <div key={key} className="flex items-center gap-2 group">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--color-text)] truncate">
              {key}
            </p>
            <p className="text-xs font-mono text-[var(--color-text-muted)] truncate opacity-70">
              {command}
            </p>
          </div>
          {onLaunchCommand && (
            <button
              type="button"
              onClick={() =>
                onLaunchCommand({
                  key,
                  type,
                  command,
                  sessionId: targetScopedCommandSessionId(
                    type,
                    projectName,
                    typeof target === "string"
                      ? undefined
                      : (target?.worktreePath ?? undefined),
                    type === "custom"
                      ? key.replace(/[^a-zA-Z0-9:._-]/g, "-")
                      : undefined,
                  ),
                })
              }
              title={`Launch ${key}`}
              className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-2)] transition-all text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
