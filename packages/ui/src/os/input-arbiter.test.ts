// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  arbitrateKeyboardEvent,
  isImeOrCompositionEvent,
  isOsGlobalShortcut,
} from "./input-arbiter.js";

describe("input-arbiter", () => {
  it("blocks input when Cognito mode is active", () => {
    const event = new KeyboardEvent("keydown", { key: "a" });
    const disposition = arbitrateKeyboardEvent(event, {
      isCognitoActive: true,
      isComposing: false,
      isFrameFocused: false,
    });
    expect(disposition).toBe("cognito-blocked");
  });

  it("passes through IME composition and dead keys without chord interception", () => {
    const imeEvent = new KeyboardEvent("keydown", { key: "Process", keyCode: 229 });
    expect(isImeOrCompositionEvent(imeEvent)).toBe(true);

    const disposition = arbitrateKeyboardEvent(imeEvent, {
      isCognitoActive: false,
      isComposing: true,
      isFrameFocused: false,
    });
    expect(disposition).toBe("ime-passthrough");
  });

  it("handles Ctrl+Alt+Escape as OS shortcut without PTY bytes", () => {
    const chordEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      altKey: true,
    });
    expect(isOsGlobalShortcut(chordEvent)).toBe(true);

    // Repeats must be bypassed
    const repeatChord = new KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      altKey: true,
      repeat: true,
    });
    expect(isOsGlobalShortcut(repeatChord)).toBe(false);

    const disposition = arbitrateKeyboardEvent(chordEvent, {
      isCognitoActive: false,
      isComposing: false,
      isFrameFocused: false,
    });
    expect(disposition).toBe("os-shortcut-handled");
  });
  it("handles frame focus when chrome is active", () => {
    const event = new KeyboardEvent("keydown", { key: "ArrowRight" });
    const disposition = arbitrateKeyboardEvent(event, {
      isCognitoActive: false,
      isComposing: false,
      isFrameFocused: true,
    });
    expect(disposition).toBe("frame-focused-handled");
  });

  it("passes normal keys through to focused app body", () => {
    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true });
    const disposition = arbitrateKeyboardEvent(event, {
      isCognitoActive: false,
      isComposing: false,
      isFrameFocused: false,
    });
    expect(disposition).toBe("app-passthrough");
  });
});
