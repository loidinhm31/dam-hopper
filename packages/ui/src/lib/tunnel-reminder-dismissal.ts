export const TUNNEL_REMINDER_DISMISSAL_STORAGE_KEY =
  "dam-hopper:tunnel-reminders:dismissed:v1";

const MAX_DISMISSED_ENTRIES = 200;

let memoryDismissed: Set<string> | null = null;
const listeners = new Set<() => void>();

export interface TunnelReminderDismissalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(): TunnelReminderDismissalStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function ensureLoaded(
  storage: TunnelReminderDismissalStorage | undefined = resolveStorage(),
): Set<string> {
  if (memoryDismissed !== null) {
    return memoryDismissed;
  }

  const set = new Set<string>();
  try {
    const raw = storage?.getItem(TUNNEL_REMINDER_DISMISSAL_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(-MAX_DISMISSED_ENTRIES)) {
          if (typeof item === "string" && item.length > 0) {
            set.add(item);
          }
        }
      }
    }
  } catch {
    // Storage access or JSON parse failure: fallback to empty in-memory set
  }

  memoryDismissed = set;
  return set;
}

function persist(
  set: Set<string>,
  storage: TunnelReminderDismissalStorage | undefined = resolveStorage(),
): void {
  try {
    const items = Array.from(set);
    const bounded =
      items.length > MAX_DISMISSED_ENTRIES
        ? items.slice(items.length - MAX_DISMISSED_ENTRIES)
        : items;
    storage?.setItem(
      TUNNEL_REMINDER_DISMISSAL_STORAGE_KEY,
      JSON.stringify(bounded),
    );
  } catch {
    // Gracefully ignore quota or security errors in sandboxed/private sessions
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listener errors should not break notification loop
    }
  }
}

export function isTunnelReminderDismissed(
  profileId: string,
  tunnelId: string,
  storage?: TunnelReminderDismissalStorage,
): boolean {
  const set = ensureLoaded(storage);
  return set.has(`${profileId}:${tunnelId}`);
}

export function dismissTunnelReminder(
  profileId: string,
  tunnelId: string,
  storage?: TunnelReminderDismissalStorage,
): void {
  const set = ensureLoaded(storage);
  const key = `${profileId}:${tunnelId}`;
  if (set.has(key)) return;

  set.add(key);
  if (set.size > MAX_DISMISSED_ENTRIES) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  persist(set, storage);
  notify();
}

export function resetTunnelReminderDismissals(
  storage?: TunnelReminderDismissalStorage,
): void {
  const targetStorage = storage ?? resolveStorage();
  memoryDismissed = new Set<string>();
  try {
    targetStorage?.removeItem(TUNNEL_REMINDER_DISMISSAL_STORAGE_KEY);
  } catch {
    // Ignore storage deletion errors
  }
  notify();
}

export function subscribeTunnelReminderDismissals(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
