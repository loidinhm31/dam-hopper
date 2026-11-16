import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  login,
  fetchMfaSetup,
  confirmMfaEnrollment,
  verifyMfa,
  requestMfaStepUpChallenge,
  checkAuthStatus,
  logout,
  logoutAccount,
  isSecureOrLoopbackOrigin,
  parsePositiveEpoch,
  listAuthSessions,
  revokeAuthSession,
  AUTH_PROTOCOL_VERSION,
  AuthClientError,
} from "./auth-client.js";
describe("auth-client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("login", () => {
    it("returns challenge when server returns enrollmentRequired", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          state: "enrollmentRequired",
          challengeToken: "chal-123",
          challengeExpiresAt: "2026-09-27T12:00:00Z",
          authProtocol: 2,
        }),
      });

      const res = await login("http://localhost:4801", {
        username: "alice",
        password: "secretpassword",
      });

      expect(res.kind).toBe("challenge");
      if (res.kind === "challenge") {
        expect(res.data.state).toBe("enrollmentRequired");
        expect(res.data.challengeToken).toBe("chal-123");
        expect(res.data.authProtocol).toBe(2);
      }
    });

    it("returns challenge when server returns mfaRequired", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          state: "mfaRequired",
          challengeToken: "chal-456",
          challengeExpiresAt: "2026-09-27T12:00:00Z",
          authProtocol: 2,
        }),
      });

      const res = await login("http://localhost:4801", {
        username: "bob",
        password: "secretpassword",
      });

      expect(res.kind).toBe("challenge");
      if (res.kind === "challenge") {
        expect(res.data.state).toBe("mfaRequired");
        expect(res.data.challengeToken).toBe("chal-456");
      }
    });

    it("returns session when server returns dev-mode token directly", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          token: "dev-token-xyz",
          user: "dev-user",
          dev_mode: true,
          authProtocol: 2,
        }),
      });

      const res = await login("http://localhost:4801", {});

      expect(res.kind).toBe("session");
      if (res.kind === "session") {
        expect(res.data.token).toBe("dev-token-xyz");
        expect(res.data.dev_mode).toBe(true);
      }
    });

    it("rejects challenge response with old or missing authProtocol", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          state: "mfaRequired",
          challengeToken: "chal-old",
          challengeExpiresAt: "2026-09-27T12:00:00Z",
          authProtocol: 1,
        }),
      });

      await expect(
        login("http://localhost:4801", { username: "alice", password: "pwd" }),
      ).rejects.toThrow(AuthClientError);
    });

    it("parses structured error response correctly", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ "Retry-After": "30" }),
        json: async () => ({
          error: "Invalid username or password",
          code: "INVALID_CREDENTIALS",
          retryAfter: 30,
        }),
      });

      try {
        await login("http://localhost:4801", { username: "a", password: "b" });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AuthClientError);
        const authErr = err as AuthClientError;
        expect(authErr.code).toBe("INVALID_CREDENTIALS");
        expect(authErr.status).toBe(401);
        expect(authErr.retryAfter).toBe(30);
      }
    });
  });

  describe("fetchMfaSetup", () => {
    it("returns setup parameters successfully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          secret: "JBSWY3DPEHPK3PXP",
          otpauthUri: "otpauth://totp/DamHopper:alice?secret=JBSWY3DPEHPK3PXP&issuer=DamHopper",
          issuer: "DamHopper",
          accountName: "alice",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        }),
      });

      const setup = await fetchMfaSetup("http://localhost:4801", "chal-token");
      expect(setup.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(setup.digits).toBe(6);
      expect(setup.period).toBe(30);
    });

    it("throws AuthClientError on missing fields", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          secret: "JBSWY3DPEHPK3PXP",
          // missing otpauthUri
        }),
      });

      await expect(
        fetchMfaSetup("http://localhost:4801", "chal-token"),
      ).rejects.toThrow(AuthClientError);
    });
  });

  describe("confirmMfaEnrollment", () => {
    it("returns authenticated session on valid confirmation", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          state: "authenticated",
          token: "jwt-token-123",
          expiresAt: "2026-10-27T12:00:00Z",
          mfaDueAt: "2026-10-07T12:00:00Z",
          user: "alice",
          role: "user",
          authProtocol: 2,
        }),
      });

      const session = await confirmMfaEnrollment(
        "http://localhost:4801",
        "chal-token",
        "123456",
      );

      expect(session.state).toBe("authenticated");
      expect(session.token).toBe("jwt-token-123");
      expect(session.user).toBe("alice");
      expect(session.authProtocol).toBe(AUTH_PROTOCOL_VERSION);
    });
  });

  describe("verifyMfa", () => {
    it("returns session on valid TOTP verify", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          state: "authenticated",
          token: "jwt-rotated-456",
          expiresAt: "2026-10-27T12:00:00Z",
          mfaDueAt: "2026-10-07T12:00:00Z",
          user: "alice",
          role: "user",
          authProtocol: 2,
        }),
      });

      const session = await verifyMfa(
        "http://localhost:4801",
        "chal-token",
        "654321",
      );

      expect(session.token).toBe("jwt-rotated-456");
    });
  });

  describe("requestMfaStepUpChallenge", () => {
    it("returns step up challenge token", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          challengeToken: "stepup-chal-789",
          challengeExpiresAt: "2026-09-27T12:05:00Z",
          authProtocol: 2,
        }),
      });

      const challenge = await requestMfaStepUpChallenge(
        "http://localhost:4801",
        "existing-bearer",
      );

      expect(challenge.challengeToken).toBe("stepup-chal-789");
      expect(challenge.authProtocol).toBe(2);
    });
  });

  describe("checkAuthStatus", () => {
    it("returns authenticated status on 200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          user: "alice",
          role: "admin",
          workbenchProtocol: 2,
          authProtocol: 2,
          mfaDueAt: "2026-10-07T12:00:00Z",
          expiresAt: "2026-10-27T12:00:00Z",
        }),
      });

      const status = await checkAuthStatus("http://localhost:4801", "tok");
      expect(status.authenticated).toBe(true);
      if (status.authenticated) {
        expect(status.user).toBe("alice");
        expect(status.role).toBe("admin");
      }
    });

    it("returns MFA_REQUIRED result on 401 with MFA_REQUIRED code", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          authenticated: false,
          code: "MFA_REQUIRED",
          error: "MFA verification required",
          user: "alice",
          expiresAt: "2026-10-27T12:00:00Z",
          mfaDueAt: "2026-09-27T10:00:00Z",
          workbenchProtocol: 2,
          authProtocol: 2,
        }),
      });

      const status = await checkAuthStatus("http://localhost:4801", "tok");
      expect(status.authenticated).toBe(false);
      if (!status.authenticated) {
        expect(status.code).toBe("MFA_REQUIRED");
      }
    });

    it("returns AUTH_REQUIRED result on 401 with expired/missing token", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          authenticated: false,
          code: "SESSION_EXPIRED",
          error: "Session has expired",
          workbenchProtocol: 2,
          authProtocol: 2,
        }),
      });

      const status = await checkAuthStatus("http://localhost:4801", "expired-tok");
      expect(status.authenticated).toBe(false);
      if (!status.authenticated) {
        expect(status.code).toBe("SESSION_EXPIRED");
      }
    });
    it("falls back to 127.0.0.1 when localhost fails with a network error", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("localhost")) {
          throw new TypeError("Failed to fetch (ERR_CONNECTION_REFUSED)");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: "bob",
            role: "user",
            workbenchProtocol: 2,
            authProtocol: 2,
          }),
        };
      });

      const status = await checkAuthStatus("http://localhost:4803", "tok");
      expect(status.authenticated).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toContain("http://localhost:4803");
      expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toContain("http://127.0.0.1:4803");
    });
  });

  describe("logout & logoutAccount", () => {
    it("completes without error even if server responds with error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
      await expect(logout("http://localhost:4801", "tok")).resolves.toBeUndefined();
    });

    it("restricts explicit Bearer transmission to https and loopback origins", () => {
      expect(isSecureOrLoopbackOrigin("https://remote.example")).toBe(true);
      expect(isSecureOrLoopbackOrigin("http://127.0.0.1:4801")).toBe(true);
      expect(isSecureOrLoopbackOrigin("http://localhost:4801")).toBe(true);
      expect(isSecureOrLoopbackOrigin("http://[::1]:4801")).toBe(true);
      expect(isSecureOrLoopbackOrigin("http://insecure.test")).toBe(false);
    });

    it("sends keep-data payload with Bearer on loopback/https and omits Bearer on cleartext remote HTTP", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: false,
            browserResetState: "retained",
            browserCredentialsRetained: true,
            resetRequired: true,
            profileEpoch: "2",
          }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchMock;

      const outcome = await logoutAccount(
        "http://127.0.0.1:4801",
        "secret-tok",
        { browserReset: false },
      );
      expect(outcome).toMatchObject({
        reachable: true,
        ok: true,
        status: 200,
        browserResetState: "retained",
        browserCredentialsRetained: true,
        resetRequired: true,
        profileEpoch: "2",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:4801/api/auth/logout",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ browserReset: false }),
          headers: expect.objectContaining({
            Authorization: "Bearer secret-tok",
            "Content-Type": "application/json",
          }),
        }),
      );

      fetchMock.mockClear();
      const insecureOutcome = await logoutAccount(
        "http://insecure.test",
        "secret-tok",
        {
          browserReset: false,
        },
      );
      const [, insecureInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(new Headers(insecureInit.headers).get("Authorization")).toBeNull();
      expect(insecureOutcome.revocationUncertain).toBe(true);
    });

    it("sends confirmed clear-data payload and degrades inconsistent or unreachable responses safely to unknown", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              authenticated: false,
              browserResetState: "cleared",
              browserCredentialsRetained: false,
              resetRequired: false,
              profileEpoch: "5",
              operationId: "op-1",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              authenticated: false,
              browserResetState: "cleared",
              browserCredentialsRetained: true,
              resetRequired: true,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        .mockRejectedValueOnce(new Error("offline"));
      globalThis.fetch = fetchMock;

      const cleared = await logoutAccount("https://server.test", "tok", {
        browserReset: true,
        confirmed: true,
        expectedProfileEpoch: "4",
        operationId: "op-1",
      });
      expect(cleared.browserResetState).toBe("cleared");
      expect(cleared.browserCredentialsRetained).toBe(false);
      expect(cleared.resetRequired).toBe(false);
      expect(cleared.profileEpoch).toBe("5");

      // Contradictory server payload must never report cleared
      const contradictory = await logoutAccount("https://server.test", "tok", {
        browserReset: false,
      });
      expect(contradictory.browserResetState).toBe("unknown");
      expect(contradictory.browserCredentialsRetained).toBe(true);
      expect(contradictory.resetRequired).toBe(true);

      // Legacy { ok: true } without browserResetState never claims cleared
      const legacy = await logoutAccount("https://server.test", "tok", {
        browserReset: false,
      });
      expect(legacy.browserResetState).toBe("unknown");
      expect(legacy.browserCredentialsRetained).toBe(true);
      expect(legacy.resetRequired).toBe(true);

      // Offline failure reports reachable: false and unknown/retained
      const offline = await logoutAccount("https://server.test", "tok", {
        browserReset: false,
      });
      expect(offline.reachable).toBe(false);
      expect(offline.browserResetState).toBe("unknown");
      expect(offline.browserCredentialsRetained).toBe(true);
      expect(offline.resetRequired).toBe(true);
    });

    it("reports revocationUncertain truthfully when server session revocation fails (W9)", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            sessionRevoked: false,
            revocationUncertain: true,
            browserResetState: "cleared",
            browserCredentialsRetained: false,
            resetRequired: false,
            revocationError: "database write error",
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const revokeFailed = await logoutAccount("https://server.test", "tok", {
        browserReset: false,
      });
      expect(revokeFailed.ok).toBe(true);
      expect(revokeFailed.sessionRevoked).toBe(false);
      expect(revokeFailed.revocationUncertain).toBe(true);
      expect(revokeFailed.reason).toBe("database write error");
    });

    it("never trusts sessionRevoked for a saved Bearer token that was deliberately not sent", async () => {
      // Exact shape of the production server's uncredentialed (anonymous) public logout.
      const anonymousShape = {
        ok: true,
        token: null,
        role: null,
        sessionRevoked: false,
        sessionIdentified: false,
        revocationUncertain: false,
        browserResetState: "unknown",
        browserCredentialsRetained: true,
        resetRequired: true,
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(anonymousShape), { status: 200 }))
        // A cookie-only request revokes the cookie session, which says nothing about the unsent token.
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ...anonymousShape, sessionRevoked: true, sessionIdentified: true }),
            { status: 200 },
          ),
        )
        // A legacy server that claims success regardless must not be believed either.
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ...anonymousShape, sessionRevoked: true }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      for (let i = 0; i < 3; i++) {
        const outcome = await logoutAccount("http://remote.test", "saved-bearer", {
          browserReset: false,
        });
        const [, init] = fetchMock.mock.calls[i] as [string, RequestInit];
        expect(new Headers(init.headers).get("Authorization")).toBeNull();
        expect(outcome.sessionRevoked).toBe(false);
        expect(outcome.revocationUncertain).toBe(true);
        expect(outcome.reason).toContain("revocation unconfirmed");
        expect(outcome.browserResetState).toBe("unknown");
        expect(outcome.browserCredentialsRetained).toBe(true);
      }
    });

    it("reports an anonymous response honestly and still trusts a revocation of the credential actually sent", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: true, sessionRevoked: false, sessionIdentified: false, revocationUncertain: false }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: true, sessionRevoked: true, sessionIdentified: true, revocationUncertain: false }),
            { status: 200 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      const anonymous = await logoutAccount("https://server.test", "expired-or-garbage", {
        browserReset: false,
      });
      expect(anonymous.sessionRevoked).toBe(false);
      expect(anonymous.revocationUncertain).toBe(true);

      const revoked = await logoutAccount("https://server.test", "live-token", { browserReset: false });
      const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer live-token");
      expect(revoked.sessionRevoked).toBe(true);
      expect(revoked.revocationUncertain).toBe(false);
    });
  });
});

