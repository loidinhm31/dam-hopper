import type { LineEnding } from "./conflict-merge-types.js";

/**
 * Tokenizes text into an array of lossless line tokens, preserving line terminators
 * (\r\n, \n, \r) and missing final newline exactly.
 */
export function tokenizeLosslessLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (i + 1 < text.length && text[i + 1] === "\n") {
        lines.push(text.slice(start, i + 2));
        start = i + 2;
        i++;
      } else {
        lines.push(text.slice(start, i + 1));
        start = i + 1;
      }
    } else if (text[i] === "\n") {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

/**
 * Re-joins token array back into string losslessly.
 */
export function rejoinLosslessLines(tokens: readonly string[]): string {
  return tokens.join("");
}

/**
 * Detects the dominant line ending of a text string.
 */
export function detectLineEnding(text: string): LineEnding {
  let hasCRLF = false;
  let hasLF = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (i + 1 < text.length && text[i + 1] === "\n") {
        hasCRLF = true;
        i++;
      }
    } else if (text[i] === "\n") {
      hasLF = true;
    }
  }
  if (hasCRLF && hasLF) return "mixed";
  if (hasCRLF) return "crlf";
  if (hasLF) return "lf";
  return "none";
}

/**
 * Detects if string has UTF-8 Byte Order Mark (BOM).
 */
export function detectBOM(text: string): boolean {
  return text.charCodeAt(0) === 0xfeff;
}

/**
 * Strips BOM if present.
 */
export function stripBOM(text: string): { text: string; hasBOM: boolean } {
  if (detectBOM(text)) {
    return { text: text.slice(1), hasBOM: true };
  }
  return { text, hasBOM: false };
}

/**
 * Re-applies BOM if needed.
 */
export function applyBOM(text: string, hasBOM: boolean): string {
  if (hasBOM && !detectBOM(text)) {
    return "\uFEFF" + text;
  }
  return text;
}
