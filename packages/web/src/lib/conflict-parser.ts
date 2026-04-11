/**
 * conflict-parser.ts — Parse git conflict markers from workdir file content.
 *
 * Git conflict markers:
 *   <<<<<<< HEAD (or branch name)
 *   ... our changes ...
 *   =======
 *   ... their changes ...
 *   >>>>>>> their-branch
 *
 * "Ours" = HEAD = left side; "Theirs" = incoming = right side.
 */

export interface ConflictRegion {
  index: number;
  /** 1-based line numbers (Monaco API uses 1-based) */
  startLine: number;    // line with <<<<<<<
  separatorLine: number; // line with =======
  endLine: number;      // line with >>>>>>>
  oursContent: string;  // content between <<<< and ====  (HEAD side)
  theirsContent: string; // content between ==== and >>>> (incoming side)
}

/** Normalize line endings to LF before any parsing. */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parseConflictRegions(content: string): ConflictRegion[] {
  const lines = normalizeLineEndings(content).split("\n");
  const regions: ConflictRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      const startLine = i + 1; // 1-based
      const oursLines: string[] = [];
      i++;

      while (i < lines.length && !lines[i].startsWith("=======")) {
        if (lines[i].startsWith("<<<<<<<")) {
          // Nested marker — malformed; abandon this block
          i--;
          break;
        }
        oursLines.push(lines[i]);
        i++;
      }

      if (i >= lines.length || lines[i].startsWith("<<<<<<<")) {
        i++;
        continue; // malformed block — skip
      }
      const separatorLine = i + 1; // 1-based
      const theirsLines: string[] = [];
      i++;

      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirsLines.push(lines[i]);
        i++;
      }

      if (i >= lines.length) continue; // malformed — missing close marker
      const endLine = i + 1; // 1-based

      regions.push({
        index: regions.length,
        startLine,
        separatorLine,
        endLine,
        oursContent: oursLines.join("\n"),
        theirsContent: theirsLines.join("\n"),
      });
    }
    i++;
  }

  return regions;
}

/**
 * Returns true if the content has unmatched conflict markers (open ≠ close, or
 * missing separator). Useful for surfacing a "malformed conflict" warning to the
 * user before they attempt to resolve.
 */
export function hasMalformedConflicts(content: string): boolean {
  const lines = normalizeLineEndings(content).split("\n");
  let opens = 0;
  let seps = 0;
  let closes = 0;
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) opens++;
    else if (line.startsWith("=======")) seps++;
    else if (line.startsWith(">>>>>>>")) closes++;
  }
  return opens !== closes || (opens > 0 && opens !== seps);
}

/**
 * Replace a conflict block in content with the accepted side's content.
 * Finds the block by re-parsing from startLine, handles shifted positions
 * after prior accepts.
 */
export function acceptConflict(
  content: string,
  region: ConflictRegion,
  side: "ours" | "theirs",
): string {
  const lines = normalizeLineEndings(content).split("\n");
  // Re-locate the conflict block by scanning from around startLine
  const searchStart = Math.max(0, region.startLine - 3);
  let blockStart = -1;
  let blockSep = -1;
  let blockEnd = -1;

  for (let i = searchStart; i < lines.length; i++) {
    if (lines[i].startsWith("<<<<<<<")) {
      blockStart = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("=======")) {
          blockSep = j;
        } else if (lines[j].startsWith(">>>>>>>")) {
          blockEnd = j;
          break;
        }
      }
      if (blockSep !== -1 && blockEnd !== -1) break;
      // Reset and keep scanning if block was incomplete
      blockStart = blockSep = blockEnd = -1;
    }
  }

  if (blockStart === -1 || blockSep === -1 || blockEnd === -1) return content;

  const replacement =
    side === "ours"
      ? lines.slice(blockStart + 1, blockSep)
      : lines.slice(blockSep + 1, blockEnd);

  return [
    ...lines.slice(0, blockStart),
    ...replacement,
    ...lines.slice(blockEnd + 1),
  ].join("\n");
}

export function hasRemainingConflicts(content: string): boolean {
  return content.includes("<<<<<<<");
}
