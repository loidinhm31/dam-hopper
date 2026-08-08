import { describe, expect, it } from "vitest";
import { isTerminalTabClosable } from "./terminal-tab-state.js";

describe("isTerminalTabClosable", () => {
  const tabs = [
    { sessionId: "pinned", label: "Pinned", isPinned: true },
    { sessionId: "open", label: "Open", isPinned: false },
  ];

  it("protects pinned tabs, allows unpinned tabs, and rejects unknown targets", () => {
    expect(isTerminalTabClosable(tabs, "pinned")).toBe(false);
    expect(isTerminalTabClosable(tabs, "open")).toBe(true);
    expect(isTerminalTabClosable(tabs, "missing")).toBe(false);
  });
});
