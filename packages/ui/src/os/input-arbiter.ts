export type InputDisposition =
  | "cognito-blocked"
  | "ime-passthrough"
  | "os-shortcut-handled"
  | "os-palette-handled"
  | "action-handled"
  | "frame-focused-handled"
  | "app-passthrough";

export interface InputArbiterContext {
  isCognitoActive: boolean;
  isComposing: boolean;
  isFrameFocused: boolean;
  isModalActive?: boolean;
  cycleFocusShortcut?: string | null;
  paletteShortcut?: string | null;
  settings?: ActionBindingsSettingsProjection | null;
  doubleShiftDetector?: DoubleShiftDetector;
}
import {
  matchesKeyboardShortcut,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  DoubleShiftDetector,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { matchConfiguredAction } from "./shortcuts.js";
import type { ActionBindingsSettingsProjection } from "./actions.js";

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

export function isInsideShortcutCapture(event: Event): boolean {
  if (typeof event.composedPath === "function") {
    const path = event.composedPath();
    if (path && path.length > 0) {
      for (const target of path) {
        if (
          target instanceof Element &&
          target.getAttribute("data-shortcut-capture") === "true"
        ) {
          return true;
        }
      }
    }
  }
  if (event.target instanceof Element) {
    if (event.target.closest?.('[data-shortcut-capture="true"]')) {
      return true;
    }
  }
  return false;
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

  // 3. Modal active: do not fire OS frame shortcuts or palette behind active modal
  if (ctx.isModalActive) {
    return "app-passthrough";
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

  // 3. Command Palette chord (configurable with presence-aware default fallback)
  const paletteChord =
    ctx.paletteShortcut !== undefined
      ? ctx.paletteShortcut
      : DEFAULT_OS_PALETTE_SHORTCUT;
  if (!event.repeat && paletteChord && matchesKeyboardShortcut(paletteChord, normalizedEvent)) {
    return "os-palette-handled";
  }

  // 4. Focus Cycle chord (configurable with presence-aware default fallback)
  const cycleChord =
    ctx.cycleFocusShortcut !== undefined
      ? ctx.cycleFocusShortcut
      : DEFAULT_OS_CYCLE_FOCUS_SHORTCUT;
  if (!event.repeat && cycleChord && matchesKeyboardShortcut(cycleChord, normalizedEvent)) {
    return "os-shortcut-handled";
  }
  if (ctx.settings) {
    const matched = matchConfiguredAction(
      normalizedEvent,
      ctx.settings,
      ctx.doubleShiftDetector,
    );
    if (matched) {
      if (matched.actionId === "os.palette") return "os-palette-handled";
      if (matched.actionId === "os.cycle-focus") return "os-shortcut-handled";
      return "action-handled";
    }
  }

  // 5. Frame Chrome Focus: If frame toolbar/header is focused, frame intercepts
  if (ctx.isFrameFocused) {
    return "frame-focused-handled";
  }

  // 6. Default: Passthrough to active app body (xterm / Monaco / iframe)
  return "app-passthrough";
}
