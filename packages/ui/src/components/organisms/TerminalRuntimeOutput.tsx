import { useCallback, useEffect, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import {
  subscribeToRegistry,
  terminalRegistry,
} from "@/lib/terminal-registry.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

interface TerminalRuntimeOutputProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  layoutRevision?: number;
  onSessionExit?: (sessionId: string) => void;
  onNewTerminal?: () => void;
  onSelectActive?: (sessionId: string) => void;
}

export function TerminalRuntimeOutput({
  activeSessionId,
  mountedSessions,
  layoutRevision = 0,
  onSessionExit,
  onNewTerminal,
  onSelectActive,
}: TerminalRuntimeOutputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const showMobileAccessoryBar =
    isCompactWorkspace && isCoarsePointer && !!activeSessionId;

  const reparentActiveTerminal = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;

    for (const session of mountedSessions) {
      const entry = terminalRegistry.get(session.sessionId);
      const element = entry?.terminal.element;
      if (!entry || !element) continue;

      const isActive = session.sessionId === activeSessionId;
      if (isActive && element.parentElement !== host) {
        host.appendChild(element);
      }

      element.style.display = isActive ? "block" : "none";
      element.style.width = "100%";
      element.style.height = "100%";
      element.style.position = "absolute";
      element.style.inset = "0";

      if (isActive) {
        if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
        fitTimerRef.current = setTimeout(() => {
          requestAnimationFrame(() => {
            entry.fitAddon.fit();
            entry.terminal.focus();
          });
        }, 150);
      }
    }
  }, [activeSessionId, mountedSessions]);

  useEffect(() => {
    reparentActiveTerminal();
    const unsubscribe = subscribeToRegistry((registeredId) => {
      if (
        mountedSessions.some((session) => session.sessionId === registeredId)
      ) {
        reparentActiveTerminal();
      }
    });
    return () => {
      unsubscribe();
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    };
  }, [mountedSessions, reparentActiveTerminal]);

  useEffect(() => {
    if (!activeSessionId) return;
    const timer = setTimeout(() => {
      const entry = terminalRegistry.get(activeSessionId);
      try {
        entry?.fitAddon.fit();
        entry?.terminal.focus();
      } catch {
        /* terminal may be disposed */
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [activeSessionId, layoutRevision]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      if (!activeSessionId) return;
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        terminalRegistry.get(activeSessionId)?.fitAddon.fit();
      }, 100);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [activeSessionId]);

  const handleTerminalReady = useCallback(() => {
    reparentActiveTerminal();
  }, [reparentActiveTerminal]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
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
            onTerminalReady={handleTerminalReady}
          />
        ))}
      </div>

      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#0f172a]"
        onClick={() => {
          if (!activeSessionId) return;
          onSelectActive?.(activeSessionId);
          terminalRegistry.get(activeSessionId)?.terminal.focus();
        }}
      >
        {!activeSessionId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-background)] text-[var(--color-text-muted)]">
            <TerminalIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a terminal to view output</p>
          </div>
        )}
      </div>

      {showMobileAccessoryBar && activeSessionId ? (
        <MobileTerminalAccessoryBar sessionId={activeSessionId} />
      ) : null}
    </div>
  );
}
