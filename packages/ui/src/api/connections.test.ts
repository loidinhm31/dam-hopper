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
} from "./connections.js";
import { ConnectionOwnerError } from "./ownership.js";

// Mock server-config getters
const mockProfiles = [
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

let mockTokens: Record<string, string | null> = {};

vi.mock("./server-config.js", () => ({
  getProfiles: vi.fn(() => mockProfiles),
  getAuthToken: vi.fn((profileId?: string) =>
    profileId ? mockTokens[profileId] ?? null : null,
  ),
  getServerUrl: vi.fn(() => "http://localhost:4801"),
  getActiveProfileId: vi.fn(() => "prof-valid"),
  isSameOriginProfile: vi.fn(() => true),
}));

// Mock WebSocket so WsTransport doesn't attempt real network calls
class MockWebSocket {
  readyState = 1; // WebSocket.OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    Promise.resolve().then(() => {
      this.onopen?.();
    });
  }

  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
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
});
