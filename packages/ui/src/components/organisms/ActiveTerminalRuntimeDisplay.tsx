import { useMemo } from "react";
import { Circle, Plus, Radio, Terminal as TerminalIcon } from "lucide-react";
import { TerminalRuntimeOutput } from "@/components/organisms/TerminalRuntimeOutput.js";
import { usePorts } from "@/hooks/use-ports.js";
import { cn } from "@/lib/utils.js";
import {
  UNASSIGNED_RUNTIME_GROUP_ID,
  groupActiveTerminalRuntime,
  type RuntimeProjectGroup,
  type RuntimeTerminal,
} from "@/lib/terminal-runtime-groups.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
interface ActiveTerminalRuntimeDisplayProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  openTabs: TabEntry[];
  currentProjectName?: string | null;
  layoutRevision?: number;
  onSessionExit?: (sessionId: string) => void;
  onNewProjectTerminal?: (projectName: string) => void;
  onNewFreeTerminal?: () => void;
  onSelectTab?: (sessionId: string) => void;
}
function TerminalRow({
  terminal,
  active,
  onSelect,
}: {
  terminal: RuntimeTerminal;
  active: boolean;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(terminal.sessionId)}
      title={terminal.cwd ? `cwd: ${terminal.cwd}` : terminal.sessionId}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
        active
          ? "bg-[var(--color-primary)]/12 text-[var(--color-text)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          terminal.alive === false
            ? "bg-[var(--color-warning)]"
            : "bg-[var(--color-success)]",
        )}
      />
      <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-mono">
        {terminal.label}
      </span>
    </button>
  );
}
function PortRow({ port }: { port: RuntimeProjectGroup["ports"][number] }) {
  const label = port.tunnelStatus
    ? `${port.state} · ${port.tunnelStatus}`
    : port.state;
  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
      <Circle className="h-2 w-2 shrink-0 fill-[var(--color-primary)] text-[var(--color-primary)]" />
      <Radio className="h-3.5 w-3.5 shrink-0" />
      <span className="font-mono text-[var(--color-text)]">:{port.port}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}
function RuntimeGroup({
  group,
  activeSessionId,
  onSelectTab,
  onNewProjectTerminal,
}: {
  group: RuntimeProjectGroup;
  activeSessionId: string | null;
  onSelectTab: (sessionId: string) => void;
  onNewProjectTerminal?: (projectName: string) => void;
}) {
  const canLaunchInGroup =
    !group.isFreeGroup &&
    group.id !== UNASSIGNED_RUNTIME_GROUP_ID &&
    onNewProjectTerminal;
  return (
    <section className="border-b border-[var(--color-border)] px-2 py-2 last:border-b-0">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          {group.name}
        </span>
        {canLaunchInGroup ? (
          <button
            type="button"
            onClick={() => onNewProjectTerminal(group.name)}
            title={`Open terminal in ${group.name}`}
            className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {group.terminals.map((terminal) => (
          <TerminalRow
            key={terminal.sessionId}
            terminal={terminal}
            active={terminal.sessionId === activeSessionId}
            onSelect={onSelectTab}
          />
        ))}
        {group.ports.map((port) => (
          <PortRow
            key={`${port.port}:${port.sessionId ?? "port"}`}
            port={port}
          />
        ))}
      </div>
    </section>
  );
}
export function ActiveTerminalRuntimeDisplay({
  activeSessionId,
  mountedSessions,
  openTabs,
  currentProjectName,
  layoutRevision = 0,
  onSessionExit,
  onNewProjectTerminal,
  onNewFreeTerminal,
  onSelectTab,
}: ActiveTerminalRuntimeDisplayProps) {
  const { ports } = usePorts();
  const groups = useMemo(
    () =>
      groupActiveTerminalRuntime({
        terminals: mountedSessions,
        tabs: openTabs,
        ports,
      }),
    [mountedSessions, openTabs, ports],
  );
  const handleNewTerminal = () => {
    if (currentProjectName) onNewProjectTerminal?.(currentProjectName);
    else onNewFreeTerminal?.();
  };
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--color-background)]">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Runtime
          </span>
          <button
            type="button"
            onClick={handleNewTerminal}
            title="Open terminal"
            className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {groups.length > 0 ? (
            groups.map((group) => (
              <RuntimeGroup
                key={group.id}
                group={group}
                activeSessionId={activeSessionId}
                onSelectTab={onSelectTab ?? (() => {})}
                onNewProjectTerminal={onNewProjectTerminal}
              />
            ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--color-text-muted)]">
              <TerminalIcon className="h-8 w-8 opacity-20" />
              <span>No active terminals or ports</span>
            </div>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <TerminalRuntimeOutput
          activeSessionId={activeSessionId}
          mountedSessions={mountedSessions}
          layoutRevision={layoutRevision}
          onSessionExit={onSessionExit}
          onNewTerminal={handleNewTerminal}
          onSelectActive={onSelectTab}
        />
      </main>
    </div>
  );
}
