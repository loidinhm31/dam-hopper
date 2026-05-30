import {
  matchesKeyboardShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";

const BLOCKED_BROWSER_SHORTCUTS = [
  "F12",
  "Mod+Shift+KeyI",
  "Mod+Shift+KeyJ",
  "Mod+Shift+KeyC",
  "Mod+KeyU",
  "Mod+KeyR",
  "Mod+KeyP",
] as const;

export type BrowserShortcutSuppression = "none" | "prevent-default" | "block";

export function matchesTerminalCopyShortcut(event: ShortcutKeyEvent) {
  return (
    event.type === "keydown" &&
    event.shiftKey &&
    event.code === "KeyC" &&
    ((event.ctrlKey && !event.metaKey) || (event.metaKey && !event.ctrlKey))
  );
}

export function isTerminalSurfaceTarget(target: EventTarget | null) {
  return (
    !!target &&
    "closest" in target &&
    typeof target.closest === "function" &&
    !!target.closest(".xterm, .xterm-screen, .xterm-helper-textarea")
  );
}

export function shouldSuppressBrowserShortcut(
  event: KeyboardEvent,
  target: EventTarget | null = event.target,
) {
  return getBrowserShortcutSuppression(event, target) !== "none";
}

export function getBrowserShortcutSuppression(
  event: KeyboardEvent,
  target: EventTarget | null = event.target,
): BrowserShortcutSuppression {
  if (matchesTerminalCopyShortcut(event)) {
    return isTerminalSurfaceTarget(target) ? "prevent-default" : "block";
  }

  return BLOCKED_BROWSER_SHORTCUTS.some((shortcut) =>
    matchesKeyboardShortcut(shortcut, event),
  )
    ? "block"
    : "none";
}
