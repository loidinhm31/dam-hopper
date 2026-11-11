// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureConnection,
  connectProfile,
  disconnectProfile,
  getAllConnectionSnapshots,
  getApi,
  getConnectionSnapshot,
  getTransport,
  isCurrentConnection,
  removeProfileConnection,
  resetConnections,
  registerConnectionRegistryQueryClient,
  isQueryClientRegistered,
  getUiConnectionReceipt,
  subscribeUiConnectionReceipt,
} from "./connections.js";
import type { UiConnectionFrame } from "./client.js";
import { syncActiveProfileConnection } from "./connections.js";
import { latestTerminalSessionIncarnation, rememberTerminalSessionIncarnation } from "../lib/terminal-incarnation-state.js";
import { ConnectionOwnerError } from "./ownership.js";
import { getTransport as getAmbientTransport } from "./transport.js";
import { IdleTransport } from "./idle-transport.js";
import { subscribeIpc } from "../hooks/use-sse.js";
// Mock server-config getters
const initialMockProfiles = [
  {
    id: "prof-valid",
    name: "Valid Server",
    url: "http://localhost:4801",
    authType: "none" as const,
    createdAt: Date.now(),
  },
  {
    id: "prof-auth",
    name: "Auth Server",
    url: "http://localhost:4802",
    authType: "basic" as const,
    createdAt: Date.now(),
  },
  {
    id: "prof-bad-url",
    name: "Bad URL Server",
    url: "not-a-valid-url",
    authType: "none" as const,
    createdAt: Date.now(),
  },
];
let mockProfiles: Array<{
  id: string;
  name: string;
  url: string;
  authType: "basic" | "none";
  createdAt: number;
}> = initialMockProfiles.map((profile) => ({ ...profile }));
let mockTokens: Record<string, string | null> = {};
let mockKnownProfilesStatus: "available" | "unavailable" = "available";
const { profileChangeSubscribers } = vi.hoisted(() => ({
  profileChangeSubscribers: new Set<(event?: unknown) => void>(),
}));

vi.mock("./server-config.js", () => ({
  getProfiles: vi.fn(() => mockProfiles),
  readServerProfiles: vi.fn(() =>
    mockKnownProfilesStatus === "available"
      ? { status: "available" as const, profiles: mockProfiles }
      : { status: "unavailable" as const },
  ),
  getAuthToken: vi.fn((profileId?: string) =>
    profileId ? mockTokens[profileId] ?? null : null,
  ),
  setAuthToken: vi.fn((token: string, profileId?: string) => {
    if (profileId) mockTokens[profileId] = token;
    return true;
  }),
  clearAuthToken: vi.fn((profileId?: string) => {
    if (profileId) delete mockTokens[profileId];
    return true;
  }),
  getServerUrl: vi.fn(() => "http://localhost:4801"),
  getActiveProfileId: vi.fn(() => "prof-valid"),
  normalizeServerUrl: vi.fn((u: string) => u.trim().replace(/\/+$/, "")),
  subscribeToProfileChanges: vi.fn((cb: (event?: unknown) => void) => {
    profileChangeSubscribers.add(cb);
    return () => profileChangeSubscribers.delete(cb);
  }),
}));
class MockWebSocket {
  static OPEN = 1;
  static deferOpen = false;
  static sockets: MockWebSocket[] = [];
  readyState = 1; // WebSocket.OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.sockets.push(this);
    if (MockWebSocket.deferOpen) {
      this.readyState = 0;
      return;
    }
    Promise.resolve().then(() => {
      this.onopen?.();
    });
  }

  send = vi.fn<(data: string) => void>();
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.onclose?.(code !== undefined ? { code, reason } : undefined);
  }
}
vi.stubGlobal("WebSocket", MockWebSocket);

