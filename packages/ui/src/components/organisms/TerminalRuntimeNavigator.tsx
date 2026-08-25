import { useState } from "react";
import { Plus, Terminal as TerminalIcon } from "lucide-react";
import { TerminalRuntimeNavigatorGroup } from "@/components/organisms/TerminalRuntimeNavigatorGroup.js";
import type { RuntimeTreeGroup } from "@/lib/terminal-runtime-tree.js";
import { cn } from "@/lib/utils.js";
import type { TerminalDiagnosticsMenuHandler } from "@/components/organisms/TerminalDiagnosticsContextMenu.js";
import type { TunnelInfo } from "@/api/client.js";

interface Props {
  activeSessionId: string | null;
  groups: RuntimeTreeGroup[];
  width?: number;
  className?: string;
  disableReorder?: boolean;
  touchOptimized?: boolean;
  onSelectSession?: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onNewProjectTerminal?: (projectName: string) => void;
  onNewFreeTerminal?: () => void;
  onMoveGroup: (draggedId: string, targetId: string) => void;
  onMoveItem: (groupId: string, draggedId: string, targetId: string) => void;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
  onOpenTunnelInBrowser?: (url: string, tunnel: TunnelInfo) => void;
}

export function TerminalRuntimeNavigator({
  activeSessionId,
  groups,
  width,
  className,
  disableReorder = false,
  touchOptimized = false,
  onSelectSession,
  onToggleTabPin,
  onCloseSession,
  onOpenDiagnosticsMenu,
  onNewProjectTerminal,
  onNewFreeTerminal,
  onMoveGroup,
  onMoveItem,
  onStartTunnel,
  onStopTunnel,
  onOpenTunnelInBrowser,
}: Props) {
  const [dragState, setDragState] = useState<
    { type: "group"; id: string } | { type: "item"; id: string; groupId: string } | null
  >(null);

  return (
    <aside
      style={width ? { width } : undefined}
      className={cn(
        "flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Runtime
        </span>
        <button
          type="button"
          onClick={onNewFreeTerminal}
          title="Open terminal"
          className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {groups.length > 0 ? (
          groups.map((group) => (
            <TerminalRuntimeNavigatorGroup
              key={group.id}
              activeSessionId={activeSessionId}
              disableReorder={disableReorder}
              dragState={dragState}
              group={group}
              onCloseSession={onCloseSession}
              onToggleTabPin={onToggleTabPin}
              onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
              onMoveGroup={onMoveGroup}
              onMoveItem={onMoveItem}
              onNewProjectTerminal={onNewProjectTerminal}
              onSelectSession={onSelectSession}
              onSetDragState={setDragState}
              onStartTunnel={onStartTunnel}
              onStopTunnel={onStopTunnel}
              onOpenTunnelInBrowser={onOpenTunnelInBrowser}
              touchOptimized={touchOptimized}
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
  );
}
