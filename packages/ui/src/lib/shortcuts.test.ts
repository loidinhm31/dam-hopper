import { describe, expect, it } from "vitest";
import {
  DoubleShiftDetector,
  displayShortcut,
  formatShortcut,
  matchesKeyboardShortcut,
  matchesNewTerminalShortcut,
  matchesWheelShortcut,
  parseShortcut,
  shortcutFromKeyboardEvent,
  validateShortcut,
  type ShortcutKeyEvent,
} from "./shortcuts.js";

function key(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    code: "KeyF",
    key: "f",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("shortcuts", () => {
  it("parses and formats keyboard, wheel, and DoubleShift shortcuts", () => {
    expect(formatShortcut("mod+shift+f")).toBe("Mod+Shift+KeyF");
    expect(formatShortcut("ctrl+shift+keyq")).toBe("Ctrl+Shift+KeyQ");
    expect(formatShortcut("alt+digit7")).toBe("Alt+Digit7");
    expect(formatShortcut("mod+shift+backquote")).toBe("Mod+Shift+Backquote");
    expect(formatShortcut("alt+f1")).toBe("Alt+F1");
    expect(parseShortcut("Mod+Wheel")?.kind).toBe("wheel");
    expect(formatShortcut("DoubleShift")).toBe("DoubleShift");
  });

  it("displays Mod platform-aware", () => {
    expect(displayShortcut("Mod+Shift+KeyF", false)).toBe("Ctrl+Shift+F");
    expect(displayShortcut("Mod+Shift+KeyF", true)).toBe("Cmd+Shift+F");
    expect(displayShortcut("Mod+Shift+Backquote", false)).toBe(
      "Ctrl+Shift+Backquote",
    );
    expect(displayShortcut("Alt+F1", false)).toBe("Alt+F1");
  });

  it("validates wheel modifiers", () => {
    expect(validateShortcut("Wheel")).toBe(
      "Wheel shortcut requires a modifier",
    );
    expect(validateShortcut("Mod+Wheel")).toBeNull();
  });

  it("matches Mod keyboard shortcuts exactly and suppresses repeats/composition", () => {
    expect(
      matchesKeyboardShortcut(
        "Mod+Shift+KeyF",
        key({ ctrlKey: true, shiftKey: true }),
        false,
      ),
    ).toBe(true);
    expect(
      matchesKeyboardShortcut(
        "Mod+Shift+KeyF",
        key({ ctrlKey: true, shiftKey: true, altKey: true }),
        false,
      ),
    ).toBe(false);
    expect(
      matchesKeyboardShortcut(
        "Mod+Shift+KeyF",
        key({ ctrlKey: true, shiftKey: true, repeat: true }),
        false,
      ),
    ).toBe(false);
    expect(
      matchesKeyboardShortcut(
        "Mod+Shift+KeyF",
        key({ ctrlKey: true, shiftKey: true, isComposing: true }),
        false,
      ),
    ).toBe(false);
  });

  it("matches new terminal shortcut exactly", () => {
    expect(
      matchesNewTerminalShortcut(key({ code: "Backquote", ctrlKey: true })),
    ).toBe(true);
    expect(
      matchesNewTerminalShortcut(
        key({ code: "Backquote", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      matchesNewTerminalShortcut(
        key({ code: "Backquote", ctrlKey: true, altKey: true }),
      ),
    ).toBe(false);
    expect(
      matchesNewTerminalShortcut(
        key({ code: "Backquote", ctrlKey: true, metaKey: true }),
      ),
    ).toBe(false);
    expect(
      matchesNewTerminalShortcut(key({ code: "KeyF", ctrlKey: true })),
    ).toBe(false);
  });

  it("matches Mod+Wheel by platform", () => {
    expect(
      matchesWheelShortcut(
        "Mod+Wheel",
        { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
        false,
      ),
    ).toBe(true);
    expect(
      matchesWheelShortcut(
        "Mod+Wheel",
        { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false },
        true,
      ),
    ).toBe(true);
  });

  it("detects DoubleShift within timing and ignores repeat/composition", () => {
    const detector = new DoubleShiftDetector(400);
    expect(
      detector.match(
        key({ key: "Shift", code: "ShiftLeft", shiftKey: true }),
        1000,
      ),
    ).toBe(false);
    expect(
      detector.match(
        key({ key: "Shift", code: "ShiftLeft", shiftKey: true, repeat: true }),
        1100,
      ),
    ).toBe(false);
    expect(
      detector.match(
        key({ key: "Shift", code: "ShiftLeft", shiftKey: true }),
        1200,
      ),
    ).toBe(true);

    expect(
      detector.match(
        key({
          key: "Shift",
          code: "ShiftLeft",
          shiftKey: true,
          isComposing: true,
        }),
        1300,
      ),
    ).toBe(false);
  });

  it("creates canonical keyboard shortcuts from key events", () => {
    expect(
      shortcutFromKeyboardEvent(
        key({ code: "KeyP", key: "p", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("Ctrl+Shift+KeyP");
  });
});
