import { create } from "zustand";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";

export const MAX_TERMINAL_NOTIFICATION_HISTORY = 50;
export const MAX_TERMINAL_NOTIFICATION_TOASTS = 3;

export interface TerminalNotificationRecord {
  id: string;
  event: TerminalAgentNotification;
  read: boolean;
}

export interface AddTerminalNotificationOptions {
  showToast?: boolean;
}

interface TerminalNotificationsState {
  notifications: TerminalNotificationRecord[];
  toasts: string[];
  addNotification: (
    event: TerminalAgentNotification,
    options?: AddTerminalNotificationOptions,
  ) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  dismissToast: (id: string) => void;
}

let notificationSequence = 0;

function createNotificationId(event: TerminalAgentNotification): string {
  notificationSequence += 1;
  return `${event.receivedAt}-${notificationSequence}`;
}

export const useTerminalNotificationsStore = create<TerminalNotificationsState>(
  (set) => ({
    notifications: [],
    toasts: [],
    addNotification: (event, { showToast = true } = {}) => {
      const id = createNotificationId(event);
      const record: TerminalNotificationRecord = { id, event, read: false };

      set((state) => {
        const notifications = [record, ...state.notifications].slice(
          0,
          MAX_TERMINAL_NOTIFICATION_HISTORY,
        );
        return {
          notifications,
          toasts: showToast
            ? [id, ...state.toasts].slice(0, MAX_TERMINAL_NOTIFICATION_TOASTS)
            : state.toasts,
        };
      });

      return id;
    },
    markRead: (id) =>
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.id === id && !notification.read
            ? { ...notification, read: true }
            : notification,
        ),
      })),
    markAllRead: () =>
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.read ? notification : { ...notification, read: true },
        ),
      })),
    clearNotifications: () => set({ notifications: [], toasts: [] }),
    dismissToast: (id) =>
      set((state) => ({
        toasts: state.toasts.filter((toastId) => toastId !== id),
      })),
  }),
);

export function selectUnreadTerminalNotificationCount(
  state: Pick<TerminalNotificationsState, "notifications">,
): number {
  return state.notifications.reduce(
    (count, notification) => count + (notification.read ? 0 : 1),
    0,
  );
}
