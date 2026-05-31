import { useCallback, useEffect, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { TerminalScrollButtons } from "@/components/organisms/TerminalScrollButtons.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import { scheduleTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import {
  subscribeToRegistry,
  terminalRegistry,
} from "@/lib/terminal-registry.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

interface TerminalRuntimeOutputProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  layoutRevision?: number;
  renderTerminals?: boolean;
  onSessionExit?: (sessionId: string) => void;
  onNewTerminal?: () => void;
  onSelectActive?: (sessionId: string) => void;
}

export function TerminalRuntimeOutput({
  activeSessionId,
  mountedSessions,
  layoutRevision = 0,
  renderTerminals = true,
  onSessionExit,
  onNewTerminal,
  onSelectActive,
}: TerminalRuntimeOutputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const { mobileCustomKeyboardEnabled, terminalScrollButtonsEnabled } =
    useSettingsStore();
  const showMobileAccessoryBar =
    isCompactWorkspace && isCoarsePointer && !!activeSessionId;
  const suppressTerminalFocus =
    showMobileAccessoryBar && mobileCustomKeyboardEnabled;

  const reparentActiveTerminal = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;

    attachTerminalsToHost({
      host,
      sessionIds: mountedSessions.map((session) => session.sessionId),
      activeSessionId,
      suppressTerminalFocus,
    });
  }, [activeSessionId, mountedSessions, suppressTerminalFocus]);

  useEffect(() => {
    reparentActiveTerminal();
    const unsubscribe = subscribeToRegistry((registeredId) => {
      if (
        mountedSessions.some((session) => session.sessionId === registeredId)
      ) {
        reparentActiveTerminal();
      }
    });
    return unsubscribe;
  }, [mountedSessions, reparentActiveTerminal]);

  useEffect(() => {
    if (!activeSessionId) return;
    scheduleTerminalFit(terminalRegistry.get(activeSessionId), {
      focus: !suppressTerminalFocus,
    });
  }, [activeSessionId, layoutRevision, suppressTerminalFocus]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      if (!activeSessionId) return;
      scheduleTerminalFit(terminalRegistry.get(activeSessionId));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [activeSessionId]);

  const handleTerminalReady = useCallback(() => {
    reparentActiveTerminal();
  }, [reparentActiveTerminal]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {renderTerminals && (
        <TerminalKeepAliveHost
          mountedSessions={mountedSessions}
          onSessionExit={onSessionExit}
          onNewTerminal={onNewTerminal}
          onTerminalReady={handleTerminalReady}
          suppressAutoFocus={suppressTerminalFocus}
        />
      )}

      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#0f172a]"
        onClick={() => {
          if (!activeSessionId) return;
          onSelectActive?.(activeSessionId);
          if (!suppressTerminalFocus) {
            terminalRegistry.get(activeSessionId)?.terminal.focus();
          }
        }}
      >
        {!activeSessionId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-background)] text-[var(--color-text-muted)]">
            <TerminalIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a terminal to view output</p>
          </div>
        )}
        {activeSessionId && terminalScrollButtonsEnabled && (
          <TerminalScrollButtons
            sessionId={activeSessionId}
            className={cn(showMobileAccessoryBar && "bottom-2")}
          />
        )}
      </div>

      {showMobileAccessoryBar && activeSessionId ? (
        <MobileTerminalAccessoryBar sessionId={activeSessionId} />
      ) : null}
    </div>
  );
}
