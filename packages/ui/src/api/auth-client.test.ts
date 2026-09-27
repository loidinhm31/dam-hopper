import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  login,
  fetchMfaSetup,
  confirmMfaEnrollment,
  verifyMfa,
  requestMfaStepUpChallenge,
  checkAuthStatus,
  logout,
  AUTH_PROTOCOL_VERSION,
  AUTH_ERROR_CODES,
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
  });

  describe("logout", () => {
    it("completes without error even if server responds with error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
      await expect(logout("http://localhost:4801", "tok")).resolves.toBeUndefined();
    });
  });
});
