import { describe, expect, it } from "vitest";
import { resolveGitPushTarget } from "./queries.js";

describe("resolveGitPushTarget", () => {
  it("maps a plain project name to a normal push", () => {
    expect(resolveGitPushTarget("dam-hopper")).toEqual([
      "dam-hopper",
      undefined,
      undefined,
    ]);
  });

  it("preserves root-aware force-push arguments", () => {
    expect(
      resolveGitPushTarget({
        project: "dam-hopper",
        root: "modules/child",
        force: true,
      }),
    ).toEqual(["dam-hopper", "modules/child", true]);
  });
});
