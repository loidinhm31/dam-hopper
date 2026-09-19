import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileBadge, hashProfileColor } from "./ProfileBadge.js";

describe("ProfileBadge", () => {
  it("generates deterministic colors based on profile seed", () => {
    const color1 = hashProfileColor("profile-alpha");
    const color2 = hashProfileColor("profile-alpha");
    expect(color1).toBe(color2);

    const colorBeta = hashProfileColor("profile-beta");
    expect(colorBeta).toBeDefined();
  });

  it("renders profile name and server title", () => {
    const markup = renderToStaticMarkup(
      <ProfileBadge name="Server Alpha" profileId="profile-123" />,
    );

    expect(markup).toContain("Server Alpha");
    expect(markup).toContain('title="Server profile: Server Alpha"');
  });

  it("distributes distinct color classes across multiple profiles", () => {
    const profiles = ["server-1", "server-2", "server-3", "server-4", "server-5"];
    const colors = new Set(profiles.map(hashProfileColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it("returns null for empty or whitespace-only name", () => {
    expect(renderToStaticMarkup(<ProfileBadge name="" />)).toBe("");
    expect(renderToStaticMarkup(<ProfileBadge name="   " />)).toBe("");
  });

  it("includes accessible role and aria-label", () => {
    const markup = renderToStaticMarkup(
      <ProfileBadge name="Prod US-East" profileId="prof-456" />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Server profile: Prod US-East"');
  });

  it("handles undefined or null seed in hashProfileColor without throwing", () => {
    expect(() => hashProfileColor(undefined)).not.toThrow();
    expect(() => hashProfileColor(null)).not.toThrow();
  });
});
