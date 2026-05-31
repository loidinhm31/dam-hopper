import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

interface TerminalKeepAliveHostProps {
  mountedSessions: MountedSession[];
  onSessionExit?: (sessionId: string) => void;
  onNewTerminal?: () => void;
  onTerminalReady?: (sessionId: string) => void;
  suppressAutoFocus?: boolean;
  suppressNativeKeyboard?: boolean;
}

export function TerminalKeepAliveHost({
  mountedSessions,
  onSessionExit,
  onNewTerminal,
  onTerminalReady,
  suppressAutoFocus = false,
  suppressNativeKeyboard = suppressAutoFocus,
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
      {mountedSessions.map((session) => (
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
        />
      ))}
    </div>
  );
}
