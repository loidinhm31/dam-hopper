export type InputDisposition =
  | "cognito-blocked"
  | "ime-passthrough"
  | "os-shortcut-handled"
  | "frame-focused-handled"
  | "app-passthrough";

export interface InputArbiterContext {
  isCognitoActive: boolean;
  isComposing: boolean;
  isFrameFocused: boolean;
}

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

  // 3. Global OS Chords (e.g. Ctrl+Alt+Escape)
  if (isOsGlobalShortcut(event)) {
    return "os-shortcut-handled";
  }

  // 4. Frame Chrome Focus: If frame toolbar/header is focused, frame intercepts
  if (ctx.isFrameFocused) {
    return "frame-focused-handled";
  }

  // 5. Default: Passthrough to active app body (xterm / Monaco / iframe)
  return "app-passthrough";
}
