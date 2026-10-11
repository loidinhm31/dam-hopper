import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentHarnessBadge, HARNESS_COLOR_MAP } from "./AgentHarnessBadge.js";

describe("AgentHarnessBadge", () => {
  it("renders distinct brand colors for known harnesses", () => {
    const omp = renderToStaticMarkup(<AgentHarnessBadge harness="OMP" />);
    expect(omp).toContain("OMP");
    expect(omp).toContain(HARNESS_COLOR_MAP.OMP);

    const codex = renderToStaticMarkup(<AgentHarnessBadge harness="Codex" />);
    expect(codex).toContain("Codex");
    expect(codex).toContain(HARNESS_COLOR_MAP.Codex);

    const claude = renderToStaticMarkup(<AgentHarnessBadge harness="Claude" />);
    expect(claude).toContain("Claude");
    expect(claude).toContain(HARNESS_COLOR_MAP.Claude);
  });

  it("uses sky fallback color for unknown harness", () => {
    const custom = renderToStaticMarkup(<AgentHarnessBadge harness="CustomAgent" />);
    expect(custom).toContain("CustomAgent");
    expect(custom).toContain("text-sky-300");
  });

  it("returns null for empty or whitespace-only harness", () => {
    expect(renderToStaticMarkup(<AgentHarnessBadge harness="" />)).toBe("");
    expect(renderToStaticMarkup(<AgentHarnessBadge harness="   " />)).toBe("");
  });

  it("includes accessible role, aria-label, and title", () => {
    const markup = renderToStaticMarkup(<AgentHarnessBadge harness="Claude" />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Agent: Claude"');
    expect(markup).toContain('title="Agent: Claude"');
  });
});
