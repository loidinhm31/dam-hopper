import { describe, expect, it } from "vitest";
import {
  clampHistoryContextMenuPosition,
  getDropCommitMenuState,
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

  it("clamps the history context menu inside the viewport", () => {
    expect(clampHistoryContextMenuPosition(1200, 900, 1280, 960)).toEqual({
      x: 1090,
      y: 804,
    });
    expect(clampHistoryContextMenuPosition(120, 80, 1280, 960)).toEqual({
      x: 120,
      y: 80,
    });
  });
});
