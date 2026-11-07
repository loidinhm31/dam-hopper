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
    targetWindowId: undefined,
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

export const TYPED_ACTIVITY_EVENTS: Record<string, true> = {
  "git:progress": true,
  "git:status": true,
  "git:commit": true,
  "git:branch": true,
  "worktree:changed": true,
  "status:changed": true,
  "terminal:changed": true,
  "terminal:crashed": true,
  "terminal:exit": true,
  "terminal:restart": true,
  "terminal:spawn": true,
  "agent:status": true,
  "agent:attention": true,
  "host:alert": true,
  "host:alertChanged": true,
  "host:idleSuspendChanged": true,
  "idle-suspend:armed": true,
  "idle-suspend:resumed": true,
  "idle-suspend:failed": true,
};
export function ingestIpcActivityEvent(e: {
  type: string;
  profileId?: string;
  generation?: number;
  data?: unknown;
  timestamp?: number;
}): string | null {
  if (!TYPED_ACTIVITY_EVENTS[e.type]) {
    return null;
  }
  let source: NotificationSource = "system";
  if (e.type.startsWith("git:") || e.type.startsWith("worktree:")) source = "git";
  else if (e.type.startsWith("terminal:")) source = "terminal";
  else if (e.type.startsWith("agent:")) source = "agent";

  let level: NotificationLevel = "info";
  if (e.type === "terminal:crashed" || e.type === "idle-suspend:failed") {
    level = "error";
  } else if (e.type === "host:alert" || e.type === "host:alertChanged" || e.type === "terminal:restart") {
    level = "warning";
  } else if (e.type === "agent:attention") {
    level = "attention";
  }

  let title = e.type;
  let body: string | undefined;
  let targetProject: string | undefined;
  let targetTerminalId: string | undefined;

  if (typeof e.data === "object" && e.data !== null) {
    const d = e.data as Record<string, unknown>;
    if (typeof d.projectName === "string") targetProject = d.projectName;
    if (typeof d.terminalId === "string") targetTerminalId = d.terminalId;
    if (typeof d.sessionId === "string") targetTerminalId = d.sessionId;
    if (typeof d.message === "string") {
      body = d.message.slice(0, 160);
    }
  }

  if (e.type === "git:commit") title = "Git Commit Created";
  else if (e.type === "worktree:changed") title = `Worktree Changed ${targetProject ? `(${targetProject})` : ""}`.trim();
  else if (e.type === "status:changed") title = "Repository Status Changed";
  else if (e.type === "terminal:changed") title = "Terminal Sessions Changed";
  else if (e.type === "terminal:crashed") title = "Terminal Process Crashed";
  else if (e.type === "terminal:exit") title = "Terminal Process Exited";
  else if (e.type === "terminal:spawn") title = "Terminal Process Started";
  else if (e.type === "host:alert" || e.type === "host:alertChanged") title = "Host Resource Alert";
  else if (e.type === "host:idleSuspendChanged" || e.type.startsWith("idle-suspend:")) title = `Idle Suspend: ${e.type.split(":")[1] ?? "Changed"}`;

  return useOsNotificationStore.getState().addNotification({
    profileId: e.profileId ?? "default",
    generation: e.generation ?? 0,
    title,
    body,
    source,
    level,
    targetProject,
    targetTerminalId,
  });
}

export function ingestAgentAttentionNotification(params: {
  profileId: string;
  generation: number;
  terminalId: string;
  terminalTitle?: string;
  reason?: "Approval" | "Question" | "Error" | string;
  harnessLabel?: string;
}): string {
  const reasonText = params.reason ? ` - ${params.reason} required` : "";
  const title = `Agent Attention (${params.harnessLabel ?? "Agent"})${reasonText}`;
  return useOsNotificationStore.getState().addNotification({
    profileId: params.profileId,
    generation: params.generation,
    title,
    body: params.terminalTitle ? `Terminal: ${params.terminalTitle}` : undefined,
    source: "agent",
    level: "attention",
    targetTerminalId: params.terminalId,
  });
}
