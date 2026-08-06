import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AndroidChromeKeyboardNotice } from "@/components/organisms/AndroidChromeKeyboardNotice.js";
import {
  AndroidChromeInputPolicyProvider,
  useAndroidChromeInputPolicy,
} from "@/contexts/AndroidChromeInputPolicyContext.js";
import { installAndroidChromeInputPolicy } from "@/lib/android-chrome-input-policy.js";

describe("Android input policy DOM and focus contract", () => {
  let cleanup: (() => void) | undefined;
  let root: Root | undefined;
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
  });

  function PolicyProbe() {
    const { isAndroidChromeNativeInputSuppressed } =
      useAndroidChromeInputPolicy();
    return createElement(
      Fragment,
      null,
      createElement(
        "output",
        { "data-testid": "policy-state" },
        String(isAndroidChromeNativeInputSuppressed),
      ),
      createElement("input", { "data-testid": "managed-input" }),
      createElement(AndroidChromeKeyboardNotice),
    );
  }

  function renderPolicy(): HTMLElement {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        createElement(
          AndroidChromeInputPolicyProvider,
          null,
          createElement(PolicyProbe),
        ),
      );
    });
    return container;
  }

  it("activates through the provider and restores detached React inputs on unmount", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    });
    const container = renderPolicy();
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="managed-input"]',
    );

    expect(
      container.querySelector('[data-testid="policy-state"]')?.textContent,
    ).toBe("true");
    await expect.poll(() => input?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    act(() => root?.unmount());
    root = undefined;
    expect(input?.disabled).toBe(false);
  });

  it("stays inactive for the real desktop Chromium user agent", () => {
    const container = renderPolicy();
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="managed-input"]',
    );

    expect(
      container.querySelector('[data-testid="policy-state"]')?.textContent,
    ).toBe("false");
    expect(input?.disabled).toBe(false);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("locks dynamic text controls and restores focus to a modal action", async () => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    const input = document.createElement("input");
    modal.append(cancel, input);
    document.body.append(modal);

    cleanup = installAndroidChromeInputPolicy();
    const dynamicInput = document.createElement("textarea");
    modal.append(dynamicInput);
    await expect.poll(() => dynamicInput.disabled).toBe(true);

    input.disabled = false;
    input.focus();

    expect(document.activeElement).toBe(cancel);
    expect(dynamicInput.tabIndex).toBe(-1);
  });

  it("preserves React-like external state changes after policy cleanup", async () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(input, editor);

    cleanup = installAndroidChromeInputPolicy();
    input.disabled = false;
    editor.setAttribute("contenteditable", "plaintext-only");
    await expect
      .poll(() => editor.getAttribute("contenteditable"))
      .toBe("false");
    cleanup();
    cleanup = undefined;

    expect(input.disabled).toBe(false);
    expect(editor.getAttribute("contenteditable")).toBe("plaintext-only");
  });
});
