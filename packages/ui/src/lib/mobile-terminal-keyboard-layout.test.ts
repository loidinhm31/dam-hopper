import { describe, expect, it } from "vitest";
import {
  CUSTOM_MOBILE_TERMINAL_KEY_ROWS,
  CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS,
  getCustomMobileTerminalKeySequence,
  type CustomMobileTerminalKey,
} from "./mobile-terminal-keyboard-layout.js";

function findKey(id: string): CustomMobileTerminalKey {
  const key = [
    ...CUSTOM_MOBILE_TERMINAL_KEY_ROWS,
    ...CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS,
  ]
    .flat()
    .find((candidate) => candidate.id === id);
  if (!key) throw new Error(`missing key: ${id}`);
  return key;
}

describe("mobile-terminal-keyboard-layout", () => {
  it("exports compact letter and symbol rows", () => {
    expect(CUSTOM_MOBILE_TERMINAL_KEY_ROWS[0].map((key) => key.label)).toEqual([
      "q",
      "w",
      "e",
      "r",
      "t",
      "y",
      "u",
      "i",
      "o",
      "p",
    ]);
    expect(CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS[0].map((key) => key.label)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    );
  });

  it("maps printable keys with shift and ctrl modifiers", () => {
    const a = findKey("text-a");
    expect(
      getCustomMobileTerminalKeySequence(a, { shift: false, ctrl: false }),
    ).toBe("a");
    expect(
      getCustomMobileTerminalKeySequence(a, { shift: true, ctrl: false }),
    ).toBe("A");
    expect(
      getCustomMobileTerminalKeySequence(a, { shift: false, ctrl: true }),
    ).toBe("\x01");
  });

  it("maps terminal control keys to sequences", () => {
    expect(
      getCustomMobileTerminalKeySequence(findKey("escape"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("\x1b");
    expect(
      getCustomMobileTerminalKeySequence(findKey("tab"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("\t");
    expect(
      getCustomMobileTerminalKeySequence(findKey("enter"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("\r");
    expect(
      getCustomMobileTerminalKeySequence(findKey("backspace"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("\x7f");
    expect(
      getCustomMobileTerminalKeySequence(findKey("up"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("\x1b[A");
  });
});
