import { describe, expect, it } from "vitest";
import {
  buildAgentSettingsHref,
  parseAgentStoreLocation,
} from "./agent-store-navigation.js";

describe("Agent Store navigation", () => {
  it.each(["profile-b", "a&b?c#d% e", "máy chủ 日本", "literal%26", "a+b/c= d"])(
    "round-trips profile %s with exactly one encode/decode",
    (profileId) => {
      const href = buildAgentSettingsHref(profileId);
      expect(href).toBe(`/agent-store?tab=settings&profileId=${encodeURIComponent(profileId)}`);
      expect(parseAgentStoreLocation(new URL(href, "https://example.test").search)).toEqual({
        tab: "settings",
        profile: { kind: "explicit", profileId },
      });
    },
  );

  it("builds a chooser link instead of an ambient target", () => {
    expect(buildAgentSettingsHref(null)).toBe("/agent-store?tab=settings");
    expect(parseAgentStoreLocation("?tab=settings")).toEqual({
      tab: "settings", profile: { kind: "choose" },
    });
  });

  it("keeps ordinary bare entry defaults", () => {
    expect(parseAgentStoreLocation("")).toEqual({
      tab: "store", profile: { kind: "default" },
    });
  });

  it.each(["store", "memory", "settings", "import"])(
    "retains an explicit profile independently of %s tab", (tab) => {
      expect(parseAgentStoreLocation(`?tab=${tab}&profileId=B`)).toEqual({
        tab, profile: { kind: "explicit", profileId: "B" },
      });
    },
  );

  it.each(["?profileId=", "?profileId", "?profileId=B&profileId=B", "?profileId=&profileId=B"])(
    "denies empty or repeated profile parameters: %s", (search) => {
      expect(parseAgentStoreLocation(search).profile).toEqual({ kind: "invalid" });
    },
  );

  it.each(["?tab=unknown&profileId=B", "?tab=settings&tab=memory&profileId=B", "?tab=&profileId=B"])(
    "defaults unrecognized/repeated tab without erasing target: %s", (search) => {
      expect(parseAgentStoreLocation(search)).toEqual({
        tab: "store", profile: { kind: "explicit", profileId: "B" },
      });
    },
  );

  it("does not use truthiness or decode an already decoded identifier again", () => {
    expect(parseAgentStoreLocation("?profileId=%2526").profile).toEqual({
      kind: "explicit", profileId: "%26",
    });
    expect(parseAgentStoreLocation("?profileId=+").profile).toEqual({
      kind: "explicit", profileId: " ",
    });
    expect(parseAgentStoreLocation("?tab=settings&profileId=").profile).toEqual({ kind: "invalid" });
  });
});
