import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "@/components/organisms/MarkdownPreview.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("markdown preview in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(content: string) {
    await act(async () => root.render(<MarkdownPreview content={content} />));
  }

  it("keeps inline code separate and preserves unlabeled fenced layout", async () => {
    await render(
      [
        "Inline `const value = 1` remains inline.",
        "",
        "```",
        "┌──────────────┐",
        "│  ASCII graph │",
        "└──────────────┘",
        `│ ${"wide line ".repeat(30)}│`,
        "```",
        "",
        "```text",
        "labeled source",
        "```",
      ].join("\n"),
    );

    const inlineCode = container.querySelector("p > code");
    expect(inlineCode).not.toBeNull();
    expect(inlineCode?.closest("pre")).toBeNull();

    const blocks = [...container.querySelectorAll("pre")];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.querySelector("code")?.textContent).toBe(
      [
        "┌──────────────┐",
        "│  ASCII graph │",
        "└──────────────┘",
        `│ ${"wide line ".repeat(30)}│`,
      ].join("\n") + "\n",
    );
    expect(getComputedStyle(blocks[0]!).whiteSpace).toBe("pre");
    expect(getComputedStyle(blocks[0]!).overflowX).toBe("auto");
    expect(blocks[0]!.scrollWidth).toBeGreaterThan(blocks[0]!.clientWidth);
    expect(container.textContent).toContain("labeled source");
  });

  it("renders Mermaid and falls back to source for invalid diagrams", async () => {
    await render(
      [
        "```mermaid",
        "flowchart LR",
        "  A[Start] --> B[End]",
        "```",
        "",
        "```mermaid",
        "flowchart TD",
        "  C[One] --> D[Two]",
        "```",
      ].join("\n"),
    );

    await vi.waitFor(
      () =>
        expect(
          container.querySelectorAll('[data-markdown-mermaid="diagram"] svg'),
        ).toHaveLength(2),
      { timeout: 20_000 },
    );

    const diagramIds = [
      ...container.querySelectorAll('[data-markdown-mermaid="diagram"] svg'),
    ].map((svg) => svg.getAttribute("id"));
    expect(new Set(diagramIds).size).toBe(2);
    expect(
      container
        .querySelector('[data-markdown-mermaid="diagram"]')
        ?.closest("pre"),
    ).toBeNull();
    expect(container.textContent).not.toContain("flowchart LR");

    await render(["```mermaid", "flowchart LR", "  A -->", "```"].join("\n"));
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-markdown-mermaid="error"]'),
      ).not.toBe(null),
    );

    const fallback = container.querySelector('[data-markdown-mermaid="error"]');
    expect(fallback?.getAttribute("role")).toBe("alert");
    expect(fallback?.textContent).toContain("A -->");
    expect(fallback?.querySelector("pre")).not.toBeNull();
    expect(fallback?.querySelector("svg")).toBeNull();
  });

  it("keeps raw HTML and Mermaid click directives inert", async () => {
    await render(
      [
        "<script>window.__markdownPreviewXss = true</script>",
        "",
        "```mermaid",
        "flowchart LR",
        "  A[Start] --> B[End]",
        '  click A "javascript:alert(1)"',
        "```",
      ].join("\n"),
    );

    await vi.waitFor(
      () =>
        expect(
          container.querySelector('[data-markdown-mermaid="diagram"] svg'),
        ).not.toBeNull(),
      { timeout: 20_000 },
    );

    expect(container.querySelector("script")).toBeNull();
    const diagram = container.querySelector(
      '[data-markdown-mermaid="diagram"]',
    );
    expect(diagram?.querySelector("[onclick]")).toBeNull();
    expect(diagram?.innerHTML.toLowerCase()).not.toContain("javascript:");
  });
});