describe("connections registry", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
    resetConnections();
    mockTokens = {};
    vi.restoreAllMocks();
    MockWebSocket.sockets = [];
    MockWebSocket.deferOpen = false;
    mockProfiles = initialMockProfiles.map((profile) => ({ ...profile }));
    mockKnownProfilesStatus = "available";
  });

  afterEach(() => {
    resetConnections();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns null for unknown profile snapshot", () => {
    expect(getConnectionSnapshot("unknown-profile")).toBeNull();
    expect(getAllConnectionSnapshots()).toEqual([]);
  });

  it("marks invalid server URL as unsupported", async () => {
    await connectProfile("prof-bad-url");
    const snapshot = getConnectionSnapshot("prof-bad-url");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("unsupported");
    expect(snapshot?.intent).toBe(false);
    expect(snapshot?.error).toContain("Invalid server URL");
  });

  it("sets status to login-required when basic auth profile has no token", async () => {
    mockTokens["prof-auth"] = null;
    await connectProfile("prof-auth");
    const snapshot = getConnectionSnapshot("prof-auth");
    expect(snapshot?.status).toBe("login-required");
    expect(snapshot?.error).toContain("Login required");
  });

  it("marks profile unsupported when workbenchProtocol is missing or not 2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true }), // missing workbenchProtocol: 2
      }),
    );

    await connectProfile("prof-valid");
    const snapshot = getConnectionSnapshot("prof-valid");
    expect(snapshot?.status).toBe("unsupported");
    expect(snapshot?.error).toContain("DamHopper workbench protocol 2 is required");
  });

  it("successfully connects when workbenchProtocol is 2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );

    await connectProfile("prof-valid");
    await Promise.resolve();
    await Promise.resolve();
    const snapshot = getConnectionSnapshot("prof-valid");
    expect(snapshot?.status).toBe("connected");
    expect(snapshot?.error).toBeNull();
    expect(snapshot?.intent).toBe(true);

    const owner = captureConnection("prof-valid");
    expect(owner.profileId).toBe("prof-valid");
    expect(isCurrentConnection(owner)).toBe(true);

    const transport = getTransport(owner);
    expect(transport).toBeDefined();

    const api = getApi(owner);
    expect(api).toBeDefined();
    expect(api.owner).toEqual(owner);
  });

  it("rejects getTransport and getApi for stale generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );

    await connectProfile("prof-valid");
    await Promise.resolve();
    await Promise.resolve();
    const owner1 = captureConnection("prof-valid");

    // Disconnect advances generation
    disconnectProfile("prof-valid");

    expect(isCurrentConnection(owner1)).toBe(false);

    expect(() => getTransport(owner1)).toThrowError(ConnectionOwnerError);
    expect(() => getApi(owner1)).toThrowError(ConnectionOwnerError);
  });
  it("handles profile removal with tombstone preventing reconnect", async () => {
    removeProfileConnection("prof-valid");
    expect(getConnectionSnapshot("prof-valid")).toBeNull();

    await expect(connectProfile("prof-valid")).rejects.toThrowError(
      ConnectionOwnerError,
    );
  });

  it("is idempotent when profile is already connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );

    await connectProfile("prof-valid");
    const ownerFirst = captureConnection("prof-valid");

    // Calling connectProfile again while connected should be a no-op
    await connectProfile("prof-valid");
    const ownerSecond = captureConnection("prof-valid");

    expect(ownerSecond).toEqual(ownerFirst);
    expect(ownerSecond.generation).toBe(ownerFirst.generation);
  });

  it("keeps same-ID terminal writes and peer incarnation state isolated across disconnect and reconnect", async () => {
    mockTokens["prof-auth"] = "token-b";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
    }));
    await connectProfile("prof-valid");
    await connectProfile("prof-auth");
    const ownerA = captureConnection("prof-valid");
    const ownerB = captureConnection("prof-auth");
    const a = getTransport(ownerA);
    const b = getTransport(ownerB);
    const socketA = MockWebSocket.sockets[0]!;
    const socketB = MockWebSocket.sockets[1]!;
    const terminalB = { profileId: "prof-auth", id: "shared" };
    rememberTerminalSessionIncarnation(terminalB, 9);

    a.terminalWrite("shared", "only-a");
    b.terminalWrite("shared", "only-b");
    expect(socketA.send.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
      { kind: "terminal:write", id: "shared", data: "only-a" },
    ]);
    expect(socketB.send.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
      { kind: "terminal:write", id: "shared", data: "only-b" },
    ]);

    disconnectProfile("prof-valid");
    syncActiveProfileConnection("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("disconnected");
    expect(latestTerminalSessionIncarnation(terminalB)).toBe(9);
    expect(isCurrentConnection(ownerB)).toBe(true);
    expect(socketB.readyState).toBe(MockWebSocket.OPEN);
    a.terminalWrite("shared", "stale-a");
    b.terminalResize("shared", 100, 30);
    expect(socketA.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socketB.send.mock.calls[1]![0])).toEqual({
      kind: "terminal:resize", id: "shared", cols: 100, rows: 30,
    });
    await connectProfile("prof-valid");
    expect(() => getTransport(ownerA)).toThrowError(ConnectionOwnerError);
    expect(getTransport(ownerB)).toBe(b);
    expect(latestTerminalSessionIncarnation(terminalB)).toBe(9);
  });
  it("does not demote ambient transport when disconnecting a non-ambient profile", async () => {
    mockTokens["prof-auth"] = "token-b";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );
    await connectProfile("prof-valid");
    const ambientBefore = getAmbientTransport();
    expect(ambientBefore).not.toBeInstanceOf(IdleTransport);

    await connectProfile("prof-auth");

    disconnectProfile("prof-auth");

    const ambientAfter = getAmbientTransport();
    expect(ambientAfter).toBe(ambientBefore);
    expect(ambientAfter).not.toBeInstanceOf(IdleTransport);

    disconnectProfile("prof-valid");
    const ambientFinal = getAmbientTransport();
    expect(ambientFinal).toBeInstanceOf(IdleTransport);
  });

  it("deduplicates concurrent in-flight connect calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );

    const p1 = connectProfile("prof-valid");
    const p2 = connectProfile("prof-valid");

    expect(p1).toBe(p2);
    await p1;

    expect(getConnectionSnapshot("prof-valid")?.status).toBe("connected");
  });

  it("registerConnectionRegistryQueryClient exports and registers QueryClient correctly", () => {
    const qc = {};
    expect(isQueryClientRegistered(qc)).toBe(false);
    const unreg = registerConnectionRegistryQueryClient(qc);
    expect(isQueryClientRegistered(qc)).toBe(true);
    unreg();
    expect(isQueryClientRegistered(qc)).toBe(false);
  });

  it("preserves reconnect intent during token rotation handling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );

    await connectProfile("prof-valid");
    const snapBefore = getConnectionSnapshot("prof-valid");
    expect(snapBefore?.status).toBe("connected");
    expect(snapBefore?.intent).toBe(true);

    // Simulate token update triggering storage listener or rotation
    mockTokens["prof-valid"] = "new-token-123";

    // Manually trigger storage change event
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "dam-hopper-tokens",
      }),
    );

    // Intent should have initiated reconnect rather than remaining disconnected
    const snapAfter = getConnectionSnapshot("prof-valid");
    expect(snapAfter).toBeDefined();
  });
  it("getUiConnectionReceipt and subscribeUiConnectionReceipt return receipt when connected and null when disconnected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, workbenchProtocol: 2 }),
      }),
    );

    // Before connect: owner ref is disconnected
    const disconnectedOwner = { profileId: "prof-valid", generation: 1 };
    expect(getUiConnectionReceipt(disconnectedOwner)).toBeNull();

    let receivedReceipt: UiConnectionFrame | null = null;
    const unsubEarly = subscribeUiConnectionReceipt(disconnectedOwner, (r) => {
      receivedReceipt = r;
    });
    expect(receivedReceipt).toBeNull();
    unsubEarly();

    // Connect
    await connectProfile("prof-valid");
    const owner = captureConnection("prof-valid");
    expect(owner).toBeDefined();

    // Initially null until frame received
    expect(getUiConnectionReceipt(owner)).toBeNull();

    // Subscribe to receipt
    const receipts: Array<UiConnectionFrame | null> = [];
    const unsub = subscribeUiConnectionReceipt(owner, (r) => {
      receipts.push(r);
    });
    expect(receipts).toEqual([null]);

    // Send host:uiConnection frame on the underlying mock socket
    const socket = MockWebSocket.sockets[0];
    socket?.onmessage?.({
      data: JSON.stringify({
        kind: "host:uiConnection",
        version: 1,
        connectionId: "conn-owner-1",
        decisionCapability: "sec-owner-1",
      }),
    });

    expect(getUiConnectionReceipt(owner)).toEqual({
      kind: "host:uiConnection",
      version: 1,
      connectionId: "conn-owner-1",
      decisionCapability: "sec-owner-1",
    });
    expect(receipts.length).toBe(2);
    expect(receipts[1]).toEqual({
      kind: "host:uiConnection",
      version: 1,
      connectionId: "conn-owner-1",
      decisionCapability: "sec-owner-1",
    });

    // Stale owner (previous generation) strictly returns null
    const staleOwner = { profileId: "prof-valid", generation: 999 };
    expect(getUiConnectionReceipt(staleOwner)).toBeNull();

    // Disconnecting profile invalidates receipt and returns null
    disconnectProfile("prof-valid");
    expect(getUiConnectionReceipt(owner)).toBeNull();

    unsub();
  });

  it("publishes verifiedBrowserIdentity only while connected and preserves exact principal and dev/prod namespace", async () => {
    mockTokens["prof-auth"] = "tok-prod";
    const authDeferred = Promise.withResolvers<unknown>();
    let authRequested = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.startsWith("http://localhost:4801")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              authenticated: true,
              user: "dev-user",
              workbenchProtocol: 2,
              dev_mode: true,
            }),
          });
        }
        authRequested = true;
        return authDeferred.promise;
      }),
    );

    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toEqual({
      principal: "dev-user",
      namespace: "dev",
    });

    MockWebSocket.deferOpen = true;
    const connectPromise = connectProfile("prof-auth");
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("connecting");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toBeUndefined();

    expect(authRequested).toBe(true);
    authDeferred.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: "Alice.Admin",
        workbenchProtocol: 2,
        devMode: false,
      }),
    });
    await vi.advanceTimersByTimeAsync(0);

    // Still connecting until WS opens: verifiedBrowserIdentity remains withheld on snapshot
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("connecting");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toBeUndefined();
    expect(MockWebSocket.sockets).toHaveLength(2);

    const authSocket = MockWebSocket.sockets[1]!;
    authSocket.readyState = 1;
    authSocket.onopen?.();
    await connectPromise;

    expect(getConnectionSnapshot("prof-auth")?.status).toBe("connected");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toEqual({
      principal: "Alice.Admin",
      namespace: "prod",
    });
  });

  it("withholds empty principal and prevents late auth replies from publishing on retired generations", async () => {
    const firstDeferred = Promise.withResolvers<unknown>();
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return firstDeferred.promise;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: "   ",
            workbenchProtocol: 2,
          }),
        });
      }),
    );

    const firstAttempt = connectProfile("prof-valid");
    expect(callCount).toBe(1);

    disconnectProfile("prof-valid");
    firstDeferred.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: "StaleUser",
        workbenchProtocol: 2,
      }),
    });
    await firstAttempt;

    expect(getConnectionSnapshot("prof-valid")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();

    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("connected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();
  });

  it("clears verifiedBrowserIdentity on ws drop, auth/protocol failures, endpoint change, and deletion", async () => {
    mockTokens["prof-auth"] = "tok-1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          user: "Operator",
          workbenchProtocol: 2,
          devMode: false,
        }),
      }),
    );

    await connectProfile("prof-valid");
    await connectProfile("prof-auth");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toEqual({
      principal: "Operator",
      namespace: "prod",
    });

    // WS 4403 MFA drop and 4401 revocation clear identity
    MockWebSocket.sockets[1]!.close(4403, "MFA required");
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("mfa-required");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toBeUndefined();

    MockWebSocket.sockets[0]!.close(4401, "Revoked");
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("login-required");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();

    // Reconnect then drop offline, then unsupported protocol on reconnect
    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity?.principal).toBe("Operator");
    MockWebSocket.sockets.at(-1)!.close(1006, "Network lost");
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("offline");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, user: "Operator", workbenchProtocol: 1 }),
      }),
    );
    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("unsupported");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();

    // Reconnect then endpoint replacement & deletion clear identity
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, user: "Operator", workbenchProtocol: 2 }),
      }),
    );
    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity?.principal).toBe("Operator");

    mockProfiles[0] = { ...mockProfiles[0]!, url: "http://localhost:4999" };
    for (const cb of profileChangeSubscribers) cb({ type: "dataChanged" });
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();

    await connectProfile("prof-valid");
    for (const cb of profileChangeSubscribers) cb({ type: "deleted", deletedProfileId: "prof-valid" });
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();
  });

  it("retires in-flight connecting auth and deferred WebSocket when token rotates or clears mid-handshake", async () => {
    mockTokens["prof-auth"] = "tok-old";
    const firstAuth = Promise.withResolvers<unknown>();
    const secondAuth = Promise.withResolvers<unknown>();
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1;
        return fetchCount === 1 ? firstAuth.promise : secondAuth.promise;
      }),
    );

    // 1. Token clears during pending checkAuthStatus -> old auth result cannot connect or publish identity
    const firstAttempt = connectProfile("prof-auth");
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("connecting");
    const genDuringAuth = getConnectionSnapshot("prof-auth")!.owner.generation;
    delete mockTokens["prof-auth"];
    for (const cb of profileChangeSubscribers) cb({ type: "dataChanged" });
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("login-required");
    expect(getConnectionSnapshot("prof-auth")?.owner.generation).toBeGreaterThan(genDuringAuth);

    firstAuth.resolve({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, user: "OldUser", workbenchProtocol: 2 }),
    });
    await vi.advanceTimersByTimeAsync(0);
    await firstAttempt;
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("login-required");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toBeUndefined();

    // 2. Token rotates while WS opening is deferred -> old socket cannot publish old identity
    mockTokens["prof-auth"] = "tok-v1";
    MockWebSocket.deferOpen = true;
    const secondAttempt = connectProfile("prof-auth");
    secondAuth.resolve({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, user: "StaleIdentity", workbenchProtocol: 2 }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(MockWebSocket.sockets).toHaveLength(1);
    const staleSocket = MockWebSocket.sockets[0]!;

    mockTokens["prof-auth"] = "tok-v2";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, user: "FreshIdentity", workbenchProtocol: 2 }),
      }),
    );
    for (const cb of profileChangeSubscribers) cb({ type: "dataChanged" });
    await vi.advanceTimersByTimeAsync(0);

    staleSocket.readyState = 1;
    staleSocket.onopen?.();
    await secondAttempt;

    const freshSocket = MockWebSocket.sockets.at(-1)!;
    expect(freshSocket).not.toBe(staleSocket);
    freshSocket.readyState = 1;
    freshSocket.onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(getConnectionSnapshot("prof-auth")?.status).toBe("connected");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toEqual({
      principal: "FreshIdentity",
      namespace: "prod",
    });
  });

  it("retires removed no-auth owners on profileListChanged without disconnecting when storage is unavailable", async () => {
    mockTokens["prof-valid"] = "ephemeral-noauth-tok";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          user: "dev-user",
          workbenchProtocol: 2,
          dev_mode: true,
        }),
      }),
    );

    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toEqual({
      principal: "dev-user",
      namespace: "dev",
    });

    delete mockTokens["prof-valid"];
    for (const cb of profileChangeSubscribers) cb({ type: "dataChanged" });
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();

    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity?.principal).toBe("dev-user");

    mockKnownProfilesStatus = "unavailable";
    mockProfiles = [];
    for (const cb of profileChangeSubscribers) cb({ type: "profileListChanged" });
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("connected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity?.principal).toBe("dev-user");

    mockKnownProfilesStatus = "available";
    for (const cb of profileChangeSubscribers) cb({ type: "profileListChanged" });
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();
  });

  it("preserves replacement token when deferred 401 rejection arrives before storage notification and retires authType changes", async () => {
    mockTokens["prof-auth"] = "tok-old";
    const rejectedAuth = Promise.withResolvers<unknown>();
    vi.stubGlobal("fetch", vi.fn(() => rejectedAuth.promise));

    const attempt = connectProfile("prof-auth");
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("connecting");

    // Another document rotates the token before storage notification arrives in this tab
    mockTokens["prof-auth"] = "tok-replacement";

    // 401 with non-JSON body causes checkAuthStatus to throw AuthClientError(status: 401)
    rejectedAuth.resolve({
      ok: false,
      status: 401,
      json: async () => {
        throw new Error("no json");
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await attempt;

    // Replacement token must NOT be cleared and stale login-required must NOT publish
    expect(mockTokens["prof-auth"]).toBe("tok-replacement");
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toBeUndefined();

    // Reconnect on prof-valid ("none" auth) then replace authType -> "basic" without token
    delete mockTokens["prof-valid"];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          user: "dev-user",
          workbenchProtocol: 2,
          dev_mode: true,
        }),
      }),
    );
    await connectProfile("prof-valid");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toEqual({
      principal: "dev-user",
      namespace: "dev",
    });

    mockProfiles[0] = {
      ...mockProfiles[0]!,
      authType: "basic",
    };
    for (const cb of profileChangeSubscribers) cb({ type: "dataChanged" });
    expect(getConnectionSnapshot("prof-valid")?.status).toBe("login-required");
    expect(getConnectionSnapshot("prof-valid")?.verifiedBrowserIdentity).toBeUndefined();
  });

  it("preserves replacement token when old socket drops with 4401 before storage notification and clears IPC listeners on reset", async () => {
    mockTokens["prof-auth"] = "tok-old";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          user: "Operator",
          workbenchProtocol: 2,
        }),
      }),
    );

    await connectProfile("prof-auth");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity?.principal).toBe("Operator");
    const oldSocket = MockWebSocket.sockets[0]!;

    mockTokens["prof-auth"] = "tok-replacement";
    oldSocket.close(4401, "Session expired");
    expect(mockTokens["prof-auth"]).toBe("tok-replacement");
    expect(getConnectionSnapshot("prof-auth")?.status).toBe("disconnected");
    expect(getConnectionSnapshot("prof-auth")?.verifiedBrowserIdentity).toBeUndefined();

    const receivedBeforeReset: unknown[] = [];
    subscribeIpc("prof-valid", "status:changed", (event) => {
      receivedBeforeReset.push(event.data);
    });
    await connectProfile("prof-valid");
    const socketBeforeReset = MockWebSocket.sockets.at(-1)!;
    socketBeforeReset.onmessage?.({
      data: JSON.stringify({ kind: "status:changed", phase: "before" }),
    });
    expect(receivedBeforeReset).toHaveLength(1);

    resetConnections();
    await connectProfile("prof-valid");
    const socketAfterReset = MockWebSocket.sockets.at(-1)!;
    socketAfterReset.onmessage?.({
      data: JSON.stringify({ kind: "status:changed", phase: "after" }),
    });
    expect(receivedBeforeReset).toHaveLength(1);
  });
});
