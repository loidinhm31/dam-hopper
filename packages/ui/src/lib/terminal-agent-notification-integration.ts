import { isCurrentConnection } from "@/api/connections.js";
import type {
  AgentAttentionEvent,
  TerminalAgentStatusRow,
} from "@/api/agent-status-types.js";
import {
  terminalKey,
  type ConnectionRef,
  type TerminalRef,
} from "@/api/ownership.js";
import type { Terminal } from "@xterm/xterm";
import {
  BrowserNotificationService,
  notifyTerminalAgent as notifyBrowserAgent,
} from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  parseOsc9Notification,
  type TerminalAgentNotification,
} from "@/lib/terminal-notification-signal-parser.js";
import { dispatchTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import { playTerminalNotificationSound } from "@/lib/terminal-notification-sound.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";

type Disposable = { dispose: () => void };
const CODEX_OSC9_RATE_LIMIT_MS = 1_000;
export function deliverSemanticAgentAttention(
  owner: ConnectionRef,
  row: TerminalAgentStatusRow,
  attention: AgentAttentionEvent,
): void {
  if (
    !isCurrentConnection(owner) ||
    row.id !== attention.terminalId ||
    row.incarnation !== attention.incarnation ||
    row.agentSessionId !== attention.agentSessionId ||
    row.attentionRevision !== attention.attentionRevision
  )
    return;
  const notifications = useSettingsStore.getState().terminalAgentNotifications;
  if (notifications.version !== 2 || row.agentKind !== "omp") return;
  const policy = notifications.agents.omp;
  if (!policy.enabled) return;
  const terminalRef = { profileId: owner.profileId, id: row.id };
  const terminalInstanceRef = { ...terminalRef, incarnation: row.incarnation };
  const event: TerminalAgentNotification = {
    source: "agent-status",
    sessionId: JSON.stringify([owner.profileId, row.id]),
    agent: "omp",
    title:
      attention.kind === "turn-ended"
        ? "OMP turn ended"
        : "OMP needs attention",
    body:
      attention.kind === "needs-attention"
        ? attention.reason === "approval"
          ? "Approval requested"
          : attention.reason === "question"
            ? "Question pending"
            : "Agent error"
        : "Turn ended; task success is not verified",
    status: attention.kind === "turn-ended" ? "finished" : "needs-attention",
    receivedAt: Date.now(),
    profileId: owner.profileId,
    terminalRef,
    terminalInstanceRef,
    semanticEventId: attention.id,
  };
  useTerminalNotificationsStore
    .getState()
    .addNotification(event, { showToast: policy.toast });
  if (policy.sound)
    playTerminalNotificationSound(policy.pattern, policy.volume);
  notifyBrowserAgent(event, {
    enabled: policy.browser,
    rateLimitMs: 0,
    onSelect: () =>
      dispatchTerminalNotificationSelection(
        event.sessionId,
        window,
        owner.profileId,
        terminalRef,
        terminalInstanceRef,
      ),
  });
}

interface TerminalAgentNotificationIntegrationOptions {
  term: Terminal;
  sessionId: string;
  project: string;
  getTerminalOrder?: () => number | undefined;
  profileId?: string;
  terminalRef?: TerminalRef;
  getTerminalIncarnation?: () => number | undefined;
}

export interface TerminalAgentNotificationIntegration {
  setReplayActive: (active: boolean) => void;
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
  getTerminalOrder,
  profileId,
  terminalRef,
  getTerminalIncarnation,
}: TerminalAgentNotificationIntegrationOptions): TerminalAgentNotificationIntegration {
  let replayActive = false;
  let disposed = false;
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
  const notifyTerminalAgent = (
    event: TerminalAgentNotification,
    settings: ReturnType<typeof useSettingsStore.getState>,
  ) => {
    useTerminalNotificationsStore.getState().addNotification(event, {
      showToast: settings.terminalAgentNotifications.agents.codex.toast,
    });
    if (settings.terminalAgentNotifications.agents.codex.sound) {
      playTerminalNotificationSound(
        settings.terminalAgentNotifications.agents.codex.pattern,
        settings.terminalAgentNotifications.agents.codex.volume,
      );
    }
    notificationService.notifyTerminalAgent(event, {
      enabled: settings.terminalAgentNotifications.agents.codex.browser,
      rateLimitMs: CODEX_OSC9_RATE_LIMIT_MS,
      terminalOrder: getTerminalOrder?.(),
      onSelect: (selected) =>
        dispatchTerminalNotificationSelection(
          selected.sessionId,
          window,
          selected.profileId,
          selected.terminalRef,
          selected.terminalInstanceRef,
        ),
    });
  };

  const parseSignalContext = () => {
    const incarnation = getTerminalIncarnation?.();
    return {
      sessionId: terminalRef ? terminalKey(terminalRef) : sessionId,
      project,
      agent: "codex" as const,
      profileId,
      terminalRef,
      terminalInstanceRef:
        terminalRef && incarnation !== undefined
          ? { ...terminalRef, incarnation }
          : undefined,
    };
  };
  const handleTerminalSignal = (
    parse: () => TerminalAgentNotification | null,
  ): boolean => {
    const settings = useSettingsStore.getState();
    if (
      settings.terminalAgentNotifications.version !== 2 ||
      !settings.terminalAgentNotifications.agents.codex.enabled
    )
      return true;

    const event = parse();
    if (event && !replayActive) notifyTerminalAgent(event, settings);
    return true;
  };

  const signalDisposables: Disposable[] = [
    term.parser.registerOscHandler(9, (payload) =>
      handleTerminalSignal(() =>
        parseOsc9Notification(payload, parseSignalContext()),
      ),
    ),
  ];
  return {
    setReplayActive: (active) => {
      if (disposed) return;
      replayActive = active;
    },
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
