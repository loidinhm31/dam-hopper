/**
 * Attaches a line-buffered reader to a readable stream.
 * Splits incoming chunks on "\n" and calls `onLine` for each complete line.
 * Partial lines at chunk boundaries are buffered until the next chunk arrives.
 * Any remaining partial line is flushed on stream end (handles output without trailing newline).
 */
export function pipeLines(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) return;
  let partial = "";
  stream.on("data", (chunk: Buffer) => {
    partial += chunk.toString();
    const lines = partial.split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  });
  stream.on("end", () => {
    if (partial) onLine(partial);
  });
}
