const STORAGE_KEY = "dam-hopper:browser-debug-address-history";
const MAX_ENTRIES = 12;

type StoredHistory = { version: 1; entries: unknown[] };

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    )
      return null;
    // Keep navigation secrets such as OAuth codes and signed-link tokens out of
    // persistent local history. The live address bar still shows the full URL.
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function uniqueRecent(entries: unknown[]): string[] {
  return entries.reduce<string[]>((recent, entry) => {
    const address = normalizeAddress(entry);
    if (!address || recent.includes(address) || recent.length >= MAX_ENTRIES)
      return recent;
    recent.push(address);
    return recent;
  }, []);
}

/** Returns browser-local recent addresses. Entries are revalidated before loading. */
export function loadBrowserDebugAddressHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as StoredHistory)?.entries)
        ? (parsed as StoredHistory).entries
        : [];
    return uniqueRecent(entries);
  } catch {
    return [];
  }
}

/** Records an address as most-recently used without sharing it outside this browser. */
export function recordBrowserDebugAddress(address: string): string[] {
  const normalized = normalizeAddress(address);
  const entries = normalized
    ? uniqueRecent([normalized, ...loadBrowserDebugAddressHistory()])
    : loadBrowserDebugAddressHistory();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
  } catch {
    // Private browsing and quota failures leave the in-memory suggestions usable.
  }
  return entries;
}
