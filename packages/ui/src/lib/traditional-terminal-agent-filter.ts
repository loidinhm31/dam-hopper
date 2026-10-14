import type {
  TraditionalAgentStatusLabel,
  TraditionalTerminalAgentRow,
} from "./traditional-terminal-agents.js";

export type TraditionalAgentStatusCountKey = "all" | TraditionalAgentStatusLabel;

export type TraditionalTerminalAgentStatusCounts =
  Readonly<Record<TraditionalAgentStatusCountKey, number>>;

export type TraditionalAgentStatusSelection =
  | "all"
  | readonly TraditionalAgentStatusLabel[];

export type TraditionalAgentStatusFilter =
  | "all"
  | TraditionalAgentStatusLabel
  | readonly TraditionalAgentStatusLabel[];

export const TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY =
  "dam-hopper:traditional-terminal-agents-status-filter";

export const CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS: readonly TraditionalAgentStatusLabel[] = [
  "Needs attention",
  "Working",
  "Idle",
  "Unknown",
  "Unavailable",
  "Platform unqualified",
  "Unsupported",
] as const;

export const CANONICAL_STATUS_ORDER = CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS;

const STATUS_LABEL_RECORD: Readonly<Record<TraditionalAgentStatusLabel, true>> = {
  Working: true,
  Idle: true,
  "Needs attention": true,
  Unknown: true,
  Unavailable: true,
  "Platform unqualified": true,
  Unsupported: true,
};

/**
 * Returns true if the provided value is a valid single TraditionalAgentStatusLabel.
 */
export function isTraditionalAgentStatusLabel(
  value: unknown,
): value is TraditionalAgentStatusLabel {
  return typeof value === "string" && Object.hasOwn(STATUS_LABEL_RECORD, value);
}

/**
 * Returns true if the provided value is a valid filter value:
 * "all", a valid status label string, or an array of valid status labels.
 */
export function isTraditionalAgentStatusFilter(
  value: unknown,
): value is TraditionalAgentStatusFilter {
  if (value === "all") {
    return true;
  }
  if (isTraditionalAgentStatusLabel(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isTraditionalAgentStatusLabel(item));
  }
  return false;
}

/**
 * Normalizes any input into a canonical selection:
 * - "all", invalid values, empty arrays, or all 7 statuses -> "all".
 * - Valid scalar status label -> [label].
 * - Array of status labels -> deduplicated, filtered for validity, sorted in canonical order.
 */
export function normalizeTraditionalAgentStatusFilter(
  input: unknown,
): TraditionalAgentStatusSelection {
  if (input === "all") {
    return "all";
  }

  if (typeof input === "string") {
    if (Object.hasOwn(STATUS_LABEL_RECORD, input)) {
      return [input as TraditionalAgentStatusLabel];
    }
    return "all";
  }

  if (Array.isArray(input)) {
    const matched = new Set<TraditionalAgentStatusLabel>();
    for (const item of input) {
      if (typeof item === "string" && Object.hasOwn(STATUS_LABEL_RECORD, item)) {
        matched.add(item as TraditionalAgentStatusLabel);
      }
    }

    if (
      matched.size === 0 ||
      matched.size === CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS.length
    ) {
      return "all";
    }

    return CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS.filter((label) =>
      matched.has(label),
    );
  }

  return "all";
}

/**
 * Safe accessor for default browser localStorage.
 * Evaluates inside a try/catch block so default-argument resolution never throws.
 */
