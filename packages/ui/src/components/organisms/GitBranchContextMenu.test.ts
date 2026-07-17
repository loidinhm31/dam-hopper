import { describe, expect, it } from "vitest";
import { getDeleteBranchMenuState } from "./GitBranchContextMenu.js";

describe("getDeleteBranchMenuState", () => {
  it("disables deletion for the checked-out branch", () => {
    expect(getDeleteBranchMenuState({ isCurrent: true })).toEqual({
      disabled: true,
      title: "Cannot delete the checked-out branch",
    });
  });

  it("allows deletion for non-current branches", () => {
    expect(getDeleteBranchMenuState({ isCurrent: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });
});
