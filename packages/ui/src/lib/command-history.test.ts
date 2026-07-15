import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  getHistory,
  isHistoryEnabled,
  recordCommand,
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

});
