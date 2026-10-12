import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { saveProfiles, setActiveProfile } from "@/api/server-config.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import "@/index.css";

const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function assertVisibleWithinBodyAndViewport(
  element: HTMLElement,
  scrollBody: HTMLElement,
): void {
  const rect = element.getBoundingClientRect();
  const bodyRect = scrollBody.getBoundingClientRect();

  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.top).toBeGreaterThanOrEqual(bodyRect.top - 1);
  expect(rect.bottom).toBeLessThanOrEqual(bodyRect.bottom + 1);
  expect(rect.left).toBeGreaterThanOrEqual(bodyRect.left - 1);
  expect(rect.right).toBeLessThanOrEqual(bodyRect.right + 1);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1);
}

describe("ServerSettingsDialog mobile MFA verification & enrollment in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  const profile = {
    id: "profile-mobile-mfa",
    name: "Mobile MFA Server",
    url: "http://127.0.0.1:4801",
    authType: "basic" as const,
    username: "alice",
    autoConnect: true,
    createdAt: 1,
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([667, 420])(
    "keeps Verify & Continue reachable and completable at mobile viewport 375x%i",
    async (viewportHeight) => {
      await page.viewport(375, viewportHeight);

      const fetchMock = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const urlStr = String(url);
          if (urlStr.endsWith("/api/auth/login")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                state: "mfaRequired",
                challengeToken: `mfa-chal-${viewportHeight}`,
                challengeExpiresAt: "2026-10-12T12:00:00Z",
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
                  error: "Invalid TOTP verification code",
                  code: "INVALID_CODE",
                }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({
                state: "authenticated",
                token: `session-jwt-${viewportHeight}`,
                expiresAt: "2026-11-12T12:00:00Z",
                mfaDueAt: "2026-10-20T12:00:00Z",
                user: "alice",
                role: "user",
                authProtocol: 2,
              }),
            };
          }
          return { ok: false, status: 404, json: async () => ({}) };
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await act(async () => {
        root.render(
          <ServerSettingsDialog open profile={profile} onClose={vi.fn()} />,
        );
      });

      const scrollBody = container.querySelector<HTMLElement>(
        '[data-testid="server-settings-dialog-body"]',
      );
      expect(scrollBody).not.toBeNull();

      const passwordInput = container.querySelector<HTMLInputElement>(
        'input[type="password"]',
      );
      const testButton = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Test connection"),
      );
      expect(passwordInput).not.toBeNull();
      expect(testButton).toBeDefined();

      await act(async () => {
        setInputValue(passwordInput!, "secretpass");
        testButton!.click();
      });

      await vi.waitFor(() => {
        expect(container.querySelector("#mfa-code-input")).not.toBeNull();
      });

      const codeInput =
        container.querySelector<HTMLInputElement>("#mfa-code-input")!;
      const actionsContainer = container.querySelector<HTMLElement>(
        '[data-testid="mfa-challenge-actions"]',
      )!;
      const verifyButton = Array.from(
        actionsContainer.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Verify & Continue"))!;

      // Assert initial focus, no ancestor/window scroll jump, and geometry before interacting
      expect(document.activeElement).toBe(codeInput);
      expect(window.scrollY).toBe(0);
      assertVisibleWithinBodyAndViewport(codeInput, scrollBody!);
      assertVisibleWithinBodyAndViewport(actionsContainer, scrollBody!);
      assertVisibleWithinBodyAndViewport(verifyButton, scrollBody!);

      const saveButton = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Save profile"),
      )!;
      expect(saveButton.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        window.innerHeight + 1,
      );
      // Verify user can scroll back up to earlier fields (Server URL, Username) and down again
      await act(async () => {
        scrollBody!.scrollTop = 0;
      });
      const urlInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="http://127.0.0.1:4801"]',
      )!;
      assertVisibleWithinBodyAndViewport(urlInput, scrollBody!);

      const usernameInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="Username"]',
      )!;
      await act(async () => {
        const bodyRect = scrollBody!.getBoundingClientRect();
        const userRect = usernameInput.getBoundingClientRect();
        if (userRect.bottom > bodyRect.bottom) {
          scrollBody!.scrollTop += userRect.bottom - bodyRect.bottom + 8;
        } else if (userRect.top < bodyRect.top) {
          scrollBody!.scrollTop -= bodyRect.top - userRect.top + 8;
        }
      });
      assertVisibleWithinBodyAndViewport(usernameInput, scrollBody!);
      // Focusing the code input scrolls it and the action buttons back into view
      await act(async () => {
        codeInput.blur();
        codeInput.focus();
      });
      assertVisibleWithinBodyAndViewport(codeInput, scrollBody!);
      assertVisibleWithinBodyAndViewport(verifyButton, scrollBody!);

      // Submit an incorrect code and verify error banner keeps input + Verify & Continue visible
      await act(async () => {
        setInputValue(codeInput, "999999");
      });
      assertVisibleWithinBodyAndViewport(verifyButton, scrollBody!);
      await userEvent.click(verifyButton);

      await vi.waitFor(() => {
        expect(container.textContent).toContain(
          "Invalid TOTP verification code",
        );
      });
      assertVisibleWithinBodyAndViewport(codeInput, scrollBody!);
      assertVisibleWithinBodyAndViewport(verifyButton, scrollBody!);

      // Enter valid code and click Verify & Continue
      await act(async () => {
        setInputValue(codeInput, "654321");
      });
      assertVisibleWithinBodyAndViewport(verifyButton, scrollBody!);
      await userEvent.click(verifyButton);

      await vi.waitFor(() => {
        expect(container.textContent).toContain("Reachable");
      });
    },
  );

  it.each([667, 420])(
    "keeps Confirm & Enroll, QR code, manual setup key, and rate-limit/error states reachable at mobile viewport 375x%i",
    async (viewportHeight) => {
      await page.viewport(375, viewportHeight);

      const fetchMock = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const urlStr = String(url);
          if (urlStr.endsWith("/api/auth/login")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                state: "enrollmentRequired",
                challengeToken: `enroll-chal-${viewportHeight}`,
                challengeExpiresAt: "2026-10-12T12:00:00Z",
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
            if (body.code === "000000") {
              return {
                ok: false,
                status: 429,
                headers: new Headers({ "Retry-After": "15" }),
                json: async () => ({
                  error: "Invalid confirmation code",
                  code: "RATE_LIMITED",
                  retryAfter: 15,
                }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({
                state: "authenticated",
                token: `enrolled-jwt-${viewportHeight}`,
                expiresAt: "2026-11-12T12:00:00Z",
                mfaDueAt: "2026-10-20T12:00:00Z",
                user: "alice",
                role: "user",
                authProtocol: 2,
              }),
            };
          }
          return { ok: false, status: 404, json: async () => ({}) };
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await act(async () => {
        root.render(
          <ServerSettingsDialog open profile={profile} onClose={vi.fn()} />,
        );
      });

      const scrollBody = container.querySelector<HTMLElement>(
        '[data-testid="server-settings-dialog-body"]',
      )!;
      const passwordInput = container.querySelector<HTMLInputElement>(
        'input[type="password"]',
      )!;
      const testButton = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Test connection"),
      )!;

      await act(async () => {
        setInputValue(passwordInput, "secretpass");
        testButton.click();
      });

      await vi.waitFor(() => {
        expect(
          container.querySelector('[data-testid="mfa-qr-code"]'),
        ).not.toBeNull();
      });

      const mfaSection = container.querySelector<HTMLElement>(
        '[data-testid="server-settings-mfa-section"]',
      )!;
      const qrCode = container.querySelector<HTMLElement>(
        '[data-testid="mfa-qr-code"]',
      )!;
      const codeInput =
        container.querySelector<HTMLInputElement>("#mfa-code-input")!;
      const actionsContainer = container.querySelector<HTMLElement>(
        '[data-testid="mfa-challenge-actions"]',
      )!;
      const confirmButton = Array.from(
        actionsContainer.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Confirm & Enroll"))!;

      // MFA section top and QR code are revealed inside the scroll body when enrollment opens
      const initialBodyRect = scrollBody.getBoundingClientRect();
      const initialSectionRect = mfaSection.getBoundingClientRect();
      expect(initialSectionRect.top).toBeGreaterThanOrEqual(
        initialBodyRect.top - 2,
      );
      expect(initialSectionRect.top).toBeLessThanOrEqual(
        initialBodyRect.bottom,
      );
      assertVisibleWithinBodyAndViewport(qrCode, scrollBody);

      // Scroll to manual setup key toggle if needed on short viewport, assert visibility before clicking
      const toggleManualKeyBtn = Array.from(
        container.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Can't scan? Show setup key"))!;
      await act(async () => {
        const bodyRect = scrollBody.getBoundingClientRect();
        const btnRect = toggleManualKeyBtn.getBoundingClientRect();
        if (btnRect.bottom > bodyRect.bottom) {
          scrollBody.scrollTop += btnRect.bottom - bodyRect.bottom + 8;
        }
      });
      assertVisibleWithinBodyAndViewport(toggleManualKeyBtn, scrollBody);
      await userEvent.click(toggleManualKeyBtn);

      const manualKeyInput =
        container.querySelector<HTMLInputElement>("#mfa-manual-key")!;
      const copyKeyBtn = container.querySelector<HTMLButtonElement>(
        'button[title="Copy secret key"]',
      )!;
      expect(manualKeyInput).not.toBeNull();
      expect(manualKeyInput.value).toBe("JBSWY3DPEHPK3PXP");
      expect(copyKeyBtn).not.toBeNull();

      await act(async () => {
        const bodyRect = scrollBody.getBoundingClientRect();
        const keyRect = manualKeyInput.getBoundingClientRect();
        if (keyRect.bottom > bodyRect.bottom) {
          scrollBody.scrollTop += keyRect.bottom - bodyRect.bottom + 8;
        }
      });
      assertVisibleWithinBodyAndViewport(manualKeyInput, scrollBody);
      assertVisibleWithinBodyAndViewport(copyKeyBtn, scrollBody);

      // Scroll back up to top fields (Server URL, Username) and verify they are reachable
      await act(async () => {
        scrollBody.scrollTop = 0;
      });
      const urlInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="http://127.0.0.1:4801"]',
      )!;
      assertVisibleWithinBodyAndViewport(urlInput, scrollBody);

      const usernameInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="Username"]',
      )!;
      await act(async () => {
        const bodyRect = scrollBody.getBoundingClientRect();
        const userRect = usernameInput.getBoundingClientRect();
        if (userRect.bottom > bodyRect.bottom) {
          scrollBody.scrollTop += userRect.bottom - bodyRect.bottom + 8;
        }
      });
      assertVisibleWithinBodyAndViewport(usernameInput, scrollBody);
      // Typing in #mfa-code-input reveals both the input and Confirm & Enroll button
      await act(async () => {
        codeInput.focus();
        setInputValue(codeInput, "000000");
      });
      assertVisibleWithinBodyAndViewport(codeInput, scrollBody);
      assertVisibleWithinBodyAndViewport(actionsContainer, scrollBody);
      assertVisibleWithinBodyAndViewport(confirmButton, scrollBody);

      // Trigger rate-limit + error state and verify input + actions remain visible
      await userEvent.click(confirmButton);
      await vi.waitFor(() => {
        expect(container.textContent).toContain("Invalid confirmation code");
        expect(container.textContent).toContain(
          "Too many attempts. Please wait 15s",
        );
      });
      assertVisibleWithinBodyAndViewport(codeInput, scrollBody);
      assertVisibleWithinBodyAndViewport(confirmButton, scrollBody);

      // Cancel and re-run challenge to complete enrollment with valid code
      const cancelBtn = Array.from(
        actionsContainer.querySelectorAll("button"),
      ).find((b) => b.textContent?.trim() === "Cancel")!;
      await userEvent.click(cancelBtn);

      const retestButton = Array.from(
        container.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Test connection"))!;
      await act(async () => {
        retestButton.click();
      });

      await vi.waitFor(() => {
        expect(
          container.querySelector('[data-testid="mfa-qr-code"]'),
        ).not.toBeNull();
      });

      const freshCodeInput =
        container.querySelector<HTMLInputElement>("#mfa-code-input")!;
      const freshActions = container.querySelector<HTMLElement>(
        '[data-testid="mfa-challenge-actions"]',
      )!;
      const freshConfirmBtn = Array.from(
        freshActions.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Confirm & Enroll"))!;

      await act(async () => {
        freshCodeInput.focus();
        setInputValue(freshCodeInput, "123456");
      });
      assertVisibleWithinBodyAndViewport(freshCodeInput, scrollBody);
      assertVisibleWithinBodyAndViewport(freshConfirmBtn, scrollBody);

      await userEvent.click(freshConfirmBtn);

      await vi.waitFor(() => {
        expect(container.textContent).toContain("Reachable");
      });

    },
  );
});
