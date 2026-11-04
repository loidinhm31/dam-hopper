import { describe, expect, it } from "vitest";
import {
  getEditorFormat,
  isMarkdownFile,
  isNonMonacoFormat,
} from "./editor-format.js";

describe("editor-format", () => {
  it("identifies markdown files", () => {
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("docs/notes.markdown")).toBe(true);
    expect(isMarkdownFile("main.rs")).toBe(false);
    expect(isMarkdownFile(".md")).toBe(false);
  });

  it("determines appropriate format based on extension, size, and tier", () => {
    expect(getEditorFormat("image.png")).toBe("image");
    expect(getEditorFormat("video.mp4")).toBe("video");
    expect(getEditorFormat("index.html")).toBe("html");
    expect(getEditorFormat("README.md")).toBe("markdown");
    expect(getEditorFormat("huge.log", 6 * 1024 * 1024)).toBe("large");
    expect(getEditorFormat("binary.dat", 100, "binary")).toBe("binary");
    expect(getEditorFormat("main.rs", 1000)).toBe("code");
  });

  it("determines which files should bypass Monaco KeepAlive parking", () => {
    expect(isNonMonacoFormat("image.png")).toBe(true);
    expect(isNonMonacoFormat("video.mp4")).toBe(true);
    expect(isNonMonacoFormat("huge.log", 6 * 1024 * 1024)).toBe(true);
    expect(isNonMonacoFormat("binary.dat", 100, "binary")).toBe(true);
    expect(isNonMonacoFormat("index.html")).toBe(true);
    expect(isNonMonacoFormat("README.md")).toBe(true);
    expect(isNonMonacoFormat("main.rs", 1000)).toBe(false);
  });
});
