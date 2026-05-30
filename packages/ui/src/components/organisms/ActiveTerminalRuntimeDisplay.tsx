import { useMemo } from "react";
import { useGlobalConfig } from "@/api/queries.js";
import { TerminalRuntimeNavigator } from "@/components/organisms/TerminalRuntimeNavigator.js";
import { TerminalRuntimeOutput } from "@/components/organisms/TerminalRuntimeOutput.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import { usePorts } from "@/hooks/use-ports.js";
import { useRuntimeTreeOrdering } from "@/hooks/use-runtime-tree-ordering.js";
import { buildRuntimeTree } from "@/lib/terminal-runtime-tree.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";

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
  onCloseSession?: (sessionId: string) => void;
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
  onCloseSession,
}: ActiveTerminalRuntimeDisplayProps) {
  const { data: globalConfig } = useGlobalConfig();
  const { ports, createTunnel, stopTunnel } = usePorts();
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
  const handleNewTerminal = () => {
    if (currentProjectName) onNewProjectTerminal?.(currentProjectName);
    else onNewFreeTerminal?.();
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--color-background)]">
      <TerminalRuntimeNavigator
        activeSessionId={activeSessionId}
        groups={groups}
        onCloseSession={onCloseSession}
        onMoveGroup={ordering.moveGroup}
        onMoveItem={ordering.moveItem}
        onNewFreeTerminal={handleNewTerminal}
        onNewProjectTerminal={onNewProjectTerminal}
        onSelectSession={onSelectTab}
        onStartTunnel={createTunnel}
        onStopTunnel={stopTunnel}
      />
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
