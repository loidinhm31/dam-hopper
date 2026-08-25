import { describe, expect, it } from "vitest";
import {
  canUseTerminalHistoryCommand,
  TerminalHistoryList,
} from "./TerminalHistoryList.js";

describe("TerminalHistoryList", () => {
  it("exports the explicit dialog workflow", () => {
    expect(typeof TerminalHistoryList).toBe("function");
  });

  it("allows Use only for one-line commands", () => {
    expect(canUseTerminalHistoryCommand("git status --short")).toBe(true);
    expect(canUseTerminalHistoryCommand("printf 'first\nsecond'")).toBe(false);
    expect(canUseTerminalHistoryCommand("first\rsecond")).toBe(false);
  });
});
