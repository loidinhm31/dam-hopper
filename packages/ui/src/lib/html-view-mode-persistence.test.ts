import { describe, expect, it } from "vitest";
import {
  DEFAULT_HTML_MODE,
  loadHtmlViewMode,
  HTML_VIEW_MODE_STORAGE_KEY,
  saveHtmlViewMode,
  type HtmlViewModeStorage,
} from "./html-view-mode-persistence.js";

function storage(initialValue?: string) {
  let value = initialValue ?? null;
  const api: HtmlViewModeStorage = {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
  return { api, read: () => value };
}

describe("html view mode persistence", () => {
  it.each(["edit", "split", "preview"] as const)(
    "round-trips the global %s mode",
    (mode) => {
      const { api } = storage();

      saveHtmlViewMode(mode, api);

      expect(loadHtmlViewMode(api)).toBe(mode);
    },
  );

  it("stores one mode shared globally", () => {
    const { api, read } = storage();

    saveHtmlViewMode("preview", api);

    expect(read()).toBe("preview");
    expect(loadHtmlViewMode(api)).toBe("preview");
  });

  it.each([null, "unknown", "not json", JSON.stringify({ mode: "preview" })])(
    "uses Edit for missing or invalid stored data: %s",
    (value) => {
      const { api } = storage(value ?? undefined);

      expect(loadHtmlViewMode(api)).toBe(DEFAULT_HTML_MODE);
    },
  );

  it("uses the versioned global storage key", () => {
    const readKeys: string[] = [];
    const writtenKeys: string[] = [];
    const api: HtmlViewModeStorage = {
      getItem: (key) => {
        readKeys.push(key);
        return null;
      },
      setItem: (key) => writtenKeys.push(key),
    };

    saveHtmlViewMode("split", api);
    loadHtmlViewMode(api);

    expect(writtenKeys).toEqual([HTML_VIEW_MODE_STORAGE_KEY]);
    expect(readKeys).toEqual([HTML_VIEW_MODE_STORAGE_KEY]);
  });

  it("handles throwing storage without unhandled exceptions", () => {
    const throwingApi: HtmlViewModeStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(loadHtmlViewMode(throwingApi)).toBe(DEFAULT_HTML_MODE);
    expect(() => saveHtmlViewMode("preview", throwingApi)).not.toThrow();
  });
});
