// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SettingsKeyboardShortcutsSection } from "./SettingsKeyboardShortcutsSection.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  useSettingsStore,
  __resetSettingsStoreTestState,
} from "@/stores/settings.js";
import { useCognitoModeInputGuard } from "@/hooks/use-cognito-mode-input-guard.js";
import {
  DEFAULT_COGNITO_MODE_SHORTCUT,
  displayShortcut,
} from "@/lib/shortcuts.js";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let saveDebouncedSpy: MockInstance | null = null;

function HarnessWithGuard() {
  useCognitoModeInputGuard();
  return <SettingsKeyboardShortcutsSection />;
}

describe("SettingsKeyboardShortcutsSection", () => {
  beforeEach(() => {
    __resetSettingsStoreTestState();
    useSettingsStore.setState({
      cognitoModeShortcut: DEFAULT_COGNITO_MODE_SHORTCUT,
    });
    saveDebouncedSpy = vi.spyOn(useSettingsStore.getState(), "saveDebounced");
    useCognitoModeStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    saveDebouncedSpy?.mockRestore();
    __resetSettingsStoreTestState();
    useCognitoModeStore.getState().reset();
  });

  it("renders all configured shortcut rows including Cognito Mode with accessible controls", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const cognitoCaptureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    const cognitoResetBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset Cognito Mode shortcut to default"]',
    );

    expect(cognitoCaptureBtn).not.toBeNull();
    expect(cognitoResetBtn).not.toBeNull();
    expect(cognitoCaptureBtn?.textContent).toBe(
      displayShortcut(DEFAULT_COGNITO_MODE_SHORTCUT),
    );
    expect(cognitoCaptureBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(cognitoCaptureBtn?.hasAttribute("data-shortcut-capture")).toBe(false);
  });

  it("starts capture mode and sets capture marker and aria-pressed", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    expect(captureBtn).not.toBeNull();

    await act(async () => {
      captureBtn?.click();
    });

    expect(captureBtn?.textContent).toBe("Press shortcut");
    expect(captureBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(captureBtn?.getAttribute("data-shortcut-capture")).toBe("true");
  });

  it("records a custom chord, calls saveDebounced, updates displayed binding, and clears marker", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.click();
    });

    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(saveDebouncedSpy).toHaveBeenCalledWith({
      cognitoModeShortcut: "Ctrl+Alt+KeyK",
    });
    expect(useSettingsStore.getState().cognitoModeShortcut).toBe(
      "Ctrl+Alt+KeyK",
    );
    expect(captureBtn?.textContent).toBe(displayShortcut("Ctrl+Alt+KeyK"));
    expect(captureBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(captureBtn?.hasAttribute("data-shortcut-capture")).toBe(false);
  });

  it("cancels recording on Escape and restores prior binding without saving", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.click();
    });

    expect(captureBtn?.textContent).toBe("Press shortcut");

    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(saveDebouncedSpy).not.toHaveBeenCalled();
    expect(captureBtn?.textContent).toBe(
      displayShortcut(DEFAULT_COGNITO_MODE_SHORTCUT),
    );
    expect(captureBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(captureBtn?.hasAttribute("data-shortcut-capture")).toBe(false);
  });

  it("cancels recording on blur and clears capture marker without saving", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.focus();
      captureBtn?.click();
    });

    expect(captureBtn?.getAttribute("data-shortcut-capture")).toBe("true");

    await act(async () => {
      captureBtn?.blur();
      captureBtn?.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, cancelable: true }),
      );
    });

    expect(saveDebouncedSpy).not.toHaveBeenCalled();
    expect(captureBtn?.textContent).toBe(
      displayShortcut(DEFAULT_COGNITO_MODE_SHORTCUT),
    );
    expect(captureBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(captureBtn?.hasAttribute("data-shortcut-capture")).toBe(false);
  });

  it("resets shortcut to default value and clears previous error when clicking reset button", async () => {
    useSettingsStore.setState({
      cognitoModeShortcut: "Ctrl+Alt+KeyK",
    });

    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    const resetBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset Cognito Mode shortcut to default"]',
    );

    expect(captureBtn?.textContent).toBe(displayShortcut("Ctrl+Alt+KeyK"));

    await act(async () => {
      resetBtn?.click();
    });

    expect(saveDebouncedSpy).toHaveBeenCalledWith({
      cognitoModeShortcut: DEFAULT_COGNITO_MODE_SHORTCUT,
    });
    expect(useSettingsStore.getState().cognitoModeShortcut).toBe(
      DEFAULT_COGNITO_MODE_SHORTCUT,
    );
    expect(captureBtn?.textContent).toBe(
      displayShortcut(DEFAULT_COGNITO_MODE_SHORTCUT),
    );
  });

  it("waits for a physical key when modifier-only keys are pressed", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.click();
    });

    // Press Shift alone
    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Shift",
          code: "ShiftLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(captureBtn?.textContent).toBe("Press shortcut");
    expect(captureBtn?.getAttribute("data-shortcut-capture")).toBe("true");
    expect(saveDebouncedSpy).not.toHaveBeenCalled();

    // Press Control alone
    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Control",
          code: "ControlLeft",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(captureBtn?.textContent).toBe("Press shortcut");
    expect(captureBtn?.getAttribute("data-shortcut-capture")).toBe("true");
    expect(saveDebouncedSpy).not.toHaveBeenCalled();
  });

  it("ignores repeated, composing, and IME keyCode 229 events", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.click();
    });

    // Repeat keydown
    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          ctrlKey: true,
          repeat: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(captureBtn?.textContent).toBe("Press shortcut");
    expect(saveDebouncedSpy).not.toHaveBeenCalled();

    // IME keyCode 229
    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Process",
          code: "KeyK",
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(captureBtn?.textContent).toBe("Press shortcut");
    expect(saveDebouncedSpy).not.toHaveBeenCalled();
  });

  it("rejects DoubleShift for Cognito Mode with an accessible error and restores previous binding", async () => {
    await act(async () => {
      root?.render(<SettingsKeyboardShortcutsSection />);
    });

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.click();
    });

    // First Shift press
    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Shift",
          code: "ShiftLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Second Shift press immediately (triggers DoubleShift)
    await act(async () => {
      captureBtn?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Shift",
          code: "ShiftLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(saveDebouncedSpy).not.toHaveBeenCalled();
    const alert = container?.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Cognito mode requires a keyboard shortcut");
    expect(captureBtn?.textContent).toBe(
      displayShortcut(DEFAULT_COGNITO_MODE_SHORTCUT),
    );
    expect(captureBtn?.hasAttribute("data-shortcut-capture")).toBe(false);
  });

  it("integrates with global guard: capture marker exempts Cognito chord while inactive, but active mask consumes all input", async () => {
    await act(async () => {
      root?.render(<HarnessWithGuard />);
    });

    expect(useCognitoModeStore.getState().active).toBe(false);

    const captureBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Set shortcut for Cognito Mode"]',
    );
    await act(async () => {
      captureBtn?.click();
    });

    expect(captureBtn?.getAttribute("data-shortcut-capture")).toBe("true");

    // While inactive and capturing, pressing the current Cognito chord (Mod+Alt+KeyB)
    // is passed through by the input guard because of data-shortcut-capture="true"
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const event = new KeyboardEvent("keydown", {
      key: isMac ? "b" : "b",
      code: "KeyB",
      altKey: true,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      captureBtn?.dispatchEvent(event);
    });

    // Guard did NOT toggle Cognito mode active!
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Resetting shortcut also does not activate Cognito mode
    const resetBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset Cognito Mode shortcut to default"]',
    );
    await act(async () => {
      resetBtn?.click();
    });
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Now activate Cognito Mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    // While active, even if a stale capture marker exists, the guard suppresses all input
    const maskedEvent = new KeyboardEvent("keydown", {
      key: "x",
      code: "KeyX",
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      captureBtn?.dispatchEvent(maskedEvent);
    });

    expect(maskedEvent.defaultPrevented).toBe(true);
  });
});
