import { describe, expect, it } from "vitest";
import {
  isTerminalTabClosable,
  resolveTerminalCloseFallback,
} from "./terminal-tab-state.js";

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

describe("resolveTerminalCloseFallback", () => {
  const tabs = [
    { sessionId: "project-a-1" },
    { sessionId: "project-a-2" },
    { sessionId: "project-c-3" },
  ];

  it("uses a valid project-scoped preference", () => {
    expect(resolveTerminalCloseFallback(tabs, "project-a-1")).toBe(
      "project-a-1",
    );
  });

  it("preserves the global last-tab fallback without a preference", () => {
    expect(resolveTerminalCloseFallback(tabs)).toBe("project-c-3");
  });

  it("returns no target when no tabs remain", () => {
    expect(resolveTerminalCloseFallback([], "project-a-1")).toBeNull();
  });
});
