import { useMemo, useState } from "react";
import { ListTree, Plus } from "lucide-react";
import { useGlobalConfig } from "@/api/queries.js";
import { TerminalRuntimeNavigator } from "@/components/organisms/TerminalRuntimeNavigator.js";
import { TerminalRuntimeOutput } from "@/components/organisms/TerminalRuntimeOutput.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { usePorts } from "@/hooks/use-ports.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useRuntimeTreeOrdering } from "@/hooks/use-runtime-tree-ordering.js";
import { buildRuntimeTree } from "@/lib/terminal-runtime-tree.js";
import { cn } from "@/lib/utils.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";

const RUNTIME_NAVIGATOR_WIDTH_KEY = "dam-hopper:runtime-navigator-width";

interface ActiveTerminalRuntimeDisplayProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  openTabs: TabEntry[];
  currentProjectName?: string | null;
  layoutRevision?: number;
  renderTerminals?: boolean;
  onSessionExit?: (sessionId: string) => void;
  onNewProjectTerminal?: (projectName: string) => void;
  onNewFreeTerminal?: () => void;
  onSelectTab?: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
}

export function ActiveTerminalRuntimeDisplay({
  activeSessionId,
  mountedSessions,
  openTabs,
  currentProjectName,
  layoutRevision = 0,
  renderTerminals = true,
  onSessionExit,
  onNewProjectTerminal,
  onNewFreeTerminal,
  onSelectTab,
  onCloseSession,
}: ActiveTerminalRuntimeDisplayProps) {
  const { data: globalConfig } = useGlobalConfig();
  const { ports, createTunnel, stopTunnel } = usePorts();
  const isCompactWorkspace = useCompactWorkspace();
  const [runtimeSheetOpen, setRuntimeSheetOpen] = useState(false);
  const uiConfig = useMemo(
    () => withUiConfigDefaults(globalConfig?.ui),
    [globalConfig?.ui],
  );
  const groups = useMemo(
    () =>
      buildRuntimeTree({
        terminals: mountedSessions,
        tabs: openTabs,
        ports,
        projectOrder: uiConfig.projectOrder,
        runtimeGroupOrder: uiConfig.runtimeGroupOrder,
        runtimeItemOrder: uiConfig.runtimeItemOrder,
      }),
    [mountedSessions, openTabs, ports, uiConfig],
  );
  const ordering = useRuntimeTreeOrdering(groups);
  const {
    width: navigatorWidth,
    handleProps: navigatorResizeProps,
    isDragging: isResizingNavigator,
  } = useResizeHandle({
    min: 220,
    max: 520,
    defaultWidth: 288,
    storageKey: RUNTIME_NAVIGATOR_WIDTH_KEY,
  });
  const handleNewTerminal = () => {
    if (currentProjectName) onNewProjectTerminal?.(currentProjectName);
    else onNewFreeTerminal?.();
  };
  const activeSession = mountedSessions.find(
    (session) => session.sessionId === activeSessionId,
  );
  const activeSessionLabel = activeSession
    ? `${activeSession.project}: ${activeSession.command}`
    : "No terminal selected";
  const handleMobileSelectSession = (sessionId: string) => {
    onSelectTab?.(sessionId);
    setRuntimeSheetOpen(false);
  };
  const handleMobileNewTerminal = () => {
    handleNewTerminal();
    setRuntimeSheetOpen(false);
  };
  const handleMobileNewProjectTerminal = (projectName: string) => {
    onNewProjectTerminal?.(projectName);
    setRuntimeSheetOpen(false);
  };

  if (isCompactWorkspace) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-background)]">
        <div className="safe-area-inline flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-3 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setRuntimeSheetOpen(true)}
            className="flex h-9 items-center gap-2 rounded-md border border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 px-3 text-xs font-semibold text-[var(--color-primary)] active:bg-[var(--color-primary)]/20"
          >
            <ListTree className="h-4 w-4 shrink-0" />
            <span>Runtime</span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[var(--color-text)]">
              {activeSessionLabel}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Full-width terminal
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewTerminal}
            title="Open terminal"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] active:bg-[var(--color-border)]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <main className="min-h-0 flex-1">
          <TerminalRuntimeOutput
            activeSessionId={activeSessionId}
            mountedSessions={mountedSessions}
            layoutRevision={layoutRevision}
            renderTerminals={renderTerminals}
            onSessionExit={onSessionExit}
            onNewTerminal={handleNewTerminal}
            onSelectActive={onSelectTab}
          />
        </main>

        <Dialog open={runtimeSheetOpen} onOpenChange={setRuntimeSheetOpen}>
          <DialogContent className="safe-area-inline safe-area-bottom fixed inset-x-0 bottom-0 top-auto left-0 z-50 max-h-[75dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl border-x-0 border-b-0 p-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:rounded-t-2xl">
            <DialogHeader className="border-b border-[var(--color-border)] px-4 py-3 text-left">
              <DialogTitle className="text-sm">Runtime</DialogTitle>
              <DialogDescription className="text-xs">
                Select a terminal or manage detected ports.
              </DialogDescription>
            </DialogHeader>
            <TerminalRuntimeNavigator
              activeSessionId={activeSessionId}
              className="max-h-[calc(75dvh-5rem)] w-full border-r-0"
              disableReorder
              groups={groups}
              onCloseSession={onCloseSession}
              onMoveGroup={ordering.moveGroup}
              onMoveItem={ordering.moveItem}
              onNewFreeTerminal={handleMobileNewTerminal}
              onNewProjectTerminal={handleMobileNewProjectTerminal}
              onSelectSession={handleMobileSelectSession}
              onStartTunnel={createTunnel}
              onStopTunnel={stopTunnel}
              touchOptimized
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 overflow-hidden bg-[var(--color-background)]",
        isResizingNavigator && "select-none",
      )}
    >
      <TerminalRuntimeNavigator
        activeSessionId={activeSessionId}
        groups={groups}
        width={navigatorWidth}
        onCloseSession={onCloseSession}
        onMoveGroup={ordering.moveGroup}
        onMoveItem={ordering.moveItem}
        onNewFreeTerminal={handleNewTerminal}
        onNewProjectTerminal={onNewProjectTerminal}
        onSelectSession={onSelectTab}
        onStartTunnel={createTunnel}
        onStopTunnel={stopTunnel}
      />
      <div
        {...navigatorResizeProps}
        className="group relative w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)]/20"
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[var(--color-primary)]/50 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <main className="min-w-0 flex-1">
        <TerminalRuntimeOutput
          activeSessionId={activeSessionId}
          mountedSessions={mountedSessions}
          layoutRevision={layoutRevision}
          renderTerminals={renderTerminals}
          onSessionExit={onSessionExit}
          onNewTerminal={handleNewTerminal}
          onSelectActive={onSelectTab}
        />
      </main>
    </div>
  );
}
