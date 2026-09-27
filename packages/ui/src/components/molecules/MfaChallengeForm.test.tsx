// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MfaChallengeForm } from "./MfaChallengeForm.js";
import type { MfaSetupResponse } from "@/api/auth-types.js";

const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const mockSetupData: MfaSetupResponse = {
  secret: "JBSWY3DPEHPK3PXP",
  otpauthUri:
    "otpauth://totp/DamHopper:alice?secret=JBSWY3DPEHPK3PXP&issuer=DamHopper&algorithm=SHA1&digits=6&period=30",
  issuer: "DamHopper",
  accountName: "alice",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
};

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
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("MfaChallengeForm", () => {
  it("renders enrollment mode with QR code and account details", async () => {
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "enrollment",
          setupData: mockSetupData,
          onCodeSubmit: vi.fn(),
        }),
      );
    });

    expect(container?.textContent).toContain("Set Up Two-Factor Authentication");
    expect(container?.textContent).toContain("alice");
    expect(container?.textContent).toContain("DamHopper");
    expect(container?.textContent).toContain("30 seconds (6 digits)");

    const qrElement = container?.querySelector('[data-testid="mfa-qr-code"]');
    expect(qrElement).not.toBeNull();
    expect(qrElement?.querySelector("svg")).not.toBeNull();
  });

  it("toggles manual key view and copies key to clipboard", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "enrollment",
          setupData: mockSetupData,
          onCodeSubmit: vi.fn(),
        }),
      );
    });

    // Initially manual key is hidden
    expect(container?.querySelector("#mfa-manual-key")).toBeNull();

    // Click toggle button
    const toggleBtn = container?.querySelector(
      "button[type='button']",
    ) as HTMLButtonElement | null;
    expect(toggleBtn).not.toBeNull();
    await act(async () => {
      toggleBtn?.click();
    });

    // Manual key should now be visible
    const manualKeyInput = container?.querySelector(
      "#mfa-manual-key",
    ) as HTMLInputElement | null;
    expect(manualKeyInput).not.toBeNull();
    expect(manualKeyInput?.value).toBe(mockSetupData.secret);

    // Click copy button
    const copyBtn = container?.querySelector(
      'button[title="Copy secret key"]',
    ) as HTMLButtonElement | null;
    expect(copyBtn).not.toBeNull();
    await act(async () => {
      copyBtn?.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith(mockSetupData.secret);
    expect(container?.textContent).toContain("Copied!");
  });

  it("preserves leading zeros and strips non-numeric input", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "verification",
          onCodeSubmit: onSubmit,
        }),
      );
    });

    const input = container?.querySelector("#mfa-code-input") as HTMLInputElement;
    expect(input).not.toBeNull();

    // Type code with leading zero and characters
    await act(async () => {
      setInputValue(input, "01-a2 345");
    });

    expect(input.value).toBe("012345");

    // Submit form
    const form = container?.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onSubmit).toHaveBeenCalledWith("012345");
  });

  it("disables submit button when code is incomplete or submitting", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "verification",
          submitting: false,
          onCodeSubmit: onSubmit,
        }),
      );
    });

    const submitBtn = container?.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const input = container?.querySelector("#mfa-code-input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "12345"); // only 5 digits
    });
    expect(submitBtn.disabled).toBe(true);

    await act(async () => {
      setInputValue(input, "123456"); // 6 digits
    });
    expect(submitBtn.disabled).toBe(false);
  });

  it("displays error and retry rate limit messages", async () => {
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "verification",
          error: "Invalid authentication code",
          retryAfter: 15,
          onCodeSubmit: vi.fn(),
        }),
      );
    });

    expect(container?.textContent).toContain("Invalid authentication code");
    expect(container?.textContent).toContain("Too many attempts. Please wait 15s");
  });

  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "verification",
          onCancel,
          onCodeSubmit: vi.fn(),
        }),
      );
    });

    const cancelBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Cancel",
    );
    expect(cancelBtn).toBeDefined();
    await act(async () => {
      cancelBtn?.click();
    });

    expect(onCancel).toHaveBeenCalled();
  });
});
