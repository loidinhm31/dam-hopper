export const TERMINAL_PIN_STORAGE_KEY = "dam-hopper:terminal-pins:v2";
export const LEGACY_TERMINAL_PIN_STORAGE_KEY = "dam-hopper:terminal-pins:v1";
export function getTerminalPinStorageKey(profileId?: string): string {
  return profileId
    ? `dam-hopper:terminal-pins:v2:${encodeURIComponent(profileId)}`
    : TERMINAL_PIN_STORAGE_KEY;
}

export interface TerminalPinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface TerminalPinPayload {
  version: 2;
  sessionIds: string[];
}

function defaultStorage(): TerminalPinStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
function removeStoredPins(
  storage: TerminalPinStorage | undefined,
  profileId?: string,
) {
  try {
    const key = getTerminalPinStorageKey(profileId);
    storage?.removeItem(key);
    storage?.removeItem(LEGACY_TERMINAL_PIN_STORAGE_KEY);
  } catch {
    // Browser storage is optional UI state.
  }
}

function isValidPayload(value: unknown): value is TerminalPinPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<TerminalPinPayload>;
  return (
    payload.version === 2 &&
    Array.isArray(payload.sessionIds) &&
    payload.sessionIds.every(
      (sessionId) => typeof sessionId === "string" && sessionId.length > 0,
    )
  );
}
export function loadPinnedTerminalIds(
  storage: TerminalPinStorage | undefined = defaultStorage(),
  profileId?: string,
): Set<string> {
  let raw: string | null;
  const key = getTerminalPinStorageKey(profileId);
  try {
    // Clean up legacy v1 key if present
    storage?.removeItem(LEGACY_TERMINAL_PIN_STORAGE_KEY);
    raw = storage?.getItem(key) ?? null;
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

  removeStoredPins(storage, profileId);
  return new Set();
}

export function savePinnedTerminalIds(
  sessionIds: Iterable<string>,
  storage: TerminalPinStorage | undefined = defaultStorage(),
  profileId?: string,
) {
  const normalized = [...new Set(sessionIds)].filter(
    (sessionId) => sessionId.length > 0,
  );
  const key = getTerminalPinStorageKey(profileId);

  try {
    if (normalized.length === 0) {
      storage?.removeItem(key);
      return;
    }
    storage?.setItem(
      key,
      JSON.stringify({
        version: 2,
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
