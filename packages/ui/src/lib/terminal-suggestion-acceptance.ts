import type { TerminalSuggestionSnapshot } from "./terminal-suggestion-controller.js";

export type TerminalSuggestionAcceptKind = "full" | "token";

const WHITESPACE = /\s/;

/**
 * Derives a safe insertion from the immutable ghost snapshot. The caller must
 * invalidate the snapshot before writing this value to the PTY.
 */
export function getTerminalSuggestionSuffix(
  snapshot: TerminalSuggestionSnapshot,
  kind: TerminalSuggestionAcceptKind,
): string | null {
  const candidate = snapshot.suggestion?.entry.command;
  const prefix = snapshot.rawInput;
  if (
    snapshot.state !== "ghost" ||
    !candidate ||
    !prefix ||
    !candidate.startsWith(prefix)
  ) {
    return null;
  }

  const remaining = candidate.slice(prefix.length);
  if (!remaining || /[\r\n]/.test(remaining)) return null;
  if (kind === "full") return remaining;

  const characters = [...remaining];
  const firstTokenCharacter = characters.findIndex(
    (character) => !WHITESPACE.test(character),
  );
  if (firstTokenCharacter < 0) return null;
  const tokenEnd = characters.findIndex(
    (character, index) =>
      index > firstTokenCharacter && WHITESPACE.test(character),
  );
  const end = tokenEnd < 0 ? characters.length : tokenEnd;
  return characters.slice(0, end).join("") || null;
}
