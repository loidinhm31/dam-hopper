import { Plus } from "lucide-react";
import { TerminalRuntimeNavigatorItem } from "@/components/organisms/TerminalRuntimeNavigatorItem.js";
import {
  UNASSIGNED_RUNTIME_GROUP_ID,
  type RuntimeTreeGroup,
} from "@/lib/terminal-runtime-tree.js";

interface Props {
  activeSessionId: string | null;
  dragState:
    | { type: "group"; id: string }
    | { type: "item"; id: string; groupId: string }
    | null;
  group: RuntimeTreeGroup;
  onSelectSession?: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
  onNewProjectTerminal?: (projectName: string) => void;
  onMoveGroup: (draggedId: string, targetId: string) => void;
  onMoveItem: (groupId: string, draggedId: string, targetId: string) => void;
  onSetDragState: (
    state:
      | { type: "group"; id: string }
      | { type: "item"; id: string; groupId: string }
      | null,
  ) => void;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
}

export function TerminalRuntimeNavigatorGroup({
  activeSessionId,
  dragState,
  group,
  onSelectSession,
  onCloseSession,
  onNewProjectTerminal,
  onMoveGroup,
  onMoveItem,
  onSetDragState,
  onStartTunnel,
  onStopTunnel,
}: Props) {
  const canLaunchInGroup =
    !group.isFreeGroup &&
    group.id !== UNASSIGNED_RUNTIME_GROUP_ID &&
    onNewProjectTerminal;

  return (
    <section
      draggable
      onDragStart={() => onSetDragState({ type: "group", id: group.id })}
      onDragEnd={() => onSetDragState(null)}
      onDragOver={(event) => {
        if (dragState?.type !== "group" || dragState.id === group.id) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (dragState?.type !== "group" || dragState.id === group.id) return;
        event.preventDefault();
        onMoveGroup(dragState.id, group.id);
        onSetDragState(null);
      }}
      className="border-b border-[var(--color-border)] px-2 py-2 last:border-b-0"
    >
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
      <div className="space-y-1">
        {group.items.map((item) => (
          <TerminalRuntimeNavigatorItem
            key={item.id}
            activeSessionId={activeSessionId}
            dragState={dragState}
            item={item}
            onCloseSession={onCloseSession}
            onMoveItem={onMoveItem}
            onSelectSession={onSelectSession}
            onSetDragState={onSetDragState}
            onStartTunnel={onStartTunnel}
            onStopTunnel={onStopTunnel}
          />
        ))}
      </div>
    </section>
  );
}
