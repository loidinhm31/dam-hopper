import { isCurrentConnection } from "@/api/connections.js";
import type {
  AgentAttentionEvent,
  TerminalAgentStatusRow,
} from "@/api/agent-status-types.js";
import type {
  ConnectionRef,
  TerminalRef,
} from "@/api/ownership.js";
import {
  notifyTerminalAgent as notifyBrowserAgent,
} from "@/lib/browser-notification-service.js";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";
import { dispatchTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import { playTerminalNotificationSound } from "@/lib/terminal-notification-sound.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";

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
    row.attentionRevision !== attention.attentionRevision ||
    row.agentKind !== attention.agentKind
  )
    return;

  // Codex native hooks provide status only in this rollout
  if (row.agentKind === "codex") {
    return;
  }

  const notifications = useSettingsStore.getState().terminalAgentNotifications;
  if (notifications.version !== 2) return;

  const policy =
    row.agentKind === "omp"
      ? notifications.agents.omp
      : row.agentKind === "claude"
        ? notifications.agents.claude
        : null;

  if (!policy || !policy.enabled) return;

  // For Claude, only qualified needs-attention is supported; normal turn-ended is unsupported
  if (row.agentKind === "claude" && attention.kind !== "needs-attention") {
    return;
  }

  const agentName = row.agentKind === "omp" ? "OMP" : "Claude";
  const title =
    attention.kind === "turn-ended"
      ? `${agentName} turn ended`
      : `${agentName} needs attention`;

  const body =
    attention.kind === "needs-attention"
      ? attention.reason === "approval"
        ? "Approval requested"
        : attention.reason === "question"
          ? "Question pending"
          : "Agent error"
      : "Turn ended; task success is not verified";

  const terminalRef: TerminalRef = { profileId: owner.profileId, id: row.id };
  const terminalInstanceRef = { ...terminalRef, incarnation: row.incarnation };
  const event: TerminalAgentNotification = {
    source: "agent-status",
    sessionId: JSON.stringify([owner.profileId, row.id]),
    agent: row.agentKind,
    title,
    body,
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
