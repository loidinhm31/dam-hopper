import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import type {
  TraditionalAgentStatusLabel,
  TraditionalTerminalAgentRow,
} from "./traditional-terminal-agents.js";
import {
  TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
  countTraditionalTerminalAgentsByStatus,
  filterTraditionalTerminalAgentRows,
  isTraditionalAgentStatusFilter,
  loadTraditionalTerminalAgentFilter,
  saveTraditionalTerminalAgentFilter,
  type TraditionalAgentStatusFilter,
} from "./traditional-terminal-agent-filter.js";

const ALL_FILTERS: readonly TraditionalAgentStatusFilter[] = [
  "all", "Working", "Idle", "Needs attention", "Unknown", "Unavailable", "Platform unqualified", "Unsupported",
] as const;

const PRIMARY_LABELS: readonly TraditionalAgentStatusLabel[] = [
  "Working", "Idle", "Needs attention", "Unknown", "Unavailable", "Platform unqualified", "Unsupported",
] as const;

function createMapStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(initial ? Object.entries(initial) : []);
  return {
    map,
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { map.set(key, value); }),
    removeItem: vi.fn((key: string) => { map.delete(key); }),
    clear: vi.fn(() => { map.clear(); }),
  };
}

function createTestRow(options: {
  id: string;
  profileId?: string;
  groupId?: string;
  projectLabel?: string;
  profileLabel?: string;
  harnessLabel?: "OMP" | "Codex" | "Claude";
  label?: TraditionalAgentStatusLabel;
  reasonLabel?: "Approval" | "Question" | "Error" | null;
  outcomeHint?: "Done (turn ended)" | null;
  wireState?: "working" | "idle" | "blocked" | "unknown";
  availability?: "ready" | "unavailable" | "platform-unqualified" | null;
}): TraditionalTerminalAgentRow {
  const profileId = options.profileId ?? "profile-test";
  const terminalRef = { profileId, id: options.id };
  const groupId = options.groupId ?? "group-1";
  const harnessLabel = options.harnessLabel ?? "OMP";
  const label = options.label ?? "Working";
  const wireState = options.wireState ?? (
    label === "Working" ? "working" : label === "Idle" ? "idle" : label === "Needs attention" ? "blocked" : "unknown"
  );

  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 1 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 1,
    groupId,
    projectLabel: options.projectLabel ?? `Project ${groupId}`,
    profileLabel: options.profileLabel ?? (options.profileId ? `Profile ${options.profileId}` : "Default Profile"),
    terminalTitle: `Terminal ${options.id}`,
    harnessLabel,
    statusOwner: { profileId, generation: 1 },
    availability: options.availability === undefined ? "ready" : options.availability,
    status: {
      id: `agent-${options.id}`,
      incarnation: 1,
      agentKind: harnessLabel.toLowerCase() as "omp" | "codex" | "claude",
      agentSessionId: `agent-session-${options.id}`,
      reporterEpoch: 1,
      state: wireState,
      source: "lifecycle",
      attentionRevision: 1,
      reason: options.reasonLabel === "Approval" ? "approval"
        : options.reasonLabel === "Question" ? "question"
        : options.reasonLabel === "Error" ? "error" : undefined,
      lastOutcome: options.outcomeHint === "Done (turn ended)" ? "ended" : undefined,
    },
    presentation: {
      label,
      reasonLabel: options.reasonLabel ?? null,
      outcomeHint: options.outcomeHint ?? null,
      sourceLabel: "Lifecycle observation",
      coverageHint: null,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isTraditionalAgentStatusFilter", () => {
  it("accepts exactly the eight valid filter values", () => {
    for (const filter of ALL_FILTERS) {
      expect(isTraditionalAgentStatusFilter(filter)).toBe(true);
    }
  });

  it("rejects non-string values", () => {
    const invalidValues = [
      undefined, null, true, false, 0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY,
      [], {}, ["all"], { label: "Working" }, () => "all", Symbol("all"),
    ];
    for (const value of invalidValues) {
      expect(isTraditionalAgentStatusFilter(value)).toBe(false);
    }
  });

  it("rejects empty and whitespace strings", () => {
    for (const ws of ["", " ", "   ", "\t", "\n", "all ", " Working"]) {
      expect(isTraditionalAgentStatusFilter(ws)).toBe(false);
    }
  });

  it("rejects wrong case, wire state strings, outcome hints, and quoted strings", () => {
    const invalidStrings = [
      "working", "idle", "ALL", "needs attention", "WORKING", "blocked", "ready",
      "turn-ended", "Done (turn ended)", '"all"', '"Working"',
      "toString", "hasOwnProperty", "valueOf", "constructor",
    ];
    for (const str of invalidStrings) {
      expect(isTraditionalAgentStatusFilter(str)).toBe(false);
    }
  });
});

