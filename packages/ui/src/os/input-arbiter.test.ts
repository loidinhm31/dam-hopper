// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  arbitrateKeyboardEvent,
  isImeOrCompositionEvent,
  isOsGlobalShortcut,
  isOsPaletteShortcut,
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

  it("handles Ctrl+Alt+K as OS command palette chord", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      altKey: true,
    });
    expect(isOsPaletteShortcut(event)).toBe(true);

    const disposition = arbitrateKeyboardEvent(event, {
      isCognitoActive: false,
      isComposing: false,
      isFrameFocused: false,
    });
    expect(disposition).toBe("os-palette-handled");
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

  it("suppresses OS palette and global shortcuts when modal is active", () => {
    const paletteChord = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      altKey: true,
    });
    const osChord = new KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      altKey: true,
    });

    expect(
      arbitrateKeyboardEvent(paletteChord, {
        isCognitoActive: false,
        isComposing: false,
        isFrameFocused: false,
        isModalActive: true,
      }),
    ).toBe("app-passthrough");

    expect(
      arbitrateKeyboardEvent(osChord, {
        isCognitoActive: false,
        isComposing: false,
        isFrameFocused: false,
        isModalActive: true,
      }),
    ).toBe("app-passthrough");
  });

  it("prioritizes Cognito blocking over modal-active and IME", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape", ctrlKey: true, altKey: true });
    expect(
      arbitrateKeyboardEvent(event, {
        isCognitoActive: true,
        isComposing: true,
        isFrameFocused: true,
        isModalActive: true,
      }),
    ).toBe("cognito-blocked");
  });
});
