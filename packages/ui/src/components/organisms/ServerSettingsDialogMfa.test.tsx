// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthToken,
  saveProfiles,
  setActiveProfile,
} from "@/api/server-config.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";

const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ServerSettingsDialog MFA & Enrollment Flow", () => {
  const profile = {
    id: "profile-mfa-test",
    name: "MFA Server",
    url: "http://127.0.0.1:4801",
    authType: "basic" as const,
    username: "alice",
    createdAt: 1,
  };

  it("handles enrollmentRequired flow end-to-end with QR and TOTP confirmation", async () => {
    saveProfiles([profile]);
    setActiveProfile(profile.id);

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/api/auth/login")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            state: "enrollmentRequired",
            challengeToken: "enroll-chal-123",
            challengeExpiresAt: "2026-09-27T12:00:00Z",
            authProtocol: 2,
          }),
        };
      }
      if (urlStr.endsWith("/api/auth/mfa/setup")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            secret: "JBSWY3DPEHPK3PXP",
            otpauthUri:
              "otpauth://totp/DamHopper:alice?secret=JBSWY3DPEHPK3PXP&issuer=DamHopper",
            issuer: "DamHopper",
            accountName: "alice",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
          }),
        };
      }
      if (urlStr.endsWith("/api/auth/mfa/confirm")) {
        const body = JSON.parse(String(init?.body));
        if (body.code === "123456") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              state: "authenticated",
              token: "new-session-jwt",
              expiresAt: "2026-10-27T12:00:00Z",
              mfaDueAt: "2026-10-07T12:00:00Z",
              user: "alice",
              role: "user",
              authProtocol: 2,
            }),
          };
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: "Invalid confirmation code",
            code: "INVALID_CODE",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose: vi.fn(),
        }),
      );
    });

    const passwordInput = container?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const testButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Test connection"),
    );
    expect(passwordInput).not.toBeNull();
    expect(testButton).not.toBeNull();

    // Enter password and test
    await act(async () => {
      setInputValue(passwordInput!, "secretpass");
      testButton!.click();
      await Promise.resolve();
    });

    // Should now show MFA enrollment challenge form with QR code
    expect(container?.textContent).toContain("Set Up Two-Factor Authentication");
    expect(container?.querySelector('[data-testid="mfa-qr-code"]')).not.toBeNull();

    // Reachable should NOT be shown yet
    expect(container?.textContent).not.toContain("Reachable");

    // Enter TOTP confirmation code
    const mfaCodeInput = container?.querySelector<HTMLInputElement>("#mfa-code-input");
    expect(mfaCodeInput).not.toBeNull();

    await act(async () => {
      setInputValue(mfaCodeInput!, "123456");
      const submitBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.includes("Confirm & Enroll"),
      );
      submitBtn?.click();
      await Promise.resolve();
    });

    // Confirmation succeeds! Should show Reachable and enable Save
    expect(container?.textContent).toContain("Reachable");

    // Now save profile
    const saveButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Save profile"),
    );
    expect(saveButton).toBeDefined();
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });

    // Token should now be persisted in storage for the profile
    expect(getAuthToken(profile.id)).toBe("new-session-jwt");
  });

  it("handles mfaRequired flow and displays error on incorrect code", async () => {
    saveProfiles([profile]);
    setActiveProfile(profile.id);

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/api/auth/login")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            state: "mfaRequired",
            challengeToken: "mfa-chal-456",
            challengeExpiresAt: "2026-09-27T12:00:00Z",
            authProtocol: 2,
          }),
        };
      }
      if (urlStr.endsWith("/api/auth/mfa/verify")) {
        const body = JSON.parse(String(init?.body));
        if (body.code === "999999") {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              error: "Invalid TOTP code",
              code: "INVALID_CODE",
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            state: "authenticated",
            token: "verified-session-jwt",
            expiresAt: "2026-10-27T12:00:00Z",
            mfaDueAt: "2026-10-07T12:00:00Z",
            user: "alice",
            role: "user",
            authProtocol: 2,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose: vi.fn(),
        }),
      );
    });

    const passwordInput = container?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const testButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Test connection"),
    );

    await act(async () => {
      setInputValue(passwordInput!, "secretpass");
      testButton!.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Two-Factor Authentication Required");
    // Verification mode does NOT render QR code
    expect(container?.querySelector('[data-testid="mfa-qr-code"]')).toBeNull();

    // Enter wrong code first
    const mfaCodeInput = container?.querySelector<HTMLInputElement>("#mfa-code-input");
    await act(async () => {
      setInputValue(mfaCodeInput!, "999999");
      const submitBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.includes("Verify & Continue"),
      );
      submitBtn?.click();
      await Promise.resolve();
    });

    // Should show error message
    expect(container?.textContent).toContain("Invalid TOTP code");
    expect(container?.textContent).not.toContain("Reachable");

    // Enter correct code
    await act(async () => {
      setInputValue(mfaCodeInput!, "654321");
      const submitBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.includes("Verify & Continue"),
      );
      submitBtn?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Reachable");
  });

  it("resets challenge state when cancel is clicked in MFA form", async () => {
    saveProfiles([profile]);
    setActiveProfile(profile.id);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          state: "mfaRequired",
          challengeToken: "mfa-chal-789",
          challengeExpiresAt: "2026-09-27T12:00:00Z",
          authProtocol: 2,
        }),
      }),
    );

    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose: vi.fn(),
        }),
      );
    });

    const passwordInput = container?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const testButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Test connection"),
    );

    await act(async () => {
      setInputValue(passwordInput!, "secretpass");
      testButton!.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Two-Factor Authentication Required");

    // Click Cancel inside the MFA challenge form
    const cancelMfaBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Cancel",
    );
    await act(async () => {
      cancelMfaBtn?.click();
    });

    // MFA form should be closed, testState back to idle
    expect(container?.textContent).not.toContain("Two-Factor Authentication Required");
    expect(container?.textContent).not.toContain("Reachable");
  });
});
