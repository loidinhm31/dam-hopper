import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { TerminalScrollButtons } from "@/components/organisms/TerminalScrollButtons.js";
import { useSettingsStore } from "@/stores/settings.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import {
  cancelScheduledTerminalFit,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import {
  getTerminal,
  subscribeToRegistry,
} from "@/lib/terminal-registry.js";
import { syncTerminalInputSuppression } from "@/lib/terminal-input-policy.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

interface TerminalRuntimeOutputProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  layoutRevision?: number;
  renderTerminals?: boolean;
  onSessionExit?: (sessionId: string) => void;
  onNewTerminal?: () => void;
  onSelectActive?: (sessionId: string) => void;
  onOpenSessionChanges?: (sessionId: string) => void;
}

export function TerminalRuntimeOutput({
  activeSessionId,
  mountedSessions,
  layoutRevision = 0,
  renderTerminals = true,
  onSessionExit,
  onNewTerminal,
  onSelectActive,
  onOpenSessionChanges,
}: TerminalRuntimeOutputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { terminalScrollButtonsEnabled } = useSettingsStore();

  const reparentActiveTerminal = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;

    attachTerminalsToHost({
      host,
      sessionIds: mountedSessions.map((session) => session.sessionId),
      activeSessionId,
      suppressTerminalFocus: false,
    });
    for (const session of mountedSessions) {
      syncTerminalInputSuppression(
        getTerminal(session.sessionId)?.terminal ?? null,
        false,
      );
    }
  }, [activeSessionId, mountedSessions]);

  useEffect(() => {
    reparentActiveTerminal();
    const unsubscribe = subscribeToRegistry((registeredId) => {
      const entry = getTerminal(registeredId);
      const rawId = entry?.terminalRef?.id ?? registeredId;
      if (
        mountedSessions.some(
          (session) =>
            session.sessionId === registeredId || session.sessionId === rawId,
        )
      ) {
        reparentActiveTerminal();
      }
    });
    return unsubscribe;
  }, [mountedSessions, reparentActiveTerminal]);

  useEffect(() => {
    if (!activeSessionId) return;
    scheduleTerminalFit(getTerminal(activeSessionId), {
      focus: true,
    });
  }, [activeSessionId, layoutRevision]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      if (!activeSessionId) return;
      scheduleTerminalFit(getTerminal(activeSessionId));
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
          suppressAutoFocus={false}
          suppressNativeKeyboard={false}
        />
      )}

      <div
        ref={hostRef}
        data-testid="terminal-runtime-output-host"
        className="relative min-h-0 flex-1 overflow-clip bg-[var(--color-background)] ring-1 ring-inset ring-[var(--color-border)] focus-within:ring-2 focus-within:ring-[var(--color-ring)]"
        onClick={() => {
          if (!activeSessionId) return;
          onSelectActive?.(activeSessionId);
          getTerminal(activeSessionId)?.terminal.focus();
        }}
      >
        {!activeSessionId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-background)] text-[var(--color-text-muted)]">
            <TerminalIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a terminal to view output</p>
          </div>
        )}
      </div>
      <div className="w-full shrink-0">
        {activeSessionId && terminalScrollButtonsEnabled && (
          <TerminalScrollButtons
            sessionId={activeSessionId}
            reserveAccessoryRail={false}
            accessoryPanelOpen={false}
          />
        )}
      </div>
    </div>
  );
}
