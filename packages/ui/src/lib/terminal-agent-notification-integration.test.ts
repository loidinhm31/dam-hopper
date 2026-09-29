import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { playTerminalNotificationSound, recordClientDiagnostic } = vi.hoisted(
  () => ({
    playTerminalNotificationSound: vi.fn(),
    recordClientDiagnostic: vi.fn(),
  }),
);

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic,
}));

vi.mock("@/lib/terminal-notification-sound.js", () => ({
  playTerminalNotificationSound,
}));

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: vi.fn((owner) => owner?.generation !== 999),
}));

import { deliverSemanticAgentAttention } from "./terminal-agent-notification-integration.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type {
  AgentAttentionEvent,
  TerminalAgentStatusRow,
} from "@/api/agent-status-types.js";

const originalNotification = globalThis.Notification;

function restoreNotificationGlobal(): void {
  if (originalNotification === undefined) {
    Reflect.deleteProperty(globalThis, "Notification");
    return;
  }

  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: originalNotification,
  });
}

function installFakeNotification() {
  const created: Array<{ title: string; options: NotificationOptions }> = [];

  class FakeNotification {
    static permission: NotificationPermission = "granted";
    static requestPermission = vi.fn();

    constructor(title: string, options: NotificationOptions) {
      created.push({ title, options });
    }
  }

  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: FakeNotification,
  });

  return created;
}

const currentOwner: ConnectionRef = {
  profileId: "profile-1",
  url: "http://localhost:4801",
  generation: 1,
};

const baseOmpRow: TerminalAgentStatusRow = {
  id: "term-1",
  incarnation: 1,
  agentKind: "omp",
  state: "idle",
  source: "lifecycle",
  observedAtMs: 1_000,
  expiresAtMs: null,
  agentSessionId: "sess-1",
  attentionRevision: 1,
};

const baseOmpAttention: AgentAttentionEvent = {
  id: "att-1",
  terminalId: "term-1",
  incarnation: 1,
  agentKind: "omp",
  kind: "turn-ended",
  outcome: "ended",
  agentSessionId: "sess-1",
  attentionRevision: 1,
};

