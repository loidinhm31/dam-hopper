import { tokenizeLosslessLines } from "./conflict-tokenization.js";

export interface ParsedMarkerBlock {
  startLine: number;
  baseSeparatorLine: number | null;
  separatorLine: number;
  endLine: number;
  oursTokens: string[];
  baseTokens: string[];
  theirsTokens: string[];
  allTokens: string[];
  startOffset: number;
  endOffset: number;
  style: "diff3" | "zdiff3" | "normal";
}

/**
 * Parses raw Git conflict marker blocks in result text.
 */
export function parseResultMarkerBlocks(
  resultText: string,
): ParsedMarkerBlock[] {
  const lines = tokenizeLosslessLines(resultText);
  const blocks: ParsedMarkerBlock[] = [];
  let inConflict = false;
  let currentStartLine = -1;
  let currentBaseSepLine: number | null = null;
  let currentSepLine = -1;
  let currentStyle: "diff3" | "zdiff3" | "normal" = "normal";

  let startOffset = 0;
  let currentBlockStartOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based
    const trimmed = line.trimEnd();

    if (!inConflict) {
      if (trimmed.startsWith("<<<<<<<")) {
        inConflict = true;
        currentStartLine = lineNum;
        currentBlockStartOffset = startOffset;
        currentBaseSepLine = null;
        currentSepLine = -1;
        currentStyle = "normal";
      }
    } else {
      if (trimmed.startsWith("|||||||")) {
        currentBaseSepLine = lineNum;
        currentStyle = "diff3";
      } else if (trimmed.startsWith("=======")) {
        currentSepLine = lineNum;
      } else if (trimmed.startsWith(">>>>>>>")) {
        if (currentSepLine !== -1) {
          const blockEndOffset = startOffset + line.length;
          const allTokens = lines.slice(currentStartLine - 1, lineNum);
          let oursTokens: string[] = [];
          let baseTokens: string[] = [];
          let theirsTokens: string[] = [];

          if (currentBaseSepLine !== null) {
            oursTokens = lines.slice(currentStartLine, currentBaseSepLine - 1);
            baseTokens = lines.slice(currentBaseSepLine, currentSepLine - 1);
            theirsTokens = lines.slice(currentSepLine, lineNum - 1);
          } else {
            oursTokens = lines.slice(currentStartLine, currentSepLine - 1);
            theirsTokens = lines.slice(currentSepLine, lineNum - 1);
          }

          blocks.push({
            startLine: currentStartLine,
            baseSeparatorLine: currentBaseSepLine,
            separatorLine: currentSepLine,
            endLine: lineNum,
            oursTokens,
            baseTokens,
            theirsTokens,
            allTokens,
            startOffset: currentBlockStartOffset,
            endOffset: blockEndOffset,
            style: currentStyle,
          });
        }
        inConflict = false;
      }
    }
    startOffset += line.length;
  }

  return blocks;
}
