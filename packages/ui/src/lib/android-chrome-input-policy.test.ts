// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidChromeKeyboardNotice } from "@/components/organisms/AndroidChromeKeyboardNotice.js";
import {
  AndroidChromeInputPolicyProvider,
  useAndroidChromeInputPolicy,
} from "@/contexts/AndroidChromeInputPolicyContext.js";
import {
  classifyAndroidChromeInput,
  installAndroidChromeInputPolicy,
  isAndroidChrome,
} from "./android-chrome-input-policy.js";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const originalUserAgent = navigator.userAgent;
let root: Root | null = null;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
function setUserAgent(userAgent: string): void {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  setUserAgent(originalUserAgent);
});
describe("isAndroidChrome", () => {
  it.each([
    ["Android Chrome", ANDROID_CHROME_UA, true],
    ["desktop Chrome", "Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36", false],
    ["Android WebView", `${ANDROID_CHROME_UA} wv`, false],
    ["Android Edge", `${ANDROID_CHROME_UA} EdgA/126.0.0.0`, false],
    ["Android Opera", `${ANDROID_CHROME_UA} OPR/85.0.0.0`, false],
    ["Samsung Browser", `${ANDROID_CHROME_UA} SamsungBrowser/26.0`, false],
    [
      "Android Firefox",
      ANDROID_CHROME_UA.replace("Chrome/126.0.0.0", "Firefox/126.0"),
      false,
    ],
    ["Android Brave", `${ANDROID_CHROME_UA} Brave/1.80.0`, false],
    ["Android Chromium", `${ANDROID_CHROME_UA} Chromium/126.0.0.0`, false],
    ["Android Kiwi", `${ANDROID_CHROME_UA} Kiwi/124.0.0`, false],
    ["Android Huawei OEM", `${ANDROID_CHROME_UA} HuaweiBrowser/15.0`, false],
    ["Android Chrome Custom Tab/WebView", `${ANDROID_CHROME_UA} wv`, false],
    ["Android legacy WebView", `${ANDROID_CHROME_UA} Version/4.0`, false],
    [
      "Android Chrome iOS-style token",
      `${ANDROID_CHROME_UA} CriOS/126.0.0.0`,
      false,
    ],
  ])("classifies %s", (_name, userAgent, expected) => {
    expect(isAndroidChrome(userAgent)).toBe(expected);
  });

  it("fails closed when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isAndroidChrome()).toBe(false);
  });
});
describe("classifyAndroidChromeInput", () => {
  it("includes text-like inputs, textarea, and authored contenteditable", () => {
    for (const type of [
      "text",
      "search",
      "email",
      "url",
      "tel",
      "password",
      "number",
    ]) {
      const input = document.createElement("input");
      input.type = type;
      expect(classifyAndroidChromeInput(input)).toBe("text-input");
    }
    expect(classifyAndroidChromeInput(document.createElement("textarea"))).toBe(
      "text-input",
    );
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    expect(classifyAndroidChromeInput(editor)).toBe("contenteditable");
  });

  it("excludes file and non-text controls", () => {
    for (const type of [
      "file",
      "hidden",
      "checkbox",
      "radio",
      "range",
      "button",
      "submit",
      "reset",
      "image",
      "color",
      "date",
    ]) {
      const input = document.createElement("input");
      input.type = type;
      expect(classifyAndroidChromeInput(input)).toBeNull();
    }
    expect(
      classifyAndroidChromeInput(document.createElement("select")),
    ).toBeNull();
    const readOnlyEditor = document.createElement("div");
    readOnlyEditor.setAttribute("contenteditable", "false");
    expect(classifyAndroidChromeInput(readOnlyEditor)).toBeNull();
  });
});
describe("installAndroidChromeInputPolicy", () => {
  it("locks, preserves, and restores editable controls", () => {
    const input = document.createElement("input");
    const alreadyDisabled = document.createElement("textarea");
    alreadyDisabled.disabled = true;
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.setAttribute("tabindex", "2");
    const file = document.createElement("input");
    file.type = "file";
    document.body.append(input, alreadyDisabled, editor, file);

    const cleanup = installAndroidChromeInputPolicy();
    expect(input.disabled).toBe(true);
    expect(input.tabIndex).toBe(-1);
    expect(alreadyDisabled.disabled).toBe(true);
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.tabIndex).toBe(-1);
    expect(file.disabled).toBe(false);

    cleanup();
    expect(input.disabled).toBe(false);
    expect(alreadyDisabled.disabled).toBe(true);
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.getAttribute("tabindex")).toBe("2");
    expect(file.disabled).toBe(false);
  });

  it("locks dynamic controls and rejects later focus attempts", async () => {
    const fallback = document.createElement("button");
    const input = document.createElement("input");
    document.body.append(fallback);
    const cleanup = installAndroidChromeInputPolicy();

    document.body.append(input);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(input.disabled).toBe(true);

    fallback.focus();
    input.disabled = false;
    input.focus();
    expect(document.activeElement).toBe(fallback);
    expect(input.disabled).toBe(true);

    cleanup();
  });

  it("releases detached managed nodes without retaining or restoring them later", async () => {
    const input = document.createElement("input");
    input.tabIndex = 3;
    document.body.append(input);
    const cleanup = installAndroidChromeInputPolicy();

    expect(input.disabled).toBe(true);
    input.remove();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(3);
    expect(input.hasAttribute("data-dh-android-chrome-input-lock")).toBe(false);
    cleanup();
  });

  it("restores detached managed nodes during immediate cleanup", () => {
    const input = document.createElement("input");
    input.tabIndex = 3;
    document.body.append(input);
    const cleanup = installAndroidChromeInputPolicy();

    expect(input.disabled).toBe(true);
    input.remove();
    cleanup();

    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(3);
    expect(input.hasAttribute("data-dh-android-chrome-input-lock")).toBe(false);
  });

  it("preserves external disabled, contenteditable, and tabindex changes on cleanup", async () => {
    const input = document.createElement("input");
    input.tabIndex = 2;
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 1;
    document.body.append(input, editor);
    const cleanup = installAndroidChromeInputPolicy();

    input.disabled = false;
    editor.setAttribute("contenteditable", "plaintext-only");
    editor.tabIndex = 4;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(input.disabled).toBe(true);
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.tabIndex).toBe(-1);
    cleanup();

    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(2);
    expect(editor.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(editor.tabIndex).toBe(4);
  });

  it("preserves external changes that return to the enforced values", async () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(input, editor);
    const cleanup = installAndroidChromeInputPolicy();

    // Each pair produces a real mutation even though the final value is still
    // the policy value. The caller's final state must win at cleanup.
    input.disabled = false;
    input.disabled = true;
    editor.setAttribute("contenteditable", "plaintext-only");
    editor.setAttribute("contenteditable", "false");
    editor.tabIndex = 3;
    editor.tabIndex = -1;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(input.disabled).toBe(true);
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.tabIndex).toBe(-1);
    cleanup();

    expect(input.disabled).toBe(true);
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.getAttribute("tabindex")).toBe("-1");
  });

  it("relocks a remounted control and restores its latest caller state", async () => {
    const host = document.createElement("div");
    const input = document.createElement("input");
    input.tabIndex = 4;
    host.append(input);
    document.body.append(host);
    const cleanup = installAndroidChromeInputPolicy();

    host.removeChild(input);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    input.disabled = true;
    input.tabIndex = 5;
    host.append(input);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(input.disabled).toBe(true);
    expect(input.tabIndex).toBe(-1);
    cleanup();

    expect(input.disabled).toBe(true);
    expect(input.getAttribute("tabindex")).toBe("5");
  });

  it("shares one idempotent document policy across repeated installs", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const firstCleanup = installAndroidChromeInputPolicy();
    const secondCleanup = installAndroidChromeInputPolicy();

    firstCleanup();
    expect(input.disabled).toBe(true);
    secondCleanup();
    expect(input.disabled).toBe(false);
    secondCleanup();
  });

  it("uses an allowed control in the closest modal and excludes hidden or disabled candidates", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    const hidden = document.createElement("button");
    hidden.hidden = true;
    const ariaHidden = document.createElement("button");
    ariaHidden.setAttribute("aria-hidden", "true");
    const inert = document.createElement("button");
    inert.setAttribute("inert", "");
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true;
    fieldset.append(document.createElement("button"));
    const disabled = document.createElement("button");
    disabled.disabled = true;
    const ariaDisabled = document.createElement("button");
    ariaDisabled.setAttribute("aria-disabled", "true");
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    const input = document.createElement("input");
    modal.append(
      hidden,
      ariaHidden,
      inert,
      fieldset,
      disabled,
      ariaDisabled,
      cancel,
      input,
    );
    document.body.append(outside, modal);
    const cleanup = installAndroidChromeInputPolicy();

    outside.focus();
    input.disabled = false;
    input.focus();

    expect(document.activeElement).toBe(cancel);
    cleanup();
  });

  it("keeps focus in a modal when it has no safe interactive target", () => {
    const outside = document.createElement("button");
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    const disabled = document.createElement("button");
    disabled.disabled = true;
    const input = document.createElement("input");
    modal.append(disabled, input);
    document.body.append(outside, modal);
    const cleanup = installAndroidChromeInputPolicy();

    input.disabled = false;
    input.focus();

    expect(document.activeElement).toBe(modal);
    expect(modal.getAttribute("tabindex")).toBe("-1");
    cleanup();
    expect(modal.hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).not.toBe(input);
    expect(document.activeElement).not.toBe(outside);
  });

  it("uses a focusable document root when no allowed control exists", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const cleanup = installAndroidChromeInputPolicy();

    input.disabled = false;
    input.focus();

    expect(document.activeElement).toBe(document.documentElement);
    expect(document.documentElement.getAttribute("tabindex")).toBe("-1");
    cleanup();
    expect(document.documentElement.hasAttribute("tabindex")).toBe(false);
  });
});
function ContextProbe() {
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  return createElement(
    "output",
    { "data-testid": "policy-state" },
    String(isAndroidChromeNativeInputSuppressed),
  );
}
describe("AndroidChromeInputPolicyProvider and notice", () => {
  it("exposes the active policy and provides dismissible accessible notice", async () => {
    setUserAgent(ANDROID_CHROME_UA);
    const container = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(outside, container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          AndroidChromeInputPolicyProvider,
          null,
          createElement(ContextProbe),
          createElement(AndroidChromeKeyboardNotice),
        ),
      );
    });

    const notice = document.querySelector('[role="status"]');
    expect(
      document.querySelector("[data-testid=policy-state]")?.textContent,
    ).toBe("true");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.getAttribute("aria-labelledby")).toBe(
      "android-chrome-keyboard-notice-title",
    );
    expect(notice?.getAttribute("aria-describedby")).toBe(
      "android-chrome-keyboard-notice-description",
    );
    expect(notice?.hasAttribute("aria-label")).toBe(false);
    expect(notice?.textContent).toContain(
      "Custom terminal keys remain available",
    );
    const dismiss = notice?.querySelector<HTMLButtonElement>("button");
    outside.focus();
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    dismiss?.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(outside);
    await act(async () =>
      dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("stays inactive on desktop Chrome", async () => {
    setUserAgent("Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          AndroidChromeInputPolicyProvider,
          null,
          createElement(ContextProbe),
          createElement(AndroidChromeKeyboardNotice),
        ),
      );
    });
    expect(
      document.querySelector("[data-testid=policy-state]")?.textContent,
    ).toBe("false");
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
