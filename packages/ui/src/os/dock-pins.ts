import type { OsAppId } from "./types.js";
import {
  DEFAULT_DOCK_PINS,
  loadDockPins,
  normalizeDockPins,
  OS_DOCK_STORAGE_KEY,
  registerDockPinsImportListener,
  registerDockPinsSnapshotProvider,
  saveDockPins,
} from "./persistence.js";

function arraysEqual(
  a: readonly OsAppId[],
  b: readonly OsAppId[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Canonical cached snapshot (immutable)
let cachedSnapshot: readonly OsAppId[] = Object.freeze(loadDockPins());

// Active subscribers
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const listener of subscribers) {
    try {
      listener();
    } catch (err) {
      console.error("Dock pins subscriber error:", err);
    }
  }
}

function updateSnapshot(next: readonly OsAppId[]): boolean {
  if (arraysEqual(cachedSnapshot, next)) {
    return false;
  }
  cachedSnapshot = Object.freeze([...next]);
  notifySubscribers();
  return true;
}

/**
 * Returns canonical immutable snapshot of current dock pins.
 * Reference-stable across reads when pin membership/ordering has not changed.
 */
export function getDockPinsSnapshot(): readonly OsAppId[] {
  return cachedSnapshot;
}

/**
 * Subscribes to changes to the canonical dock pins snapshot.
 * Returns an unsubscription callback.
 */
export function subscribeDockPins(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export type SetDockPinsResult =
  | { persisted: true }
  | { persisted: false; reason: string };

/**
 * Atomically updates dock pins:
 * 1. Normalizes pins (unknown IDs filtered, duplicates removed, valid [] preserved).
 * 2. Attempts durable write to localStorage.
 * 3. On success, updates internal snapshot and notifies subscribers.
 * 4. On storage error/quota failure, retains prior persisted value and returns honest failure.
 */
export function setDockPins(pins: readonly OsAppId[]): SetDockPinsResult {
  const normalized = normalizeDockPins(pins);
  try {
    if (typeof localStorage === "undefined") {
      return { persisted: false, reason: "localStorage is not available" };
    }
    localStorage.setItem(OS_DOCK_STORAGE_KEY, JSON.stringify(normalized));
    updateSnapshot(normalized);
    return { persisted: true };
  } catch (err) {
    return {
      persisted: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Toggles an app's pinned status in the dock.
 * If already pinned, removes it.
 * If not pinned, appends it to the end.
 * Retains running windows without closing or mutating resources.
 */
export function toggleDockPin(appId: OsAppId): SetDockPinsResult {
  const current = getDockPinsSnapshot();
  const next = current.includes(appId)
    ? current.filter((id) => id !== appId)
    : [...current, appId];
  return setDockPins(next);
}

/**
 * Resets dock pins back to default pins.
 */
export function resetDockPins(): SetDockPinsResult {
  return setDockPins(DEFAULT_DOCK_PINS);
}

/**
 * Handles cross-tab / cross-window storage events for OS_DOCK_STORAGE_KEY.
 * Avoids write-back loops; updates cached snapshot and notifies subscribers.
 */
export function handleDockPinsStorageEvent(event: StorageEvent): void {
  if (
    event.storageArea &&
    typeof localStorage !== "undefined" &&
    event.storageArea !== localStorage
  ) {
    return;
  }
  if (event.key !== OS_DOCK_STORAGE_KEY) {
    return;
  }

  // Key removed / localStorage.clear()
  if (event.newValue === null) {
    updateSnapshot(DEFAULT_DOCK_PINS);
    return;
  }

  try {
    const parsed = JSON.parse(event.newValue);
    if (Array.isArray(parsed)) {
      const normalized = normalizeDockPins(parsed);
      updateSnapshot(normalized);
    }
  } catch {
    // Malformed JSON from foreign source ignored
  }
}

// Attach native window storage listener if in browser environment
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("storage", handleDockPinsStorageEvent);
}

// Register import notification listener so importOsEnvelope updates snapshot synchronously
registerDockPinsImportListener((importedPins) => {
  const normalized = normalizeDockPins(importedPins);
  updateSnapshot(normalized);
});

// Register snapshot provider for exportOsEnvelope
registerDockPinsSnapshotProvider(getDockPinsSnapshot);

/**
 * Test helper: reloads snapshot from storage to synchronize with test setup.
 */
export function _reloadDockPinsFromStorageForTesting(): void {
  const loaded = loadDockPins();
  updateSnapshot(loaded);
}
