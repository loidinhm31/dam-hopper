import { describe, it, expect } from "vitest";
import {
  getFileTreeRowHeight,
  FILE_TREE_MIN_ROW_HEIGHT,
} from "./workbench-typography.js";

describe("workbench-typography", () => {
  it("defaults to minimum 24px floor for default 14px system font", () => {
    expect(getFileTreeRowHeight(14)).toBe(24);
  });

  it("handles minimum clamp boundary (10px)", () => {
    expect(getFileTreeRowHeight(10)).toBe(24);
  });

  it("scales dynamically for larger system font sizes", () => {
    expect(getFileTreeRowHeight(20)).toBe(27);
    expect(getFileTreeRowHeight(32)).toBe(41);
  });

  it("falls back gracefully when font size is 0 or NaN", () => {
    expect(getFileTreeRowHeight(0)).toBe(FILE_TREE_MIN_ROW_HEIGHT);
    expect(getFileTreeRowHeight(Number.NaN)).toBe(FILE_TREE_MIN_ROW_HEIGHT);
  });
});
