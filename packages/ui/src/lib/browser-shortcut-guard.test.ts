import { describe, expect, it } from "vitest";
import {
  getBrowserShortcutSuppression,
  shouldSuppressBrowserShortcut,
} from "./browser-shortcut-guard.js";

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
  it("allows F12 while blocking other denylisted browser shortcuts", () => {
    expect(shouldSuppressBrowserShortcut(keydown({ code: "F12" }))).toBe(false);
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
    const terminalTarget = { closest: () => ({}) } as unknown as EventTarget;

    expect(
      shouldSuppressBrowserShortcut(
        keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }),
        terminalTarget,
      ),
    ).toBe(true);
    expect(
      getBrowserShortcutSuppression(
        keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }),
        terminalTarget,
      ),
    ).toBe("prevent-default");
  });

  it("suppresses terminal copy outside xterm", () => {
    expect(
      shouldSuppressBrowserShortcut(
        keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      getBrowserShortcutSuppression(
        keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("block");
  });
});
