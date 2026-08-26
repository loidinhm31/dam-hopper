import { describe, expect, it } from "vitest";
import { shouldRenderEmptyTerminalBrowserSurface } from "./terminal-browser-surface.js";

describe("shouldRenderEmptyTerminalBrowserSurface", () => {
  it("shows Browser in Traditional mode when no terminal session exists", () => {
    expect(
      shouldRenderEmptyTerminalBrowserSurface({
        terminalUsageMode: "traditional",
        mountedSessionCount: 0,
        browserOpen: true,
        isCompactWorkspace: false,
      }),
    ).toBe(true);
  });

  it("keeps the empty terminal fallback when Browser is closed", () => {
    expect(
      shouldRenderEmptyTerminalBrowserSurface({
        terminalUsageMode: "traditional",
        mountedSessionCount: 0,
        browserOpen: false,
        isCompactWorkspace: false,
      }),
    ).toBe(false);
  });
});
