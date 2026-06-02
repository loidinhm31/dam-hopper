import { describe, expect, it, vi } from "vitest";
import { handleIpcStatusChange } from "./use-sse.js";

describe("handleIpcStatusChange", () => {
  it("invalidates terminal sessions on connected status", () => {
    const setStatus = vi.fn();
    const invalidate = vi.fn();

    handleIpcStatusChange("connected", setStatus, invalidate);

    expect(setStatus).toHaveBeenCalledWith("connected");
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("does not invalidate terminal sessions for disconnected status", () => {
    const setStatus = vi.fn();
    const invalidate = vi.fn();

    handleIpcStatusChange("disconnected", setStatus, invalidate);

    expect(setStatus).toHaveBeenCalledWith("disconnected");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
