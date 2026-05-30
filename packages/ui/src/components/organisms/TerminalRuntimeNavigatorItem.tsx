import { Circle, Cloud, ExternalLink, Radio, Terminal as TerminalIcon, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { RuntimePort, RuntimeTreeItem } from "@/lib/terminal-runtime-tree.js";

interface Props {
  active: boolean;
  dragState:
    | { type: "group"; id: string }
    | { type: "item"; id: string; groupId: string }
    | null;
  item: RuntimeTreeItem;
  onSelectSession?: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
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

function RuntimePortChip({
  port,
  onStartTunnel,
  onStopTunnel,
}: {
  port: RuntimePort;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
      <Radio className="h-3 w-3 shrink-0" />
      <span className="font-mono text-[var(--color-text)]">:{port.port}</span>
      <span>{port.tunnelStatus ?? port.state}</span>
      {port.tunnelUrl ? (
        <a
          href={port.tunnelUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="rounded p-0.5 hover:bg-[var(--color-background)]"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      {port.tunnelId ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void onStopTunnel(port.tunnelId!);
          }}
          className="rounded p-0.5 hover:bg-[var(--color-background)]"
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void onStartTunnel(port.port, port.project || `port-${port.port}`);
          }}
          className="rounded p-0.5 hover:bg-[var(--color-background)]"
        >
          <Cloud className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function TerminalRuntimeNavigatorItem({
  active,
  dragState,
  item,
  onSelectSession,
  onCloseSession,
  onMoveItem,
  onSetDragState,
  onStartTunnel,
  onStopTunnel,
}: Props) {
  const ports = item.kind === "session" ? item.ports : item.ports;

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        onSetDragState({ type: "item", id: item.id, groupId: item.groupId });
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        onSetDragState(null);
      }}
      onDragOver={(event) => {
        if (
          dragState?.type !== "item" ||
          dragState.groupId !== item.groupId ||
          dragState.id === item.id
        ) {
          return;
        }
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (
          dragState?.type !== "item" ||
          dragState.groupId !== item.groupId ||
          dragState.id === item.id
        ) {
          return;
        }
        event.preventDefault();
        onMoveItem(item.groupId, dragState.id, item.id);
        onSetDragState(null);
      }}
      className={cn(
        "rounded-sm border border-transparent px-2 py-1.5 text-xs transition-colors",
        active
          ? "bg-[var(--color-primary)]/12 text-[var(--color-text)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            item.kind === "session" && item.alive === false
              ? "bg-[var(--color-warning)]"
              : "bg-[var(--color-success)]",
          )}
        />
        {item.kind === "session" ? (
          <button
            type="button"
            onClick={() => onSelectSession?.(item.sessionId)}
            title={item.cwd ? `cwd: ${item.cwd}` : item.sessionId}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate font-mono">{item.label}</span>
          </button>
        ) : (
          <>
            <Circle className="h-3.5 w-3.5 shrink-0 fill-[var(--color-primary)] text-[var(--color-primary)]" />
            <span className="font-mono text-[var(--color-text)]">:{item.port}</span>
            <span className="truncate">Detached port</span>
          </>
        )}
        {item.kind === "session" ? (
          <button
            type="button"
            title="Close terminal (terminates process)"
            onClick={(event) => {
              event.stopPropagation();
              onCloseSession?.(item.sessionId);
            }}
            className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {ports.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1 pl-5">
          {ports.map((port) => (
            <RuntimePortChip
              key={`${item.id}:${port.port}`}
              port={port}
              onStartTunnel={onStartTunnel}
              onStopTunnel={onStopTunnel}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
