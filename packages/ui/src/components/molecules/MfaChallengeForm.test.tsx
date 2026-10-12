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

  it("keeps code input and actions visible inside [data-dialog-scroll-body='true'] when error updates without stealing focus", async () => {
    await act(async () => {
      root?.render(
        createElement(
          "div",
          {
            "data-testid": "scroll-body",
            "data-dialog-scroll-body": "true",
          },
          createElement("button", { type: "button", id: "other-focus-target" }, "Other"),
          createElement(MfaChallengeForm, {
            mode: "verification",
            error: null,
            onCodeSubmit: vi.fn(),
            onCancel: vi.fn(),
          }),
        ),
      );
    });

    const scrollBody = container?.querySelector<HTMLDivElement>(
      '[data-testid="scroll-body"]',
    );
    const codeInput = container?.querySelector<HTMLInputElement>("#mfa-code-input");
    const actions = container?.querySelector<HTMLDivElement>(
      '[data-testid="mfa-challenge-actions"]',
    );
    const otherButton = container?.querySelector<HTMLButtonElement>(
      "#other-focus-target",
    );

    expect(scrollBody).not.toBeNull();
    expect(codeInput).not.toBeNull();
    expect(codeInput?.hasAttribute("autofocus")).toBe(false);
    expect(actions).not.toBeNull();
    expect(otherButton).not.toBeNull();

    // Move focus to another control before error arrives
    otherButton!.focus();
    expect(document.activeElement).toBe(otherButton);

    vi.spyOn(scrollBody!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 340, 240), // bottom = 340
    );
    vi.spyOn(codeInput!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 220, 160, 36), // top = 220, bottom = 256
    );
    vi.spyOn(actions!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 355, 340, 40), // top = 355, bottom = 395 (55px below bodyRect.bottom)
    );

    await act(async () => {
      root?.render(
        createElement(
          "div",
          {
            "data-testid": "scroll-body",
            "data-dialog-scroll-body": "true",
          },
          createElement("button", { type: "button", id: "other-focus-target" }, "Other"),
          createElement(MfaChallengeForm, {
            mode: "verification",
            error: "Invalid authentication code",
            onCodeSubmit: vi.fn(),
            onCancel: vi.fn(),
          }),
        ),
      );
    });

    // Should scroll down by actionsRect.bottom (395) - bodyRect.bottom (340) = 55
    expect(scrollBody!.scrollTop).toBe(55);
    // Focus must remain on the other control and not be stolen by the error update
    expect(document.activeElement).toBe(otherButton);
  });

  it("adjusts scroll body on visualViewport resize when #mfa-code-input is focused and cleans up on unmount", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const fakeViewport = Object.assign(new EventTarget(), {
      offsetTop: 0,
      height: 240,
    });
    const addSpy = vi.spyOn(fakeViewport, "addEventListener");
    const removeSpy = vi.spyOn(fakeViewport, "removeEventListener");
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeViewport,
    });

    try {
      await act(async () => {
        root?.render(
          createElement(
            "div",
            {
              "data-testid": "scroll-body",
              "data-dialog-scroll-body": "true",
            },
            createElement(MfaChallengeForm, {
              mode: "verification",
              onCodeSubmit: vi.fn(),
              onCancel: vi.fn(),
            }),
          ),
        );
      });

      const scrollBody = container?.querySelector<HTMLDivElement>(
        '[data-testid="scroll-body"]',
      )!;
      const codeInput =
        container?.querySelector<HTMLInputElement>("#mfa-code-input")!;
      const actions = container?.querySelector<HTMLDivElement>(
        '[data-testid="mfa-challenge-actions"]',
      )!;

      expect(document.activeElement).toBe(codeInput);

      // Scroll body rect remains 340px tall (bottom = 420), while visualViewport height shrinks to 240px
      vi.spyOn(scrollBody, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 80, 340, 340),
      );
      vi.spyOn(codeInput, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 170, 160, 36),
      );
      vi.spyOn(actions, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 250, 340, 40), // bottom = 290 (50px below visualViewport bottom 240)
      );

      await act(async () => {
        fakeViewport.dispatchEvent(new Event("resize"));
      });

      expect(scrollBody.scrollTop).toBe(50);

      expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
      const registeredHandler = addSpy.mock.calls[0]?.[1];

      // Unmount and verify the exact listener was removed
      await act(async () => {
        root?.render(null);
      });
      expect(removeSpy).toHaveBeenCalledWith("resize", registeredHandler);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "visualViewport", originalDescriptor);
      } else {
        Reflect.deleteProperty(window, "visualViewport");
      }
    }
  });

  it("focuses #mfa-code-input when loading completes unless user focused another control", async () => {
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "verification",
          loading: true,
          onCodeSubmit: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });

    const codeInput =
      container?.querySelector<HTMLInputElement>("#mfa-code-input")!;
    expect(codeInput.disabled).toBe(true);

    // Unattended loading -> ready focuses #mfa-code-input
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "verification",
          loading: false,
          onCodeSubmit: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });
    expect(document.activeElement).toBe(codeInput);

    // Now test mode="enrollment" where user focuses Cancel while loading=true
    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "enrollment",
          loading: true,
          onCodeSubmit: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });
    const cancelBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Cancel",
    )!;
    cancelBtn.focus();
    expect(document.activeElement).toBe(cancelBtn);

    await act(async () => {
      root?.render(
        createElement(MfaChallengeForm, {
          mode: "enrollment",
          loading: false,
          setupData: mockSetupData,
          onCodeSubmit: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });
    // Must preserve user's focus on Cancel
    expect(document.activeElement).toBe(cancelBtn);
  });
});
