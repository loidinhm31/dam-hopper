// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LockScreenOverlay, formatLockTime, formatLockDate } from "./LockScreenOverlay.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LockScreenOverlay", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    useLockScreenStore.getState().reset();
    useCognitoModeStore.getState().reset();
    useSettingsStore.setState({
      cognitoModeShortcut: "Mod+Alt+KeyB",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    localStorage.clear();
    useLockScreenStore.getState().reset();
    useCognitoModeStore.getState().reset();
    document.querySelectorAll('[data-testid="lock-screen-overlay"]').forEach((el) => {
      el.remove();
    });
  });

  it("does not render when isLocked is false", async () => {
    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    const overlay = document.querySelector('[data-testid="lock-screen-overlay"]');
    expect(overlay).toBeNull();
  });

  it("renders live clock, localized date, and identity when locked", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    const overlay = document.querySelector('[data-testid="lock-screen-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");

    const clock = document.querySelector('[data-testid="lock-clock"]');
    const date = document.querySelector('[data-testid="lock-date"]');
    expect(clock).not.toBeNull();
    expect(date).not.toBeNull();

    // Verify clock matches format HH:MM
    expect(clock?.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(date?.textContent?.length).toBeGreaterThan(0);
  });

  it("renders dots matching pinLength and handles keypad entry, clear, and backspace", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    const dots = document.querySelectorAll("[data-pin-dot]");
    expect(dots.length).toBe(4);
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(0);

    const btn1 = document.querySelector('button[aria-label="1"]') as HTMLButtonElement;
    const btn2 = document.querySelector('button[aria-label="2"]') as HTMLButtonElement;
    const btnClr = document.querySelector('button[aria-label="Clear PIN"]') as HTMLButtonElement;
    const btnBack = document.querySelector('button[aria-label="Backspace"]') as HTMLButtonElement;

    // Click 1 and 2
    await act(async () => {
      btn1.click();
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(1);

    await act(async () => {
      btn2.click();
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(2);

    // Click Backspace
    await act(async () => {
      btnBack.click();
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(1);

    // Click Clear
    await act(async () => {
      btnClr.click();
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(0);
  });

  it("handles keyboard events: digits, backspace, and escape in window capture phase", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    // Type '1' then '2'
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(2);

    // Backspace
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(1);

    // Escape
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(0);
  });

  it("suppresses other keyboard events from leaking to underlying application", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    const letterEvent = new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(letterEvent);
    });
    expect(letterEvent.defaultPrevented).toBe(true);

    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(enterEvent);
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    const keyUpEvent = new KeyboardEvent("keyup", {
      key: "a",
      code: "KeyA",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(keyUpEvent);
    });
    expect(keyUpEvent.defaultPrevented).toBe(true);
  });

  it("preserves Cognito toggle chord without suppression", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    // Dispatched Cognito toggle chord: Mod+Alt+KeyB (Ctrl+Alt+KeyB or Meta+Alt+KeyB)
    const cognitoEvent = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.dispatchEvent(cognitoEvent);
    });

    // Should NOT be prevented or suppressed
    expect(cognitoEvent.defaultPrevented).toBe(false);

    // When Cognito mode is active, keydown should also not be suppressed by lock screen
    useCognitoModeStore.setState({ active: true });
    const anyEventWhileCognitoActive = new KeyboardEvent("keydown", {
      key: "x",
      code: "KeyX",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(anyEventWhileCognitoActive);
    });
    expect(anyEventWhileCognitoActive.defaultPrevented).toBe(false);
  });

  it("traps Tab focus within the overlay buttons", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    const overlay = document.querySelector('[data-testid="lock-screen-overlay"]') as HTMLDivElement;
    const focusable = Array.from(
      overlay.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    expect(focusable.length).toBeGreaterThan(0);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Focus last button and press Tab -> should wrap to first
    last.focus();
    const tabForward = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(tabForward);
    });
    expect(document.activeElement).toBe(first);

    // Focus first button and press Shift+Tab -> should wrap to last
    first.focus();
    const tabBackward = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(tabBackward);
    });
    expect(document.activeElement).toBe(last);
  });

  it("shakes and displays error on incorrect PIN", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay />);
    });

    const btn9 = document.querySelector('button[aria-label="9"]') as HTMLButtonElement;

    // Enter wrong PIN: 9999
    await act(async () => {
      btn9.click();
      btn9.click();
      btn9.click();
      btn9.click();
    });

    await vi.waitFor(() => {
      const status = document.getElementById("lock-screen-status");
      expect(status?.textContent).toContain("Incorrect PIN");
    });

    const dotsContainer = document.querySelector('[data-testid="lock-pin-dots"]');
    expect(dotsContainer?.className).toContain("os-lock-shake");
    expect(useLockScreenStore.getState().failedAttempts).toBe(1);
    expect(useLockScreenStore.getState().isLocked).toBe(true);
  });

  it("unlocks when correct PIN is entered and unmounts after transition", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    const btn1 = document.querySelector('button[aria-label="1"]') as HTMLButtonElement;
    const btn2 = document.querySelector('button[aria-label="2"]') as HTMLButtonElement;
    const btn3 = document.querySelector('button[aria-label="3"]') as HTMLButtonElement;
    const btn4 = document.querySelector('button[aria-label="4"]') as HTMLButtonElement;

    await act(async () => {
      btn1.click();
      btn2.click();
      btn3.click();
      btn4.click();
    });

    await vi.waitFor(() => {
      expect(useLockScreenStore.getState().isLocked).toBe(false);
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="lock-screen-overlay"]')).toBeNull();
    });
  });

  it("supports 8-digit PIN configuration", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("12345678");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    const dots = document.querySelectorAll("[data-pin-dot]");
    expect(dots.length).toBe(8);

    // Type 8 digits via keyboard
    for (const d of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: d, code: `Digit${d}`, bubbles: true, cancelable: true }),
        );
      });
    }

    await vi.waitFor(() => {
      expect(useLockScreenStore.getState().isLocked).toBe(false);
    });
  });

  it("displays cooldown countdown and enables retry once cooldown expires", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    // Manually set cooldown for 500ms
    const cooldownDeadline = Date.now() + 500;
    useLockScreenStore.setState({
      isCooldown: true,
      cooldownUntil: cooldownDeadline,
      failedAttempts: 5,
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    const status = document.getElementById("lock-screen-status");
    expect(status?.textContent).toContain("Too many failed attempts");

    // Keypad buttons should be disabled during cooldown
    const btn1 = document.querySelector('button[aria-label="1"]') as HTMLButtonElement;
    expect(btn1.disabled).toBe(true);

    // Keyboard events are ignored during cooldown
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelectorAll('[data-pin-filled="true"]').length).toBe(0);

    // Fast-forward past deadline
    await vi.waitFor(
      () => {
        expect(Date.now()).toBeGreaterThanOrEqual(cooldownDeadline);
      },
      { timeout: 1000 },
    );

    // Re-render interval tick
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // Controls should now be re-enabled and usable
    expect(btn1.disabled).toBe(false);

    // Retry unlock with correct PIN succeeds
    const btn2 = document.querySelector('button[aria-label="2"]') as HTMLButtonElement;
    const btn3 = document.querySelector('button[aria-label="3"]') as HTMLButtonElement;
    const btn4 = document.querySelector('button[aria-label="4"]') as HTMLButtonElement;
    await act(async () => {
      btn1.click();
      btn2.click();
      btn3.click();
      btn4.click();
    });
    await vi.waitFor(() => {
      expect(useLockScreenStore.getState().isLocked).toBe(false);
    });
  });
  it("guards against duplicate in-flight verification on rapid keypresses", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    const { promise, resolve } = Promise.withResolvers<boolean>();
    const verifySpy = vi
      .spyOn(useLockScreenStore.getState(), "verifyAndUnlock")
      .mockImplementation(() => promise);

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    // Enter 1 2 3 4 rapidly
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4", bubbles: true, cancelable: true }));
      // Extra rapid keypress while in-flight
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "5", code: "Digit5", bubbles: true, cancelable: true }));
    });

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith("1234");

    // Resolve verification as false (mock)
    await act(async () => {
      resolve(false);
    });

    verifySpy.mockRestore();
  });

  it("retains overlay in DOM with data-dismissing=true during fade transition", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={80} />);
    });

    // Enter correct PIN
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4", bubbles: true, cancelable: true }));
    });

    // Store unlocks immediately
    await vi.waitFor(() => {
      expect(useLockScreenStore.getState().isLocked).toBe(false);
    });

    // But overlay is still present during the fade with data-dismissing="true"
    const dismissingOverlay = document.querySelector('[data-testid="lock-screen-overlay"]');
    expect(dismissingOverlay).not.toBeNull();
    expect(dismissingOverlay?.getAttribute("data-dismissing")).toBe("true");

    // After fade completes, overlay is removed
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="lock-screen-overlay"]')).toBeNull();
    });
  });

  it("absorbs trailing keyup for a key held down during unlock even after unmount", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    // Enter 1 2 3
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
    });

    // Press and HOLD 4 (keydown fired, keyup NOT yet fired)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4", bubbles: true, cancelable: true }));
    });

    // Overlay unmounts after unlock
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="lock-screen-overlay"]')).toBeNull();
    });

    // Now user finally releases key 4 (trailing keyup event)
    const trailingKeyUp = new KeyboardEvent("keyup", {
      key: "4",
      code: "Digit4",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(trailingKeyUp);

    // Must be suppressed so it doesn't leak into underlying Monaco / xterm
    expect(trailingKeyUp.defaultPrevented).toBe(true);
  });

  it("recovers focus when focus escape is attempted while locked", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    const overlay = document.querySelector('[data-testid="lock-screen-overlay"]') as HTMLDivElement;
    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);

    // Simulate programmatic focus on an outside element
    await act(async () => {
      outsideButton.focus();
      window.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    // Focus should be pulled back to overlay
    expect(document.activeElement).toBe(overlay);
    outsideButton.remove();
  });

  it("wraps Shift+Tab to last button when overlay root itself has focus", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    const overlay = document.querySelector('[data-testid="lock-screen-overlay"]') as HTMLDivElement;
    const buttons = Array.from(overlay.querySelectorAll<HTMLElement>("button:not([disabled])"));
    const lastButton = buttons[buttons.length - 1];

    // Overlay root has focus
    overlay.focus();
    expect(document.activeElement).toBe(overlay);

    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.dispatchEvent(shiftTab);
    });

    expect(document.activeElement).toBe(lastButton);
  });

  it("suppresses repeated keydown events for a held key after unlock until release", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    // Enter 1 2 3
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "1", code: "Digit1", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "2", code: "Digit2", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
    });

    // Press and hold key 4
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4", bubbles: true, cancelable: true }));
    });

    // Wait for unlock and unmount
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="lock-screen-overlay"]')).toBeNull();
    });

    // Operating system auto-repeat keydown for held key 4
    const repeatEvent = new KeyboardEvent("keydown", {
      key: "4",
      code: "Digit4",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(repeatEvent);
    expect(repeatEvent.defaultPrevented).toBe(true);

    // Release key 4
    const releaseEvent = new KeyboardEvent("keyup", {
      key: "4",
      code: "Digit4",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(releaseEvent);
    expect(releaseEvent.defaultPrevented).toBe(true);

    // Subsequent new keydown is now allowed through
    const freshKeyEvent = new KeyboardEvent("keydown", {
      key: "x",
      code: "KeyX",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(freshKeyEvent);
    expect(freshKeyEvent.defaultPrevented).toBe(false);
  });

  it("dismisses immediately when unlocked externally through store", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={150} />);
    });

    expect(document.querySelector('[data-testid="lock-screen-overlay"]')).not.toBeNull();

    // External unlock: e.g. store reset or programmatic unlock
    await act(async () => {
      useLockScreenStore.getState().unlock();
    });

    expect(document.querySelector('[data-testid="lock-screen-overlay"]')).toBeNull();
  });

  it("does not restore focus or create stale timers if unmounted while verifying", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("1234");
      useLockScreenStore.getState().lock();
    });

    const { promise, resolve } = Promise.withResolvers<boolean>();
    const verifySpy = vi
      .spyOn(useLockScreenStore.getState(), "verifyAndUnlock")
      .mockImplementation(() => promise);

    await act(async () => {
      root?.render(<LockScreenOverlay transitionDurationMs={10} />);
    });

    // Enter PIN
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4", bubbles: true, cancelable: true }));
    });

    expect(verifySpy).toHaveBeenCalledTimes(1);

    // Unmount while verification is in-flight
    await act(async () => {
      root?.unmount();
    });

    // Resolve verification
    await act(async () => {
      resolve(true);
    });

    // Ensure no crashes and overlay stays unmounted
    expect(document.querySelector('[data-testid="lock-screen-overlay"]')).toBeNull();
    verifySpy.mockRestore();
  });
});
