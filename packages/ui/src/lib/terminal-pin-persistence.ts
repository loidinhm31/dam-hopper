export const TERMINAL_PIN_STORAGE_KEY = "dam-hopper:terminal-pins:v1";

export interface TerminalPinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface TerminalPinPayload {
  version: 1;
  sessionIds: string[];
}

function defaultStorage(): TerminalPinStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function removeStoredPins(storage: TerminalPinStorage | undefined) {
  try {
    storage?.removeItem(TERMINAL_PIN_STORAGE_KEY);
  } catch {
    // Browser storage is optional UI state.
  }
}

function isValidPayload(value: unknown): value is TerminalPinPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<TerminalPinPayload>;
  return (
    payload.version === 1 &&
    Array.isArray(payload.sessionIds) &&
    payload.sessionIds.every(
      (sessionId) => typeof sessionId === "string" && sessionId.length > 0,
    )
  );
}

export function loadPinnedTerminalIds(
  storage: TerminalPinStorage | undefined = defaultStorage(),
): Set<string> {
  let raw: string | null;
  try {
    raw = storage?.getItem(TERMINAL_PIN_STORAGE_KEY) ?? null;
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();

  try {
    const payload: unknown = JSON.parse(raw);
    if (isValidPayload(payload)) return new Set(payload.sessionIds);
  } catch {
    // Invalid browser storage must not interrupt terminal initialization.
  }

  removeStoredPins(storage);
  return new Set();
}

export function savePinnedTerminalIds(
  sessionIds: Iterable<string>,
  storage: TerminalPinStorage | undefined = defaultStorage(),
) {
  const normalized = [...new Set(sessionIds)].filter(
    (sessionId) => sessionId.length > 0,
  );

  try {
    if (normalized.length === 0) {
      storage?.removeItem(TERMINAL_PIN_STORAGE_KEY);
      return;
    }
    storage?.setItem(
      TERMINAL_PIN_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sessionIds: normalized,
      } satisfies TerminalPinPayload),
    );
  } catch {
    // Browser storage is optional UI state.
  }
}

export function retainPinnedTerminalIds(
  pinnedIds: ReadonlySet<string>,
  liveOrPendingIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    [...pinnedIds].filter((sessionId) => liveOrPendingIds.has(sessionId)),
  );
}

export function setPinnedTerminalId(
  pinnedIds: ReadonlySet<string>,
  sessionId: string,
  isPinned: boolean,
): Set<string> {
  const nextPinnedIds = new Set(pinnedIds);
  if (isPinned) {
    nextPinnedIds.add(sessionId);
  } else {
    nextPinnedIds.delete(sessionId);
  }
  return nextPinnedIds;
}
