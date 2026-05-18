import { useState, useEffect, useRef } from "react";
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
  GripVertical,
  Pencil,
} from "lucide-react";
import { inputClass } from "@/components/atoms/Button.js";
import { CommandSuggestionInput } from "@/components/atoms/CommandSuggestionInput.js";
import { cn } from "@/lib/utils.js";
import type { TreeProject, TreeCommand } from "@/hooks/useTerminalTree.js";
import type { SessionInfo, ProjectType } from "@/api/client.js";
import { getSessionStatus, getStatusDotColor } from "@/lib/session-status.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";
import { useGlobalConfig, useUpdateUiConfig } from "@/api/queries.js";

interface Props {
  projects: TreeProject[];
  freeTerminals: SessionInfo[];
  activeProjectName?: string;
  selectedId: string | null;
  onSelectProject: (name: string) => void;
  onSelectTerminal: (sessionId: string) => void;
  onLaunchTerminal: (projectName: string, command: TreeCommand) => void;
  onKillTerminal: (sessionId: string) => void;
  onAddShell: (projectName: string) => void;
  onLaunchProfile: (projectName: string, command: TreeCommand) => void;
  onDeleteProfile: (projectName: string, profileName: string) => void;
  onLaunchSuggestedCommand: (projectName: string, command: string) => void;
  onAddFreeTerminal: (projectName?: string) => void;
  onLaunchFreeWithCommand: (command: string, projectName?: string) => void;
  onSelectFreeTerminal: (sessionId: string) => void;
  onKillFreeTerminal: (sessionId: string) => void;
  onRemoveFreeTerminal: (sessionId: string) => void;
  onSaveFreeTerminal: (sessionId: string) => void;
  onUpdateProfile: (
    projectName: string,
    originalName: string,
    next: { name: string; command: string; cwd: string },
  ) => Promise<void>;
  onUpdateCustomCommand: (
    projectName: string,
    originalKey: string,
    next: { key: string; command: string },
  ) => Promise<void>;
}

type EditState =
  | {
      kind: "profile";
      projectName: string;
      originalName: string;
      name: string;
      command: string;
      cwd: string;
      saving: boolean;
      error?: string;
    }
  | {
      kind: "command";
      projectName: string;
      originalKey: string;
      key: string;
      command: string;
      saving: boolean;
      error?: string;
    }
  | null;

function StatusDot({ session }: { session?: SessionInfo | null }) {
  if (!session) {
    return (
      <span className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]/30 shrink-0" />
    );
  }
  const status = getSessionStatus(session);
  const dotColor = getStatusDotColor(status);
  return <span className={`h-2 w-2 rounded-full ${dotColor} shrink-0`} />;
}

function getProfileEditorKey(projectName: string, profileName: string) {
  return `${projectName}:terminal:${profileName}`;
}

function handleEditorKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  onCancel: () => void,
) {
  if (e.key === "Escape") {
    e.preventDefault();
    onCancel();
  }
}

function CommandRow({
  cmd,
  isSelected,
  isEditing,
  canEdit,
  onSelect,
  onLaunch,
  onKill,
  onEdit,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDrop,
  isDragged,
  isOver,
}: {
  cmd: TreeCommand;
  isSelected: boolean;
  isEditing: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onLaunch: () => void;
  onKill: () => void;
  onEdit?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragged: boolean;
  isOver: boolean;
}) {
  const hasSession = !!cmd.session;
  const isAlive = cmd.session?.alive ?? false;

  return (
    <div
      onClick={!isEditing && hasSession ? onSelect : undefined}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      className={cn(
        "group flex items-center gap-1.5 pl-2 pr-2 py-1 text-xs cursor-pointer",
        "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected &&
          "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
        !hasSession && "cursor-default",
        isEditing && "bg-[var(--color-primary)]/8",
        isDragged && "opacity-40",
        isOver && "border-t-2 border-[var(--color-primary)]",
      )}
    >
      <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing mr-0.5" />
      <StatusDot session={cmd.session} />
      <Terminal className="h-3 w-3 shrink-0 opacity-60" />
      <span className="flex-1 truncate font-mono">{cmd.label ?? cmd.key}</span>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            title="Edit command"
            className={cn(
              "rounded p-0.5 transition-colors",
              isEditing
                ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] opacity-100"
                : "hover:bg-[var(--color-primary)]/20 hover:text-[var(--color-primary)]",
            )}
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {!isAlive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLaunch();
            }}
            title={`Launch ${cmd.key}`}
            className="rounded p-0.5 hover:bg-green-500/20 hover:text-green-500 transition-colors"
          >
            <Play className="h-3 w-3" />
          </button>
        )}
        {isAlive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onKill();
            }}
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

