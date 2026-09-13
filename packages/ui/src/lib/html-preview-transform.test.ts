import { describe, expect, it } from "vitest";
import {
  prepareHtmlPreviewContent,
  HTML_PREVIEW_SHIM,
} from "./html-preview-transform.js";

describe("html-preview-transform", () => {
  it("returns empty string if given empty string", () => {
    expect(prepareHtmlPreviewContent("")).toBe("");
  });

  it("injects shim after <head> tag", () => {
    const input = `<!DOCTYPE html><html><head><title>Test</title></head><body>Hello</body></html>`;
    const output = prepareHtmlPreviewContent(input);

    expect(output).toContain("<head>\n" + HTML_PREVIEW_SHIM);
    expect(output.indexOf(HTML_PREVIEW_SHIM)).toBeGreaterThan(output.indexOf("<head>"));
    expect(output.indexOf(HTML_PREVIEW_SHIM)).toBeLessThan(output.indexOf("<title>"));
  });

  it("injects shim after <html> tag when <head> is missing", () => {
    const input = `<!DOCTYPE html><html><body>Hello</body></html>`;
    const output = prepareHtmlPreviewContent(input);

    expect(output).toContain("<html>\n" + HTML_PREVIEW_SHIM);
  });

  it("prepends shim when neither <html> nor <head> is present", () => {
    const input = `<p>Just some markup</p>`;
    const output = prepareHtmlPreviewContent(input);

    expect(output.startsWith(HTML_PREVIEW_SHIM)).toBe(true);
    expect(output).toContain("<p>Just some markup</p>");
  });
});
