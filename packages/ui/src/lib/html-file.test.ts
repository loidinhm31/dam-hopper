import { describe, expect, it } from "vitest";
import {
  htmlMimeType,
  isHtmlFile,
  isHtmlPreviewCandidate,
} from "./html-file.js";

describe("html file routing", () => {
  it.each([
    ["index.html", "text/html"],
    ["PAGE.HTML", "text/html"],
    ["about.htm", "text/html"],
    ["template.HTM", "text/html"],
    ["feed.xhtml", "application/xhtml+xml"],
    ["FEED.XHTML", "application/xhtml+xml"],
  ])("recognizes %s with exact MIME hint", (name, mime) => {
    expect(htmlMimeType(name)).toBe(mime);
    expect(isHtmlFile(name)).toBe(true);
    expect(isHtmlPreviewCandidate("normal", name)).toBe(true);
  });

  it("handles relative and nested paths", () => {
    expect(htmlMimeType("src/pages/index.html")).toBe("text/html");
    expect(htmlMimeType("dist\\templates\\mail.htm")).toBe("text/html");
  });

  it("rejects non-HTML files and dotfiles", () => {
    expect(htmlMimeType("script.js")).toBeUndefined();
    expect(htmlMimeType("style.css")).toBeUndefined();
    expect(htmlMimeType("doc.md")).toBeUndefined();
    expect(htmlMimeType("image.png")).toBeUndefined();
    expect(htmlMimeType(".html")).toBeUndefined();
    expect(htmlMimeType("index.html.bak")).toBeUndefined();
    expect(htmlMimeType("index")).toBeUndefined();

    expect(isHtmlFile("script.js")).toBe(false);
    expect(isHtmlFile(".html")).toBe(false);
  });

  it("does not treat diff, large, or binary tabs as HTML preview candidates", () => {
    expect(isHtmlPreviewCandidate("diff", "index.html")).toBe(false);
    expect(isHtmlPreviewCandidate("large", "index.html")).toBe(false);
    expect(isHtmlPreviewCandidate("binary", "index.html")).toBe(false);
    expect(isHtmlPreviewCandidate("normal", "index.html")).toBe(true);
    expect(isHtmlPreviewCandidate("degraded", "index.html")).toBe(true);
  });
});
