import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDisconnect, mockFence } = vi.hoisted(() => ({
  mockDisconnect: vi.fn(),
  mockFence: vi.fn(),
}));

vi.mock("@/api/connections.js", () => ({ disconnectProfile: mockDisconnect }));
vi.mock("@/os/BrowserStreamKeepAliveHost.js", () => ({
  fenceBrowserViewsForProfile: mockFence,
}));

import { fenceThenDisconnectProfile } from "./browser-logout-fence.js";

describe("fenceThenDisconnectProfile", () => {
  beforeEach(() => {
    mockDisconnect.mockReset();
    mockFence.mockReset();
  });

  it("fences views with the captured generation BEFORE the generation-advancing disconnect", () => {
    fenceThenDisconnectProfile("profile-1", 4, {
      browserResetState: "cleared",
      sessionRevoked: true,
    });

    expect(mockFence).toHaveBeenCalledWith(
      "profile-1",
      "Shared Browser profile reset or logged out",
      4,
    );
    expect(mockDisconnect).toHaveBeenCalledWith("profile-1");
    expect(mockFence.mock.invocationCallOrder[0]).toBeLessThan(
      mockDisconnect.mock.invocationCallOrder[0],
    );
  });

  it("still disconnects but does not fence when nothing was reset and revocation failed", () => {
    fenceThenDisconnectProfile("profile-1", 4, {
      browserResetState: "retained",
      sessionRevoked: false,
    });

    expect(mockFence).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalledWith("profile-1");
  });
});
