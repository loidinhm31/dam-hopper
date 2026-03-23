import { Terminal as TerminalIcon } from "lucide-react";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";

export interface MountedSession {
  sessionId: string;
  project: string;
  command: string;
}

interface Props {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  onSessionExit?: (sessionId: string) => void;
}

export function MultiTerminalDisplay({
  activeSessionId,
  mountedSessions,
  onSessionExit,
}: Props) {
  if (mountedSessions.length === 0 || !activeSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
        <TerminalIcon className="h-10 w-10 opacity-20" />
        <p className="text-sm">Select a terminal to view output</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {mountedSessions.map((s) => (
        <div
          key={s.sessionId}
          style={{ display: s.sessionId === activeSessionId ? "flex" : "none" }}
          className="absolute inset-0 flex flex-col"
        >
          <TerminalPanel
            sessionId={s.sessionId}
            project={s.project}
            command={s.command}
            onExit={() => onSessionExit?.(s.sessionId)}
            className="flex-1"
          />
        </div>
      ))}
    </div>
  );
}