describe("loadTraditionalTerminalAgentFilter", () => {
  it("matches the exact canonical storage key string", () => {
    expect(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY).toBe(
      "dam-hopper:traditional-terminal-agents-status-filter",
    );
  });

  it("round-trips every valid filter value unchanged from storage", () => {
    for (const filter of ALL_FILTERS) {
      const storage = createMapStorage({ [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: filter });
      expect(loadTraditionalTerminalAgentFilter(storage)).toBe(filter);
      expect(storage.getItem).toHaveBeenCalledWith(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY);
    }
  });

  it("falls back to 'all' when storage entry is missing", () => {
    const storage = createMapStorage();
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");
    expect(storage.getItem).toHaveBeenCalledWith(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY);
  });

  it.each([
    "", "   ", "working", "blocked", "Done (turn ended)", '"all"', '{"filter":"Working"}', "unknown-status",
  ])("falls back to 'all' for corrupt or invalid stored value: %s", (corrupt) => {
    const storage = createMapStorage({ [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: corrupt });
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");
  });

  it("never writes, modifies, or deletes storage entries during load", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: "corrupt-data",
      "unrelated-key": "preserve-me",
    });
    const result = loadTraditionalTerminalAgentFilter(storage);
    expect(result).toBe("all");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.map.get("unrelated-key")).toBe("preserve-me");
    expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe("corrupt-data");
  });
});

describe("storage failure tolerance", () => {
  it("falls back to 'all' and does not throw when global storage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadTraditionalTerminalAgentFilter()).toBe("all");
    expect(() => saveTraditionalTerminalAgentFilter("Working")).not.toThrow();
  });

  it("falls back to 'all' and does not throw when localStorage getter throws", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() { throw new Error("SecurityError: storage access denied"); },
      });
      expect(loadTraditionalTerminalAgentFilter()).toBe("all");
      expect(() => saveTraditionalTerminalAgentFilter("Working")).not.toThrow();
      expect(() => saveTraditionalTerminalAgentFilter("all")).not.toThrow();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      } else {
        delete (globalThis as Record<string, unknown>).localStorage;
      }
    }
  });

  it("falls back to 'all' when injected storage getItem throws", () => {
    const throwingStorage = { getItem: vi.fn(() => { throw new Error("Hardware I/O error"); }) };
    expect(loadTraditionalTerminalAgentFilter(throwingStorage)).toBe("all");
  });

  it("does not throw when injected storage setItem throws", () => {
    const throwingStorage = { setItem: vi.fn(() => { throw new Error("QuotaExceededError"); }) };
    expect(() => saveTraditionalTerminalAgentFilter("Working", throwingStorage)).not.toThrow();
  });

  it("allows injected storage to function independently of broken global storage", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() { throw new Error("Blocked"); },
      });
      const injected = createMapStorage();
      saveTraditionalTerminalAgentFilter("Idle", injected);
      expect(loadTraditionalTerminalAgentFilter(injected)).toBe("Idle");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      } else {
        delete (globalThis as Record<string, unknown>).localStorage;
      }
    }
  });
});

describe("saveTraditionalTerminalAgentFilter", () => {
  it("persists each valid filter value as a raw string under exact key", () => {
    for (const filter of ALL_FILTERS) {
      const storage = createMapStorage();
      saveTraditionalTerminalAgentFilter(filter, storage);
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      expect(storage.setItem).toHaveBeenCalledWith(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY, filter);
      expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe(filter);
    }
  });

  it("rejects invalid runtime values without calling setItem", () => {
    const invalidInputs = ["invalid-filter", "working", "blocked", "Done (turn ended)", "", null, undefined, 123, {}];
    for (const invalid of invalidInputs) {
      const storage = createMapStorage();
      saveTraditionalTerminalAgentFilter(invalid as unknown as TraditionalAgentStatusFilter, storage);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.map.size).toBe(0);
    }
  });

  it("preserves unrelated entries in storage when saving", () => {
    const storage = createMapStorage({
      "unrelated-user-pref": "dark-theme",
      "dam-hopper:app-zoom:v1": '{"version":1,"zoom":100}',
    });
    saveTraditionalTerminalAgentFilter("Working", storage);
    expect(storage.map.get("unrelated-user-pref")).toBe("dark-theme");
    expect(storage.map.get("dam-hopper:app-zoom:v1")).toBe('{"version":1,"zoom":100}');
    expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe("Working");
  });
});