describe("device session boundary", () => {
  const row = { id: "owned", userAgent: null, issuedAt: "2026-10-22T00:00:00Z",
    expiresAt: "2026-11-22T00:00:00+00:00", mfaVerifiedAt: "2026-10-22T00:00:00Z", current: false };
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a selected bearer authoritative, omits cookies and escapes cursor/session IDs", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [row], nextCursor: "next" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect((await listAuthSessions("https://selected.test/", "selected-token", "a+/=?", signal)).sessions).toEqual([row]);
    await revokeAuthSession("https://selected.test", "selected-token", "a/b?", signal);
    expect(fetch.mock.calls[0]).toEqual(["https://selected.test/api/auth/sessions?cursor=a%2B%2F%3D%3F",
      expect.objectContaining({ credentials: "omit", signal, headers: { Accept: "application/json", Authorization: "Bearer selected-token" } })]);
    expect(fetch.mock.calls[1][0]).toBe("https://selected.test/api/auth/sessions/a%2Fb%3F");
  });

  it.each(["https://user:secret@server.test", "ftp://server.test", "javascript:alert(1)"])(
    "rejects invalid or unsafe target URL %s", async (url) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(listAuthSessions(url, "token")).rejects.toMatchObject({ code: "UNSAFE_AUTH_TRANSPORT" });
      expect(fetch).not.toHaveBeenCalled();
    });

  it.each(["http://localhost:4800", "http://127.0.0.1:4800", "http://192.168.1.50:4800", "http://remote.test:4800"])(
    "supports http and https target %s without cookies", async (url) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [], nextCursor: null }))));
      await expect(listAuthSessions(url, "token")).resolves.toEqual({ sessions: [], nextCursor: null });
    });

  it.each([
    { ...row, current: "true" }, { ...row, userAgent: undefined },
    { ...row, issuedAt: "2026-02-30T00:00:00Z" }, { ...row, expiresAt: "tomorrow" },
    { ...row, mfaVerifiedAt: null }, { ...row, id: "" },
  ])("rejects malformed rows instead of exposing partial session inventory", async (invalid) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [row, invalid], nextCursor: null }))));
    await expect(listAuthSessions("https://server.test", "token")).rejects.toMatchObject({ code: "INCOMPATIBLE_PROTOCOL" });
  });

  it.each([undefined, 42, "", {}])("rejects malformed cursor %s", async (nextCursor) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [], nextCursor }))));
    await expect(listAuthSessions("https://server.test", "token")).rejects.toMatchObject({ code: "INCOMPATIBLE_PROTOCOL" });
  });

  it("surfaces unsupported and authorization failures and requires exact DELETE acknowledgement", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "DEVICE_SESSIONS_UNAVAILABLE" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "AUTH_REQUIRED" }), { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(listAuthSessions("https://server.test", null)).rejects.toMatchObject({ code: "DEVICE_SESSIONS_UNAVAILABLE", status: 409 });
    await expect(listAuthSessions("https://server.test", "old")).rejects.toMatchObject({ status: 401 });
    await expect(revokeAuthSession("https://server.test", "token", "id")).rejects.toMatchObject({ code: "INCOMPATIBLE_PROTOCOL" });
    await expect(revokeAuthSession("https://server.test", "token", "foreign")).rejects.toMatchObject({ status: 404 });
  });
});

