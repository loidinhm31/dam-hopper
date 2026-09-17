import { describe, expect, it } from "vitest";
import {
  browserTerminalTargetReason,
  buildBrowserTerminalReference,
  isBrowserTerminalTargetReady,
} from "./browser-terminal-handoff.js";

const target = {
  sessionId: "shell:demo",
  profileId: "profile-a",
  incarnation: 1,
  label: "Demo shell",
  mounted: true,
  registered: true,
  alive: true,
  current: false,
};

describe("browser terminal handoff", () => {
  it("requires a mounted, registered, server-live terminal", () => {
    expect(isBrowserTerminalTargetReady(target)).toBe(true);
    expect(browserTerminalTargetReason({ ...target, alive: false })).toBe(
      "Disconnected",
    );
    expect(browserTerminalTargetReason({ ...target, registered: false })).toBe(
      "Not mounted",
    );
    expect(browserTerminalTargetReason({ ...target, alive: undefined })).toBe(
      "Checking terminal status…",
    );
  });

  it("formats only a bounded, single-line server artifact reference", () => {
    const reference = buildBrowserTerminalReference({
      artifactId: "artifact-1",
      terminalId: "shell:demo",
      terminalIncarnation: 1,
      expiresAt: Date.now() + 60_000,
      jsonPath: "/tmp/selection\n\u001b[31m.json",
      jsonSize: 1,
      jsonSha256: "hash",
      pngPath: "/tmp/selection\r.png",
      pngSize: 1,
      pngSha256: "hash",
    });

    expect(reference).toContain("untrusted page data");
    expect(reference).toContain("/tmp/selection.json");
    expect(reference).toContain("/tmp/selection.png");
    expect(reference).not.toMatch(/[\r\n\u001b\u009b]/);
  });

  it("rejects an unbounded generated reference", () => {
    expect(() =>
      buildBrowserTerminalReference({
        artifactId: "artifact-1",
        terminalId: "shell:demo",
        terminalIncarnation: 1,
        expiresAt: Date.now() + 60_000,
        jsonPath: `/${"a".repeat(1_100)}.json`,
        jsonSize: 1,
        jsonSha256: "hash",
      }),
    ).toThrow("invalid");
  });

  it("rejects cross-owner terminal handoff before create", () => {
    const browserTargetA = { owner: { profileId: "profile-a", generation: 0 } };
    const browserTargetB = { owner: { profileId: "profile-b", generation: 0 } };

    // Same profile is ready
    expect(isBrowserTerminalTargetReady(target, browserTargetA)).toBe(true);
    expect(browserTerminalTargetReason(target, browserTargetA)).toBeNull();

    // Different profile is rejected
    expect(isBrowserTerminalTargetReady(target, browserTargetB)).toBe(false);
    expect(browserTerminalTargetReason(target, browserTargetB)).toBe("Different profile");
  });
});
