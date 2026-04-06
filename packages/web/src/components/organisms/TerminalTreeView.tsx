import { useState, useEffect } from "react";
import {
  ChevronRight,
  FolderOpen,
  Folder,
  Play,
  Square,
  Plus,
  Terminal,
  Trash2,
  Save,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { CommandSuggestionInput } from "@/components/atoms/CommandSuggestionInput.js";
import type { TreeProject, TreeCommand } from "@/hooks/useTerminalTree.js";
import type { SessionInfo } from "@/api/client.js";
import type { ProjectType } from "@/api/client.js";

interface Props {
  projects: TreeProject[];
  freeTerminals: SessionInfo[];
  selectedId: string | null;
  onSelectProject: (name: string) => void;
  onSelectTerminal: (sessionId: string) => void;
  onLaunchTerminal: (projectName: string, command: TreeCommand) => void;
  onKillTerminal: (sessionId: string) => void;
  onAddShell: (projectName: string) => void;
  onLaunchProfile: (projectName: string, command: TreeCommand) => void;
  onDeleteProfile: (projectName: string, profileName: string) => void;
  onLaunchSuggestedCommand: (projectName: string, command: string) => void;
  onAddFreeTerminal: () => void;
  onLaunchFreeWithCommand: (command: string) => void;
  onSelectFreeTerminal: (sessionId: string) => void;
  onKillFreeTerminal: (sessionId: string) => void;
  onRemoveFreeTerminal: (sessionId: string) => void;
  onSaveFreeTerminal: (sessionId: string) => void;
}

function StatusDot({ session }: { session?: SessionInfo | null }) {
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
      <span className="flex-1 truncate font-mono">{cmd.label ?? cmd.key}</span>

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

/** Instance child row under a profile node */
function InstanceRow({
  session,
  index,
  isSelected,
  onSelect,
  onKill,
}: {
  session: SessionInfo;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-1.5 pl-14 pr-2 py-1 text-xs cursor-pointer",
        "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected && "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
      )}
    >
      <StatusDot session={session} />
      <span className="flex-1 truncate font-mono opacity-70">instance #{index + 1}</span>
      {session.alive && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onKill(); }}
          title="Kill instance"
          className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-500 transition-colors"
        >
          <Square className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** Single free terminal row in the Terminals section */
function FreeTerminalRow({
  session,
  label,
  isSelected,
  onSelect,
  onKill,
  onRemove,
  onSave,
}: {
  session: SessionInfo;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  onKill: () => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-1.5 pl-8 pr-2 py-1 text-xs cursor-pointer",
        "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected && "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
      )}
    >
      <StatusDot session={session} />
      <Terminal className="h-3 w-3 shrink-0 opacity-60" />
      <span className="flex-1 truncate font-mono">{label}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {session.command && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSave(); }}
            title="Save to project profile"
            className="rounded p-0.5 hover:bg-[var(--color-primary)]/20 hover:text-[var(--color-primary)] transition-colors"
          >
            <Save className="h-3 w-3" />
          </button>
        )}
        {session.alive && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            title="Kill terminal"
            className="rounded p-0.5 hover:bg-amber-500/20 hover:text-amber-500 transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove terminal"
          className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Expandable profile node with instance children */
function ProfileRow({
  cmd,
  projectName,
  selectedId,
  isExpanded,
  onToggle,
  onSelectInstance,
  onLaunchInstance,
  onKillInstance,
  onDelete,
}: {
  cmd: TreeCommand;
  projectName: string;
  selectedId: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectInstance: (sessionId: string) => void;
  onLaunchInstance: () => void;
  onKillInstance: (sessionId: string) => void;
  onDelete: () => void;
}) {
  const sessions = cmd.sessions ?? [];
  const aliveCount = sessions.filter((s) => s.alive).length;

  return (
    <>
      {/* Profile header row */}
      <div
        onClick={onToggle}
        className={cn(
          "group flex items-center gap-1.5 pl-6 pr-2 py-1 text-xs cursor-pointer",
          "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          "hover:bg-[var(--color-surface-2)] transition-colors",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />
        <Terminal className="h-3 w-3 shrink-0 opacity-60" />
        <span className="flex-1 truncate font-mono">{cmd.profileName}</span>
        {aliveCount > 0 && (
          <span className="rounded-full bg-green-500/20 px-1 text-green-600 text-[10px] font-medium shrink-0">
            {aliveCount}
          </span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onLaunchInstance(); }}
            title="Launch new instance"
            className="rounded p-0.5 hover:bg-green-500/20 hover:text-green-500 transition-colors"
          >
            <Play className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete profile"
            className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Instance children */}
      {isExpanded && (
        <>
          {sessions.map((session, i) => (
            <InstanceRow
              key={session.id}
              session={session}
              index={i}
              isSelected={selectedId === `terminal:${session.id}`}
              onSelect={() => onSelectInstance(session.id)}
              onKill={() => onKillInstance(session.id)}
            />
          ))}
          {sessions.length === 0 && (
            <div className="pl-14 pr-2 py-1 text-xs text-[var(--color-text-muted)]/50 italic">
              no instances
            </div>
          )}
        </>
      )}
    </>
  );
}

export function TerminalTreeView({
  projects,
  freeTerminals,
  selectedId,
  onSelectProject,
  onSelectTerminal,
  onLaunchTerminal,
  onKillTerminal,
  onAddShell,
  onLaunchProfile,
  onDeleteProfile,
  onLaunchSuggestedCommand,
  onAddFreeTerminal,
  onLaunchFreeWithCommand,
  onSelectFreeTerminal,
  onKillFreeTerminal,
  onRemoveFreeTerminal,
  onSaveFreeTerminal,
}: Props) {
  const [activeSuggestionProject, setActiveSuggestionProject] = useState<string | null>(null);
  const [showFreeSuggestion, setShowFreeSuggestion] = useState(false);
  const [terminalsExpanded, setTerminalsExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem("devhub:expanded-free-terminals");
    return stored === null ? true : stored === "true";
  });
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("devhub:expanded-projects");
    if (stored) {
      try {
        return new Set(JSON.parse(stored) as string[]);
      } catch {
        // ignore malformed storage
      }
    }
    return new Set(projects.map((p) => p.name));
  });
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("devhub:expanded-profiles");
    if (stored) {
      try {
        return new Set(JSON.parse(stored) as string[]);
      } catch {
        // ignore malformed storage
      }
    }
    return new Set();
  });

  // Auto-expand projects that are newly added
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

  function toggleTerminals() {
    setTerminalsExpanded((prev) => {
      localStorage.setItem("devhub:expanded-free-terminals", String(!prev));
      return !prev;
    });
  }

  function toggleProject(name: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      localStorage.setItem("devhub:expanded-projects", JSON.stringify([...next]));
      return next;
    });
  }

  function toggleProfile(key: string) {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem("devhub:expanded-profiles", JSON.stringify([...next]));
      return next;
    });
  }

  if (projects.length === 0 && freeTerminals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-muted)] text-sm p-4">
        <FolderOpen className="h-8 w-8 opacity-40" />
        <span>No projects configured</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full py-1">
      {/* Terminals section */}
      <div>
        <div
          onClick={toggleTerminals}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium cursor-pointer text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150",
              terminalsExpanded && "rotate-90",
            )}
          />
          <Terminal className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
          <span className="flex-1">Terminals</span>
          {(() => {
            const aliveCount = freeTerminals.filter((s) => s.alive).length;
            return aliveCount > 0 ? (
              <span className="rounded-full bg-green-500/20 px-1.5 text-green-600 text-[10px] font-medium">
                {aliveCount}
              </span>
            ) : null;
          })()}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowFreeSuggestion((v) => !v); }}
            title="New terminal"
            className="rounded p-0.5 hover:bg-[var(--color-primary)]/20 hover:text-[var(--color-primary)] transition-colors"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        {terminalsExpanded && (
          <div>
            {showFreeSuggestion && (
              <div className="px-2 pb-1 pt-0.5">
                <CommandSuggestionInput
                  autoFocus
                  placeholder="Command or press Enter for shell..."
                  onSelect={(cmd) => {
                    onLaunchFreeWithCommand(cmd.command);
                    setShowFreeSuggestion(false);
                  }}
                  onSubmitCustom={(cmd) => {
                    if (cmd.trim()) {
                      onLaunchFreeWithCommand(cmd);
                    } else {
                      onAddFreeTerminal();
                    }
                    setShowFreeSuggestion(false);
                  }}
                />
              </div>
            )}
            {freeTerminals.map((session, i) => (
              <FreeTerminalRow
                key={session.id}
                session={session}
                label={`Terminal ${i + 1}`}
                isSelected={selectedId === `terminal:${session.id}`}
                onSelect={() => onSelectFreeTerminal(session.id)}
                onKill={() => onKillFreeTerminal(session.id)}
                onRemove={() => onRemoveFreeTerminal(session.id)}
                onSave={() => onSaveFreeTerminal(session.id)}
              />
            ))}
            {freeTerminals.length === 0 && !showFreeSuggestion && (
              <div className="pl-8 pr-2 py-1 text-xs text-[var(--color-text-muted)]/50 italic">
                No terminals — press + to create one
              </div>
            )}
          </div>
        )}
      </div>

      {/* Projects section header */}
      {projects.length > 0 && (
        <div className="px-2 py-1.5 mt-1 border-t border-[var(--color-border)]">
          <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Projects</span>
        </div>
      )}

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

            {/* Commands + profiles */}
            {isExpanded && (
              <div>
                {project.commands.map((cmd) => {
                  if (cmd.type === "terminal") {
                    const profileKey = `${project.name}:${cmd.key}`;
                    return (
                      <ProfileRow
                        key={cmd.key}
                        cmd={cmd}
                        projectName={project.name}
                        selectedId={selectedId}
                        isExpanded={expandedProfiles.has(profileKey)}
                        onToggle={() => toggleProfile(profileKey)}
                        onSelectInstance={(sid) => onSelectTerminal(sid)}
                        onLaunchInstance={() => onLaunchProfile(project.name, cmd)}
                        onKillInstance={(sid) => onKillTerminal(sid)}
                        onDelete={() => onDeleteProfile(project.name, cmd.profileName!)}
                      />
                    );
                  }
                  return (
                    <CommandRow
                      key={cmd.sessionId}
                      cmd={cmd}
                      isSelected={selectedId === `terminal:${cmd.sessionId}`}
                      onSelect={() => onSelectTerminal(cmd.sessionId)}
                      onLaunch={() => onLaunchTerminal(project.name, cmd)}
                      onKill={() => onKillTerminal(cmd.sessionId)}
                    />
                  );
                })}

                {/* + Shell button / inline suggestion input */}
                {activeSuggestionProject === project.name ? (
                  <div className="px-2 py-1">
                    <CommandSuggestionInput
                      projectType={project.type as ProjectType}
                      autoFocus
                      placeholder="Search commands..."
                      onSelect={(cmd) => {
                        onLaunchSuggestedCommand(project.name, cmd.command);
                        setActiveSuggestionProject(null);
                      }}
                      onSubmitCustom={(cmd) => {
                        if (cmd.trim()) {
                          onLaunchSuggestedCommand(project.name, cmd);
                        } else {
                          onAddShell(project.name);
                        }
                        setActiveSuggestionProject(null);
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveSuggestionProject(project.name)}
                    className={cn(
                      "flex items-center gap-1.5 pl-8 pr-2 py-1 w-full text-xs",
                      "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                      "hover:bg-[var(--color-surface-2)] transition-colors",
                    )}
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    <span>Terminal</span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
