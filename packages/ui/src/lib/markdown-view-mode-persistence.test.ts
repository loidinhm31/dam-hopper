import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKDOWN_MODE,
  loadMarkdownViewMode,
  MARKDOWN_VIEW_MODE_STORAGE_KEY,
  saveMarkdownViewMode,
  type MarkdownViewModeStorage,
} from "./markdown-view-mode-persistence.js";

function storage(initialValue?: string) {
  let value = initialValue ?? null;
  const api: MarkdownViewModeStorage = {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
  return { api, read: () => value };
}

describe("markdown view mode persistence", () => {
  it.each(["edit", "split", "preview"] as const)(
    "round-trips the global %s mode",
    (mode) => {
      const { api } = storage();

      saveMarkdownViewMode(mode, api);

      expect(loadMarkdownViewMode(api)).toBe(mode);
    },
  );

  it("stores one mode shared by every Markdown host", () => {
    const { api, read } = storage();

    saveMarkdownViewMode("preview", api);

    expect(read()).toBe("preview");
    expect(loadMarkdownViewMode(api)).toBe("preview");
  });

  it.each([null, "unknown", "not json", JSON.stringify({ mode: "preview" })])(
    "uses Split for missing or invalid stored data: %s",
    (value) => {
      const { api } = storage(value ?? undefined);

      expect(loadMarkdownViewMode(api)).toBe(DEFAULT_MARKDOWN_MODE);
    },
  );

  it("uses the versioned global storage key", () => {
    const readKeys: string[] = [];
    const writtenKeys: string[] = [];
    const api: MarkdownViewModeStorage = {
      getItem: (key) => {
        readKeys.push(key);
        return null;
      },
      setItem: (key) => writtenKeys.push(key),
    };

    loadMarkdownViewMode(api);
    saveMarkdownViewMode("edit", api);

    expect(readKeys).toEqual([MARKDOWN_VIEW_MODE_STORAGE_KEY]);
    expect(writtenKeys).toEqual([MARKDOWN_VIEW_MODE_STORAGE_KEY]);
  });

  it("fails open when browser storage reads throw", () => {
    const unavailable: MarkdownViewModeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };

    expect(loadMarkdownViewMode(unavailable)).toBe(DEFAULT_MARKDOWN_MODE);
  });

  it("fails open when browser storage writes throw", () => {
    const unavailable: MarkdownViewModeStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(() => saveMarkdownViewMode("preview", unavailable)).not.toThrow();
  });
});
