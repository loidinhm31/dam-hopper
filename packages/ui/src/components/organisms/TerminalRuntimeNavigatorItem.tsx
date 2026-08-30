import {
  Circle,
  Cloud,
  ExternalLink,
  PanelRightOpen,
  Pin,
  PinOff,
  Radio,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { TerminalActivityIndicator } from "@/components/atoms/TerminalActivityIndicator.js";
import {
  openTerminalDiagnosticsContextMenu,
  type TerminalDiagnosticsMenuHandler,
} from "@/components/organisms/TerminalDiagnosticsContextMenu.js";
import type {
  RuntimePort,
  RuntimeSessionItem,
  RuntimeTreeItem,
} from "@/lib/terminal-runtime-tree.js";
import type { TunnelInfo } from "@/api/client.js";

interface Props {
  activeSessionId: string | null;
  disableReorder?: boolean;
  dragState:
    | { type: "group"; id: string }
    | { type: "item"; id: string; groupId: string }
    | null;
  item: RuntimeTreeItem;
  onSelectSession?: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onMoveItem: (groupId: string, draggedId: string, targetId: string) => void;
  onSetDragState: (
    state:
      | { type: "group"; id: string }
      | { type: "item"; id: string; groupId: string }
      | null,
  ) => void;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
  onOpenTunnelInBrowser?: (url: string, tunnel: TunnelInfo) => void;
  touchOptimized?: boolean;
}

function RuntimePortChip({
  port,
  onStartTunnel,
  onStopTunnel,
  onOpenTunnelInBrowser,
}: {
  port: RuntimePort;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
  onOpenTunnelInBrowser?: (url: string, tunnel: TunnelInfo) => void;
}) {
  const readyTunnelUrl =
    port.tunnelStatus === "ready" ? port.tunnelUrl : undefined;

  return (
    <div className="flex items-center gap-1 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
      <Radio className="h-3 w-3 shrink-0" />
      <span className="font-mono text-[var(--color-text)]">:{port.port}</span>
      <span>{port.tunnelStatus ?? port.state}</span>
      {readyTunnelUrl && onOpenTunnelInBrowser ? (
        <button
          type="button"
          title={`Open ${readyTunnelUrl} in embedded Browser`}
          aria-label={`Open ${readyTunnelUrl} in embedded Browser`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenTunnelInBrowser(readyTunnelUrl, port.tunnel!);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          className="rounded p-1 hover:bg-[var(--color-background)]"
        >
          <PanelRightOpen className="h-3 w-3" />
        </button>
      ) : null}
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

function RuntimeSessionLeaf({
  active,
  session,
  onSelectSession,
  onToggleTabPin,
  onCloseSession,
  onOpenDiagnosticsMenu,
  onStartTunnel,
  onStopTunnel,
  onOpenTunnelInBrowser,
  touchOptimized = false,
}: {
  active: boolean;
  session: RuntimeSessionItem;
  onSelectSession?: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
  onOpenTunnelInBrowser?: (url: string, tunnel: TunnelInfo) => void;
  touchOptimized?: boolean;
}) {
  return (
    <div
      onClick={() => onSelectSession?.(session.sessionId)}
      className={cn(
        "rounded-sm px-1.5 py-1 outline-none",
        "focus-within:ring-1 focus-within:ring-[var(--color-primary)]/60",
        touchOptimized && "min-h-11 py-2 text-sm",
        active
          ? "bg-[var(--color-primary)]/15 text-[var(--color-text)] ring-1 ring-inset ring-[var(--color-primary)]/45"
          : "",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          title={session.cwd ? `cwd: ${session.cwd}` : session.sessionId}
          onClick={(event) => {
            event.stopPropagation();
            onSelectSession?.(session.sessionId);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]/60"
          onContextMenu={(event) =>
            openTerminalDiagnosticsContextMenu(
              event,
              session.sessionId,
              onOpenDiagnosticsMenu,
            )
          }
        >
          <TerminalActivityIndicator
            sessionId={session.sessionId}
            alive={session.alive}
          />
          <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate font-mono">{session.label}</span>
        </button>
        <button
          type="button"
          aria-label={session.isPinned ? "Unpin terminal" : "Pin terminal"}
          aria-pressed={session.isPinned === true}
          title={
            session.isPinned
              ? "Unpin terminal (allows closing)"
              : "Pin terminal (prevents closing)"
          }
          onClick={(event) => {
            event.stopPropagation();
            onToggleTabPin?.(session.sessionId);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "rounded-sm p-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]",
            session.isPinned
              ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
          )}
        >
          {session.isPinned ? (
            <PinOff className="h-3 w-3" />
          ) : (
            <Pin className="h-3 w-3" />
          )}
        </button>
        {!session.isPinned ? (
          <button
            type="button"
            aria-label="Close terminal"
            title="Close terminal (terminates process)"
            onClick={(event) => {
              event.stopPropagation();
              onCloseSession?.(session.sessionId);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {session.ports.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1 pl-5">
          {session.ports.map((port) => (
            <RuntimePortChip
              key={`${session.sessionId}:${port.port}`}
              port={port}
              onStartTunnel={onStartTunnel}
              onStopTunnel={onStopTunnel}
              onOpenTunnelInBrowser={onOpenTunnelInBrowser}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TerminalRuntimeNavigatorItem({
  activeSessionId,
  disableReorder = false,
  dragState,
  item,
  onSelectSession,
  onToggleTabPin,
  onCloseSession,
  onOpenDiagnosticsMenu,
  onMoveItem,
  onSetDragState,
  onStartTunnel,
  onStopTunnel,
  onOpenTunnelInBrowser,
  touchOptimized = false,
}: Props) {
  const isTopLevelActive =
    item.kind === "session"
      ? item.sessionId === activeSessionId
      : item.kind === "service-group"
        ? item.sessions.some((session) => session.sessionId === activeSessionId)
        : false;

  return (
    <div
      draggable={!disableReorder}
      onDragStart={(event) => {
        if (disableReorder) return;
        event.stopPropagation();
        onSetDragState({ type: "item", id: item.id, groupId: item.groupId });
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        onSetDragState(null);
      }}
      onDragOver={(event) => {
        if (disableReorder) return;
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
        if (disableReorder) return;
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
        touchOptimized && "py-2 text-sm",
        isTopLevelActive
          ? "bg-[var(--color-primary)]/12 text-[var(--color-text)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      {item.kind === "session" ? (
        <RuntimeSessionLeaf
          active={item.sessionId === activeSessionId}
          session={item}
          onSelectSession={onSelectSession}
          onToggleTabPin={onToggleTabPin}
          onCloseSession={onCloseSession}
          onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
          onStartTunnel={onStartTunnel}
          onStopTunnel={onStopTunnel}
          onOpenTunnelInBrowser={onOpenTunnelInBrowser}
          touchOptimized={touchOptimized}
        />
      ) : item.kind === "service-group" ? (
        <>
          <div className="flex items-center gap-2">
            <Circle className="h-3.5 w-3.5 shrink-0 fill-[var(--color-primary)] text-[var(--color-primary)]" />
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text)]">
              {item.label}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {item.sessions.length}
            </span>
          </div>
          <div className="mt-1 space-y-1 pl-3">
            {item.sessions.map((session) => (
              <RuntimeSessionLeaf
                key={session.sessionId}
                active={session.sessionId === activeSessionId}
                session={session}
                onSelectSession={onSelectSession}
                onToggleTabPin={onToggleTabPin}
                onCloseSession={onCloseSession}
                onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
                onStartTunnel={onStartTunnel}
                onStopTunnel={onStopTunnel}
                onOpenTunnelInBrowser={onOpenTunnelInBrowser}
                touchOptimized={touchOptimized}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Circle className="h-3.5 w-3.5 shrink-0 fill-[var(--color-primary)] text-[var(--color-primary)]" />
            <span className="font-mono text-[var(--color-text)]">
              :{item.port}
            </span>
            <span className="truncate">Detached port</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1 pl-5">
            {item.ports.map((port) => (
              <RuntimePortChip
                key={`${item.id}:${port.port}`}
                port={port}
                onStartTunnel={onStartTunnel}
                onStopTunnel={onStopTunnel}
                onOpenTunnelInBrowser={onOpenTunnelInBrowser}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
