import { describe, expect, it, vi } from "vitest";
import { handleIpcStatusChange, handleWorkspaceChanged } from "./use-sse.js";

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

describe("handleWorkspaceChanged", () => {
  it("removes project language scans before broad invalidation", async () => {
    let resolveReset!: () => void;
    const queryClient = {
      removeQueries: vi.fn(),
      resetQueries: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveReset = resolve;
          }),
      ),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(() => Promise.resolve()),
    };

    const cleanup = handleWorkspaceChanged(queryClient);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    resolveReset();
    await cleanup;

    expect(queryClient.resetQueries).toHaveBeenCalledWith({
      queryKey: ["explorer-language-scan"],
    });
    expect(queryClient.setQueriesData).toHaveBeenCalledWith(
      { queryKey: ["explorer-language-scan"] },
      expect.any(Function),
    );
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ["explorer-language-scan"],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["known-workspaces"],
    });
    expect(queryClient.removeQueries.mock.invocationCallOrder[0]).toBeLessThan(
      queryClient.invalidateQueries.mock.invocationCallOrder[0]!,
    );
  });
});
