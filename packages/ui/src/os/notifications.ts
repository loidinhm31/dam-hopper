import { create } from "zustand";
import { generateUUID } from "@/lib/utils.js";
import type { ConnectionRef } from "@/api/ownership.js";

export const MAX_NOTIFICATION_ENTRIES = 50;

export type NotificationSource = "agent" | "system" | "terminal" | "git";
export type NotificationLevel = "info" | "warning" | "error" | "attention";

export interface OsNotificationEntry {
  id: string;
  profileId: string;
  generation: number;
  title: string;
  body?: string;
  source: NotificationSource;
  level: NotificationLevel;
  timestamp: number;
  read: boolean;
  targetWindowId?: string;
  targetTerminalId?: string;
  targetProject?: string;
}

export interface OsNotificationState {
  entries: OsNotificationEntry[];
  addNotification: (
    entry: Omit<OsNotificationEntry, "id" | "timestamp" | "read">,
  ) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  getUnreadCount: () => number;
}

export const useOsNotificationStore = create<OsNotificationState>((set, get) => ({
  entries: [],

  addNotification: (entry) => {
    const id = generateUUID();
    const newEntry: OsNotificationEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
      read: false,
    };

    set((state) => {
      // Bounded 50-entry FIFO log
      const updated = [newEntry, ...state.entries].slice(0, MAX_NOTIFICATION_ENTRIES);
      return { entries: updated };
    });

    return id;
  },

  markRead: (id) => {
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? { ...e, read: true } : e)),
    }));
  },

  markAllRead: () => {
    set((state) => ({
      entries: state.entries.map((e) => ({ ...e, read: true })),
    }));
  },

  clearAll: () => {
    set({ entries: [] });
  },

  getUnreadCount: () => {
    return get().entries.filter((e) => !e.read).length;
  },
}));

/**
 * Redacts notification fields immediately if Cognito Privacy Mode is active.
 * Guarantees zero sensitive identities or raw terminal output leak to DOM/ARIA.
 */
export function redactNotification(
  entry: OsNotificationEntry,
  isCognitoActive: boolean,
): OsNotificationEntry {
  if (!isCognitoActive) {
    return entry;
  }
  return {
    ...entry,
    title: "Notification (Protected)",
    body: "Details hidden in Cognito Privacy Mode",
    profileId: "protected",
    targetProject: undefined,
    targetTerminalId: undefined,
  };
}

/**
 * Filter notifications for an owner generation so stale connections cannot
 * update a newly connected owner.
 */
export function filterNotificationsByOwner(
  entries: OsNotificationEntry[],
  owner: Pick<ConnectionRef, "profileId" | "generation">,
): OsNotificationEntry[] {
  return entries.filter(
    (e) => e.profileId === owner.profileId && e.generation === owner.generation,
  );
}
