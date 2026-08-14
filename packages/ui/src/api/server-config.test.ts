// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveProfile,
  getAuthToken,
  getProfiles,
  clearAuthToken,
  deleteProfile,
  getServerUrl,
  haveServerUrlsChanged,
  migrateToProfiles,
  normalizeServerUrl,
  saveProfiles,
  setActiveProfile,
  setAuthToken,
  setServerUrl,
  shouldClearAuthTokenForUrlChange,
  readServerProfiles,
  subscribeToProfileChanges,
} from "./server-config.js";

function mockStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("server profile migration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    vi.stubGlobal("sessionStorage", mockStorage());
    vi.stubGlobal("crypto", { randomUUID: () => "profile-id" });
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "127.0.0.1:4800",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:4800",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates a legacy cross-origin URL into the active profile", () => {
    setServerUrl("http://localhost:4800/");

    migrateToProfiles();

    expect(getProfiles()).toEqual([
      {
        id: "profile-id",
        name: "Default Server",
        url: "http://localhost:4800",
        authType: "basic",
        username: undefined,
        createdAt: expect.any(Number),
      },
    ]);
    expect(getActiveProfile()?.id).toBe("profile-id");
  });

  it("normalizes equivalent URLs without treating trailing slashes as changes", () => {
    expect(normalizeServerUrl(" localhost:4800/// ")).toBe(
      "http://localhost:4800",
    );
    expect(
      haveServerUrlsChanged("http://localhost:4800/", "localhost:4800"),
    ).toBe(false);
  });

  it("rejects non-http URL schemes during normalization", () => {
    expect(normalizeServerUrl("ftp://example.test")).toBe("");
    expect(normalizeServerUrl("javascript:alert(1)")).toBe("");
    expect(normalizeServerUrl("localhost:4800")).toBe("http://localhost:4800");
  });

  it("clears an unchanged token when a profile URL changes", () => {
    expect(
      shouldClearAuthTokenForUrlChange(
        "http://old.test",
        "https://new.test",
        "old-token",
        "old-token",
      ),
    ).toBe(true);
    expect(
      shouldClearAuthTokenForUrlChange(
        "http://old.test",
        "https://new.test",
        "old-token",
        "new-token",
      ),
    ).toBe(false);
    expect(
      shouldClearAuthTokenForUrlChange(
        "http://old.test/",
        "old.test",
        "old-token",
        "old-token",
      ),
    ).toBe(false);
  });

  it("migrates a legacy same-origin URL instead of forcing setup", () => {
    setServerUrl("http://127.0.0.1:4800");

    migrateToProfiles();

    expect(getProfiles()).toHaveLength(1);
    expect(getActiveProfile()?.url).toBe("http://127.0.0.1:4800");
  });

  it("uses migrated active profile for server URL after migration", () => {
    setServerUrl("http://localhost:4800/");

    migrateToProfiles();

    expect(getServerUrl()).toBe("http://localhost:4800");
  });

  it("keeps persisted tokens isolated by profile", () => {
    saveProfiles([
      {
        id: "profile-a",
        name: "A",
        url: "http://a.test",
        authType: "basic",
        createdAt: 1,
      },
      {
        id: "profile-b",
        name: "B",
        url: "http://b.test",
        authType: "basic",
        createdAt: 2,
      },
    ]);
    setActiveProfile("profile-a");
    setAuthToken("token-a", "profile-a");
    setAuthToken("token-b", "profile-b");

    expect(getAuthToken("profile-a")).toBe("token-a");
    expect(getAuthToken("profile-b")).toBe("token-b");

    clearAuthToken("profile-a");
    expect(getAuthToken("profile-a")).toBeNull();
    expect(getAuthToken("profile-b")).toBe("token-b");
  });

  it("migrates the legacy session token into the created profile", () => {
    setServerUrl("http://localhost:4800/");
    sessionStorage.setItem("damhopper_auth_token", "legacy-token");

    migrateToProfiles();

    const profile = getActiveProfile();
    expect(profile).not.toBeNull();
    expect(getAuthToken(profile?.id)).toBe("legacy-token");
    expect(localStorage.getItem("damhopper_auth_token")).toBeNull();
    expect(sessionStorage.getItem("damhopper_auth_token")).toBeNull();
  });

  it("cleans the legacy token when the destination profile is already authenticated", () => {
    const profile = {
      id: "profile-id",
      name: "Existing Server",
      url: "http://localhost:4800",
      authType: "basic" as const,
      createdAt: 1,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setAuthToken("profile-token", profile.id);
    localStorage.setItem("damhopper_auth_token", "legacy-token");

    migrateToProfiles();

    expect(getAuthToken(profile.id)).toBe("profile-token");
    expect(localStorage.getItem("damhopper_auth_token")).toBeNull();
  });

  it("does not migrate a legacy token to a profile with a different URL", () => {
    const profile = {
      id: "profile-id",
      name: "Existing Server",
      url: "http://new.test",
      authType: "basic" as const,
      createdAt: 1,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setServerUrl("http://old.test");
    localStorage.setItem("damhopper_auth_token", "old-token");

    migrateToProfiles();

    expect(getAuthToken(profile.id)).toBeNull();
    expect(localStorage.getItem("damhopper_auth_token")).toBeNull();
  });

  it("discards an orphan legacy token when no server URL is configured", () => {
    localStorage.setItem("damhopper_auth_token", "orphan-token");
    sessionStorage.setItem("damhopper_auth_token", "orphan-session-token");

    migrateToProfiles();

    expect(localStorage.getItem("damhopper_auth_token")).toBeNull();
    expect(sessionStorage.getItem("damhopper_auth_token")).toBeNull();
  });

  it("filters malformed persisted profiles before exposing them", () => {
    localStorage.setItem(
      "damhopper_server_profiles",
      JSON.stringify([
        {
          id: "valid",
          name: "Valid",
          url: "http://valid.test",
          authType: "basic",
          createdAt: 1,
        },
        { id: "missing-url", name: "Invalid", authType: "basic" },
      ]),
    );

    expect(getProfiles()).toHaveLength(1);
    expect(getProfiles()[0]?.id).toBe("valid");
  });

  it("attempts session-token cleanup even when localStorage removal fails", () => {
    setAuthToken("profile-token", "profile-a");
    sessionStorage.setItem(
      "damhopper_auth_token_profile-a",
      "legacy-profile-token",
    );
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(clearAuthToken("profile-a")).toBe(false);
    expect(sessionStorage.getItem("damhopper_auth_token_profile-a")).toBeNull();
  });

  it("reports unavailable profile reads rather than an authoritative empty list", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(readServerProfiles()).toEqual({ status: "unavailable" });
  });

  it("emits typed active and deleted events only after delete commits", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeToProfileChanges((event) => events.push(event));
    const profile = { id: "profile-a", name: "A", url: "http://a.test", authType: "basic" as const, createdAt: 1 };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    expect(deleteProfile(profile.id)).toBe(true);
    expect(events).toContainEqual({ type: "deleted", deletedProfileId: profile.id, knownProfileIds: { status: "available", ids: [] } });
    unsubscribe();
  });

  it("selects a replacement and clears credentials when deleting active profile", () => {
    const profileA = {
      id: "profile-a",
      name: "A",
      url: "http://a.test",
      authType: "basic" as const,
      createdAt: 1,
    };
    const profileB = {
      id: "profile-b",
      name: "B",
      url: "http://b.test",
      authType: "basic" as const,
      createdAt: 2,
    };
    saveProfiles([profileA, profileB]);
    setActiveProfile(profileA.id);
    setAuthToken("token-a", profileA.id);

    deleteProfile(profileA.id);

    expect(getActiveProfile()?.id).toBe(profileB.id);
    expect(getAuthToken(profileA.id)).toBeNull();
  });
});
