import { describe, expect, it } from "vitest";
import {
  getMobileTerminalKeySequence,
  MOBILE_TERMINAL_KEYS,
} from "./mobile-terminal-keys.js";

describe("mobile-terminal-keys", () => {
  it("maps terminal navigation keys to ANSI sequences", () => {
    expect(getMobileTerminalKeySequence("escape")).toBe("\x1b");
    expect(getMobileTerminalKeySequence("tab")).toBe("\t");
    expect(getMobileTerminalKeySequence("ctrl-c")).toBe("\x03");
    expect(getMobileTerminalKeySequence("page-up")).toBe("\x1b[5~");
    expect(getMobileTerminalKeySequence("page-down")).toBe("\x1b[6~");
    expect(getMobileTerminalKeySequence("up")).toBe("\x1b[A");
    expect(getMobileTerminalKeySequence("down")).toBe("\x1b[B");
    expect(getMobileTerminalKeySequence("left")).toBe("\x1b[D");
    expect(getMobileTerminalKeySequence("right")).toBe("\x1b[C");
  });

  it("exports a stable mobile keyboard layout", () => {
    expect(MOBILE_TERMINAL_KEYS.map((key) => key.id)).toEqual([
      "escape",
      "tab",
      "ctrl-c",
      "page-up",
      "page-down",
      "up",
      "left",
      "down",
      "right",
    ]);
  });
});
