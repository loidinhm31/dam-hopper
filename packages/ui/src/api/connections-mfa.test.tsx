// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectProfile,
  disconnectProfile,
  getConnectionSnapshot,
  stepUpProfileMfa,
  resetConnections,
} from "./connections.js";
import {
  saveProfiles,
  setActiveProfile,
  setAuthToken,
  getAuthToken,
} from "./server-config.js";

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static sockets: MockWebSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.sockets.push(this);
    Promise.resolve().then(() => {
      this.onopen?.();
    });
  }

  close(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send(): void {}
}

const profile = {
  id: "prof-mfa-conn",
  name: "MFA Server",
  url: "http://127.0.0.1:4801",
  authType: "basic" as const,
  username: "alice",
  createdAt: Date.now(),
  autoConnect: true,
};

beforeEach(() => {
  MockWebSocket.sockets = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  localStorage.clear();
  sessionStorage.clear();
  resetConnections();
  saveProfiles([profile]);
  setActiveProfile(profile.id);
  setAuthToken("initial-bearer-token", profile.id);
});

afterEach(() => {
  resetConnections();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("connections MFA lifecycle and close codes", () => {
  it("transitions to mfa-required on status check 401 with MFA_REQUIRED without starting WS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          authenticated: false,
          code: "MFA_REQUIRED",
          error: "Periodic MFA verification required",
          mfaDueAt: "2026-09-27T10:00:00Z",
          expiresAt: "2026-10-27T10:00:00Z",
          workbenchProtocol: 2,
          authProtocol: 2,
        }),
      }),
    );

    await connectProfile(profile.id);
    const snapshot = getConnectionSnapshot(profile.id);

    expect(snapshot?.status).toBe("mfa-required");
    expect(snapshot?.error).toContain("Periodic MFA verification required");
    expect(snapshot?.mfaDueAt).toBe("2026-09-27T10:00:00Z");
    // Restricted token should NOT be wiped (needed for step-up)
    expect(getAuthToken(profile.id)).toBe("initial-bearer-token");
    // WebSocket should not have connected
    expect(MockWebSocket.sockets.length).toBe(0);
  });

  it("handles WS private close code 4403 by setting mfa-required without reconnect loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          workbenchProtocol: 2,
          authProtocol: 2,
        }),
      }),
    );

    await connectProfile(profile.id);
    expect(getConnectionSnapshot(profile.id)?.status).toBe("connected");
    expect(MockWebSocket.sockets.length).toBe(1);

    const ws = MockWebSocket.sockets[0];
    // Server terminates WS with 4403 (MFA required)
    ws.close(4403, "MFA deadline reached");

    const snapshot = getConnectionSnapshot(profile.id);
    expect(snapshot?.status).toBe("mfa-required");
    // Token is retained for step-up
    expect(getAuthToken(profile.id)).toBe("initial-bearer-token");
  });

  it("handles WS private close code 4401 by clearing token and setting login-required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          workbenchProtocol: 2,
          authProtocol: 2,
        }),
      }),
    );

    await connectProfile(profile.id);
    expect(getConnectionSnapshot(profile.id)?.status).toBe("connected");

    const ws = MockWebSocket.sockets[0];
    // Server terminates WS with 4401 (Full login required, e.g. session expired)
    ws.close(4401, "Session expired at 30 days");

    const snapshot = getConnectionSnapshot(profile.id);
    expect(snapshot?.status).toBe("login-required");
    // Invalid token must be cleared
    expect(getAuthToken(profile.id)).toBeNull();
  });

  it("stepUpProfileMfa requests step-up challenge over HTTP, updates token, and reconnects", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/api/auth/mfa/challenge")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            challengeToken: "stepup-chal-456",
            challengeExpiresAt: "2026-09-27T10:05:00Z",
            authProtocol: 2,
          }),
        };
      }
      if (urlStr.endsWith("/api/auth/mfa/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            state: "authenticated",
            token: "rotated-replacement-token",
            expiresAt: "2026-10-27T10:00:00Z",
            mfaDueAt: "2026-10-07T10:00:00Z",
            user: "alice",
            role: "user",
            authProtocol: 2,
          }),
        };
      }
      if (urlStr.endsWith("/api/auth/status")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            workbenchProtocol: 2,
            authProtocol: 2,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const success = await stepUpProfileMfa(profile.id, "123456");
    expect(success).toBe(true);

    // Stored token was updated to rotated replacement
    expect(getAuthToken(profile.id)).toBe("rotated-replacement-token");

    // Profile connection was reconnected
    const snapshot = getConnectionSnapshot(profile.id);
    expect(snapshot?.status).toBe("connected");
  });
});
