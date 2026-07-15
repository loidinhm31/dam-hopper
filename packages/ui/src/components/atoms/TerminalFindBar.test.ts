import { describe, expect, it, vi } from "vitest";
import { focusTerminalFindInput } from "./TerminalFindBar.js";

describe("focusTerminalFindInput", () => {
  it("does not focus the native input when mobile keyboard suppression is active", () => {
    const input = { focus: vi.fn(), select: vi.fn() };

    focusTerminalFindInput(input, false);

    expect(input.focus).not.toHaveBeenCalled();
    expect(input.select).not.toHaveBeenCalled();
  });

  it("focuses and selects the input for desktop search", () => {
    const input = { focus: vi.fn(), select: vi.fn() };

    focusTerminalFindInput(input, true);

    expect(input.focus).toHaveBeenCalledOnce();
    expect(input.select).toHaveBeenCalledOnce();
  });
});
