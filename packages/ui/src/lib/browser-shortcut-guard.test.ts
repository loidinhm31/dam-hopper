import { describe, expect, it } from "vitest";
import { shouldSuppressBrowserShortcut } from "./browser-shortcut-guard.js";

function keydown(
  overrides: Partial<KeyboardEvent> & { code: string },
): KeyboardEvent {
  return {
    type: "keydown",
    key: overrides.code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("shouldSuppressBrowserShortcut", () => {
  it("blocks denylisted browser and devtools shortcuts", () => {
    expect(shouldSuppressBrowserShortcut(keydown({ code: "F12" }))).toBe(true);
    expect(
      shouldSuppressBrowserShortcut(
        keydown({ code: "KeyI", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressBrowserShortcut(keydown({ code: "KeyP", ctrlKey: true })),
    ).toBe(true);
  });

  it("preserves terminal copy when focus is inside xterm", () => {
    expect(
      shouldSuppressBrowserShortcut(
        keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }),
        { closest: () => ({}) } as unknown as EventTarget,
      ),
    ).toBe(false);
  });

  it("suppresses terminal copy outside xterm", () => {
    expect(
      shouldSuppressBrowserShortcut(
        keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });
});