describe("filterTraditionalTerminalAgentRows", () => {
  it("returns original array identity when filter is 'all'", () => {
    const rows = [createTestRow({ id: "1", label: "Working" }), createTestRow({ id: "2", label: "Idle" })];
    expect(filterTraditionalTerminalAgentRows(rows, "all")).toBe(rows);
  });

  it("returns input array identity on empty input with 'all'", () => {
    const rows: readonly TraditionalTerminalAgentRow[] = [];
    expect(filterTraditionalTerminalAgentRows(rows, "all")).toBe(rows);
  });

  it("returns empty array when filtering empty input with specific status", () => {
    const rows: readonly TraditionalTerminalAgentRow[] = [];
    expect(filterTraditionalTerminalAgentRows(rows, "Working")).toEqual([]);
  });

  it("filters correctly for each primary label", () => {
    const rows = PRIMARY_LABELS.map((label, idx) => createTestRow({ id: `row-${idx}`, label }));
    for (const label of PRIMARY_LABELS) {
      const filtered = filterTraditionalTerminalAgentRows(rows, label);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.presentation.label).toBe(label);
    }
  });

  it("returns empty array when no rows match the filter", () => {
    const rows = [createTestRow({ id: "1", label: "Working" }), createTestRow({ id: "2", label: "Idle" })];
    expect(filterTraditionalTerminalAgentRows(rows, "Unavailable")).toEqual([]);
  });

  it("preserves input order and exact object identities across projects, profiles, and harnesses", () => {
    const row1 = createTestRow({ id: "1", profileId: "prof-1", groupId: "proj-A", harnessLabel: "OMP", label: "Working" });
    const row2 = createTestRow({ id: "2", profileId: "prof-2", groupId: "proj-B", harnessLabel: "Codex", label: "Idle" });
    const row3 = createTestRow({ id: "3", profileId: "prof-2", groupId: "proj-A", harnessLabel: "Claude", label: "Working" });
    const row4 = createTestRow({ id: "4", profileId: "prof-3", groupId: "proj-C", harnessLabel: "OMP", label: "Working" });

    const rows = [row1, row2, row3, row4];
    const filtered = filterTraditionalTerminalAgentRows(rows, "Working");

    expect(filtered).toHaveLength(3);
    expect(filtered[0]).toBe(row1);
    expect(filtered[1]).toBe(row3);
    expect(filtered[2]).toBe(row4);
  });

  it("leaves frozen input arrays and frozen row objects untouched", () => {
    const row1 = Object.freeze(createTestRow({ id: "1", label: "Working" }));
    const row2 = Object.freeze(createTestRow({ id: "2", label: "Idle" }));
    const rows = Object.freeze([row1, row2]);

    expect(() => filterTraditionalTerminalAgentRows(rows, "all")).not.toThrow();
    const working = filterTraditionalTerminalAgentRows(rows, "Working");
    expect(working).toHaveLength(1);
    expect(working[0]).toBe(row1);
  });
});

describe("presentation authority", () => {
  it("matches Unavailable when wire state is working but presented as Unavailable", () => {
    const unavailableRow = createTestRow({
      id: "unavail-1",
      label: "Unavailable",
      wireState: "working",
      availability: "unavailable",
    });
    const rows = [unavailableRow];

    expect(filterTraditionalTerminalAgentRows(rows, "Working")).toHaveLength(0);
    const unavailableFiltered = filterTraditionalTerminalAgentRows(rows, "Unavailable");
    expect(unavailableFiltered).toHaveLength(1);
    expect(unavailableFiltered[0]).toBe(unavailableRow);

    const counts = countTraditionalTerminalAgentsByStatus(rows);
    expect(counts.Working).toBe(0);
    expect(counts.Unavailable).toBe(1);
    expect(counts.all).toBe(1);
  });

  it("filters and counts platform unqualified and unsupported labels separately", () => {
    const platformUnqualifiedRow = createTestRow({
      id: "pq-1",
      label: "Platform unqualified",
      availability: "platform-unqualified",
    });
    const unsupportedRow = createTestRow({
      id: "unsupp-1",
      label: "Unsupported",
      availability: null,
    });
    const rows = [platformUnqualifiedRow, unsupportedRow];

    expect(filterTraditionalTerminalAgentRows(rows, "Platform unqualified")).toEqual([platformUnqualifiedRow]);
    expect(filterTraditionalTerminalAgentRows(rows, "Unsupported")).toEqual([unsupportedRow]);

    const counts = countTraditionalTerminalAgentsByStatus(rows);
    expect(counts["Platform unqualified"]).toBe(1);
    expect(counts.Unsupported).toBe(1);
    expect(counts.all).toBe(2);
  });

  it("keeps Idle with Done (turn ended) outcome in Idle", () => {
    const endedRow = createTestRow({
      id: "ended-1",
      label: "Idle",
      wireState: "idle",
      outcomeHint: "Done (turn ended)",
    });
    const rows = [endedRow];

    expect(filterTraditionalTerminalAgentRows(rows, "Idle")).toEqual([endedRow]);
    expect(filterTraditionalTerminalAgentRows(rows, "Needs attention")).toEqual([]);

    const counts = countTraditionalTerminalAgentsByStatus(rows);
    expect(counts.Idle).toBe(1);
    expect(counts["Needs attention"]).toBe(0);
  });
});

