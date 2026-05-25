import { describe, expect, it } from "vitest";
import {
  clampBranchContextMenuPosition,
  getDeleteBranchMenuState,
} from "./GitBranchContextMenu.js";

describe("clampBranchContextMenuPosition", () => {
  it("keeps the menu inside the viewport", () => {
    expect(clampBranchContextMenuPosition(1200, 900, 1280, 960)).toEqual({
      x: 1090,
      y: 864,
    });
    expect(clampBranchContextMenuPosition(40, 60, 1280, 960)).toEqual({
      x: 40,
      y: 60,
    });
  });
});

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
