import { describe, expect, it } from "vitest";
import { handleTerminalSuggestionInput } from "./use-terminal-suggestions.js";

describe("terminal suggestion containment", () => {
  it.each([
    "\t",
    "\r",
    "\x1b",
    "\x12",
    "\x1b[A",
    "\x1b[Z",
    "pasted command\nwith another line",
    "arbitrary\x00bytes",
  ])("forwards %j unchanged to the PTY", (data) => {
    expect(handleTerminalSuggestionInput(data)).toEqual({
      forward: true,
      data,
    });
  });
});
