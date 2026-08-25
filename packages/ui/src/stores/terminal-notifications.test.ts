import { beforeEach, describe, expect, it } from "vitest";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";
import {
  MAX_TERMINAL_NOTIFICATION_HISTORY,
  MAX_TERMINAL_NOTIFICATION_TOASTS,
  selectUnreadTerminalNotificationCount,
  useTerminalNotificationsStore,
} from "./terminal-notifications.js";

function notification(
  receivedAt: number,
  title = `Notification ${receivedAt}`,
): TerminalAgentNotification {
  return {
    source: "osc9",
    sessionId: `terminal-${receivedAt}`,
    project: "web",
    agent: "codex",
    title,
    body: "Review the answer",
    status: "needs-attention",
    receivedAt,
  };
}

describe("useTerminalNotificationsStore", () => {
  beforeEach(() => {
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
  });

  it("adds unread notifications newest first with unique IDs", () => {
    const store = useTerminalNotificationsStore.getState();
    const firstId = store.addNotification(notification(1_000));
    const secondId = store.addNotification(notification(1_000, "Second"));
    const state = useTerminalNotificationsStore.getState();

    expect(firstId).not.toBe(secondId);
    expect(state.notifications.map((item) => item.event.title)).toEqual([
      "Second",
      "Notification 1000",
    ]);
    expect(selectUnreadTerminalNotificationCount(state)).toBe(2);
  });

  it("keeps history and unread state when toast delivery is disabled", () => {
    const id = useTerminalNotificationsStore
      .getState()
      .addNotification(notification(1_000), { showToast: false });
    const state = useTerminalNotificationsStore.getState();

    expect(state.notifications).toEqual([
      expect.objectContaining({ id, event: notification(1_000), read: false }),
    ]);
    expect(selectUnreadTerminalNotificationCount(state)).toBe(1);
    expect(state.toasts).toEqual([]);
  });

  it("marks one or all notifications read without dismissing toasts", () => {
    const store = useTerminalNotificationsStore.getState();
    const firstId = store.addNotification(notification(1));
    store.addNotification(notification(2));

    useTerminalNotificationsStore.getState().markRead(firstId);
    let state = useTerminalNotificationsStore.getState();
    expect(selectUnreadTerminalNotificationCount(state)).toBe(1);
    expect(state.toasts).toHaveLength(2);

    state.markAllRead();
    state = useTerminalNotificationsStore.getState();
    expect(selectUnreadTerminalNotificationCount(state)).toBe(0);
    expect(state.toasts).toHaveLength(2);
  });

  it("dismisses a toast without marking its notification read", () => {
    const id = useTerminalNotificationsStore
      .getState()
      .addNotification(notification(1));

    useTerminalNotificationsStore.getState().dismissToast(id);
    const state = useTerminalNotificationsStore.getState();
    expect(state.toasts).toEqual([]);
    expect(state.notifications[0]?.read).toBe(false);
  });

  it("bounds history and visible toasts", () => {
    const store = useTerminalNotificationsStore.getState();
    for (
      let index = 0;
      index < MAX_TERMINAL_NOTIFICATION_HISTORY + 5;
      index += 1
    ) {
      store.addNotification(notification(index));
    }

    const state = useTerminalNotificationsStore.getState();
    expect(state.notifications).toHaveLength(MAX_TERMINAL_NOTIFICATION_HISTORY);
    expect(state.notifications[0]?.event.receivedAt).toBe(54);
    expect(state.notifications.at(-1)?.event.receivedAt).toBe(5);
    expect(state.toasts).toHaveLength(MAX_TERMINAL_NOTIFICATION_TOASTS);
  });

  it("clears history and active toasts together", () => {
    const store = useTerminalNotificationsStore.getState();
    store.addNotification(notification(1));
    store.clearNotifications();

    expect(useTerminalNotificationsStore.getState()).toMatchObject({
      notifications: [],
      toasts: [],
    });
  });
});
