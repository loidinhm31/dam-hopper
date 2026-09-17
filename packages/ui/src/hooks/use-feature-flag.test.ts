// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFeatureAvailability, useFeatureFlag, type FeatureAvailability } from "./use-feature-flag.js";

vi.mock("@/api/server-config.js", () => ({
  getActiveProfileId: vi.fn(() => "profile-active"),
}));
vi.mock("@/api/connections.js", () => ({
  subscribeConnections: vi.fn(() => () => {}),
  getConnectionSnapshot: vi.fn((profileId: string) => {
    if (profileId === "profile-active") {
      return {
        owner: { profileId: "profile-active", generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: "http://127.0.0.1:4800",
      };
    }
    if (profileId === "profile-unsupported") {
      return {
        owner: { profileId: "profile-unsupported", generation: 0 },
        status: "unsupported",
        intent: false,
        serverUrl: "http://127.0.0.1:4801",
        error: "DamHopper workbench protocol 2 is required",
      };
    }
    if (profileId === "profile-connecting") {
      return {
        owner: { profileId: "profile-connecting", generation: 0 },
        status: "connecting",
        intent: true,
        serverUrl: "http://127.0.0.1:4802",
      };
    }
    if (profileId === "profile-offline") {
      return {
        owner: { profileId: "profile-offline", generation: 0 },
        status: "offline",
        intent: false,
        serverUrl: "http://127.0.0.1:4803",
      };
    }
    return null;
  }),
}));

describe("useFeatureAvailability and useFeatureFlag", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function testHook<T>(hookFn: () => T): { getResult: () => T } {
    let result!: T;
    function TestComponent() {
      result = hookFn();
      return null;
    }
    act(() => {
      root.render(createElement(TestComponent));
    });
    return { getResult: () => result };
  }

  it("returns available for connected active profile", () => {
    const { getResult } = testHook(() => useFeatureAvailability("browser-debug"));
    expect(getResult().state).toBe("available");
    expect(getResult().isAvailable).toBe(true);
  });

  it("returns unavailable with reason for unsupported profile", () => {
    const { getResult } = testHook(() =>
      useFeatureAvailability("browser-debug", { profileId: "profile-unsupported" }),
    );
    expect(getResult().state).toBe("unavailable");
    expect(getResult().reason).toContain("protocol 2 is required");
    expect(getResult().isAvailable).toBe(false);
  });

  it("returns loading for connecting profile", () => {
    const { getResult } = testHook(() =>
      useFeatureAvailability("browser-debug", { profileId: "profile-connecting" }),
    );
    expect(getResult().state).toBe("loading");
    expect(getResult().isAvailable).toBe(false);
  });

  it("returns unavailable for offline profile without cross-profile interference", () => {
    let activeResult!: FeatureAvailability;
    let offlineResult!: FeatureAvailability;

    function DualComponent() {
      activeResult = useFeatureAvailability("browser-debug", { profileId: "profile-active" });
      offlineResult = useFeatureAvailability("browser-debug", { profileId: "profile-offline" });
      return null;
    }

    act(() => {
      root.render(createElement(DualComponent));
    });

    expect(activeResult.state).toBe("available");
    expect(activeResult.isAvailable).toBe(true);

    expect(offlineResult.state).toBe("unavailable");
    expect(offlineResult.isAvailable).toBe(false);
  });

  it("useFeatureFlag returns boolean based on owner-local availability", () => {
    let activeFlag = false;
    let unsupportedFlag = true;

    function FlagComponent() {
      activeFlag = useFeatureFlag("browser-debug", { profileId: "profile-active" });
      unsupportedFlag = useFeatureFlag("browser-debug", { profileId: "profile-unsupported" });
      return null;
    }

    act(() => {
      root.render(createElement(FlagComponent));
    });

    expect(activeFlag).toBe(true);
    expect(unsupportedFlag).toBe(false);
  });
});
