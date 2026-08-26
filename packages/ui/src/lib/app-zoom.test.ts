import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_ZOOM_STORAGE_KEY,
  DEFAULT_APP_ZOOM_LEVEL,
  isAppZoomLevel,
  loadAppZoom,
  saveAppZoom,
  stepAppZoom,
} from "./app-zoom.js";
import type { AppZoomStorage } from "./app-zoom.js";

function storage(initial?: string): AppZoomStorage & { value: string | null } {
  let value = initial ?? null;
  return {
    get value() {
      return value;
    },
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app zoom model", () => {
  it("accepts only the five discrete levels", () => {
    expect([50, 60, 70, 80, 90, 100, 110, 120].every(isAppZoomLevel)).toBe(
      true,
    );
    expect(isAppZoomLevel(85)).toBe(false);
    expect(isAppZoomLevel("100")).toBe(false);
    expect(isAppZoomLevel(Number.NaN)).toBe(false);
  });

  it("steps by ten percent and saturates at both bounds", () => {
    expect(stepAppZoom(100, "increase")).toBe(110);
    expect(stepAppZoom(100, "decrease")).toBe(90);
    expect(stepAppZoom(50, "decrease")).toBe(50);
    expect(stepAppZoom(120, "increase")).toBe(120);
    expect(stepAppZoom(85, "increase")).toBe(DEFAULT_APP_ZOOM_LEVEL);
  });

  it("round-trips a valid versioned value under one stable key", () => {
    const state = storage();

    saveAppZoom(110, state);

    expect(state.setItem).toHaveBeenCalledWith(
      APP_ZOOM_STORAGE_KEY,
      JSON.stringify({ version: 1, zoom: 110 }),
    );
    expect(loadAppZoom(state)).toBe(110);
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, zoom: 110 }),
    JSON.stringify({ version: 1, zoom: 85 }),
    JSON.stringify({ version: 1, zoom: "110" }),
  ])("falls back for malformed persisted value: %s", (value) => {
    expect(loadAppZoom(storage(value))).toBe(DEFAULT_APP_ZOOM_LEVEL);
  });

  it("ignores invalid values and opens when storage reads or writes fail", () => {
    const unavailable: AppZoomStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };

    expect(loadAppZoom(unavailable)).toBe(DEFAULT_APP_ZOOM_LEVEL);
    expect(() => saveAppZoom(110, unavailable)).not.toThrow();
    expect(() => saveAppZoom(85, unavailable)).not.toThrow();
  });

  it("opens when the default localStorage accessor is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });

    expect(loadAppZoom()).toBe(DEFAULT_APP_ZOOM_LEVEL);
    expect(() => saveAppZoom(110)).not.toThrow();
  });
});