describe("browser profile epoch decimal strings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts only canonical positive decimal u64 strings", () => {
    expect(parsePositiveEpoch("1")).toBe("1");
    expect(parsePositiveEpoch("9007199254740993")).toBe("9007199254740993");
    expect(parsePositiveEpoch("18446744073709551615")).toBe("18446744073709551615");
    for (const bad of [1, 9007199254740993, 1.5, "0", "01", "+1", "-1", " 1", "1 ", "1e3", "0x1", "", "18446744073709551616", null, undefined, {}]) {
      expect(parsePositiveEpoch(bad), String(bad)).toBeUndefined();
    }
  });

  it("round-trips profile epochs through the logout request and outcome without Number conversion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: false,
          browserResetState: "cleanupPending",
          browserCredentialsRetained: true,
          resetRequired: true,
          operationId: "op-big",
          profileEpoch: "18446744073709551615",
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock;
    const outcome = await logoutAccount("https://server.test", "tok", {
      browserReset: true,
      confirmed: true,
      expectedProfileEpoch: "9007199254740993",
      operationId: "op-big",
    });
    expect(outcome.profileEpoch).toBe("18446744073709551615");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('"expectedProfileEpoch":"9007199254740993"');
  });

  it("drops a numeric profileEpoch from the server rather than coercing it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: false,
          browserResetState: "cleanupPending",
          browserCredentialsRetained: true,
          resetRequired: true,
          profileEpoch: 2,
        }),
        { status: 200 },
      ),
    );
    const outcome = await logoutAccount("https://server.test", "tok", { browserReset: false });
    expect(outcome.profileEpoch).toBeUndefined();
  });
});
