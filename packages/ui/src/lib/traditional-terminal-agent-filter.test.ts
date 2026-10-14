import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import type {
  TraditionalAgentStatusLabel,
  TraditionalTerminalAgentRow,
} from "./traditional-terminal-agents.js";
import {
  CANONICAL_STATUS_ORDER,
  CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS,
  TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
  countTraditionalTerminalAgentsByStatus,
  filterTraditionalTerminalAgentRows,
  formatTraditionalAgentStatusFilter,
  isTraditionalAgentStatusFilter,
  isTraditionalAgentStatusLabel,
  loadTraditionalTerminalAgentFilter,
  normalizeTraditionalAgentStatusFilter,
  saveTraditionalTerminalAgentFilter,
  type TraditionalAgentStatusCountKey,
  type TraditionalAgentStatusFilter,
  type TraditionalAgentStatusSelection,
  type TraditionalTerminalAgentStatusCounts,
} from "./traditional-terminal-agent-filter.js";

const PRIMARY_LABELS: readonly TraditionalAgentStatusLabel[] = [
  "Needs attention",
  "Working",
  "Idle",
  "Unknown",
  "Unavailable",
  "Platform unqualified",
  "Unsupported",
] as const;

function createMapStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(initial ? Object.entries(initial) : []);
  return {
    map,
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    clear: vi.fn(() => {
      map.clear();
    }),
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
  const wireState =
    options.wireState ??
    (label === "Working"
      ? "working"
      : label === "Idle"
        ? "idle"
        : label === "Needs attention"
          ? "blocked"
          : "unknown");

  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 1 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 1,
    groupId,
    projectLabel: options.projectLabel ?? `Project ${groupId}`,
    profileLabel:
      options.profileLabel ??
      (options.profileId ? `Profile ${options.profileId}` : "Default Profile"),
    terminalTitle: `Terminal ${options.id}`,
    harnessLabel,
    statusOwner: { profileId, generation: 1 },
    availability:
      options.availability === undefined ? "ready" : options.availability,
    status: {
      id: `agent-${options.id}`,
      incarnation: 1,
      agentKind: harnessLabel.toLowerCase() as "omp" | "codex" | "claude",
      agentSessionId: `agent-session-${options.id}`,
      reporterEpoch: 1,
      state: wireState,
      source: "lifecycle",
      attentionRevision: 1,
      reason:
        options.reasonLabel === "Approval"
          ? "approval"
          : options.reasonLabel === "Question"
            ? "question"
            : options.reasonLabel === "Error"
              ? "error"
              : undefined,
      lastOutcome:
        options.outcomeHint === "Done (turn ended)" ? "ended" : undefined,
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

describe("type and canonical constants contracts", () => {
  it("defines 7 canonical statuses in exact prioritized order", () => {
    expect(CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS).toEqual([
      "Needs attention",
      "Working",
      "Idle",
      "Unknown",
      "Unavailable",
      "Platform unqualified",
      "Unsupported",
    ]);
    expect(CANONICAL_STATUS_ORDER).toBe(CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS);
  });

  it("verifies type assignment contracts for count keys, counts, and selections", () => {
    const key: TraditionalAgentStatusCountKey = "Working";
    const counts: TraditionalTerminalAgentStatusCounts = {
      all: 1,
      Working: 1,
      Idle: 0,
      "Needs attention": 0,
      Unknown: 0,
      Unavailable: 0,
      "Platform unqualified": 0,
      Unsupported: 0,
    };
    const selection: TraditionalAgentStatusSelection = ["Working"];
    const allSelection: TraditionalAgentStatusSelection = "all";
    const filterFromSelection: TraditionalAgentStatusFilter = selection;
    const filterFromScalar: TraditionalAgentStatusFilter = "Idle";

    expect(key).toBe("Working");
    expect(counts.all).toBe(1);
    expect(selection).toEqual(["Working"]);
    expect(allSelection).toBe("all");
    expect(filterFromSelection).toEqual(["Working"]);
    expect(filterFromScalar).toBe("Idle");
  });
});

describe("isTraditionalAgentStatusLabel", () => {
  it("accepts all 7 canonical status labels", () => {
    for (const label of PRIMARY_LABELS) {
      expect(isTraditionalAgentStatusLabel(label)).toBe(true);
    }
  });

  it("rejects 'all' and invalid strings", () => {
    for (const invalid of ["all", "working", "idle", "needs attention", "", "unknown-status"]) {
      expect(isTraditionalAgentStatusLabel(invalid)).toBe(false);
    }
  });

  it("rejects non-string values", () => {
    for (const invalid of [null, undefined, 123, true, {}, []]) {
      expect(isTraditionalAgentStatusLabel(invalid)).toBe(false);
    }
  });
});

describe("isTraditionalAgentStatusFilter", () => {
  it("accepts 'all', each status label, and valid status label arrays", () => {
    expect(isTraditionalAgentStatusFilter("all")).toBe(true);
    for (const label of PRIMARY_LABELS) {
      expect(isTraditionalAgentStatusFilter(label)).toBe(true);
    }
    expect(isTraditionalAgentStatusFilter(["Working"])).toBe(true);
    expect(isTraditionalAgentStatusFilter(["Needs attention", "Working", "Idle"])).toBe(true);
    expect(isTraditionalAgentStatusFilter([])).toBe(true);
  });

  it("rejects non-filter strings and arrays with invalid elements", () => {
    expect(isTraditionalAgentStatusFilter("invalid")).toBe(false);
    expect(isTraditionalAgentStatusFilter("working")).toBe(false);
    expect(isTraditionalAgentStatusFilter(["all"])).toBe(false);
    expect(isTraditionalAgentStatusFilter(["Working", "invalid"])).toBe(false);
    expect(isTraditionalAgentStatusFilter(["Working", null])).toBe(false);
  });

  it("rejects non-string, non-array types", () => {
    for (const invalid of [undefined, null, true, false, 0, 1, {}, () => "all", Symbol("all")]) {
      expect(isTraditionalAgentStatusFilter(invalid)).toBe(false);
    }
  });
});

describe("normalizeTraditionalAgentStatusFilter", () => {
  it("returns 'all' when input is 'all'", () => {
    expect(normalizeTraditionalAgentStatusFilter("all")).toBe("all");
  });

  it("normalizes a valid scalar status label into a singleton array", () => {
    for (const label of PRIMARY_LABELS) {
      expect(normalizeTraditionalAgentStatusFilter(label)).toEqual([label]);
    }
  });

  it("returns 'all' for invalid string inputs or non-string/non-array types", () => {
    const invalidInputs = [
      "",
      "   ",
      "working",
      "blocked",
      "invalid-label",
      null,
      undefined,
      123,
      true,
      {},
      { label: "Working" },
    ];
    for (const input of invalidInputs) {
      expect(normalizeTraditionalAgentStatusFilter(input)).toBe("all");
    }
  });

  it("returns 'all' for empty arrays", () => {
    expect(normalizeTraditionalAgentStatusFilter([])).toBe("all");
  });

  it("returns 'all' when all 7 canonical statuses are provided", () => {
    expect(normalizeTraditionalAgentStatusFilter(PRIMARY_LABELS)).toBe("all");
  });

  it("returns 'all' when all 7 canonical statuses are provided in scrambled order with duplicates", () => {
    const scrambled = [
      "Unsupported",
      "Working",
      "Needs attention",
      "Working",
      "Platform unqualified",
      "Idle",
      "Unavailable",
      "Unknown",
    ];
    expect(normalizeTraditionalAgentStatusFilter(scrambled)).toBe("all");
  });

  it("preserves singleton array selections", () => {
    expect(normalizeTraditionalAgentStatusFilter(["Working"])).toEqual(["Working"]);
    expect(normalizeTraditionalAgentStatusFilter(["Needs attention"])).toEqual([
      "Needs attention",
    ]);
  });

  it("sorts multiple valid labels into canonical order regardless of input order", () => {
    const input = ["Unsupported", "Working", "Needs attention", "Idle"];
    const expected = ["Needs attention", "Working", "Idle", "Unsupported"];
    expect(normalizeTraditionalAgentStatusFilter(input)).toEqual(expected);
  });

  it("deduplicates repeated valid labels", () => {
    const input = ["Working", "Working", "Needs attention", "Working", "Needs attention"];
    expect(normalizeTraditionalAgentStatusFilter(input)).toEqual([
      "Needs attention",
      "Working",
    ]);
  });

  it("filters out invalid labels and keeps valid labels in canonical order", () => {
    const input = ["invalid-1", "Idle", "working", "Needs attention", null as unknown as string];
    expect(normalizeTraditionalAgentStatusFilter(input)).toEqual([
      "Needs attention",
      "Idle",
    ]);
  });

  it("returns 'all' when array contains only invalid elements", () => {
    expect(normalizeTraditionalAgentStatusFilter(["invalid", "wrong", 123 as unknown as string])).toBe("all");
  });

  it("leaves frozen input arrays untouched", () => {
    const frozenInput = Object.freeze(["Idle", "Working"]);
    expect(() => normalizeTraditionalAgentStatusFilter(frozenInput)).not.toThrow();
    expect(normalizeTraditionalAgentStatusFilter(frozenInput)).toEqual(["Working", "Idle"]);
  });
});

describe("loadTraditionalTerminalAgentFilter", () => {
  it("matches the exact canonical storage key string", () => {
    expect(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY).toBe(
      "dam-hopper:traditional-terminal-agents-status-filter",
    );
  });

  it("loads 'all' unchanged", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: "all",
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");
    expect(storage.getItem).toHaveBeenCalledWith(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY);
  });

  it("loads legacy scalar strings as normalized singleton selections", () => {
    for (const label of PRIMARY_LABELS) {
      const storage = createMapStorage({
        [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: label,
      });
      expect(loadTraditionalTerminalAgentFilter(storage)).toEqual([label]);
    }
  });

  it("loads serialized JSON arrays of multiple statuses in canonical order", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: JSON.stringify(["Idle", "Working"]),
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Working", "Idle"]);
  });

  it("loads JSON arrays wrapped in whitespace", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: '   ["Needs attention", "Working"]   ',
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Needs attention", "Working"]);
  });

  it("loads serialized JSON array with all 7 statuses as 'all'", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: JSON.stringify(PRIMARY_LABELS),
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");
  });

  it("loads serialized JSON array with single status as singleton selection", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: JSON.stringify(["Working"]),
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Working"]);
  });

  it("loads serialized JSON array with invalid elements filtered out", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: JSON.stringify(["Working", "invalid"]),
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Working"]);
  });

  it("falls back to 'all' when storage entry is missing", () => {
    const storage = createMapStorage();
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");
    expect(storage.getItem).toHaveBeenCalledWith(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY);
  });

  it.each([
    "",
    "   ",
    "working",
    "blocked",
    "Done (turn ended)",
    '"all"',
    '"Working"',
    '{"filter":"Working"}',
    "unknown-status",
    "[corrupt-json",
    "[]",
    '["invalid-status"]',
  ])("falls back to 'all' for corrupt or invalid stored value: %s", (corrupt) => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: corrupt,
    });
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");
  });

  it("never writes, modifies, or deletes storage entries when loading valid preferences", () => {
    const storage = createMapStorage({
      [TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY]: "Working",
      "unrelated-key": "preserve-me",
    });
    const result = loadTraditionalTerminalAgentFilter(storage);
    expect(result).toEqual(["Working"]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.map.get("unrelated-key")).toBe("preserve-me");
    expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe("Working");
  });

  it("never writes, modifies, or deletes storage entries when loading corrupt data", () => {
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
        get() {
          throw new Error("SecurityError: storage access denied");
        },
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
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error("Hardware I/O error");
      }),
    };
    expect(loadTraditionalTerminalAgentFilter(throwingStorage)).toBe("all");
  });

  it("does not throw when injected storage setItem throws", () => {
    const throwingStorage = {
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
    };
    expect(() => saveTraditionalTerminalAgentFilter("Working", throwingStorage)).not.toThrow();
  });

  it("allows injected storage to function independently of broken global storage", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
          throw new Error("Blocked");
        },
      });
      const injected = createMapStorage();
      saveTraditionalTerminalAgentFilter("Idle", injected);
      expect(loadTraditionalTerminalAgentFilter(injected)).toEqual(["Idle"]);
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
  it("persists 'all' as scalar string 'all'", () => {
    const storage = createMapStorage();
    saveTraditionalTerminalAgentFilter("all", storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
      "all",
    );
    expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe("all");
  });

  it("persists each scalar status label as a scalar string", () => {
    for (const label of PRIMARY_LABELS) {
      const storage = createMapStorage();
      saveTraditionalTerminalAgentFilter(label, storage);
      expect(storage.setItem).toHaveBeenCalledWith(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        label,
      );
      expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe(label);
    }
  });

  it("persists singleton array selections as scalar strings", () => {
    for (const label of PRIMARY_LABELS) {
      const storage = createMapStorage();
      saveTraditionalTerminalAgentFilter([label], storage);
      expect(storage.setItem).toHaveBeenCalledWith(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        label,
      );
      expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe(label);
    }
  });

  it("persists multi-status arrays as canonical JSON array strings", () => {
    const storage = createMapStorage();
    saveTraditionalTerminalAgentFilter(["Idle", "Working"], storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
      JSON.stringify(["Working", "Idle"]),
    );
    expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe(
      JSON.stringify(["Working", "Idle"]),
    );
  });

  it("persists mixed valid and invalid arrays by preserving valid labels", () => {
    const storage = createMapStorage();
    saveTraditionalTerminalAgentFilter(
      ["Working", "invalid" as unknown as TraditionalAgentStatusLabel],
      storage,
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
      "Working",
    );
  });

  it("normalizes and stores 'all' when saving all 7 statuses", () => {
    const storage = createMapStorage();
    saveTraditionalTerminalAgentFilter(PRIMARY_LABELS, storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
      "all",
    );
    expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe("all");
  });

  it("normalizes and stores 'all' when saving empty array or invalid inputs", () => {
    const invalidInputs = [
      [],
      "invalid-filter" as TraditionalAgentStatusFilter,
      null as unknown as TraditionalAgentStatusFilter,
    ];
    for (const input of invalidInputs) {
      const storage = createMapStorage();
      saveTraditionalTerminalAgentFilter(input, storage);
      expect(storage.setItem).toHaveBeenCalledWith(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        "all",
      );
      expect(storage.map.get(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY)).toBe("all");
    }
  });

  it("round trips saved values through loadTraditionalTerminalAgentFilter", () => {
    const storage = createMapStorage();

    saveTraditionalTerminalAgentFilter("all", storage);
    expect(loadTraditionalTerminalAgentFilter(storage)).toBe("all");

    saveTraditionalTerminalAgentFilter("Working", storage);
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Working"]);

    saveTraditionalTerminalAgentFilter(["Working"], storage);
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Working"]);

    saveTraditionalTerminalAgentFilter(["Idle", "Working"], storage);
    expect(loadTraditionalTerminalAgentFilter(storage)).toEqual(["Working", "Idle"]);
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
    const rows = [
      createTestRow({ id: "1", label: "Working" }),
      createTestRow({ id: "2", label: "Idle" }),
    ];
    expect(filterTraditionalTerminalAgentRows(rows, "all")).toBe(rows);
  });

  it("returns input array identity on empty input with 'all'", () => {
    const rows: readonly TraditionalTerminalAgentRow[] = [];
    expect(filterTraditionalTerminalAgentRows(rows, "all")).toBe(rows);
  });

  it("returns empty array when filtering empty input with specific status", () => {
    const rows: readonly TraditionalTerminalAgentRow[] = [];
    expect(filterTraditionalTerminalAgentRows(rows, "Working")).toEqual([]);
    expect(filterTraditionalTerminalAgentRows(rows, ["Working"])).toEqual([]);
  });

  it("filters correctly for each primary label with scalar filter", () => {
    const rows = PRIMARY_LABELS.map((label, idx) =>
      createTestRow({ id: `row-${idx}`, label }),
    );
    for (const label of PRIMARY_LABELS) {
      const filtered = filterTraditionalTerminalAgentRows(rows, label);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.presentation.label).toBe(label);
    }
  });

  it("filters correctly with singleton array filter", () => {
    const rows = PRIMARY_LABELS.map((label, idx) =>
      createTestRow({ id: `row-${idx}`, label }),
    );
    for (const label of PRIMARY_LABELS) {
      const filtered = filterTraditionalTerminalAgentRows(rows, [label]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.presentation.label).toBe(label);
    }
  });

  it("filters union of multiple statuses with array filter", () => {
    const rows = [
      createTestRow({ id: "1", label: "Working" }),
      createTestRow({ id: "2", label: "Idle" }),
      createTestRow({ id: "3", label: "Needs attention" }),
      createTestRow({ id: "4", label: "Unknown" }),
    ];
    const filtered = filterTraditionalTerminalAgentRows(rows, ["Working", "Needs attention"]);
    expect(filtered).toHaveLength(2);
    expect(filtered[0]!.key).toBeDefined();
    expect(filtered.map((r) => r.presentation.label)).toEqual(["Working", "Needs attention"]);
  });

  it("returns empty array when no rows match the filter", () => {
    const rows = [
      createTestRow({ id: "1", label: "Working" }),
      createTestRow({ id: "2", label: "Idle" }),
    ];
    expect(filterTraditionalTerminalAgentRows(rows, "Unavailable")).toEqual([]);
    expect(filterTraditionalTerminalAgentRows(rows, ["Unavailable", "Unknown"])).toEqual([]);
  });

  it("returns empty array when filter is empty array []", () => {
    const rows = [createTestRow({ id: "1", label: "Working" })];
    expect(filterTraditionalTerminalAgentRows(rows, [])).toEqual([]);
  });

  it("preserves input order and exact object identities across projects, profiles, and harnesses", () => {
    const row1 = createTestRow({
      id: "1",
      profileId: "prof-1",
      groupId: "proj-A",
      harnessLabel: "OMP",
      label: "Working",
    });
    const row2 = createTestRow({
      id: "2",
      profileId: "prof-2",
      groupId: "proj-B",
      harnessLabel: "Codex",
      label: "Idle",
    });
    const row3 = createTestRow({
      id: "3",
      profileId: "prof-2",
      groupId: "proj-A",
      harnessLabel: "Claude",
      label: "Working",
    });
    const row4 = createTestRow({
      id: "4",
      profileId: "prof-3",
      groupId: "proj-C",
      harnessLabel: "OMP",
      label: "Needs attention",
    });

    const rows = [row1, row2, row3, row4];
    const filtered = filterTraditionalTerminalAgentRows(rows, [
      "Working",
      "Needs attention",
    ]);

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
    const working = filterTraditionalTerminalAgentRows(rows, ["Working"]);
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

  it("filters and counts platform unqualified and unsupported labels separately and in union", () => {
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

    expect(filterTraditionalTerminalAgentRows(rows, "Platform unqualified")).toEqual([
      platformUnqualifiedRow,
    ]);
    expect(filterTraditionalTerminalAgentRows(rows, "Unsupported")).toEqual([unsupportedRow]);
    expect(
      filterTraditionalTerminalAgentRows(rows, [
        "Platform unqualified",
        "Unsupported",
      ]),
    ).toEqual([platformUnqualifiedRow, unsupportedRow]);

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
    const approvalRow = createTestRow({
      id: "r-approval",
      label: "Needs attention",
      reasonLabel: "Approval",
      wireState: "blocked",
    });
    const questionRow = createTestRow({
      id: "r-question",
      label: "Needs attention",
      reasonLabel: "Question",
      wireState: "blocked",
    });
    const errorRow = createTestRow({
      id: "r-error",
      label: "Needs attention",
      reasonLabel: "Error",
      wireState: "blocked",
    });
    const nullReasonRow = createTestRow({
      id: "r-null",
      label: "Needs attention",
      reasonLabel: null,
      wireState: "blocked",
    });

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

describe("formatTraditionalAgentStatusFilter", () => {
  it("formats 'all' as 'All statuses'", () => {
    expect(formatTraditionalAgentStatusFilter("all")).toBe("All statuses");
  });

  it("formats scalar status label as itself", () => {
    for (const label of PRIMARY_LABELS) {
      expect(formatTraditionalAgentStatusFilter(label)).toBe(label);
    }
  });

  it("formats singleton array as status label", () => {
    expect(formatTraditionalAgentStatusFilter(["Working"])).toBe("Working");
  });

  it("formats multiple status array as comma-separated labels", () => {
    expect(formatTraditionalAgentStatusFilter(["Working", "Idle"])).toBe(
      "Working, Idle",
    );
    expect(
      formatTraditionalAgentStatusFilter(["Needs attention", "Working", "Idle"]),
    ).toBe("Needs attention, Working, Idle");
  });

  it("formats empty array directly as empty string", () => {
    expect(formatTraditionalAgentStatusFilter([])).toBe("");
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
      createTestRow({
        id: "6",
        groupId: "A",
        label: "Needs attention",
        reasonLabel: "Approval",
      }),
      createTestRow({
        id: "7",
        groupId: "C",
        label: "Needs attention",
        reasonLabel: "Error",
      }),
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
