import { describe, expect, it } from "vitest";
import { getTerminalSuggestionCapability } from "./terminal-suggestion-capability.js";

describe("terminal suggestion capability", () => {
  it("fails closed until a verified shell lifecycle is available", () => {
    expect(getTerminalSuggestionCapability()).toBe("unavailable");
  });
});
