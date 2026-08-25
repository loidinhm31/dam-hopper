import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalSuggestionGhost } from "./TerminalSuggestionGhost.js";

describe("TerminalSuggestionGhost", () => {
  it("is absent when no suffix is available", () => {
    expect(
      renderToStaticMarkup(
        <TerminalSuggestionGhost
          suffix=""
          position={{ x: 12, y: 18, lineHeight: 18 }}
          fontSize={13}
        />,
      ),
    ).toBe("");
  });

  it("renders only a passive, clipped suffix", () => {
    const markup = renderToStaticMarkup(
      <TerminalSuggestionGhost
        suffix=" --help"
        position={{ x: 12, y: 18, lineHeight: 18 }}
        fontSize={16}
      />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("--help");
    expect(markup).toContain("font-size:16px");
  });
});
