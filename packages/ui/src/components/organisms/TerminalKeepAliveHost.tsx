import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

interface TerminalKeepAliveHostProps {
  mountedSessions: MountedSession[];
  openTabs?: TabEntry[];
  onSessionExit?: (sessionId: string) => void;
  onNewTerminal?: () => void;
  onTerminalReady?: (sessionId: string) => void;
  suppressAutoFocus?: boolean;
  suppressNativeKeyboard?: boolean;
  webglEnabledSessionIds?: ReadonlySet<string>;
}

export function TerminalKeepAliveHost({
  mountedSessions,
  openTabs,
  onSessionExit,
  onNewTerminal,
  onTerminalReady,
  suppressAutoFocus = false,
  suppressNativeKeyboard = suppressAutoFocus,
  webglEnabledSessionIds,
}: TerminalKeepAliveHostProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        width: 1024,
        height: 768,
        overflow: "hidden",
        top: -10000,
        left: -10000,
      }}
    >
      {mountedSessions.map((session, mountedIndex) => {
        const tabIndex = openTabs?.findIndex(
          (tab) => tab.sessionId === session.sessionId,
        );
        const terminalOrder = openTabs
          ? tabIndex !== undefined && tabIndex >= 0
            ? tabIndex + 1
            : undefined
          : mountedIndex + 1;

        return (
          <TerminalPanel
            key={session.sessionId}
            sessionId={session.sessionId}
            project={session.project}
            command={session.command}
            cwd={session.cwd}
            onExit={() => onSessionExit?.(session.sessionId)}
            onNewTerminal={onNewTerminal}
            onTerminalReady={onTerminalReady}
            suppressAutoFocus={suppressAutoFocus}
            suppressNativeKeyboard={suppressNativeKeyboard}
            terminalOrder={terminalOrder}
            webglEnabled={
              webglEnabledSessionIds?.has(session.sessionId) ?? false
            }
          />
        );
      })}
    </div>
  );
}
