import { describe, expect, it } from "vitest";
import {
  BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
  BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT,
  BROWSER_DEBUG_VIEWPORT_MIN_WIDTH,
  BROWSER_DEBUG_VIEWPORT_RESIZE_STEP,
  DEFAULT_BROWSER_DEBUG_VIEWPORT,
  browserDebugViewportStorageKey,
  enterBrowserDebugViewportCustomMode,
  loadBrowserDebugViewport,
  saveBrowserDebugViewport,
  stepBrowserDebugViewport,
  updateBrowserDebugViewportSize,
  validateBrowserDebugViewportDimension,
} from "./browser-debug-viewport.js";
import type {
  BrowserDebugViewportSize,
  BrowserDebugViewportStorage,
  BrowserDebugViewportState,
} from "./browser-debug-viewport.js";

function storage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) values.set("seed", initialValue);
  const api: BrowserDebugViewportStorage = {
    getItem: (key) => values.get(key) ?? values.get("seed") ?? null,
    setItem: (key, nextValue) => {
      values.set(key, nextValue);
    },
  };
  return { api, read: (key?: string) => values.get(key ?? "seed") ?? null };
}

const customState: BrowserDebugViewportState = {
  mode: "custom",
  customSize: { width: 390, height: 844 },
};

describe("browser debug viewport model", () => {
  it("starts in responsive mode", () => {
    expect(loadBrowserDebugViewport("android", storage().api)).toEqual(
      DEFAULT_BROWSER_DEBUG_VIEWPORT,
    );
  });

  it("round-trips valid state by platform key", () => {
    const { api, read } = storage();

    saveBrowserDebugViewport(customState, "android", api);

    expect(read(browserDebugViewportStorageKey("android"))).toContain(
      '"version":1',
    );
    expect(loadBrowserDebugViewport("android", api)).toEqual(customState);
    expect(loadBrowserDebugViewport("windows", api)).toEqual(
      DEFAULT_BROWSER_DEBUG_VIEWPORT,
    );
    expect(browserDebugViewportStorageKey("Android")).toContain(":android");
  });

  it.each([
    null,
    "not json",
    JSON.stringify({
      version: 1,
      mode: "custom",
      customSize: { width: 0, height: 400 },
    }),
    JSON.stringify({
      version: 2,
      mode: "custom",
      customSize: { width: 390, height: 844 },
    }),
  ])("falls back for malformed state %s", (value) => {
    expect(
      loadBrowserDebugViewport("native", storage(value ?? undefined).api),
    ).toEqual(DEFAULT_BROWSER_DEBUG_VIEWPORT);
  });

  it("fails open when storage reads or writes throw", () => {
    const unavailable: BrowserDebugViewportStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(loadBrowserDebugViewport("native", unavailable)).toEqual(
      DEFAULT_BROWSER_DEBUG_VIEWPORT,
    );
    expect(() =>
      saveBrowserDebugViewport(customState, "native", unavailable),
    ).not.toThrow();
  });

  it("uses the current responsive rect when entering custom mode", () => {
    expect(
      enterBrowserDebugViewportCustomMode(DEFAULT_BROWSER_DEBUG_VIEWPORT, {
        width: 389.5,
        height: 843.5,
      }),
    ).toEqual({ mode: "custom", customSize: { width: 390, height: 844 } });
    expect(
      enterBrowserDebugViewportCustomMode(DEFAULT_BROWSER_DEBUG_VIEWPORT, {
        width: 0,
        height: 0,
      }),
    ).toEqual(DEFAULT_BROWSER_DEBUG_VIEWPORT);
  });

  it("changes both dimensions by the fixed step and saturates at bounds", () => {
    expect(stepBrowserDebugViewport(customState, "increase")).toEqual({
      mode: "custom",
      customSize: {
        width: 390 + BROWSER_DEBUG_VIEWPORT_RESIZE_STEP,
        height: 844 + BROWSER_DEBUG_VIEWPORT_RESIZE_STEP,
      },
    });
    expect(
      stepBrowserDebugViewport(
        {
          mode: "custom",
          customSize: {
            width: BROWSER_DEBUG_VIEWPORT_MIN_WIDTH,
            height: BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT,
          },
        },
        "decrease",
      ),
    ).toEqual({
      mode: "custom",
      customSize: {
        width: BROWSER_DEBUG_VIEWPORT_MIN_WIDTH,
        height: BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT,
      },
    });
    expect(
      stepBrowserDebugViewport(
        {
          mode: "custom",
          customSize: {
            width: BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
            height: BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
          },
        },
        "increase",
      ).customSize,
    ).toEqual({
      width: BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
      height: BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
    });
    expect(
      stepBrowserDebugViewport(DEFAULT_BROWSER_DEBUG_VIEWPORT, "increase"),
    ).toBe(DEFAULT_BROWSER_DEBUG_VIEWPORT);
  });

  it("updates only valid custom sizes", () => {
    const nextSize: BrowserDebugViewportSize = { width: 480, height: 900 };
    expect(updateBrowserDebugViewportSize(customState, nextSize)).toEqual({
      mode: "custom",
      customSize: nextSize,
    });
    expect(
      updateBrowserDebugViewportSize(customState, { width: 0, height: 900 }),
    ).toBe(customState);
  });

  it.each([
    ["480", 480],
    [" 900 ", 900],
  ])("accepts whole-number dimensions: %s", (input, value) => {
    expect(validateBrowserDebugViewportDimension(input)).toEqual({
      value,
      error: null,
    });
  });

  it.each(["", "12.5", "-1", "4097", "nope"])(
    "rejects invalid dimensions: %s",
    (input) => {
      expect(validateBrowserDebugViewportDimension(input).value).toBeNull();
    },
  );
});
