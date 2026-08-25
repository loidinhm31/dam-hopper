import { describe, expect, it } from "vitest";
import {
  loadPinnedTerminalIds,
  retainPinnedTerminalIds,
  savePinnedTerminalIds,
  setPinnedTerminalId,
  TERMINAL_PIN_STORAGE_KEY,
  type TerminalPinStorage,
} from "./terminal-pin-persistence.js";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const api: TerminalPinStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  return { api, values };
}

describe("terminal pin persistence", () => {
  it("round-trips deduplicated terminal session IDs", () => {
    const { api, values } = storage();

    savePinnedTerminalIds(["free:one", "free:one", "run:web"], api);

    expect(loadPinnedTerminalIds(api)).toEqual(
      new Set(["free:one", "run:web"]),
    );
    expect(JSON.parse(values.get(TERMINAL_PIN_STORAGE_KEY)!)).toEqual({
      version: 1,
      sessionIds: ["free:one", "run:web"],
    });
  });

  it("removes the key when no IDs remain", () => {
    const { api, values } = storage({
      [TERMINAL_PIN_STORAGE_KEY]: "persisted",
    });

    savePinnedTerminalIds([], api);

    expect(values.has(TERMINAL_PIN_STORAGE_KEY)).toBe(false);
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, sessionIds: ["free:one"] }),
    JSON.stringify({ version: 1, sessionIds: ["free:one", 1] }),
    JSON.stringify({ version: 1, sessionIds: [""] }),
  ])("discards malformed stored data: %s", (payload) => {
    const { api, values } = storage({ [TERMINAL_PIN_STORAGE_KEY]: payload });

    expect(loadPinnedTerminalIds(api)).toEqual(new Set());
    expect(values.has(TERMINAL_PIN_STORAGE_KEY)).toBe(false);
  });

  it("fails open when browser storage throws", () => {
    const unavailable: TerminalPinStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(loadPinnedTerminalIds(unavailable)).toEqual(new Set());
    expect(() =>
      savePinnedTerminalIds(["free:one"], unavailable),
    ).not.toThrow();
  });

  it("retains pins only for live or pending sessions after reconciliation", () => {
    expect(
      retainPinnedTerminalIds(
        new Set(["free:live", "free:pending", "free:stale"]),
        new Set(["free:live", "free:pending"]),
      ),
    ).toEqual(new Set(["free:live", "free:pending"]));
  });

  it("returns the expected state for consecutive pin toggles", () => {
    const once = setPinnedTerminalId(new Set(), "free:one", true);
    const twice = setPinnedTerminalId(once, "free:one", false);

    expect(once).toEqual(new Set(["free:one"]));
    expect(twice).toEqual(new Set());
  });

  it("aligns persisted state with the latest visible pin state", () => {
    expect(
      setPinnedTerminalId(new Set(["free:one"]), "free:one", true),
    ).toEqual(new Set(["free:one"]));
    expect(
      setPinnedTerminalId(new Set(["free:one"]), "free:one", false),
    ).toEqual(new Set());
  });
});
