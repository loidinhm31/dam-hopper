import { describe, expect, it } from "vitest";
import { formatGitActionStatus } from "./GitHistoryActions.js";

describe("formatGitActionStatus", () => {
  it("formats success results", () => {
    expect(
      formatGitActionStatus(
        { ok: true, message: "Dropped abc1234" },
        "success fallback",
        "error fallback",
      ),
    ).toEqual({
      kind: "success",
      message: "Dropped abc1234",
      detail: undefined,
    });
  });

  it("distinguishes blocked, dirty, and conflict results", () => {
    expect(
      formatGitActionStatus(
        {
          ok: false,
          blockedReason: "pushed-commit",
          recommendation: "Use revert.",
        },
        "success",
        "Drop failed",
      ),
    ).toEqual({
      kind: "blocked",
      message: "Drop failed",
      detail: "Use revert.",
    });

    expect(
      formatGitActionStatus(
        { ok: false, dirty: true },
        "success",
        "Checkout failed",
      ),
    ).toEqual({
      kind: "dirty",
      message: "Checkout failed",
      detail: "Commit, stash, or discard local changes.",
    });

    expect(
      formatGitActionStatus(
        {
          ok: false,
          conflict: true,
          recovery: {
            operation: "cherry-pick",
            canAbort: true,
            canContinue: true,
          },
        },
        "success",
        "Cherry-pick failed",
      ),
    ).toEqual({
      kind: "conflict",
      message: "Cherry-pick failed",
      detail: "Resolve the active operation before continuing.",
    });
  });
});
