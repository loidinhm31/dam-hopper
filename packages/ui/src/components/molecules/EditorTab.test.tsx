import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorTab } from "./EditorTab.js";

describe("EditorTab", () => {
  it("uses the tab path for file decoration when provided", () => {
    const markup = renderToStaticMarkup(
      <EditorTab
        name="Dockerfile.dev"
        path="ops/Dockerfile.dev"
        active={false}
        dirty={false}
        onClick={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("text-sky-400");
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Close Dockerfile.dev");
  });

  it("falls back to the visible name when no path is provided", () => {
    const markup = renderToStaticMarkup(
      <EditorTab
        name="README"
        active
        dirty
        onClick={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("text-indigo-300");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("Unsaved changes");
  });

  it("renders git state without replacing the dirty indicator", () => {
    const markup = renderToStaticMarkup(
      <EditorTab
        name="app.ts"
        path="src/app.ts"
        active
        dirty
        gitState={{
          path: "src/app.ts",
          rootRelativePath: "src/app.ts",
          rootId: ".",
          status: "modified",
          stagedState: "mixed",
          additions: 2,
          deletions: 1,
          hasConflict: false,
        }}
        onClick={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("Unsaved changes");
    expect(markup).toContain("Open diff: modified, staged + unstaged, +2 -1");
    expect(markup).toContain("±");
  });
});
