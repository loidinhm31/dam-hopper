import type {
  TraditionalAgentStatusLabel,
  TraditionalTerminalAgentRow,
} from "./traditional-terminal-agents.js";

export type TraditionalAgentStatusFilter = "all" | TraditionalAgentStatusLabel;

export const TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY =
  "dam-hopper:traditional-terminal-agents-status-filter";

export type TraditionalTerminalAgentStatusCounts =
  Readonly<Record<TraditionalAgentStatusFilter, number>>;

const VALID_FILTER_RECORD: Readonly<Record<TraditionalAgentStatusFilter, true>> = {
  all: true,
  Working: true,
  Idle: true,
  "Needs attention": true,
  Unknown: true,
  Unavailable: true,
  "Platform unqualified": true,
  Unsupported: true,
};

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
 * Returns true if the provided value is exactly one of the eight valid filter values.
 */
export function isTraditionalAgentStatusFilter(
  value: unknown,
): value is TraditionalAgentStatusFilter {
  return typeof value === "string" && Object.hasOwn(VALID_FILTER_RECORD, value);
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
 * Returns "all" if storage is unavailable, access throws, or the stored value is invalid/missing.
 * Does not write or remove storage entries during load.
 */
export function loadTraditionalTerminalAgentFilter(
  storage: Pick<Storage, "getItem"> | undefined = defaultStorage(),
): TraditionalAgentStatusFilter {
  try {
    const raw = storage?.getItem(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY);
    return isTraditionalAgentStatusFilter(raw) ? raw : "all";
  } catch {
    return "all";
  }
}

/**
 * Persists the filter preference to storage as a raw string.
 * Invalid values are rejected without writing. Failures are safely ignored.
 */
export function saveTraditionalTerminalAgentFilter(
  filter: TraditionalAgentStatusFilter,
  storage: Pick<Storage, "setItem"> | undefined = defaultStorage(),
): void {
  if (!isTraditionalAgentStatusFilter(filter)) {
    return;
  }

  try {
    storage?.setItem(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY, filter);
  } catch {
    // Storage is optional UI preference.
  }
}

/**
 * Filters rows strictly by presentation label.
 * For "all", returns the input array unchanged (retains array identity).
 * For a specific status, returns a stable-order subset containing the original row references.
 */
export function filterTraditionalTerminalAgentRows(
  rows: readonly TraditionalTerminalAgentRow[],
  filter: TraditionalAgentStatusFilter,
): readonly TraditionalTerminalAgentRow[] {
  if (filter === "all") {
    return rows;
  }

  return rows.filter((row) => row.presentation.label === filter);
}

/**
 * Tally of terminal agents by presentation status in a single pass.
 * Returns an object with all eight keys initialized, where 'all' equals rows.length.
 */
export function countTraditionalTerminalAgentsByStatus(
  rows: readonly TraditionalTerminalAgentRow[],
): TraditionalTerminalAgentStatusCounts {
  const counts: Record<TraditionalAgentStatusFilter, number> = {
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