describe("deliverSemanticAgentAttention", () => {
  let createdNotifications: Array<{ title: string; options: NotificationOptions }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    recordClientDiagnostic.mockReset();
    playTerminalNotificationSound.mockReset();
    createdNotifications = installFakeNotification();

    useSettingsStore.setState({
      terminalAgentNotifications: {
        version: 2,
        agents: {
          codex: {
            enabled: false,
            toast: true,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "default",
          },
          omp: {
            enabled: true,
            toast: true,
            browser: true,
            sound: true,
            volume: 80,
            pattern: "soft",
          },
          claude: {
            enabled: true,
            toast: true,
            browser: true,
            sound: true,
            volume: 90,
            pattern: "urgent",
          },
        },
      },
    });
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
  });

  afterEach(() => {
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    restoreNotificationGlobal();
    vi.useRealTimers();
  });

  it("delivers OMP turn-ended attention when enabled", () => {
    deliverSemanticAgentAttention(currentOwner, baseOmpRow, baseOmpAttention);

    const store = useTerminalNotificationsStore.getState();
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].event).toMatchObject({
      agent: "omp",
      title: "OMP turn ended",
      body: "Turn ended; task success is not verified",
      status: "finished",
    });

    expect(playTerminalNotificationSound).toHaveBeenCalledWith("soft", 80);
    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0].title).toBe("OMP turn ended");
  });

  it("delivers OMP needs-attention with approval, question, and error bodies", () => {
    const approvalAttention: AgentAttentionEvent = {
      ...baseOmpAttention,
      id: "att-approval",
      kind: "needs-attention",
      reason: "approval",
    };
    deliverSemanticAgentAttention(currentOwner, baseOmpRow, approvalAttention);
    expect(useTerminalNotificationsStore.getState().notifications[0]?.event.body).toBe(
      "Approval requested",
    );

    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    const questionAttention: AgentAttentionEvent = {
      ...baseOmpAttention,
      id: "att-question",
      kind: "needs-attention",
      reason: "question",
    };
    deliverSemanticAgentAttention(currentOwner, baseOmpRow, questionAttention);
    expect(useTerminalNotificationsStore.getState().notifications[0]?.event.body).toBe(
      "Question pending",
    );

    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    const errorAttention: AgentAttentionEvent = {
      ...baseOmpAttention,
      id: "att-error",
      kind: "needs-attention",
      reason: "error",
    };
    deliverSemanticAgentAttention(currentOwner, baseOmpRow, errorAttention);
    expect(useTerminalNotificationsStore.getState().notifications[0]?.event.body).toBe(
      "Agent error",
    );
  });

  it("delivers Claude needs-attention when enabled", () => {
    const claudeRow: TerminalAgentStatusRow = {
      ...baseOmpRow,
      agentKind: "claude",
      source: "hook",
    };
    const claudeAttention: AgentAttentionEvent = {
      ...baseOmpAttention,
      agentKind: "claude",
      kind: "needs-attention",
      reason: "approval",
    };

    deliverSemanticAgentAttention(currentOwner, claudeRow, claudeAttention);

    const store = useTerminalNotificationsStore.getState();
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].event).toMatchObject({
      agent: "claude",
      title: "Claude needs attention",
      body: "Approval requested",
      status: "needs-attention",
    });
    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0].title).toBe("Claude needs attention");
  });

  it("ignores Claude normal turn-ended attention (Claude only supports qualified needs-attention)", () => {
    const claudeRow: TerminalAgentStatusRow = {
      ...baseOmpRow,
      agentKind: "claude",
      source: "hook",
    };
    const claudeTurnEnded: AgentAttentionEvent = {
      ...baseOmpAttention,
      agentKind: "claude",
      kind: "turn-ended",
    };

    deliverSemanticAgentAttention(currentOwner, claudeRow, claudeTurnEnded);

    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
    expect(createdNotifications).toHaveLength(0);
  });

  it("ignores Codex attention because Codex provides status only in this rollout", () => {
    const codexRow: TerminalAgentStatusRow = {
      ...baseOmpRow,
      agentKind: "codex",
      source: "hook",
    };
    const codexAttention: AgentAttentionEvent = {
      ...baseOmpAttention,
      agentKind: "codex",
      kind: "needs-attention",
      reason: "approval",
    };

    deliverSemanticAgentAttention(currentOwner, codexRow, codexAttention);

    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
    expect(createdNotifications).toHaveLength(0);
  });

  it("rejects mismatch between row.agentKind and attention.agentKind", () => {
    const mismatchedAttention: AgentAttentionEvent = {
      ...baseOmpAttention,
      agentKind: "claude",
    };

    deliverSemanticAgentAttention(currentOwner, baseOmpRow, mismatchedAttention);

    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
  });

  it("rejects attention when terminalId, incarnation, agentSessionId, or attentionRevision mismatch", () => {
    deliverSemanticAgentAttention(
      currentOwner,
      baseOmpRow,
      { ...baseOmpAttention, terminalId: "term-different" },
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);

    deliverSemanticAgentAttention(
      currentOwner,
      baseOmpRow,
      { ...baseOmpAttention, incarnation: 99 },
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);

    deliverSemanticAgentAttention(
      currentOwner,
      baseOmpRow,
      { ...baseOmpAttention, agentSessionId: "different-session" },
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);

    deliverSemanticAgentAttention(
      currentOwner,
      baseOmpRow,
      { ...baseOmpAttention, attentionRevision: 99 },
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
  });

  it("rejects attention when connection is stale or not current", () => {
    const staleOwner: ConnectionRef = {
      ...currentOwner,
      generation: 999, // mocked to return false from isCurrentConnection
    };

    deliverSemanticAgentAttention(staleOwner, baseOmpRow, baseOmpAttention);

    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
  });

  it("respects channel toggles for toast, sound, and browser", () => {
    useSettingsStore.setState({
      terminalAgentNotifications: {
        version: 2,
        agents: {
          codex: { enabled: false, toast: true, browser: true, sound: true, volume: 100, pattern: "default" },
          omp: { enabled: true, toast: false, browser: false, sound: false, volume: 50, pattern: "default" },
          claude: { enabled: false, toast: true, browser: true, sound: true, volume: 100, pattern: "default" },
        },
      },
    });

    deliverSemanticAgentAttention(currentOwner, baseOmpRow, baseOmpAttention);

    const store = useTerminalNotificationsStore.getState();
    expect(store.notifications).toHaveLength(1);
    expect(store.toasts).toHaveLength(0); // toast disabled
    expect(playTerminalNotificationSound).not.toHaveBeenCalled(); // sound disabled
    expect(createdNotifications).toHaveLength(0); // browser disabled
  });
});
