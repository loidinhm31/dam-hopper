import type { TerminalSuggestionAcceptKind } from "./terminal-suggestion-acceptance.js";

export const TERMINAL_HISTORY_SHORTCUT = "Ctrl+Alt+KeyH";

interface TerminalSuggestionKeyHandlerOptions {
  accept: (kind: TerminalSuggestionAcceptKind) => string | null;
  openHistory: () => boolean;
}

/**
 * Owns only explicit desktop suggestion actions. Returning false is xterm's
 * cancellation signal; every unrelated key continues through the normal path.
 */
export function handleTerminalSuggestionKeyEvent(
  event: KeyboardEvent,
  { accept, openHistory }: TerminalSuggestionKeyHandlerOptions,
): boolean {
  if (
    event.type !== "keydown" ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return true;
  }
  if (
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === "KeyH"
  ) {
    return openHistory() ? false : true;
  }
  if (
    !event.ctrlKey &&
    !event.metaKey &&
    event.altKey &&
    event.code === "ArrowRight"
  ) {
    const kind: TerminalSuggestionAcceptKind = event.shiftKey
      ? "token"
      : "full";
    return accept(kind) ? false : true;
  }
  return true;
}
