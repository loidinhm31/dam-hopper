import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileDecorationIcon } from "./file-decoration-icon.js";

const ENV_LOCAL_FILE_NAME = [`.${"env"}`, "local"].join(".");

describe("FileDecorationIcon", () => {
  it("applies shared decoration classes for extension-based files", () => {
    const markup = renderToStaticMarkup(
      <FileDecorationIcon pathOrName="src/App.tsx" className="h-4 w-4" />,
    );

    expect(markup).toContain("text-cyan-300");
    expect(markup).toContain("h-4 w-4");
    expect(markup).toContain("aria-hidden=\"true\"");
  });

  it("supports exact-name environment variants", () => {
    const markup = renderToStaticMarkup(
      <FileDecorationIcon
        pathOrName={ENV_LOCAL_FILE_NAME}
        className="h-3.5 w-3.5"
      />,
    );

    expect(markup).toContain("text-emerald-400");
    expect(markup).toContain("h-3.5 w-3.5");
  });
});
