import {
  matchesKeyboardShortcut,
  matchesNewTerminalShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { matchesTerminalCopyShortcut } from "@/lib/browser-shortcut-guard.js";

interface SharedTerminalKeyOptions {
  workspaceShortcut: string;
  revealActiveFileShortcut: string;
  panelShortcuts?: string[];
  terminalFontSizeIncreaseShortcut?: string;
  terminalFontSizeDecreaseShortcut?: string;
  onCopySelection: () => void;
  onFind?: () => void;
  onNewTerminal?: () => void;
  onIncreaseTerminalFontSize?: () => void;
  onDecreaseTerminalFontSize?: () => void;
}

function matchesTerminalFontShortcut(
  shortcut: string | undefined,
  event: ShortcutKeyEvent,
): boolean {
  if (!shortcut || event.type !== "keydown") return false;
  return matchesKeyboardShortcut(shortcut, {
    type: event.type,
    code: event.code,
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: false,
    isComposing: false,
    keyCode: event.keyCode,
  });
}

interface TerminalFontSizeShortcutOptions {
  increaseShortcut?: string;
  decreaseShortcut?: string;
  onIncrease?: () => void;
  onDecrease?: () => void;
}

/** Handles configured font-size shortcuts before browser or terminal input. */
export function handleTerminalFontSizeShortcut(
  event: ShortcutKeyEvent,
  {
    increaseShortcut,
    decreaseShortcut,
    onIncrease,
    onDecrease,
  }: TerminalFontSizeShortcutOptions,
): boolean {
  const shouldIncrease = matchesTerminalFontShortcut(increaseShortcut, event);
  const shouldDecrease = matchesTerminalFontShortcut(decreaseShortcut, event);
  if (!shouldIncrease && !shouldDecrease) return true;

  event.preventDefault?.();
  if (!event.repeat && !event.isComposing && event.keyCode !== 229) {
    if (shouldIncrease && !shouldDecrease) onIncrease?.();
    else if (shouldDecrease && !shouldIncrease) onDecrease?.();
  }
  return false;
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
    panelShortcuts = [],
    terminalFontSizeIncreaseShortcut,
    terminalFontSizeDecreaseShortcut,
    onCopySelection,
    onFind,
    onNewTerminal,
    onIncreaseTerminalFontSize,
    onDecreaseTerminalFontSize,
  }: SharedTerminalKeyOptions,
) {
  if (
    !handleTerminalFontSizeShortcut(event, {
      increaseShortcut: terminalFontSizeIncreaseShortcut,
      decreaseShortcut: terminalFontSizeDecreaseShortcut,
      onIncrease: onIncreaseTerminalFontSize,
      onDecrease: onDecreaseTerminalFontSize,
    })
  ) {
    return false;
  }

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
      matchesKeyboardShortcut(revealActiveFileShortcut, event) ||
      panelShortcuts.some((shortcut) =>
        matchesKeyboardShortcut(shortcut, event),
      ))
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
