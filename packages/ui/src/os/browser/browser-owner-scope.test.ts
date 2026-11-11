// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import {
  areBrowserNativeTargetKeysEqual,
  areBrowserOwnerScopesEqual,
  browserOwnerScopeKey,
  captureVerifiedBrowserOwner,
  createBrowserNativeTargetKey,
  extractBrowserOwnerScopeFromSnapshot,
  formatBrowserNativeTargetKey,
  isBrowserRuntimeCompatible,
  isCanonicalPositiveU64Decimal,
  isCapturedBrowserOwnerCurrent,
  mayReferenceSameNativeTarget,
  normalizeBrowserEndpoint,
} from "./browser-owner-scope.js";

function connectedSnapshot(
  profileId: string,
  overrides: Partial<ConnectionSnapshot> = {},
): ConnectionSnapshot {
  return {
    owner: { profileId, generation: 1 },
    status: "connected",
    intent: true,
    serverUrl: "http://127.0.0.1:4801/",
    error: null,
    verifiedBrowserIdentity: { principal: "Alice.Admin", namespace: "prod" },
    ...overrides,
  };
}

describe("browser-owner-scope", () => {
  afterEach(() => resetConnections());

  it("normalizes valid HTTP(S) endpoints and rejects invalid or userinfo-bearing URLs", () => {
    expect(normalizeBrowserEndpoint("https://host.test:8443///")).toBe("https://host.test:8443");
    expect(normalizeBrowserEndpoint("localhost:4801/")).toBe("http://localhost:4801");
    expect(normalizeBrowserEndpoint("https://user:pass@host.test")).toBe("");
    expect(normalizeBrowserEndpoint("ftp://host.test")).toBe("");
    expect(normalizeBrowserEndpoint("javascript:alert(1)")).toBe("");
    expect(normalizeBrowserEndpoint("")).toBe("");
  });

  it("fails closed when connection is non-connected, missing identity, or empty principal", () => {
    expect(extractBrowserOwnerScopeFromSnapshot(null)).toBeNull();
    expect(extractBrowserOwnerScopeFromSnapshot(connectedSnapshot("p1", { status: "connecting" }))).toBeNull();
    expect(extractBrowserOwnerScopeFromSnapshot(connectedSnapshot("p1", { status: "login-required" }))).toBeNull();
    expect(extractBrowserOwnerScopeFromSnapshot(connectedSnapshot("p1", { verifiedBrowserIdentity: undefined }))).toBeNull();
    expect(
      extractBrowserOwnerScopeFromSnapshot(
        connectedSnapshot("p1", { verifiedBrowserIdentity: { principal: "   ", namespace: "prod" } }),
      ),
    ).toBeNull();
    expect(
      extractBrowserOwnerScopeFromSnapshot(connectedSnapshot("p1", { serverUrl: "https://u:p@host.test" })),
    ).toBeNull();
  });

  it("captures verified owner with generation fence and detects endpoint, principal, profileId, and namespace drift", () => {
    expect(captureVerifiedBrowserOwner("missing-profile")).toBeNull();
    __setConnectionSnapshotForTests(
      "prof-a",
      connectedSnapshot("prof-a", {
        owner: { profileId: "prof-a", generation: 3 },
        serverUrl: "https://Server.Test:4801/",
        verifiedBrowserIdentity: { principal: "Alice.Admin", namespace: "prod" },
      }),
    );

    const captured = captureVerifiedBrowserOwner("prof-a");
    expect(captured).toEqual({
      owner: { profileId: "prof-a", generation: 3 },
      scope: {
        profileId: "prof-a",
        endpoint: "https://Server.Test:4801",
        principal: "Alice.Admin",
        namespace: "prod",
      },
    });
    expect(isCapturedBrowserOwnerCurrent(captured!.owner, captured!.scope)).toBe(true);

    __setConnectionSnapshotForTests(
      "prof-a",
      connectedSnapshot("prof-a", { owner: { profileId: "prof-a", generation: 4 }, serverUrl: "https://Server.Test:4801" }),
    );
    expect(isCapturedBrowserOwnerCurrent(captured!.owner, captured!.scope)).toBe(false);

    const fresh = captureVerifiedBrowserOwner("prof-a")!;
    __setConnectionSnapshotForTests(
      "prof-a",
      connectedSnapshot("prof-a", { owner: fresh.owner, serverUrl: "https://Other.Test:4801" }),
    );
    expect(isCapturedBrowserOwnerCurrent(fresh.owner, fresh.scope)).toBe(false);

    __setConnectionSnapshotForTests(
      "prof-a",
      connectedSnapshot("prof-a", {
        owner: fresh.owner,
        serverUrl: "https://Server.Test:4801",
        verifiedBrowserIdentity: { principal: "alice.admin", namespace: "prod" },
      }),
    );
    expect(isCapturedBrowserOwnerCurrent(fresh.owner, fresh.scope)).toBe(false);

    __setConnectionSnapshotForTests(
      "prof-a",
      connectedSnapshot("prof-a", {
        owner: fresh.owner,
        serverUrl: "https://Server.Test:4801",
        verifiedBrowserIdentity: { principal: "Alice.Admin", namespace: "dev" },
      }),
    );
    expect(isCapturedBrowserOwnerCurrent(fresh.owner, fresh.scope)).toBe(false);
    expect(isCapturedBrowserOwnerCurrent({ profileId: "prof-other", generation: fresh.owner.generation }, fresh.scope)).toBe(false);
  });

  it("keeps two profile scopes isolated while sharing one native target key across profileIds", () => {
    const scopeA = extractBrowserOwnerScopeFromSnapshot(
      connectedSnapshot("profile-alpha", {
        serverUrl: "https://browser.host/",
        verifiedBrowserIdentity: { principal: "Alice", namespace: "prod" },
      }),
    )!;
    const scopeB = extractBrowserOwnerScopeFromSnapshot(
      connectedSnapshot("profile-beta", {
        serverUrl: "https://browser.host",
        verifiedBrowserIdentity: { principal: "Alice", namespace: "prod" },
      }),
    )!;

    expect(areBrowserOwnerScopesEqual(scopeA, scopeB)).toBe(false);
    expect(browserOwnerScopeKey(scopeA)).not.toBe(browserOwnerScopeKey(scopeB));

    const nativeA = createBrowserNativeTargetKey(scopeA, "sess-1");
    const nativeB = createBrowserNativeTargetKey(scopeB, "sess-1");
    expect(nativeA).toEqual({
      endpoint: "https://browser.host",
      principal: "Alice",
      namespace: "prod",
      sessionId: "sess-1",
    });
    expect(areBrowserNativeTargetKeysEqual(nativeA, nativeB)).toBe(true);
    expect(formatBrowserNativeTargetKey(nativeA!)).toBe(formatBrowserNativeTargetKey(nativeB!));
    expect("profileId" in nativeA!).toBe(false);

    expect(areBrowserNativeTargetKeysEqual(nativeA, createBrowserNativeTargetKey({ ...scopeB, namespace: "dev" }, "sess-1"))).toBe(false);
    expect(areBrowserNativeTargetKeysEqual(nativeA, createBrowserNativeTargetKey({ ...scopeB, principal: "alice" }, "sess-1"))).toBe(false);
    expect(areBrowserNativeTargetKeysEqual(nativeA, createBrowserNativeTargetKey({ ...scopeB, endpoint: "https://other.host" }, "sess-1"))).toBe(false);
  });

  it("checks runtime incarnation and decimal u64 profileEpoch precision without equating missing evidence with absence", () => {
    expect(isCanonicalPositiveU64Decimal("1")).toBe(true);
    expect(isCanonicalPositiveU64Decimal("18446744073709551615")).toBe(true);
    expect(isCanonicalPositiveU64Decimal("0")).toBe(false);
    expect(isCanonicalPositiveU64Decimal("01")).toBe(false);
    expect(isCanonicalPositiveU64Decimal("18446744073709551616")).toBe(false);

    const scopeA = extractBrowserOwnerScopeFromSnapshot(
      connectedSnapshot("p-a", { serverUrl: "https://host.test", verifiedBrowserIdentity: { principal: "dev-user", namespace: "dev" } }),
    )!;
    const scopeB = extractBrowserOwnerScopeFromSnapshot(
      connectedSnapshot("p-b", { serverUrl: "https://host.test", verifiedBrowserIdentity: { principal: "dev-user", namespace: "dev" } }),
    )!;

    expect(
      mayReferenceSameNativeTarget({
        scopeA, sessionIdA: "s-1", runtimeA: { browserIncarnation: "inc-1", profileEpoch: "18446744073709551615" },
        scopeB, sessionIdB: "s-1", runtimeB: { browserIncarnation: "inc-1", profileEpoch: "18446744073709551615" },
      }),
    ).toBe(true);
    expect(
      mayReferenceSameNativeTarget({
        scopeA, sessionIdA: "s-1", runtimeA: { browserIncarnation: "inc-1", profileEpoch: "10" },
        scopeB, sessionIdB: "s-1", runtimeB: { browserIncarnation: "inc-2", profileEpoch: "10" },
      }),
    ).toBe(false);
    expect(
      mayReferenceSameNativeTarget({
        scopeA, sessionIdA: "s-1", runtimeA: { browserIncarnation: "inc-1", profileEpoch: "18446744073709551615" },
        scopeB, sessionIdB: "s-1", runtimeB: { browserIncarnation: "inc-1", profileEpoch: "18446744073709551614" },
      }),
    ).toBe(false);
    expect(
      mayReferenceSameNativeTarget({
        scopeA, sessionIdA: "s-1", runtimeA: { browserIncarnation: "inc-1", profileEpoch: "2" },
        scopeB, sessionIdB: "s-1", runtimeB: undefined,
      }),
    ).toBe(true);
    expect(isBrowserRuntimeCompatible({ browserIncarnation: "inc-1", profileEpoch: "0" }, { browserIncarnation: "inc-1", profileEpoch: "1" })).toBe(false);
    expect(isBrowserRuntimeCompatible({ profileEpoch: 123 as unknown as string }, { profileEpoch: "1" })).toBe(false);
    expect(isBrowserRuntimeCompatible({ browserIncarnation: "" }, { browserIncarnation: "inc-2" })).toBe(true);
  });
});
