export interface CommandHistoryEntry {
  command: string;
  lastUsedAt: number;
  useCount: number;
  project?: string;
}

export interface HistorySearchResult {
  entry: CommandHistoryEntry;
  score: number;
}

const K1 = 1.2;
const B = 0.75;
const STORAGE_KEY = "dam-hopper:command-history";
const MAX_ENTRIES = 1000;
// 0.01 chosen empirically: compositeScore = bm25 * recency * freq; with 30-day decay
// a command used once 31+ days ago scores ~bm25 * 1.05 * 1 ≈ 0.02–0.1 for a weak match.
// Below 0.01 the BM25 token overlap is so partial the result would be noise.
const MIN_SCORE_THRESHOLD = 0.01;
const DECAY_DAYS = 30;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function computeDocFrequency(
  queryTokens: string[],
  allTokenized: string[][],
): Map<string, number> {
  const df = new Map<string, number>();
  for (const docTokens of allTokenized) {
    const counted = new Set<string>();
    for (const t of docTokens) {
      for (const qt of queryTokens) {
        // Count exact matches and prefix matches (e.g. "hel" matches "hello")
        if ((t === qt || t.startsWith(qt)) && !counted.has(qt)) {
          df.set(qt, (df.get(qt) ?? 0) + 1);
          counted.add(qt);
        }
      }
    }
  }
  return df;
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  df: Map<string, number>,
  N: number,
): number {
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    let freq = tf.get(qt) ?? 0;
    let prefixOnly = false;
    if (freq === 0) {
      // Prefix match: "hel" matches doc tokens like "hello", "help"
      for (const [token, count] of tf) {
        if (token.startsWith(qt)) freq += count;
      }
      if (freq > 0) prefixOnly = true;
    }
    if (freq === 0) continue;
    const n = df.get(qt) ?? 0;
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    const num = freq * (K1 + 1);
    const denom = freq + K1 * (1 - B + B * (docTokens.length / avgDocLen));
    // Prefix matches score at 70% of an exact match
    score += idf * (num / denom) * (prefixOnly ? 0.7 : 1.0);
  }
  return score;
}

function recencyBoost(lastUsedAt: number): number {
  const ageDays = (Date.now() - lastUsedAt) / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / DECAY_DAYS);
}

function freqBoost(useCount: number): number {
  return Math.log2(useCount + 1);
}

function compositeScore(
  bm25: number,
  entry: CommandHistoryEntry,
  applyRecency = true,
): number {
  const recency = applyRecency ? 1 + recencyBoost(entry.lastUsedAt) : 1;
  return bm25 * recency * (1 + freqBoost(entry.useCount));
}

function loadEntries(): CommandHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is CommandHistoryEntry =>
        typeof (e as CommandHistoryEntry)?.command === "string" &&
        typeof (e as CommandHistoryEntry)?.useCount === "number" &&
        typeof (e as CommandHistoryEntry)?.lastUsedAt === "number",
    );
  } catch {
    return [];
  }
}

function saveEntries(entries: CommandHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // QuotaExceededError or SecurityError in private browsing — silent degrade
  }
}

export function recordCommand(command: string, project?: string): void {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return;

  const entries = loadEntries();
  const existing = entries.find((e) => e.command === normalized);

  if (existing) {
    existing.lastUsedAt = Date.now();
    existing.useCount += 1;
    if (project) existing.project = project;
  } else {
    entries.push({ command: normalized, lastUsedAt: Date.now(), useCount: 1, project });
  }

  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    entries.splice(MAX_ENTRIES);
  }

  saveEntries(entries);
}

export function searchHistory(query: string, limit = 5): HistorySearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const entries = loadEntries();
  if (entries.length === 0) return [];

  const queryTokens = tokenize(q);
  if (queryTokens.length === 0) return [];

  const allTokenized = entries.map((e) => tokenize(e.command));
  const totalLen = allTokenized.reduce((sum, t) => sum + t.length, 0);
  const avgDocLen = totalLen / entries.length;
  const df = computeDocFrequency(queryTokens, allTokenized);
  const N = entries.length;

  // First pass: score with recency decay, retain raw bm25 for potential fallback reuse
  type RawScored = { entry: CommandHistoryEntry; bm25: number; score: number };
  const rawScored: RawScored[] = [];
  for (let i = 0; i < entries.length; i++) {
    const docTokens = allTokenized[i]!;
    const bm25 = bm25Score(queryTokens, docTokens, avgDocLen, df, N);
    if (bm25 === 0) continue;
    rawScored.push({ entry: entries[i]!, bm25, score: compositeScore(bm25, entries[i]!) });
  }

  rawScored.sort((a, b) => b.score - a.score);
  const topResults = rawScored.slice(0, limit);

  // Fallback: if all results are below threshold (matches are very old), re-score without
  // recency decay so old-but-relevant commands still surface. Reuses first-pass bm25.
  if (topResults.length === 0 || topResults.every((r) => r.score < MIN_SCORE_THRESHOLD)) {
    const fallback: HistorySearchResult[] = rawScored.map((r) => ({
      entry: r.entry,
      score: compositeScore(r.bm25, r.entry, false),
    }));
    fallback.sort((a, b) => b.score - a.score);
    return fallback.slice(0, limit);
  }

  return topResults.map(({ entry, score }) => ({ entry, score }));
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getHistory(): CommandHistoryEntry[] {
  return loadEntries();
}
