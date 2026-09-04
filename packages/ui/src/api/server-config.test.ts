// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveProfile,
  getActiveProfileId,
  getAuthToken,
  createProfile,
  getExistingNativeScopeId,
  getProfiles,
  getNativeScopeId,
  getNativeScopeIds,
  completeNativeScopeDeletion,
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
  removeNativeScopeId,
  retireNativeScopeId,
  subscribeToProfileChanges,
  reconcileManagedProfile,
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
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "127.0.0.1:4800",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:4800",
    });
  });

  afterEach(() => {
    delete document.documentElement.dataset.appHost;
    vi.unstubAllGlobals();
  });

  it("migrates a legacy cross-origin URL into the active profile", () => {
    setServerUrl("http://localhost:4800/");

    migrateToProfiles();

    expect(getProfiles()).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Default Server",
        url: "http://localhost:4800",
        authType: "basic",
        username: undefined,
        createdAt: expect.any(Number),
      },
    ]);
    expect(getActiveProfile()?.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("creates a profile when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Uint8Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const profile = createProfile({
      name: "LAN Server",
      url: "http://192.168.1.10:4800",
      authType: "none",
    });

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(profile.id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(getProfiles()).toEqual([profile]);
  });

  it("aliases legacy profile IDs for native scopes without rewriting profile data", () => {
    const legacyId = "phase5-runtime-profile";
    const profile = {
      id: legacyId,
      name: "Legacy Server",
      url: "http://legacy.test",
      authType: "basic" as const,
      createdAt: 1,
    };
    saveProfiles([profile]);
    setActiveProfile(legacyId);
    setAuthToken("legacy-token", legacyId);
    const persistedProfiles = localStorage.getItem("damhopper_server_profiles");

    const nativeScopeId = getNativeScopeId(legacyId);

    expect(nativeScopeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(getNativeScopeId(legacyId)).toBe(nativeScopeId);
    expect(getNativeScopeIds([legacyId])).toEqual({
      status: "available",
      ids: [nativeScopeId],
    });
    expect(getNativeScopeId(nativeScopeId)).toBe(nativeScopeId);
    expect(localStorage.getItem("damhopper_server_profiles")).toBe(
      persistedProfiles,
    );
    expect(getActiveProfileId()).toBe(legacyId);
    expect(getAuthToken(legacyId)).toBe("legacy-token");

    expect(retireNativeScopeId(legacyId)).toBe(nativeScopeId);
    expect(getExistingNativeScopeId(legacyId)).toBeNull();
    expect(completeNativeScopeDeletion(legacyId, nativeScopeId)).toBe(true);

    expect(removeNativeScopeId(legacyId)).toBe(true);
    expect(localStorage.getItem("damhopper_native_scope_ids")).toBe("{}");
  });

  it("keeps UUID profile IDs as native scope IDs", () => {
    const profileId = "22222222-2222-4222-8222-222222222222";

    expect(getNativeScopeId(profileId)).toBe(profileId);
    expect(localStorage.getItem("damhopper_native_scope_ids")).toBeNull();
  });

  it("fails closed when native scope aliases are malformed", () => {
    localStorage.setItem("damhopper_native_scope_ids", "not-json");

    expect(() => getNativeScopeId("legacy-profile")).toThrow(
      "Native scope identity storage unavailable",
    );
    expect(getExistingNativeScopeId("legacy-profile")).toBeNull();
    expect(getNativeScopeIds(["legacy-profile"])).toEqual({
      status: "unavailable",
    });
    expect(removeNativeScopeId("legacy-profile")).toBe(false);
  });

  it("gives a recreated legacy profile a new native identity", () => {
    const firstNativeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondNativeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce(firstNativeId)
        .mockReturnValueOnce(secondNativeId),
    });

    expect(getNativeScopeId("legacy-profile")).toBe(firstNativeId);
    expect(retireNativeScopeId("legacy-profile")).toBe(firstNativeId);
    expect(getExistingNativeScopeId("legacy-profile")).toBeNull();
    expect(getNativeScopeId("legacy-profile")).toBe(secondNativeId);

    expect(completeNativeScopeDeletion("legacy-profile", firstNativeId)).toBe(
      true,
    );
    expect(getNativeScopeId("legacy-profile")).toBe(secondNativeId);
  });

  it("hides separate-origin active profiles from unsupported native hosts", () => {
    saveProfiles([
      {
        id: "remote",
        name: "Remote",
        url: "http://remote.example:4800",
        authType: "basic",
        createdAt: 1,
      },
    ]);
    setActiveProfile("remote");
    document.documentElement.dataset.appHost = "native";
    document.documentElement.dataset.appPlatform = "android";

    expect(getActiveProfile()).toBeNull();
    expect(getServerUrl()).toBe("http://127.0.0.1:4800");
  });

  it("allows separate-origin profiles on Windows native desktop", () => {
    saveProfiles([
      {
        id: "remote",
        name: "Remote",
        url: "http://remote.example:4800",
        authType: "none",
        createdAt: 1,
      },
    ]);
    setActiveProfile("remote");
    document.documentElement.dataset.appHost = "native";
    document.documentElement.dataset.appPlatform = "windows";

    expect(getActiveProfile()?.id).toBe("remote");
    expect(getServerUrl()).toBe("http://remote.example:4800");
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
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(readServerProfiles()).toEqual({ status: "unavailable" });
  });

  it("emits distinct profile-list, active, and deleted events after delete commits", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeToProfileChanges((event) =>
      events.push(event),
    );
    const profile = {
      id: "profile-a",
      name: "A",
      url: "http://a.test",
      authType: "basic" as const,
      createdAt: 1,
    };
    saveProfiles([profile]);
    expect(events).toContainEqual({ type: "profileListChanged" });
    setActiveProfile(profile.id);
    expect(events).toContainEqual({
      type: "activeChanged",
      activeProfileId: profile.id,
    });
    expect(deleteProfile(profile.id)).toBe(true);
    expect(events).toContainEqual({
      type: "deleted",
      deletedProfileId: profile.id,
      knownProfileIds: { status: "available", ids: [] },
    });
    unsubscribe();
  });

  it("emits data changes without presenting them as active-profile changes", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeToProfileChanges((event) =>
      events.push(event),
    );

    setAuthToken("token", "profile-a");

    expect(events.at(-1)).toEqual({ type: "dataChanged" });
    expect(events).not.toContainEqual({
      type: "activeChanged",
      activeProfileId: null,
    });
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

describe("managed runtime profile reconciliation", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    vi.stubGlobal("sessionStorage", mockStorage());
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "127.0.0.1:4802",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:4802",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a managed profile and sets it active on first load", () => {
    const profile = reconcileManagedProfile({
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      apiUrl: "http://127.0.0.1:4801",
    });

    expect(profile).not.toBeNull();
    expect(getActiveProfile()?.id).toBe("c7325e68-07e1-4e44-8d96-b333a4658cf9");
    expect(getActiveProfile()?.url).toBe("http://127.0.0.1:4801");
  });

  it("preserves existing active user profile when reconciling managed profile", () => {
    const userProfile = {
      id: "user-selected-profile",
      name: "Custom User Server",
      url: "http://custom-server:4800",
      authType: "basic" as const,
      createdAt: 100,
    };
    saveProfiles([userProfile]);
    setActiveProfile(userProfile.id);

    const managed = reconcileManagedProfile({
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      apiUrl: "http://127.0.0.1:4801",
    });

    expect(managed).not.toBeNull();
    expect(getActiveProfile()?.id).toBe("user-selected-profile");
    expect(
      getProfiles().some(
        (p) => p.id === "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      ),
    ).toBe(true);
  });

  it("clears token when managed profile URL changes", () => {
    const managedId = "c7325e68-07e1-4e44-8d96-b333a4658cf9";
    reconcileManagedProfile({
      profileId: managedId,
      apiUrl: "http://127.0.0.1:4801",
    });
    setAuthToken("initial-token", managedId);
    expect(getAuthToken(managedId)).toBe("initial-token");

    // Reconcile with new URL
    reconcileManagedProfile({
      profileId: managedId,
      apiUrl: "http://127.0.0.1:4809",
    });

    expect(getActiveProfile()?.url).toBe("http://127.0.0.1:4809");
    expect(getAuthToken(managedId)).toBeNull();
  });

  it("preserves token when managed profile URL is unchanged", () => {
    const managedId = "c7325e68-07e1-4e44-8d96-b333a4658cf9";
    reconcileManagedProfile({
      profileId: managedId,
      apiUrl: "http://127.0.0.1:4801",
    });
    setAuthToken("stable-token", managedId);

    // Reconcile with same URL
    reconcileManagedProfile({
      profileId: managedId,
      apiUrl: "http://127.0.0.1:4801/",
    });

    expect(getAuthToken(managedId)).toBe("stable-token");
  });

  it("enforces strict per-profile token isolation", () => {
    const profileA = "c7325e68-07e1-4e44-8d96-b333a4658cf9";
    const profileB = "d8436f79-18f2-4f55-9e07-c444b5769da0";

    setAuthToken("token-secret-a", profileA);
    setAuthToken("token-secret-b", profileB);

    expect(getAuthToken(profileA)).toBe("token-secret-a");
    expect(getAuthToken(profileB)).toBe("token-secret-b");

    clearAuthToken(profileA);
    expect(getAuthToken(profileA)).toBeNull();
    expect(getAuthToken(profileB)).toBe("token-secret-b");
  });

  it("fails safely and returns null when given invalid or malformed managed profile config", () => {
    // Empty profileId
    expect(
      reconcileManagedProfile({
        profileId: "   ",
        apiUrl: "http://127.0.0.1:4801",
      }),
    ).toBeNull();

    // Empty API URL
    expect(
      reconcileManagedProfile({
        profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
        apiUrl: "   ",
      }),
    ).toBeNull();
  });
});
