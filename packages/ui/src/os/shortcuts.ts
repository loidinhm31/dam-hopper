import {
  matchesKeyboardShortcut,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";

export {
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
};

export const DEFAULT_OS_NEW_TERMINAL_SHORTCUT = "Ctrl+Alt+KeyT";
export const DEFAULT_OS_NEW_EDITOR_SHORTCUT = "Ctrl+Alt+KeyE";
export const DEFAULT_OS_TOGGLE_MAXIMIZE_SHORTCUT = "Ctrl+Alt+KeyM";
export const DEFAULT_OS_TOGGLE_FLOAT_SHORTCUT = "Ctrl+Alt+KeyF";
export const DEFAULT_OS_CLOSE_WINDOW_SHORTCUT = "Ctrl+Alt+KeyW";

export function isShortcutMatched(
  event: ShortcutKeyEvent,
  shortcutPattern: string,
): boolean {
  if (event.repeat) return false;
  return matchesKeyboardShortcut(shortcutPattern, event);
}
