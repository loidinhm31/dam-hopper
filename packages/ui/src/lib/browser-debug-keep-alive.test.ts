import { describe, expect, it } from "vitest";
import { clipBrowserDebugViewportFrame } from "./browser-debug-keep-alive.js";

describe("clipBrowserDebugViewportFrame", () => {
  it("clips a viewport that is partially outside the window", () => {
    expect(
      clipBrowserDebugViewportFrame(
        { top: -20, left: -10, width: 200, height: 180 },
        160,
        120,
      ),
    ).toEqual({ top: 0, left: 0, width: 160, height: 120 });
  });

  it("returns null when the viewport is completely outside the window", () => {
    expect(
      clipBrowserDebugViewportFrame(
        { top: 130, left: 0, width: 20, height: 20 },
        160,
        120,
      ),
    ).toBeNull();
  });

  it("clips a viewport to a nested stage as well as the window", () => {
    expect(
      clipBrowserDebugViewportFrame(
        { top: 20, left: 10, width: 500, height: 400 },
        800,
        600,
        { top: 50, left: 40, width: 200, height: 160 },
      ),
    ).toEqual({ top: 50, left: 40, width: 200, height: 160 });
  });

  it("returns null when the viewport misses the nested stage", () => {
    expect(
      clipBrowserDebugViewportFrame(
        { top: 20, left: 10, width: 20, height: 20 },
        800,
        600,
        { top: 50, left: 40, width: 200, height: 160 },
      ),
    ).toBeNull();
  });
});
