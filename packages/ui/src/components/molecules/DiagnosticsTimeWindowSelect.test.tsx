import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsTimeWindowSelect } from "./DiagnosticsTimeWindowSelect.js";

describe("DiagnosticsTimeWindowSelect", () => {
  it("renders the supported controlled time windows", () => {
    const markup = renderToStaticMarkup(
      <DiagnosticsTimeWindowSelect value={10} onChange={vi.fn()} />,
    );

    expect(markup).toContain('aria-label="Diagnostics time window"');
    expect(markup).toContain('value="2"');
    expect(markup).toContain('value="5"');
    expect(markup).toContain('value="10" selected=""');
    expect(markup).toContain('value="30"');
    expect(markup).toContain('value="60"');
  });
});
