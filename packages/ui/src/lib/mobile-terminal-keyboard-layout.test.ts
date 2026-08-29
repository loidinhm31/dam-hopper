import { describe, expect, it } from "vitest";
import {
  CUSTOM_MOBILE_TERMINAL_KEY_ROWS,
  CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS,
  getCustomMobileTerminalKeyAriaLabel,
  getCustomMobileTerminalKeyLabel,
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

function findKeyInRows(
  rows: CustomMobileTerminalKey[][],
  id: string,
): CustomMobileTerminalKey {
  const key = rows.flat().find((candidate) => candidate.id === id);
  if (!key) throw new Error(`missing key: ${id}`);
  return key;
}

describe("mobile-terminal-keyboard-layout", () => {
  it("exports the physical US 60 percent row order", () => {
    expect(
      CUSTOM_MOBILE_TERMINAL_KEY_ROWS.map((row) => row.map((key) => key.label)),
    ).toEqual([
      [
        "Esc",
        "`~",
        "1!",
        "2@",
        "3#",
        "4$",
        "5%",
        "6^",
        "7&",
        "8*",
        "9(",
        "0)",
        "-_",
        "=+",
        "Backspace",
      ],
      [
        "Tab",
        "Q",
        "W",
        "E",
        "R",
        "T",
        "Y",
        "U",
        "I",
        "O",
        "P",
        "[{",
        "]}",
        "\\|",
        "Enter",
      ],
      ["Caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";:", "'\""],
      ["Shift", "Z", "X", "C", "V", "B", "N", "M", ",<", ".>", "/?", "Shift"],
      ["Ctrl", "Win", "Alt", "Space", "Alt", "Fn", "↑", "←", "↓", "→"],
    ]);
    expect(findKey("backspace").units).toBe(2);
    expect(findKey("enter").units).toBe(1.75);
    expect(findKey("up").cluster).toBe("arrows");
  });

  it("shows shifted punctuation when Shift is active", () => {
    expect(getCustomMobileTerminalKeyLabel(findKey("text-1"), false)).toBe(
      "1!",
    );
    expect(getCustomMobileTerminalKeyLabel(findKey("text-1"), true)).toBe("!");
    expect(getCustomMobileTerminalKeyLabel(findKey("text-["), true)).toBe("{");
    expect(getCustomMobileTerminalKeyLabel(findKey("text-a"), true)).toBe("A");
    expect(
      getCustomMobileTerminalKeyAriaLabel(findKey("text-1"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("Send 1");
    expect(
      getCustomMobileTerminalKeyAriaLabel(findKey("text-1"), {
        shift: true,
        ctrl: false,
      }),
    ).toBe("Send exclamation mark");
  });

  it("maps shifted, caps, ctrl, and alt text modifiers", () => {
    const a = findKey("text-a");
    expect(
      getCustomMobileTerminalKeySequence(a, { shift: false, ctrl: false }),
    ).toBe("a");
    expect(
      getCustomMobileTerminalKeySequence(a, { shift: true, ctrl: false }),
    ).toBe("A");
    expect(
      getCustomMobileTerminalKeySequence(a, {
        shift: false,
        ctrl: false,
        caps: true,
      }),
    ).toBe("A");
    expect(
      getCustomMobileTerminalKeySequence(a, {
        shift: true,
        ctrl: false,
        caps: true,
      }),
    ).toBe("a");
    expect(
      getCustomMobileTerminalKeySequence(findKey("text-1"), {
        shift: true,
        ctrl: false,
      }),
    ).toBe("!");
    expect(
      getCustomMobileTerminalKeySequence(a, {
        shift: false,
        ctrl: false,
        alt: true,
      }),
    ).toBe("\x1ba");
    expect(
      getCustomMobileTerminalKeySequence(a, { shift: false, ctrl: true }),
    ).toBe("\x01");
    expect(
      getCustomMobileTerminalKeyAriaLabel(a, {
        shift: false,
        ctrl: true,
      }),
    ).toBe("Send Ctrl+A");
    expect(
      getCustomMobileTerminalKeyAriaLabel(a, {
        shift: true,
        ctrl: false,
        alt: true,
      }),
    ).toBe("Send Alt+A");
  });

  it("keeps Enter, Backspace, and navigation sequences on both layers", () => {
    for (const rows of [
      CUSTOM_MOBILE_TERMINAL_KEY_ROWS,
      CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS,
    ]) {
      expect(
        getCustomMobileTerminalKeySequence(findKeyInRows(rows, "enter"), {
          shift: false,
          ctrl: false,
        }),
      ).toBe("\r");
      expect(
        getCustomMobileTerminalKeySequence(findKeyInRows(rows, "backspace"), {
          shift: false,
          ctrl: false,
        }),
      ).toBe("\x7f");
    }
    expect(
      getCustomMobileTerminalKeySequence(findKey("right"), {
        shift: false,
        ctrl: false,
      }),
    ).toBe("\x1b[C");
  });

  it("keeps the function layer toggle and physical navigation affordances", () => {
    expect(CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS[0]?.[0]).toMatchObject({
      id: "symbols",
      label: "ABC",
      title: "Show Letters",
    });
    expect(
      CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS.flat().some(
        (key) => key.id === "page-up" || key.id === "page-down",
      ),
    ).toBe(true);
    expect(
      CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS.flat().filter(
        (key) => key.cluster === "arrows",
      ),
    ).toHaveLength(4);
  });
});
