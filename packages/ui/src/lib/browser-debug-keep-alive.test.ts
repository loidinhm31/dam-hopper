// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clipBrowserDebugViewportFrame,
  getBrowserDebugNativeViewportFrame,
  getBrowserDebugViewportGeometry,
} from "./browser-debug-keep-alive.js";

beforeEach(() => {
  document.documentElement.style.zoom = "";
});

afterEach(() => {
  document.documentElement.style.zoom = "";
});

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

  it("returns logical CSS-pixel geometry when the app document is zoomed", () => {
    document.documentElement.style.zoom = "120%";
    const viewport = document.createElement("div");
    const stage = document.createElement("div");
    document.body.append(viewport, stage);
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 48,
        left: 24,
        width: 384,
        height: 216,
      }),
    });
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        left: 0,
        width: 1200,
        height: 800,
      }),
    });

    expect(getBrowserDebugViewportGeometry(viewport, stage)).toEqual({
      frame: { top: 40, left: 20, width: 320, height: 180 },
      visibleFrame: { top: 40, left: 20, width: 320, height: 180 },
    });
  });

  it("keeps native child bounds in rendered window coordinates", () => {
    document.documentElement.style.zoom = "80%";
    const viewport = document.createElement("div");
    const stage = document.createElement("div");
    document.body.append(viewport, stage);
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 120,
        left: 240,
        width: 640,
        height: 360,
      }),
    });
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        left: 0,
        width: 1200,
        height: 800,
      }),
    });

    expect(getBrowserDebugNativeViewportFrame(viewport, stage)).toEqual({
      top: 120,
      left: 240,
      width: 640,
      height: 360,
    });
  });
});
