import { describe, expect, it, vi } from "vitest";
import { resolveGitPushTarget, usageSessionPollInterval } from "./queries.js";

describe("resolveGitPushTarget", () => {
  it("maps a plain project name to a normal push", () => {
    expect(resolveGitPushTarget("dam-hopper")).toEqual([
      "dam-hopper",
      undefined,
    ]);
  });

  it("preserves root-aware push arguments", () => {
    expect(
      resolveGitPushTarget({
        project: "dam-hopper",
        root: "modules/child",
      }),
    ).toEqual(["dam-hopper", "modules/child"]);
  });
});

describe("usageSessionPollInterval", () => {
  it("polls visible documents and stops when hidden or server-rendered", () => {
    expect(usageSessionPollInterval()).toBe(false);
    vi.stubGlobal("document", { visibilityState: "visible" });
    expect(usageSessionPollInterval()).toBe(15_000);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    expect(usageSessionPollInterval()).toBe(false);
    vi.unstubAllGlobals();
  });
});