function defaultStorage(): Storage | undefined {
  try {
    return typeof globalThis !== "undefined" ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads the persisted filter preference from storage.
 * Reads legacy scalar strings, "all", and JSON array strings.
 * Returns normalized TraditionalAgentStatusSelection.
 * Returns "all" if storage is unavailable, access throws, or the stored value is invalid/missing.
 * Does not write or remove storage entries during load.
 */
export function loadTraditionalTerminalAgentFilter(
  storage: Pick<Storage, "getItem"> | undefined = defaultStorage(),
): TraditionalAgentStatusSelection {
  try {
    const raw = storage?.getItem(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY);
    if (!raw || typeof raw !== "string") {
      return "all";
    }

    if (raw === "all") {
      return "all";
    }

    // Check if it's a legacy scalar string status label
    if (Object.hasOwn(STATUS_LABEL_RECORD, raw)) {
      return [raw as TraditionalAgentStatusLabel];
    }

    // Attempt to parse as JSON array string (including with whitespace)
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return normalizeTraditionalAgentStatusFilter(parsed);
      }
    } catch {
      return "all";
    }

    return "all";
  } catch {
    return "all";
  }
}

/**
 * Persists the filter preference to storage:
 * - "all" -> stores "all".
 * - single label / singleton array -> stores scalar string (e.g. "Working").
 * - multiple labels -> stores JSON string (e.g. '["Needs attention","Working"]').
 * Normalizes before saving. Storage errors are safely ignored.
 */
export function saveTraditionalTerminalAgentFilter(
  filter: TraditionalAgentStatusFilter,
  storage: Pick<Storage, "setItem"> | undefined = defaultStorage(),
): void {
  const normalized = normalizeTraditionalAgentStatusFilter(filter);
  let serialized: string;

  if (normalized === "all") {
    serialized = "all";
  } else if (normalized.length === 1) {
    serialized = normalized[0];
  } else {
    serialized = JSON.stringify(normalized);
  }

  try {
    storage?.setItem(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY, serialized);
  } catch {
    // Storage is optional UI preference.
  }
}

/**
 * Filters rows strictly by presentation label.
 * For "all", returns the input array unchanged (retains array identity).
 * For a specific status, returns rows matching row.presentation.label === filter.
 * For an array of statuses, returns rows whose row.presentation.label is in the allowed set.
 * Note: Raw helper semantics treat empty array [] as matching zero rows. UI consumers
 * normalize selections via normalizeTraditionalAgentStatusFilter before filtering.
 */
export function filterTraditionalTerminalAgentRows(
  rows: readonly TraditionalTerminalAgentRow[],
  filter: TraditionalAgentStatusFilter,
): readonly TraditionalTerminalAgentRow[] {
  if (filter === "all") {
    return rows;
  }

  if (typeof filter === "string") {
    return rows.filter((row) => row.presentation.label === filter);
  }

  if (Array.isArray(filter)) {
    const allowed = new Set<string>(filter);
    return rows.filter((row) => allowed.has(row.presentation.label));
  }

  return rows;
}

/**
 * Formats a filter value for trigger label display:
 * - "all" -> "All statuses".
 * - single status -> label string (e.g. "Working").
 * - array -> comma-separated labels (e.g. "Working, Idle").
 * Note: Raw helper semantics format empty array [] as "". UI consumers
 * normalize selections via normalizeTraditionalAgentStatusFilter before formatting.
 */
export function formatTraditionalAgentStatusFilter(
  filter: TraditionalAgentStatusFilter,
): string {
  if (filter === "all") {
    return "All statuses";
  }

  if (typeof filter === "string") {
    return filter;
  }

  if (Array.isArray(filter)) {
    return filter.join(", ");
  }

  return "All statuses";
}

/**
 * Tally of terminal agents by presentation status in a single pass.
 * Returns an object with all eight keys initialized, where 'all' equals rows.length.
 */
export function countTraditionalTerminalAgentsByStatus(
  rows: readonly TraditionalTerminalAgentRow[],
): TraditionalTerminalAgentStatusCounts {
  const counts: Record<TraditionalAgentStatusCountKey, number> = {
    all: rows.length,
    Working: 0,
    Idle: 0,
    "Needs attention": 0,
    Unknown: 0,
    Unavailable: 0,
    "Platform unqualified": 0,
    Unsupported: 0,
  };

  for (const row of rows) {
    const label = row.presentation.label;
    if (Object.hasOwn(STATUS_LABEL_RECORD, label)) {
      counts[label]++;
    }
  }

  return counts;
}
