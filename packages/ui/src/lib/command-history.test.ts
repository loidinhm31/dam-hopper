import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  getHistory,
  isHistoryEnabled,
  recordCommand,
  searchHistory,
  setHistoryEnabled,
} from "./command-history.js";

const entriesKey = "dam-hopper:command-history";
const enabledKey = "dam-hopper:command-history-enabled";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("command history privacy", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("preserves exact commands without rewriting whitespace", () => {
    recordCommand("  git   commit -m 'keep spacing'  ", "web");

    expect(getHistory()).toEqual([
      expect.objectContaining({
        command: "  git   commit -m 'keep spacing'  ",
        project: "web",
        searchText: "  git   commit -m 'keep spacing'  ",
      }),
    ]);
  });

  it("does not record commands after local history is disabled", () => {
    setHistoryEnabled(false);
    recordCommand("sudo secret-command", "web");

    expect(isHistoryEnabled()).toBe(false);
    expect(getHistory()).toEqual([]);
    expect(localStorage.getItem(entriesKey)).toBeNull();
  });

  it("clears the actual history key without deleting the enabled preference", () => {
    recordCommand("pnpm test", "web");
    setHistoryEnabled(false);
    clearHistory();

    expect(localStorage.getItem(entriesKey)).toBeNull();
    expect(localStorage.getItem(enabledKey)).toBe("false");
  });

  it("fails closed when browser storage cannot be read", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(isHistoryEnabled()).toBe(false);
    recordCommand("must not persist", "web");
    expect(getHistory()).toEqual([]);
  });

  it("retains legacy records in memory until a verified command writes v2", () => {
    const legacy = [
      { command: "git status", lastUsedAt: 1, useCount: 1, project: "web" },
    ];
    localStorage.setItem(entriesKey, JSON.stringify(legacy));

    expect(getHistory()[0]).toMatchObject({
      command: "git status",
      id: expect.stringMatching(/^v2-/),
      projectUsage: { web: { lastUsedAt: 1, useCount: 1 } },
    });
    expect(localStorage.getItem(entriesKey)).toBe(JSON.stringify(legacy));

    recordCommand("git status", "api");
    expect(JSON.parse(localStorage.getItem(entriesKey) ?? "{}")).toMatchObject({
      version: 2,
      entries: [
        expect.objectContaining({
          projectUsage: expect.objectContaining({ api: expect.any(Object) }),
        }),
      ],
    });
  });

  it("ranks exact raw prefixes ahead of normalized token matches", () => {
    recordCommand("git status", "web");
    recordCommand("status --short", "web");
    recordCommand("git café", "web");

    expect(searchHistory("git s")[0]?.entry.command).toBe("git status");
    expect(searchHistory("CAFÉ")[0]?.entry.command).toBe("git café");
  });

  it("keeps usage for each project without changing exact command identity", () => {
    recordCommand("pnpm test", "web");
    recordCommand("pnpm test", "server");

    expect(getHistory()).toEqual([
      expect.objectContaining({
        command: "pnpm test",
        useCount: 2,
        projectUsage: expect.objectContaining({
          web: expect.any(Object),
          server: expect.any(Object),
        }),
      }),
    ]);
  });
});
