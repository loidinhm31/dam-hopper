import { describe, expect, it } from "vitest";
import { classifyTerminalSuggestionInput } from "./terminal-suggestion-input.js";

describe("classifyTerminalSuggestionInput", () => {
  it("allows one printable Unicode grapheme", () => {
    expect(classifyTerminalSuggestionInput("e\u0301")).toEqual({
      kind: "append",
      text: "e\u0301",
    });
  });

  it.each(["git", "\r", "\x1b[D"])(
    "fails closed for ambiguous terminal input %j",
    (input) =>
      expect(classifyTerminalSuggestionInput(input)).toEqual({
        kind: "ambiguous",
      }),
  );

  it.each(["\x7f", "\b"])("classifies %j as Backspace", (input) => {
    expect(classifyTerminalSuggestionInput(input)).toEqual({
      kind: "backspace",
    });
  });
});
