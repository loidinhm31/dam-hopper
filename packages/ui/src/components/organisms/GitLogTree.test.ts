import { describe, expect, it } from "vitest";
import {
  getDropCommitMenuState,
  getEditCommitMessageMenuState,
  getUndoLastCommitMenuState,
  isHeadCommit,
} from "./GitLogTree.js";

describe("GitLogTree helpers", () => {
  it("disables drop commit for pushed commits", () => {
    expect(getDropCommitMenuState({ isPushed: true })).toEqual({
      disabled: true,
      title: "Drop commit is only available for commits not pushed upstream",
    });
    expect(getDropCommitMenuState({ isPushed: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it("enables Edit Commit Message for both pushed and unpushed commits", () => {
    expect(getEditCommitMessageMenuState({ isPushed: true })).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(getEditCommitMessageMenuState({ isPushed: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it("enables undo last commit only for HEAD", () => {
    expect(
      getUndoLastCommitMenuState({ isHead: true, isPushed: false }),
    ).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(
      getUndoLastCommitMenuState({ isHead: false, isPushed: false }),
    ).toEqual({
      disabled: true,
      title: "Undo Last Commit is only available on HEAD",
    });
    expect(
      getUndoLastCommitMenuState({ isHead: true, isPushed: true }),
    ).toEqual({
      disabled: true,
      title:
        "Undo Last Commit is only available for commits not pushed upstream",
    });
  });

  it("detects HEAD from commit refs", () => {
    expect(isHeadCommit({ refs: ["HEAD -> main", "origin/main"] })).toBe(true);
    expect(isHeadCommit({ refs: ["HEAD"] })).toBe(true);
    expect(isHeadCommit({ refs: ["origin/main", "tag: v1"] })).toBe(false);
  });
});
