export interface ProjectUsage {
  lastUsedAt: number;
  useCount: number;
}

export interface CommandHistoryEntry {
  id: string;
  /** Exact command as emitted by a verified shell lifecycle marker. */
  command: string;
  /** Derived only for search; never used to reconstruct or transmit a command. */
  searchText: string;
  lastUsedAt: number;
  useCount: number;
  project?: string;
  projectUsage: Record<string, ProjectUsage>;
  profileId?: string;
}

export interface HistorySearchResult {
  entry: CommandHistoryEntry;
  score: number;
}

type StoredHistory = { version: 3; entries: unknown[] };
type LegacyEntry = Partial<CommandHistoryEntry> & {
  command?: unknown;
  lastUsedAt?: unknown;
  useCount?: unknown;
  project?: unknown;
  profileId?: unknown;
};
const STORAGE_KEY = "dam-hopper:command-history";
const HISTORY_ENABLED_STORAGE_KEY = "dam-hopper:command-history-enabled";
const MAX_ENTRIES = 1000;
const DECAY_DAYS = 30;

function stableId(command: string, profileId?: string): string {
  let value = 2166136261;
  const raw = profileId ? `${profileId}\u0000${command}` : command;
  for (const char of raw) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return `v3-${(value >>> 0).toString(36)}`;
}

function toSearchText(command: string): string {
  return command.normalize("NFKC").toLocaleLowerCase();
}

function tokens(text: string): string[] {
  return toSearchText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function toEntry(value: LegacyEntry): CommandHistoryEntry | null {
  if (
    typeof value.command !== "string" ||
    typeof value.lastUsedAt !== "number" ||
    typeof value.useCount !== "number"
  )
    return null;
  const project = typeof value.project === "string" ? value.project : undefined;
  const projectUsage =
    value.projectUsage && typeof value.projectUsage === "object"
      ? (Object.fromEntries(
          Object.entries(value.projectUsage).filter(
            ([, usage]) =>
              typeof usage === "object" &&
              usage !== null &&
              typeof (usage as ProjectUsage).lastUsedAt === "number" &&
              typeof (usage as ProjectUsage).useCount === "number",
          ),
        ) as Record<string, ProjectUsage>)
      : project
        ? {
            [project]: {
              lastUsedAt: value.lastUsedAt,
              useCount: value.useCount,
            },
          }
        : {};
  const profileId =
    typeof value.profileId === "string" ? value.profileId : undefined;
  return {
    id:
      typeof value.id === "string"
        ? value.id
        : stableId(value.command, profileId),
    command: value.command,
    searchText:
      typeof value.searchText === "string"
        ? value.searchText
        : toSearchText(value.command),
    lastUsedAt: value.lastUsedAt,
    useCount: value.useCount,
    project,
    projectUsage,
    profileId,
  };
}
function loadEntries(): CommandHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as StoredHistory).version !== 3 ||
      !Array.isArray((parsed as StoredHistory).entries)
    ) {
      // Discard legacy/unversioned entries per Phase 04 / G0 specification
      return [];
    }
    const values = (parsed as StoredHistory).entries;
    return values.flatMap((value) => {
      const entry = toEntry(value as LegacyEntry);
      return entry ? [entry] : [];
    });
  } catch {
    return [];
  }
}

function saveEntries(entries: CommandHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, entries }));
  } catch {
    // Quota or privacy failures intentionally leave command persistence disabled.
  }
}

export function isHistoryEnabled(): boolean {
  try {
    return localStorage.getItem(HISTORY_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return false;
  }
}

export function setHistoryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HISTORY_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Storage errors are handled by isHistoryEnabled(), which fails closed.
  }
}

export function recordCommand(
  command: string,
  project?: string,
  profileId?: string,
): void {
  if (!isHistoryEnabled() || !command) return;
  const now = Date.now();
  const entries = loadEntries();
  const entry = entries.find(
    (candidate) =>
      candidate.command === command &&
      (candidate.profileId ?? "") === (profileId ?? ""),
  );
  if (entry) {
    entry.lastUsedAt = now;
    entry.useCount += 1;
    if (project) {
      entry.project = project;
      const usage = entry.projectUsage[project] ?? {
        lastUsedAt: now,
        useCount: 0,
      };
      entry.projectUsage[project] = {
        lastUsedAt: now,
        useCount: usage.useCount + 1,
      };
    }
  } else {
    entries.push({
      id: stableId(command, profileId),
      command,
      searchText: toSearchText(command),
      lastUsedAt: now,
      useCount: 1,
      project,
      projectUsage: project
        ? { [project]: { lastUsedAt: now, useCount: 1 } }
        : {},
      profileId,
    });
  }
  entries.sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  saveEntries(entries.slice(0, MAX_ENTRIES));
}

function score(entry: CommandHistoryEntry, queryTokens: string[]): number {
  const entryTokens = tokens(entry.searchText);
  const matches = queryTokens.reduce(
    (count, query) =>
      count + Number(entryTokens.some((token) => token.startsWith(query))),
    0,
  );
  if (!matches) return 0;
  const ageDays = (Date.now() - entry.lastUsedAt) / 86_400_000;
  return (
    (matches / queryTokens.length) *
    (1 + Math.exp(-ageDays / DECAY_DAYS)) *
    (1 + Math.log2(entry.useCount + 1))
  );
}

/** Shared ranking: exact raw prefixes win; normalized Unicode tokens rank the rest. */
export function searchHistory(
  query: string,
  limit = 5,
  profileId?: string,
): HistorySearchResult[] {
  if (!query) return [];
  const queryTokens = tokens(query);
  const results = loadEntries()
    .filter(
      (entry) =>
        !profileId || !entry.profileId || entry.profileId === profileId,
    )
    .flatMap((entry) => {
      const prefix = entry.command.startsWith(query);
      const rank = prefix
        ? 10_000 + score(entry, queryTokens)
        : score(entry, queryTokens);
      return rank > 0 ? [{ entry, score: rank }] : [];
    });
  return results
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function getProjectUsage(
  entry: CommandHistoryEntry,
  project: string,
): ProjectUsage | undefined {
  return entry.projectUsage[project];
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* intentionally ignored */
  }
}

export function getHistory(profileId?: string): CommandHistoryEntry[] {
  const entries = loadEntries();
  if (!profileId) return entries;
  return entries.filter(
    (entry) => !entry.profileId || entry.profileId === profileId,
  );
}
