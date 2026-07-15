import {
  matchesKeyboardShortcut,
  matchesNewTerminalShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { matchesTerminalCopyShortcut } from "@/lib/browser-shortcut-guard.js";

interface SharedTerminalKeyOptions {
  workspaceShortcut: string;
  revealActiveFileShortcut: string;
  onCopySelection: () => void;
  onFind?: () => void;
  onNewTerminal?: () => void;
}

function matchesTerminalFindShortcut(event: ShortcutKeyEvent): boolean {
  const isFindKey =
    event.code === "KeyF" || event.key === "f" || event.key === "F";
  const hasExactlyOneFindModifier = event.ctrlKey !== event.metaKey;

  return (
    event.type === "keydown" &&
    !event.altKey &&
    !event.shiftKey &&
    hasExactlyOneFindModifier &&
    isFindKey
  );
}

export function handleSharedTerminalKeyEvent(
  event: ShortcutKeyEvent,
  {
    workspaceShortcut,
    revealActiveFileShortcut,
    onCopySelection,
    onFind,
    onNewTerminal,
  }: SharedTerminalKeyOptions,
) {
  if (matchesTerminalFindShortcut(event)) {
    event.preventDefault?.();
    if (!event.repeat && !event.isComposing) onFind?.();
    return false;
  }
  if (matchesTerminalCopyShortcut(event) && event.type === "keydown") {
    onCopySelection();
    return false;
  }
  if (
    event.type === "keydown" &&
    (matchesKeyboardShortcut(workspaceShortcut, event) ||
      matchesKeyboardShortcut(revealActiveFileShortcut, event))
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
