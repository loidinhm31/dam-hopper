// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  performFreshStateReset,
  isLegacyResourceKey,
  checkLegacyDeepLink,
  shouldShowFreshResetNotice,
  dismissFreshResetNotice,
} from "./fresh-state-reset.js";

describe("fresh-state-reset", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("identifies legacy resource keys correctly", () => {
    expect(isLegacyResourceKey("dam-hopper:active-project")).toBe(true);
    expect(isLegacyResourceKey("dam-hopper:terminal-pins")).toBe(true);
    expect(isLegacyResourceKey("dam-hopper:terminal-layout:default")).toBe(true);
    expect(isLegacyResourceKey("dam-hopper:terminal-layout:v3:['p1',1]")).toBe(false);
    expect(isLegacyResourceKey("some-key:legacy-unowned:backup")).toBe(true);
    expect(isLegacyResourceKey("damhopper_quarantine_records")).toBe(true);
    expect(isLegacyResourceKey("damhopper_server_profiles")).toBe(false);
    expect(isLegacyResourceKey("damhopper_profile_auth_v2_p1")).toBe(false);
  });

  it("discards legacy keys and preserves saved profiles and new-version stores", () => {
    const clearSpy = vi.spyOn(localStorage, "clear");

    // Set legacy keys
    localStorage.setItem("dam-hopper:active-project", "legacy-project");
    localStorage.setItem("dam-hopper:terminal-pins", "legacy-pins");
    localStorage.setItem("dam-hopper:terminal-layout:old", "legacy-layout");
    localStorage.setItem("dam-hopper:quarantine:backup", "bad-data");

    // Set valid new keys
    localStorage.setItem("damhopper_server_profiles", JSON.stringify([{ id: "p1" }]));
    localStorage.setItem("damhopper_profile_auth_v2_p1", JSON.stringify({ version: 2 }));
    localStorage.setItem("dam-hopper:terminal-layout:v3:['p1',1]", "valid-v3-layout");
    localStorage.setItem("dam-hopper:workspace-state", JSON.stringify({ version: 1 }));

    const result = performFreshStateReset();
    expect(result.applied).toBe(true);
    expect(clearSpy).not.toHaveBeenCalled();

    // Legacy keys removed
    expect(localStorage.getItem("dam-hopper:active-project")).toBeNull();
    expect(localStorage.getItem("dam-hopper:terminal-pins")).toBeNull();
    expect(localStorage.getItem("dam-hopper:terminal-layout:old")).toBeNull();
    expect(localStorage.getItem("dam-hopper:quarantine:backup")).toBeNull();

    // Valid new keys preserved
    expect(localStorage.getItem("damhopper_server_profiles")).not.toBeNull();
    expect(localStorage.getItem("damhopper_profile_auth_v2_p1")).not.toBeNull();
    expect(localStorage.getItem("dam-hopper:terminal-layout:v3:['p1',1]")).not.toBeNull();
    expect(localStorage.getItem("dam-hopper:workspace-state")).not.toBeNull();

    // Notice pending flag set
    expect(shouldShowFreshResetNotice()).toBe(true);
    dismissFreshResetNotice();
    expect(shouldShowFreshResetNotice()).toBe(false);

    clearSpy.mockRestore();
  });

  it("is idempotent across retries and reloads", () => {
    localStorage.setItem("dam-hopper:active-project", "legacy-project");
    performFreshStateReset();
    expect(localStorage.getItem("dam-hopper:active-project")).toBeNull();

    // Run again
    const second = performFreshStateReset();
    expect(second.applied).toBe(true);
    expect(second.keysRemoved).toEqual([]);
  });

  it("rejects legacy deep links without profileId and guides the user", () => {
    const legacyProjectLink = checkLegacyDeepLink({
      search: "?project=foo",
      hash: "",
    });
    expect(legacyProjectLink.isLegacy).toBe(true);
    expect(legacyProjectLink.guidance).toContain("Legacy unqualified link detected without profileId");

    const legacySessionLink = checkLegacyDeepLink({
      search: "?session=abc",
      hash: "",
    });
    expect(legacySessionLink.isLegacy).toBe(true);

    const validQualifiedLink = checkLegacyDeepLink({
      search: "?profileId=p1&project=foo",
      hash: "",
    });
    expect(validQualifiedLink.isLegacy).toBe(false);

    const normalLink = checkLegacyDeepLink({
      search: "",
      hash: "",
    });
    expect(normalLink.isLegacy).toBe(false);
  });
});
