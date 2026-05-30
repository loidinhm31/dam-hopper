import {
  matchesKeyboardShortcut,
  matchesNewTerminalShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { matchesTerminalCopyShortcut } from "@/lib/browser-shortcut-guard.js";

interface SharedTerminalKeyOptions {
  workspaceShortcut: string;
  onCopySelection: () => void;
  onNewTerminal?: () => void;
}

export function handleSharedTerminalKeyEvent(
  event: ShortcutKeyEvent,
  { workspaceShortcut, onCopySelection, onNewTerminal }: SharedTerminalKeyOptions,
) {
  if (matchesTerminalCopyShortcut(event) && event.type === "keydown") {
    onCopySelection();
    return false;
  }
  if (
    event.type === "keydown" &&
    matchesKeyboardShortcut(workspaceShortcut, event)
  ) {
    return false;
  }
  if (matchesNewTerminalShortcut(event)) {
    return false;
  }
  if (
    event.type === "keydown" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "Enter"
  ) {
    onNewTerminal?.();
    return false;
  }
  return true;
}
