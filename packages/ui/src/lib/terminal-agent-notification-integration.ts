import type { Terminal } from "@xterm/xterm";
import { AgentActivityTracker } from "@/lib/agent-activity-tracker.js";
import { BrowserNotificationService } from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  parseBelNotification,
  parseOsc9Notification,
  parseOsc777Notification,
  parseOsc99Notification,
  type TerminalAgentNotification,
} from "@/lib/terminal-notification-signal-parser.js";
import { useSettingsStore } from "@/stores/settings.js";

type Disposable = { dispose: () => void };

interface TerminalAgentNotificationIntegrationOptions {
  term: Terminal;
  sessionId: string;
  project: string;
}

export interface TerminalAgentNotificationIntegration {
  onOutput: () => void;
  onUserInput: () => void;
  onSubmittedCommand: (commandLine: string) => void;
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
      enabled: useSettingsStore.getState().terminalAgentNotificationsEnabled,
    });
  };
  const tracker = new AgentActivityTracker(
    { sessionId, project },
    {
      get terminalAgentNotificationsEnabled() {
        return useSettingsStore.getState().terminalAgentNotificationsEnabled;
      },
      get terminalAgentQuietTrackingEnabled() {
        return useSettingsStore.getState().terminalAgentQuietTrackingEnabled;
      },
      get terminalAgentQuietTimeoutMs() {
        return useSettingsStore.getState().terminalAgentQuietTimeoutMs;
      },
      get terminalAgentCommandPatterns() {
        return useSettingsStore.getState().terminalAgentCommandPatterns;
      },
    },
    { notify: notifyTerminalAgent },
  );

  const parseSignalContext = () => ({ sessionId, project });
  const handleTerminalSignal = (
    parse: () => TerminalAgentNotification | null,
  ): boolean => {
    const settings = useSettingsStore.getState();
    if (
      !settings.terminalAgentNotificationsEnabled ||
      !settings.terminalAgentSignalsEnabled
    ) {
      return true;
    }

    const event = parse();
    if (event) notifyTerminalAgent(event);
    return true;
  };

  const signalDisposables: Disposable[] = [
    term.onBell(() => {
      handleTerminalSignal(() => parseBelNotification(parseSignalContext()));
    }),
    term.parser.registerOscHandler(9, (payload) =>
      handleTerminalSignal(() =>
        parseOsc9Notification(payload, parseSignalContext()),
      ),
    ),
    term.parser.registerOscHandler(777, (payload) =>
      handleTerminalSignal(() =>
        parseOsc777Notification(payload, parseSignalContext()),
      ),
    ),
    term.parser.registerOscHandler(99, (payload) =>
      handleTerminalSignal(() =>
        parseOsc99Notification(payload, parseSignalContext()),
      ),
    ),
  ];
  let disposed = false;

  return {
    onOutput: () => {
      tracker.onOutput();
      notificationService.resetTerminalAgentRateLimit(sessionId, "quiet");
    },
    onUserInput: () => tracker.onUserInput(),
    onSubmittedCommand: (commandLine) => tracker.onSubmittedCommand(commandLine),
    onTerminalExit: (options) => tracker.onTerminalExit(options),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      signalDisposables.forEach((disposable) => disposable.dispose());
      tracker.dispose();
    },
  };
}
