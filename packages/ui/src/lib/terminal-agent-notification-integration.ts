import type { Terminal } from "@xterm/xterm";
import { BrowserNotificationService } from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  parseOsc9Notification,
  type TerminalAgentNotification,
} from "@/lib/terminal-notification-signal-parser.js";
import { useSettingsStore } from "@/stores/settings.js";

type Disposable = { dispose: () => void };
const CODEX_OSC9_RATE_LIMIT_MS = 1_000;

interface TerminalAgentNotificationIntegrationOptions {
  term: Terminal;
  sessionId: string;
  project: string;
}

export interface TerminalAgentNotificationIntegration {
  onOutput: () => void;
  onUserInput: () => void;
  onSubmittedCommand: (commandLine: string) => void;
  onTitleChange: (title: string) => void;
  onTerminalExit: (options?: { willRestart?: boolean }) => void;
  dispose: () => void;
}

export function attachTerminalAgentNotifications({
  term,
  sessionId,
  project,
}: TerminalAgentNotificationIntegrationOptions): TerminalAgentNotificationIntegration {
  const notificationService = new BrowserNotificationService({
    diagnostics: (message, fields) => {
      recordClientDiagnostic(
        "custom",
        "terminal-agent-notifications",
        message,
        fields,
      );
    },
  });
  const notifyTerminalAgent = (event: TerminalAgentNotification) => {
    notificationService.notifyTerminalAgent(event, {
      enabled: useSettingsStore.getState().terminalCodexNotificationsEnabled,
      rateLimitMs: CODEX_OSC9_RATE_LIMIT_MS,
    });
  };

  const parseSignalContext = () => ({
    sessionId,
    project,
    agent: "codex" as const,
  });
  const handleTerminalSignal = (
    parse: () => TerminalAgentNotification | null,
  ): boolean => {
    const settings = useSettingsStore.getState();
    if (!settings.terminalCodexNotificationsEnabled) return true;

    const event = parse();
    if (event) notifyTerminalAgent(event);
    return true;
  };

  const signalDisposables: Disposable[] = [
    term.parser.registerOscHandler(9, (payload) =>
      handleTerminalSignal(() =>
        parseOsc9Notification(payload, parseSignalContext()),
      ),
    ),
  ];
  let disposed = false;

  return {
    onOutput: () => {},
    onUserInput: () => {},
    onSubmittedCommand: () => {},
    onTitleChange: () => {},
    onTerminalExit: () => {},
    dispose: () => {
      if (disposed) return;
      disposed = true;
      signalDisposables.forEach((disposable) => disposable.dispose());
    },
  };
}
