export type TerminalSuggestionInput =
  | { kind: "append"; text: string }
  | { kind: "ambiguous" };

function hasSingleGrapheme(data: string): boolean {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    return [...new Segmenter().segment(data)].length === 1;
  }
  return [...data].length === 1;
}

/**
 * Accept only one printable grapheme. Paste, IME composition, cursor edits, and
 * terminal control sequences are deliberately opaque rather than reconstructed.
 */
export function classifyTerminalSuggestionInput(
  data: string,
): TerminalSuggestionInput {
  if (!data || !hasSingleGrapheme(data)) return { kind: "ambiguous" };
  for (const char of data) {
    if (char < " " || char === "\x7f" || char === "\x1b") {
      return { kind: "ambiguous" };
    }
  }
  return { kind: "append", text: data };
}
