import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarkdownPreview,
  resolveTargetRelativePath,
  slugifyHeading,
} from "./MarkdownPreview.js";

describe("MarkdownPreview link policy and security", () => {
  describe("slugifyHeading", () => {
    it("converts heading text to valid lowercase hyphenated id", () => {
      expect(slugifyHeading("Context Links & Scope")).toBe("context-links-scope");
      expect(slugifyHeading("  Trim Spaces  ")).toBe("trim-spaces");
      expect(slugifyHeading("Phase 04 — Dashboard")).toBe("phase-04-dashboard");
    });
  });

  describe("resolveTargetRelativePath", () => {
    it("resolves sibling markdown file within target", () => {
      const res = resolveTargetRelativePath(
        "plans/feature/plan.md",
        "./phase-01.md",
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.resolvedPath).toBe("plans/feature/phase-01.md");
        expect(res.isMarkdown).toBe(true);
      }
    });

    it("resolves parent target docs markdown file", () => {
      const res = resolveTargetRelativePath(
        "plans/feature/plan.md",
        "../../docs/architecture.md#overview",
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.resolvedPath).toBe("docs/architecture.md");
        expect(res.fragment).toBe("overview");
        expect(res.isMarkdown).toBe(true);
      }
    });

    it("rejects path traversal escaping above target root", () => {
      const res = resolveTargetRelativePath(
        "plan.md",
        "../../outside.md",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Path traversal escape");
      }
    });

    it("rejects unsafe URI schemes like javascript: or file:", () => {
      const res = resolveTargetRelativePath(
        "plan.md",
        "javascript:alert(1)",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Unsafe URI scheme");
      }
    });

    it("rejects null bytes in path", () => {
      const res = resolveTargetRelativePath(
        "plan.md",
        "phase\0.md",
      );
      expect(res.ok).toBe(false);
    });

    it("marks non-markdown local files as isMarkdown: false", () => {
      const res = resolveTargetRelativePath(
        "plans/plan.md",
        "./diagram.png",
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.isMarkdown).toBe(false);
      }
    });
  });

  describe("MarkdownPreview rendering with linkPolicy", () => {
    it("renders headings with deterministic slug IDs", () => {
      const content = "# First Heading\n\n## Sub Section";
      const html = renderToStaticMarkup(<MarkdownPreview content={content} />);

      expect(html).toContain('id="first-heading"');
      expect(html).toContain('id="sub-section"');
    });

    it("renders safe local markdown links with href targeting resolved path", () => {
      const onNavigate = vi.fn();
      const content = "[Go to Phase 1](./phase-01.md)";
      const html = renderToStaticMarkup(
        <MarkdownPreview
          content={content}
          linkPolicy={{
            currentDocumentPath: "plans/my-plan/plan.md",
            onNavigateLocalMarkdown: onNavigate,
          }}
        />,
      );

      expect(html).toContain('href="#plans/my-plan/phase-01.md"');
      expect(html).toContain("Go to Phase 1");
    });

    it("renders non-markdown links as unsupported and non-clickable spans", () => {
      const onNavigate = vi.fn();
      const content = "[See Asset](./image.png)";
      const html = renderToStaticMarkup(
        <MarkdownPreview
          content={content}
          linkPolicy={{
            currentDocumentPath: "plans/plan.md",
            onNavigateLocalMarkdown: onNavigate,
          }}
        />,
      );

      expect(html).toContain("See Asset");
      expect(html).toContain("Non-Markdown local links are not supported");
      expect(html).not.toContain('href="./image.png"');
    });

    it("renders local images as accessible notices without image fetch", () => {
      const content = "![Architecture Diagram](./assets/diagram.png)";
      const html = renderToStaticMarkup(
        <MarkdownPreview
          content={content}
          linkPolicy={{
            currentDocumentPath: "plans/plan.md",
          }}
        />,
      );

      expect(html).toContain('role="note"');
      expect(html).toContain("[Image: Architecture Diagram]");
      expect(html).not.toContain("<img");
    });

    it("renders external images normally when http/https", () => {
      const content = "![Remote Image](https://example.com/logo.png)";
      const html = renderToStaticMarkup(
        <MarkdownPreview
          content={content}
          linkPolicy={{
            currentDocumentPath: "plans/plan.md",
          }}
        />,
      );

      expect(html).toContain("<img");
      expect(html).toContain('src="https://example.com/logo.png"');
    });
  });
});
