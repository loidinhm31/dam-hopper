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
    expect(markup).toContain("Unsaved changes");
  });
});
