import { describe, expect, it } from "vitest";
import { getTerminalSuggestionSuffix } from "./terminal-suggestion-acceptance.js";
import type { TerminalSuggestionSnapshot } from "./terminal-suggestion-controller.js";

function snapshot(
  rawInput: string,
  command: string,
): TerminalSuggestionSnapshot {
  return {
    state: "ghost",
    sessionId: "terminal-1",
    promptEpoch: 1,
    revision: 1,
    rawInput,
    suggestion: {
      score: 1,
      entry: {
        id: command,
        command,
        searchText: command,
        lastUsedAt: 1,
        useCount: 1,
        projectUsage: {},
      },
    },
  };
}

describe("getTerminalSuggestionSuffix", () => {
  it("returns only the suffix for a full acceptance", () => {
    expect(
      getTerminalSuggestionSuffix(snapshot("git ", "git status"), "full"),
    ).toBe("status");
  });

  it("returns the remainder of the current token", () => {
    expect(
      getTerminalSuggestionSuffix(snapshot("gi", "git status"), "token"),
    ).toBe("t");
  });

  it("includes required leading whitespace with the next token", () => {
    expect(
      getTerminalSuggestionSuffix(
        snapshot("git", "git status --short"),
        "token",
      ),
    ).toBe(" status");
  });

  it("fails closed for a stale, non-prefix, or multiline candidate", () => {
    expect(
      getTerminalSuggestionSuffix(snapshot("git x", "git status"), "full"),
    ).toBeNull();
    expect(
      getTerminalSuggestionSuffix(snapshot("git", "git\nstatus"), "full"),
    ).toBeNull();
    expect(
      getTerminalSuggestionSuffix(
        { ...snapshot("git", "git status"), state: "opaque" },
        "full",
      ),
    ).toBeNull();
  });
});
