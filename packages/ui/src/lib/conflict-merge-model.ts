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