function CommandEditorRow({
  value,
  onKeyChange,
  onCommandChange,
  onSave,
  onCancel,
}: {
  value: Extract<EditState, { kind: "command" }>;
  onKeyChange: (key: string) => void;
  onCommandChange: (command: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
      className="mx-2 mb-2 mt-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
    >
      <div className="grid gap-2">
        <input
          autoFocus
          className={inputClass}
          value={value.key}
          onChange={(e) => onKeyChange(e.target.value)}
          onKeyDown={(e) => handleEditorKeyDown(e, onCancel)}
          placeholder="Command key"
          disabled={value.saving}
        />
        <input
          className={inputClass}
          value={value.command}
          onChange={(e) => onCommandChange(e.target.value)}
          onKeyDown={(e) => handleEditorKeyDown(e, onCancel)}
          placeholder="pnpm test"
          disabled={value.saving}
        />
        {value.error && (
          <p className="text-[10px] text-[var(--color-danger)]">
            {value.error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={value.saving}
            className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={value.saving}
            className="rounded bg-[var(--color-primary)] px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {value.saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </form>
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
        isSelected &&
          "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
      )}
    >
      <StatusDot session={session} />
      <span className="flex-1 truncate font-mono opacity-70">
        instance #{index + 1}
      </span>
      {session.alive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onKill();
          }}
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
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDrop,
  isDragged,
  isOver,
}: {
  session: SessionInfo;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  onKill: () => void;
  onRemove: () => void;
  onSave: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragged: boolean;
  isOver: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      className={cn(
        "group flex items-center gap-1.5 pl-2 pr-2 py-1 text-xs cursor-pointer",
        "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        "hover:bg-[var(--color-surface-2)] transition-colors",
        isSelected &&
          "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
        isDragged && "opacity-40",
        isOver && "border-t-2 border-[var(--color-primary)]",
      )}
    >
      <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing mr-0.5" />
      <StatusDot session={session} />
      <Terminal className="h-3 w-3 shrink-0 opacity-60" />
      <span className="flex-1 truncate font-mono">{label}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {session.command && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSave();
            }}
            title="Save to project profile"
            className="rounded p-0.5 hover:bg-[var(--color-primary)]/20 hover:text-[var(--color-primary)] transition-colors"
          >
            <Save className="h-3 w-3" />
          </button>
        )}
        {session.alive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onKill();
            }}
            title="Kill terminal"
            className="rounded p-0.5 hover:bg-amber-500/20 hover:text-amber-500 transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove terminal"
          className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function ProfileEditorRow({
  value,
  onNameChange,
  onCommandChange,
  onCwdChange,
  onSave,
  onCancel,
}: {
  value: Extract<EditState, { kind: "profile" }>;
  onNameChange: (name: string) => void;
  onCommandChange: (command: string) => void;
  onCwdChange: (cwd: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
      className="mx-2 mb-2 mt-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
    >
      <div className="grid gap-2">
        <input
          autoFocus
          className={inputClass}
          value={value.name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => handleEditorKeyDown(e, onCancel)}
          placeholder="Profile name"
          disabled={value.saving}
        />
        <input
          className={inputClass}
          value={value.command}
          onChange={(e) => onCommandChange(e.target.value)}
          onKeyDown={(e) => handleEditorKeyDown(e, onCancel)}
          placeholder="bash"
          disabled={value.saving}
        />
        <input
          className={inputClass}
          value={value.cwd}
          onChange={(e) => onCwdChange(e.target.value)}
          onKeyDown={(e) => handleEditorKeyDown(e, onCancel)}
          placeholder="."
          disabled={value.saving}
        />
        {value.error && (
          <p className="text-[10px] text-[var(--color-danger)]">
            {value.error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={value.saving}
            className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={value.saving}
            className="rounded bg-[var(--color-primary)] px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {value.saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Expandable profile node with instance children */
function ProfileRow({
  cmd,
  selectedId,
  isExpanded,
  isEditing,
  editor,
  onToggle,
  onSelectInstance,
  onLaunchInstance,
  onKillInstance,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDrop,
  isDragged,
  isOver,
}: {
  cmd: TreeCommand;
  selectedId: string | null;
  isExpanded: boolean;
  isEditing: boolean;
  editor?: React.ReactNode;
  onToggle: () => void;
  onSelectInstance: (sessionId: string) => void;
  onLaunchInstance: () => void;
  onKillInstance: (sessionId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragged: boolean;
  isOver: boolean;
}) {
  const sessions = cmd.sessions ?? [];
  const aliveCount = sessions.filter((session) => session.alive).length;

  return (
    <>
      <div
        onClick={onToggle}
        draggable={!isEditing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDrop={onDrop}
        className={cn(
          "group flex items-center gap-1.5 pl-2 pr-2 py-1 text-xs cursor-pointer",
          "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          "hover:bg-[var(--color-surface-2)] transition-colors",
          isEditing && "bg-[var(--color-primary)]/8",
          isDragged && "opacity-40",
          isOver && "border-t-2 border-[var(--color-primary)]",
        )}
      >
        <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing mr-0.5" />
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
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            title="Edit profile"
            className={cn(
              "rounded p-0.5 transition-colors",
              isEditing
                ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] opacity-100"
                : "hover:bg-[var(--color-primary)]/20 hover:text-[var(--color-primary)]",
            )}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLaunchInstance();
            }}
            title="Launch new instance"
            className="rounded p-0.5 hover:bg-green-500/20 hover:text-green-500 transition-colors"
          >
            <Play className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete profile"
            className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {isEditing && editor}

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
  activeProjectName,
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
  onUpdateProfile,
  onUpdateCustomCommand,
}: Props) {
  const { data: globalConfig } = useGlobalConfig();
  const updateUi = useUpdateUiConfig();

  const [activeSuggestionProject, setActiveSuggestionProject] = useState<
    string | null
  >(null);
  const [showFreeSuggestion, setShowFreeSuggestion] = useState(false);
  const [editState, setEditState] = useState<EditState>(null);
  const [terminalsExpanded, setTerminalsExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem("dam-hopper:expanded-free-terminals");
    return stored === null ? true : stored === "true";
  });
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("dam-hopper:expanded-projects");
    if (stored) {
      try {
        return new Set(JSON.parse(stored) as string[]);
      } catch {
        // ignore malformed storage
      }
    }
    return new Set(projects.map((project) => project.name));
  });
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("dam-hopper:expanded-profiles");
    if (stored) {
      try {
        return new Set(JSON.parse(stored) as string[]);
      } catch {
        // ignore malformed storage
      }
    }
    return new Set();
  });

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<
    "free" | "project" | "command" | null
  >(null);
  const [dragProject, setDragProject] = useState<string | null>(null);
  const activeProject = activeProjectName
    ? projects.find((project) => project.name === activeProjectName)
    : undefined;

  const autoExpandedRef = useRef<Set<string>>(
    new Set(projects.map((project) => project.name)),
  );

  useEffect(() => {
    let changed = false;
    const next = new Set(expandedProjects);

    for (const project of projects) {
      if (!autoExpandedRef.current.has(project.name)) {
        next.add(project.name);
        autoExpandedRef.current.add(project.name);
        changed = true;
      }
    }

    if (changed) {
      setExpandedProjects(next);
    }
  }, [projects, expandedProjects]);

  function persistExpandedProfiles(next: Set<string>) {
    localStorage.setItem(
      "dam-hopper:expanded-profiles",
      JSON.stringify([...next]),
    );
  }

  function ensureProfileExpanded(key: string) {
    setExpandedProfiles((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      persistExpandedProfiles(next);
      return next;
    });
  }

  function toggleTerminals() {
    setTerminalsExpanded((prev) => {
      localStorage.setItem("dam-hopper:expanded-free-terminals", String(!prev));
      return !prev;
    });
  }

  function toggleProject(name: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      localStorage.setItem(
        "dam-hopper:expanded-projects",
        JSON.stringify([...next]),
      );
      return next;
    });
  }

  function toggleProfile(key: string) {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistExpandedProfiles(next);
      return next;
    });
  }

  function handleDragStart(
    e: React.DragEvent,
    type: "free" | "project" | "command",
    id: string,
    projectName?: string,
  ) {
    setDragType(type);
    setDraggedId(id);
    setDragProject(projectName || null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDragOverId(null);
    setDragType(null);
    setDragProject(null);
  }

  function handleDragOver(
    e: React.DragEvent,
    type: "free" | "project" | "command",
    id: string,
    projectName?: string,
  ) {
    e.preventDefault();
    if (draggedId === id) return;
    if (dragType !== type) return;
    if (type === "command" && dragProject !== projectName) return;

    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  }

  function handleDrop(
    e: React.DragEvent,
    type: "free" | "project" | "command",
    targetId: string,
    projectName?: string,
  ) {
    e.preventDefault();
    if (!draggedId || draggedId === targetId || dragType !== type) {
      handleDragEnd();
      return;
    }

    if (type === "free") {
      const currentOrder = freeTerminals.map((session) => session.id);
      const fromIndex = currentOrder.indexOf(draggedId);
      const toIndex = currentOrder.indexOf(targetId);

      if (fromIndex !== -1 && toIndex !== -1) {
        const newOrder = [...currentOrder];
        const [removed] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, removed);

        const baseUi = withUiConfigDefaults(globalConfig?.ui);

        updateUi.mutate({
          ...baseUi,
          terminalOrder: newOrder,
        });
      }
    } else if (type === "project") {
      const currentOrder = projects.map((project) => project.name);
      const fromIndex = currentOrder.indexOf(draggedId);
      const toIndex = currentOrder.indexOf(targetId);

      if (fromIndex !== -1 && toIndex !== -1) {
        const newOrder = [...currentOrder];
        const [removed] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, removed);

        const baseUi = withUiConfigDefaults(globalConfig?.ui);

        updateUi.mutate({
          ...baseUi,
          projectOrder: newOrder,
        });
      }
    } else if (type === "command" && dragProject === projectName) {
      const project = projects.find(
        (candidate) => candidate.name === projectName,
      );
      if (project) {
        const currentOrder = project.commands.map((command) => command.key);
        const fromIndex = currentOrder.indexOf(draggedId);
        const toIndex = currentOrder.indexOf(targetId);

        if (fromIndex !== -1 && toIndex !== -1) {
          const newOrder = [...currentOrder];
          const [removed] = newOrder.splice(fromIndex, 1);
          newOrder.splice(toIndex, 0, removed);

          const baseUi = withUiConfigDefaults(globalConfig?.ui);

          const commandOrderMap = { ...(baseUi.projectCommandOrder || {}) };
          commandOrderMap[projectName] = newOrder;

          updateUi.mutate({
            ...baseUi,
            projectCommandOrder: commandOrderMap,
          });
        }
      }
    }

    handleDragEnd();
  }

  function startProfileEdit(projectName: string, cmd: TreeCommand) {
    if (!cmd.profileName) return;
    setActiveSuggestionProject(null);
    ensureProfileExpanded(getProfileEditorKey(projectName, cmd.profileName));
    setEditState({
      kind: "profile",
      projectName,
      originalName: cmd.profileName,
      name: cmd.profileName,
      command: cmd.command,
      cwd: cmd.cwd ?? ".",
      saving: false,
    });
  }

  function startCommandEdit(projectName: string, cmd: TreeCommand) {
    if (cmd.type !== "custom") return;
    setActiveSuggestionProject(null);
    setEditState({
      kind: "command",
      projectName,
      originalKey: cmd.key,
      key: cmd.key,
      command: cmd.command,
      saving: false,
    });
  }

  async function saveProfileEdit() {
    if (!editState || editState.kind !== "profile") return;

    setEditState((prev) =>
      prev?.kind === "profile"
        ? { ...prev, saving: true, error: undefined }
        : prev,
    );

    try {
      await onUpdateProfile(editState.projectName, editState.originalName, {
        name: editState.name,
        command: editState.command,
        cwd: editState.cwd,
      });
      setEditState(null);
    } catch (error) {
      setEditState((prev) =>
        prev?.kind === "profile"
          ? {
              ...prev,
              saving: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to save profile",
            }
          : prev,
      );
    }
  }

  async function saveCommandEdit() {
    if (!editState || editState.kind !== "command") return;

    setEditState((prev) =>
      prev?.kind === "command"
        ? { ...prev, saving: true, error: undefined }
        : prev,
    );

    try {
      await onUpdateCustomCommand(
        editState.projectName,
        editState.originalKey,
        {
          key: editState.key,
          command: editState.command,
        },
      );
      setEditState(null);
    } catch (error) {
      setEditState((prev) =>
        prev?.kind === "command"
          ? {
              ...prev,
              saving: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to save command",
            }
          : prev,
      );
    }
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
            const aliveCount = freeTerminals.filter(
              (session) => session.alive,
            ).length;
            return aliveCount > 0 ? (
              <span className="rounded-full bg-green-500/20 px-1.5 text-green-600 text-[10px] font-medium">
                {aliveCount}
              </span>
            ) : null;
          })()}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowFreeSuggestion((value) => !value);
            }}
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
                  projectName={activeProject?.name}
                  projectType={activeProject?.type}
                  placeholder="Command or press Enter for shell..."
                  onSelect={(command) => {
                    onLaunchFreeWithCommand(
                      command.command,
                      activeProject?.name,
                    );
                    setShowFreeSuggestion(false);
                  }}
                  onSubmitCustom={(command) => {
                    if (command.trim()) {
                      onLaunchFreeWithCommand(command, activeProject?.name);
                    } else {
                      onAddFreeTerminal(activeProject?.name);
                    }
                    setShowFreeSuggestion(false);
                  }}
                />
              </div>
            )}
            {freeTerminals.map((session, index) => (
              <FreeTerminalRow
                key={session.id}
                session={session}
                label={`Terminal ${index + 1}`}
                isSelected={selectedId === `terminal:${session.id}`}
                onSelect={() => onSelectFreeTerminal(session.id)}
                onKill={() => onKillFreeTerminal(session.id)}
                onRemove={() => onRemoveFreeTerminal(session.id)}
                onSave={() => onSaveFreeTerminal(session.id)}
                onDragStart={(e) => handleDragStart(e, "free", session.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, "free", session.id)}
                onDragEnter={() => setDragOverId(session.id)}
                onDrop={(e) => handleDrop(e, "free", session.id)}
                isDragged={dragType === "free" && draggedId === session.id}
                isOver={dragType === "free" && dragOverId === session.id}
              />
            ))}
            {freeTerminals.length === 0 && !showFreeSuggestion && (
              <div className="pl-8 pr-2 py-1 text-xs text-[var(--color-text-muted)]/50 italic">
                No terminals - press + to create one
              </div>
            )}
          </div>
        )}
      </div>

      {projects.length > 0 && (
        <div className="px-2 py-1.5 mt-1 border-t border-[var(--color-border)]">
          <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Projects
          </span>
        </div>
      )}

      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.name);
        const isProjectSelected = selectedId === `project:${project.name}`;

        return (
          <div key={project.name}>
            <div
              onClick={() => {
                toggleProject(project.name);
                onSelectProject(project.name);
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, "project", project.name)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, "project", project.name)}
              onDragEnter={() => setDragOverId(project.name)}
              onDrop={(e) => handleDrop(e, "project", project.name)}
              className={cn(
                "group flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium cursor-pointer",
                "text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors",
                isProjectSelected &&
                  "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
                dragType === "project" &&
                  draggedId === project.name &&
                  "opacity-40",
                dragType === "project" &&
                  dragOverId === project.name &&
                  "border-t-2 border-[var(--color-primary)]",
              )}
            >
              <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing mr-0.5" />
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

            {isExpanded && (
              <div>
                {project.commands.map((cmd) => {
                  if (cmd.type === "terminal") {
                    const profileKey = getProfileEditorKey(
                      project.name,
                      cmd.profileName ?? "",
                    );
                    const isEditing =
                      editState?.kind === "profile" &&
                      editState.projectName === project.name &&
                      editState.originalName === cmd.profileName;
                    return (
                      <ProfileRow
                        key={cmd.key}
                        cmd={cmd}
                        selectedId={selectedId}
                        isExpanded={expandedProfiles.has(profileKey)}
                        isEditing={!!isEditing}
                        editor={
                          isEditing && editState?.kind === "profile" ? (
                            <ProfileEditorRow
                              value={editState}
                              onNameChange={(name) =>
                                setEditState((prev) =>
                                  prev?.kind === "profile"
                                    ? { ...prev, name, error: undefined }
                                    : prev,
                                )
                              }
                              onCommandChange={(command) =>
                                setEditState((prev) =>
                                  prev?.kind === "profile"
                                    ? { ...prev, command, error: undefined }
                                    : prev,
                                )
                              }
                              onCwdChange={(cwd) =>
                                setEditState((prev) =>
                                  prev?.kind === "profile"
                                    ? { ...prev, cwd, error: undefined }
                                    : prev,
                                )
                              }
                              onSave={saveProfileEdit}
                              onCancel={() => setEditState(null)}
                            />
                          ) : null
                        }
                        onToggle={() => toggleProfile(profileKey)}
                        onSelectInstance={(sessionId) =>
                          onSelectTerminal(sessionId)
                        }
                        onLaunchInstance={() =>
                          onLaunchProfile(project.name, cmd)
                        }
                        onKillInstance={(sessionId) =>
                          onKillTerminal(sessionId)
                        }
                        onEdit={() => startProfileEdit(project.name, cmd)}
                        onDelete={() =>
                          onDeleteProfile(project.name, cmd.profileName!)
                        }
                        onDragStart={(e) =>
                          handleDragStart(e, "command", cmd.key, project.name)
                        }
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) =>
                          handleDragOver(e, "command", cmd.key, project.name)
                        }
                        onDragEnter={() => setDragOverId(cmd.key)}
                        onDrop={(e) =>
                          handleDrop(e, "command", cmd.key, project.name)
                        }
                        isDragged={
                          dragType === "command" &&
                          draggedId === cmd.key &&
                          dragProject === project.name
                        }
                        isOver={
                          dragType === "command" &&
                          dragOverId === cmd.key &&
                          dragProject === project.name
                        }
                      />
                    );
                  }

                  const isEditing =
                    editState?.kind === "command" &&
                    editState.projectName === project.name &&
                    editState.originalKey === cmd.key;
                  const canEdit = cmd.type === "custom";

                  return (
                    <div key={cmd.sessionId}>
                      <CommandRow
                        cmd={cmd}
                        isSelected={selectedId === `terminal:${cmd.sessionId}`}
                        isEditing={!!isEditing}
                        canEdit={canEdit}
                        onSelect={() => onSelectTerminal(cmd.sessionId)}
                        onLaunch={() => onLaunchTerminal(project.name, cmd)}
                        onKill={() => onKillTerminal(cmd.sessionId)}
                        onEdit={
                          canEdit
                            ? () => startCommandEdit(project.name, cmd)
                            : undefined
                        }
                        onDragStart={(e) =>
                          handleDragStart(e, "command", cmd.key, project.name)
                        }
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) =>
                          handleDragOver(e, "command", cmd.key, project.name)
                        }
                        onDragEnter={() => setDragOverId(cmd.key)}
                        onDrop={(e) =>
                          handleDrop(e, "command", cmd.key, project.name)
                        }
                        isDragged={
                          dragType === "command" &&
                          draggedId === cmd.key &&
                          dragProject === project.name
                        }
                        isOver={
                          dragType === "command" &&
                          dragOverId === cmd.key &&
                          dragProject === project.name
                        }
                      />
                      {isEditing && editState?.kind === "command" && (
                        <CommandEditorRow
                          value={editState}
                          onKeyChange={(key) =>
                            setEditState((prev) =>
                              prev?.kind === "command"
                                ? { ...prev, key, error: undefined }
                                : prev,
                            )
                          }
                          onCommandChange={(command) =>
                            setEditState((prev) =>
                              prev?.kind === "command"
                                ? { ...prev, command, error: undefined }
                                : prev,
                            )
                          }
                          onSave={saveCommandEdit}
                          onCancel={() => setEditState(null)}
                        />
                      )}
                    </div>
                  );
                })}

                {activeSuggestionProject === project.name ? (
                  <div className="px-2 py-1">
                    <CommandSuggestionInput
                      projectType={project.type as ProjectType}
                      projectName={project.name}
                      autoFocus
                      placeholder="Search commands..."
                      onSelect={(command) => {
                        onLaunchSuggestedCommand(project.name, command.command);
                        setActiveSuggestionProject(null);
                      }}
                      onSubmitCustom={(command) => {
                        if (command.trim()) {
                          onLaunchSuggestedCommand(project.name, command);
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
                    onClick={() => {
                      setEditState(null);
                      setActiveSuggestionProject(project.name);
                    }}
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
