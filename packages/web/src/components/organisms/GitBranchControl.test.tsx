import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GitBranchFeedback } from "./GitBranchControl.js";

describe("GitBranchFeedback", () => {
  it("renders feedback by default", () => {
    const markup = renderToStaticMarkup(
      <GitBranchFeedback message="Checked out feature/demo" error={null} />,
    );

    expect(markup).toContain("Checked out feature/demo");
  });

  it("suppresses feedback when disabled", () => {
    const markup = renderToStaticMarkup(
      <GitBranchFeedback
        message="Checked out feature/demo"
        error={null}
        showFeedback={false}
      />,
    );

    expect(markup).toBe("");
  });
});
