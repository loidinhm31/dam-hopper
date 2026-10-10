import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectBadge, hashProjectColor } from "./ProjectBadge.js";

describe("ProjectBadge", () => {
  it("generates deterministic colors based on project seed", () => {
    const color1 = hashProjectColor("dam-hopper");
    const color2 = hashProjectColor("dam-hopper");
    expect(color1).toBe(color2);

    const colorOther = hashProjectColor("website");
    expect(colorOther).toBeDefined();
  });

  it("renders project name, title, and accessible role", () => {
    const markup = renderToStaticMarkup(<ProjectBadge name="dam-hopper" />);
    expect(markup).toContain("dam-hopper");
    expect(markup).toContain('title="Project: dam-hopper"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Project: dam-hopper"');
  });

  it("distributes distinct color classes across multiple projects", () => {
    const projects = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
    const colors = new Set(projects.map(hashProjectColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it("returns null for empty or whitespace-only name", () => {
    expect(renderToStaticMarkup(<ProjectBadge name="" />)).toBe("");
    expect(renderToStaticMarkup(<ProjectBadge name="   " />)).toBe("");
  });

  it("handles undefined or null seed in hashProjectColor without throwing", () => {
    expect(() => hashProjectColor(undefined)).not.toThrow();
    expect(() => hashProjectColor(null)).not.toThrow();
  });
});