describe("needs attention reasons", () => {
  it("matches Needs attention for Approval, Question, Error, and null reasons", () => {
    const approvalRow = createTestRow({ id: "r-approval", label: "Needs attention", reasonLabel: "Approval", wireState: "blocked" });
    const questionRow = createTestRow({ id: "r-question", label: "Needs attention", reasonLabel: "Question", wireState: "blocked" });
    const errorRow = createTestRow({ id: "r-error", label: "Needs attention", reasonLabel: "Error", wireState: "blocked" });
    const nullReasonRow = createTestRow({ id: "r-null", label: "Needs attention", reasonLabel: null, wireState: "blocked" });

    const rows = [approvalRow, questionRow, errorRow, nullReasonRow];
    const filtered = filterTraditionalTerminalAgentRows(rows, "Needs attention");

    expect(filtered).toHaveLength(4);
    expect(filtered).toEqual([approvalRow, questionRow, errorRow, nullReasonRow]);
    expect(filtered[0]!.presentation.reasonLabel).toBe("Approval");
    expect(filtered[1]!.presentation.reasonLabel).toBe("Question");
    expect(filtered[2]!.presentation.reasonLabel).toBe("Error");
    expect(filtered[3]!.presentation.reasonLabel).toBeNull();
  });
});

describe("countTraditionalTerminalAgentsByStatus", () => {
  it("initializes all eight keys to zero for empty input", () => {
    const counts = countTraditionalTerminalAgentsByStatus([]);
    expect(counts).toEqual({
      all: 0,
      Working: 0,
      Idle: 0,
      "Needs attention": 0,
      Unknown: 0,
      Unavailable: 0,
      "Platform unqualified": 0,
      Unsupported: 0,
    });
  });

  it("counts all observed rows in a mixed roster with duplicates and verifies invariant", () => {
    const rows = [
      createTestRow({ id: "1", groupId: "A", label: "Working" }),
      createTestRow({ id: "2", groupId: "A", label: "Working" }),
      createTestRow({ id: "3", groupId: "B", label: "Working" }),
      createTestRow({ id: "4", groupId: "A", label: "Idle" }),
      createTestRow({ id: "5", groupId: "B", label: "Idle" }),
      createTestRow({ id: "6", groupId: "A", label: "Needs attention", reasonLabel: "Approval" }),
      createTestRow({ id: "7", groupId: "C", label: "Needs attention", reasonLabel: "Error" }),
      createTestRow({ id: "8", groupId: "A", label: "Unknown" }),
      createTestRow({ id: "9", groupId: "B", label: "Unavailable" }),
      createTestRow({ id: "10", groupId: "A", label: "Platform unqualified" }),
      createTestRow({ id: "11", groupId: "C", label: "Unsupported" }),
    ];

    const counts = countTraditionalTerminalAgentsByStatus(rows);

    expect(counts.Working).toBe(3);
    expect(counts.Idle).toBe(2);
    expect(counts["Needs attention"]).toBe(2);
    expect(counts.Unknown).toBe(1);
    expect(counts.Unavailable).toBe(1);
    expect(counts["Platform unqualified"]).toBe(1);
    expect(counts.Unsupported).toBe(1);

    expect(counts.all).toBe(rows.length);
    const sumOfStatuses =
      counts.Working +
      counts.Idle +
      counts["Needs attention"] +
      counts.Unknown +
      counts.Unavailable +
      counts["Platform unqualified"] +
      counts.Unsupported;
    expect(counts.all).toBe(sumOfStatuses);
  });

  it("tallies per agent rather than per group without grouping deduplication", () => {
    const rows = [
      createTestRow({ id: "a1", groupId: "alpha", label: "Working" }),
      createTestRow({ id: "a2", groupId: "alpha", label: "Working" }),
      createTestRow({ id: "a3", groupId: "alpha", label: "Working" }),
    ];

    const counts = countTraditionalTerminalAgentsByStatus(rows);
    expect(counts.Working).toBe(3);
    expect(counts.all).toBe(3);
  });

  it("does not mutate input rows array or row elements", () => {
    const row1 = Object.freeze(createTestRow({ id: "1", label: "Working" }));
    const row2 = Object.freeze(createTestRow({ id: "2", label: "Idle" }));
    const rows = Object.freeze([row1, row2]);

    expect(() => countTraditionalTerminalAgentsByStatus(rows)).not.toThrow();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(row1);
  });
});
