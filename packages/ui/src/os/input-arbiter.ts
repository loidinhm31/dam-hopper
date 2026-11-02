export type InputDisposition =
  | "cognito-blocked"
  | "ime-passthrough"
  | "os-shortcut-handled"
  | "os-palette-handled"
  | "frame-focused-handled"
  | "app-passthrough";

export interface InputArbiterContext {
  isCognitoActive: boolean;
  isComposing: boolean;
  isFrameFocused: boolean;
  cycleFocusShortcut?: string;
  paletteShortcut?: string;
}
import {
  matchesKeyboardShortcut,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
export interface KeyLikeEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
  getModifierState?: (keyArg: string) => boolean;
}

export function isImeOrCompositionEvent(event: KeyLikeEvent): boolean {
  const isAltGr =
    typeof event.getModifierState === "function" &&
    event.getModifierState("AltGraph");
  return (
    Boolean(event.isComposing) ||
    event.keyCode === 229 ||
    event.key === "Dead" ||
    event.key === "Process" ||
    isAltGr
  );
}

export function isOsGlobalShortcut(event: KeyLikeEvent): boolean {
  if (event.repeat) return false;
  // Ctrl+Alt+Escape: Focus cycle without emitting PTY bytes
  // Exclude AltGr: AltGr sets ctrlKey && altKey on Windows, but getModifierState("AltGraph") is true
  const isAltGr =
    typeof event.getModifierState === "function" &&
    event.getModifierState("AltGraph");
  if (isAltGr) return false;

  return (
    Boolean(event.ctrlKey) &&
    Boolean(event.altKey) &&
    !event.shiftKey &&
    !event.metaKey &&
    (event.key === "Escape" || event.code === "Escape")
  );
}

export function isOsPaletteShortcut(event: KeyLikeEvent): boolean {
  if (event.repeat) return false;
  const isAltGr =
    typeof event.getModifierState === "function" &&
    event.getModifierState("AltGraph");
  if (isAltGr) return false;

  return (
    Boolean(event.ctrlKey) &&
    Boolean(event.altKey) &&
    !event.shiftKey &&
    !event.metaKey &&
    (event.key === "k" || event.key === "K" || event.code === "KeyK")
  );
}

export function arbitrateKeyboardEvent(
  event: KeyLikeEvent,
  ctx: InputArbiterContext,
): InputDisposition {
  // 1. Cognito Privacy Mode: Highest precedence, blocks all physical input
  if (ctx.isCognitoActive) {
    return "cognito-blocked";
  }

  // 2. IME Composition / Dead keys / AltGr: Passthrough immediately without chord interception
  if (ctx.isComposing || isImeOrCompositionEvent(event)) {
    return "ime-passthrough";
  }

  const normalizedEvent: ShortcutKeyEvent = {
    code: event.code || event.key,
    key: event.key,
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    altKey: Boolean(event.altKey),
    shiftKey: Boolean(event.shiftKey),
    repeat: Boolean(event.repeat),
    isComposing: Boolean(event.isComposing),
  };

  // 3. Command Palette chord (configurable with default fallback)
  const paletteChord = ctx.paletteShortcut || DEFAULT_OS_PALETTE_SHORTCUT;
  if (
    !event.repeat &&
    (matchesKeyboardShortcut(paletteChord, normalizedEvent) ||
      isOsPaletteShortcut(event))
  ) {
    return "os-palette-handled";
  }

  // 4. Focus Cycle chord (configurable with default fallback)
  const cycleChord = ctx.cycleFocusShortcut || DEFAULT_OS_CYCLE_FOCUS_SHORTCUT;
  if (
    !event.repeat &&
    (matchesKeyboardShortcut(cycleChord, normalizedEvent) ||
      isOsGlobalShortcut(event))
  ) {
    return "os-shortcut-handled";
  }

  // 4. Frame Chrome Focus: If frame toolbar/header is focused, frame intercepts
  if (ctx.isFrameFocused) {
    return "frame-focused-handled";
  }

  // 5. Default: Passthrough to active app body (xterm / Monaco / iframe)
  return "app-passthrough";
}
