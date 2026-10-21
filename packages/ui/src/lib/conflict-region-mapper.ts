import { diff3MergeRegions } from "node-diff3";
import type {
  ConflictMergeRegion,
  ConflictReadiness,
  LineRange,
  OffsetRange,
  RegionDecisionState,
  SourceConflictRegion,
} from "./conflict-merge-types.js";
import { tokenizeLosslessLines } from "./conflict-tokenization.js";
import {
  parseResultMarkerBlocks,
  type ParsedMarkerBlock,
} from "./conflict-marker-parser.js";

/**
 * Builds deterministic diff3 regions from token arrays of ours, base, theirs.
 */
export function buildSourceRegions(
  oursTokens: string[],
  baseTokens: string[],
  theirsTokens: string[],
): SourceConflictRegion[] {
  const rawRegions = diff3MergeRegions(
    oursTokens,
    baseTokens,
    theirsTokens,
  ) as Array<
    | {
        stable: true;
        buffer: "o" | "a" | "b";
        bufferStart: number;
        bufferLength: number;
        bufferContent: string[];
      }
    | {
        stable: false;
        aStart: number;
        aLength: number;
        aContent: string[];
        oStart: number;
        oLength: number;
        oContent: string[];
        bStart: number;
        bLength: number;
        bContent: string[];
      }
  >;

  const regions: SourceConflictRegion[] = [];
  let conflictIndex = 0;

  for (let idx = 0; idx < rawRegions.length; idx++) {
    const raw = rawRegions[idx];
    if (raw.stable) {
      const start = raw.bufferStart + 1;
      const end = raw.bufferStart + raw.bufferLength;
      const range: LineRange = {
        startLine: raw.bufferLength > 0 ? start : raw.bufferStart,
        endLine: raw.bufferLength > 0 ? end : raw.bufferStart,
      };
      regions.push({
        id: `stable-${idx + 1}`,
        index: idx + 1,
        stable: true,
        oursTokens: raw.buffer === "a" ? raw.bufferContent : [],
        oursRange: range,
        theirsTokens: raw.buffer === "b" ? raw.bufferContent : [],
        theirsRange: range,
        baseTokens: raw.buffer === "o" ? raw.bufferContent : [],
        baseRange: range,
        stableSource: raw.buffer,
      });
    } else {
      conflictIndex++;
      const aRange: LineRange = {
        startLine: raw.aLength > 0 ? raw.aStart + 1 : raw.aStart,
        endLine: raw.aLength > 0 ? raw.aStart + raw.aLength : raw.aStart,
      };
      const bRange: LineRange = {
        startLine: raw.bLength > 0 ? raw.bStart + 1 : raw.bStart,
        endLine: raw.bLength > 0 ? raw.bStart + raw.bLength : raw.bStart,
      };
      const oRange: LineRange = {
        startLine: raw.oLength > 0 ? raw.oStart + 1 : raw.oStart,
        endLine: raw.oLength > 0 ? raw.oStart + raw.oLength : raw.oStart,
      };

      regions.push({
        id: `conflict-${conflictIndex}`,
        index: idx + 1,
        stable: false,
        oursTokens: raw.aContent,
        oursRange: aRange,
        theirsTokens: raw.bContent,
        theirsRange: bRange,
        baseTokens: raw.oContent,
        baseRange: oRange,
      });
    }
  }

  return regions;
}

/**
 * Computes line offset ranges for a string given 1-based startLine and endLine.
 */
function lineRangeToOffsetRange(
  lines: string[],
  startLine: number,
  endLine: number,
): OffsetRange {
  let startOffset = 0;
  for (let i = 0; i < startLine - 1 && i < lines.length; i++) {
    startOffset += lines[i].length;
  }
  let endOffset = startOffset;
  for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
    endOffset += lines[i].length;
  }
  return { startOffset, endOffset };
}

/**
 * Maps source regions to the result text conservatively.
 */
export function mapRegionsToResultText(
  sourceRegions: readonly SourceConflictRegion[],
  resultText: string,
  existingDecisions?: Record<string, RegionDecisionState>,
): ConflictMergeRegion[] {
  const resultLines = tokenizeLosslessLines(resultText);
  const parsedMarkers = parseResultMarkerBlocks(resultText);
  const conflictRegions = sourceRegions.filter((r) => !r.stable);

  const mappedRegions: ConflictMergeRegion[] = [];
  const claimedRanges: LineRange[] = [];
  const matchedMarkerIndices = new Set<number>();

  for (const region of sourceRegions) {
    const existingDecision: RegionDecisionState =
      existingDecisions && existingDecisions[region.id]
        ? existingDecisions[region.id]
        : {
            oursDecision: "pending",
            theirsDecision: "pending",
            bothOrder: null,
            manualReview: region.stable ? "none" : "none",
          };

    if (region.stable) {
      mappedRegions.push({
        ...region,
        mapping: {
          confidence: "exact",
          resultRange: null,
          resultOffset: null,
          hasConflictMarkers: false,
        },
        decision: existingDecision,
      });
      continue;
    }

    // Unstable (conflict) region:
    // 1. Try to match with parsed conflict markers in resultText
    let matchedBlock: ParsedMarkerBlock | null = null;
    let matchIndex = -1;

    // Strategy 1A: If marker count equals conflict count and token contents align
    if (parsedMarkers.length === conflictRegions.length) {
      const cIdx = conflictRegions.findIndex((cr) => cr.id === region.id);
      if (cIdx !== -1 && !matchedMarkerIndices.has(cIdx)) {
        const candidate = parsedMarkers[cIdx];
        const oursMatch =
          candidate.oursTokens.join("") === region.oursTokens.join("");
        const theirsMatch =
          candidate.theirsTokens.join("") === region.theirsTokens.join("");
        if (oursMatch && theirsMatch) {
          matchedBlock = candidate;
          matchIndex = cIdx;
        }
      }
    }

    // Strategy 1B: Find uniquely matching marker block by content
    if (!matchedBlock) {
      let candidateMatch: ParsedMarkerBlock | null = null;
      let candidateIdx = -1;
      let multipleMatches = false;

      for (let i = 0; i < parsedMarkers.length; i++) {
        if (matchedMarkerIndices.has(i)) continue;
        const b = parsedMarkers[i];
        const oursMatch = b.oursTokens.join("") === region.oursTokens.join("");
        const theirsMatch =
          b.theirsTokens.join("") === region.theirsTokens.join("");

        if (oursMatch && theirsMatch) {
          if (candidateMatch) {
            multipleMatches = true;
          } else {
            candidateMatch = b;
            candidateIdx = i;
          }
        }
      }

      if (candidateMatch && !multipleMatches) {
        matchedBlock = candidateMatch;
        matchIndex = candidateIdx;
      }
    }

    if (matchedBlock) {
      const candidateRange: LineRange = {
        startLine: matchedBlock.startLine,
        endLine: matchedBlock.endLine,
      };
      const overlaps = claimedRanges.some(
        (r) => !(r.endLine < candidateRange.startLine || r.startLine > candidateRange.endLine),
      );
      if (!overlaps) {
        claimedRanges.push(candidateRange);
        matchedMarkerIndices.add(matchIndex);
        const resultRange = candidateRange;
        const resultOffset: OffsetRange = {
          startOffset: matchedBlock.startOffset,
          endOffset: matchedBlock.endOffset,
        };

        mappedRegions.push({
          ...region,
          mapping: {
            confidence: "exact",
            resultRange,
            resultOffset,
            hasConflictMarkers: true,
            markerStyle: matchedBlock.style,
          },
          decision: existingDecision,
        });
        continue;
      }
    }

    // 2. If no conflict markers matched, search for resolved/partial/marker-free content
    const oursStr = region.oursTokens.join("");
    const theirsStr = region.theirsTokens.join("");
    const oursTheirsStr = oursStr + theirsStr;
    const theirsOursStr = theirsStr + oursStr;

    let foundRange: LineRange | null = null;
    let isAmbiguous = false;

    const searchTargets = [
      existingDecision.bothOrder === "ours-then-theirs"
        ? oursTheirsStr
        : existingDecision.bothOrder === "theirs-then-ours"
          ? theirsOursStr
          : null,
      existingDecision.oursDecision === "accepted" ? oursStr : null,
      existingDecision.theirsDecision === "accepted" ? theirsStr : null,
      oursStr,
      theirsStr,
    ].filter((s): s is string => s !== null && s.length > 0);

    for (const target of searchTargets) {
      const targetLines = tokenizeLosslessLines(target);
      if (targetLines.length === 0) continue;

      let matchCount = 0;
      let matchedStartLine = -1;

      for (let i = 0; i <= resultLines.length - targetLines.length; i++) {
        let match = true;
        for (let j = 0; j < targetLines.length; j++) {
          if (resultLines[i + j] !== targetLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          matchCount++;
          matchedStartLine = i + 1;
        }
      }

      if (matchCount === 1) {
        const candidateRange = {
          startLine: matchedStartLine,
          endLine: matchedStartLine + targetLines.length - 1,
        };
        const overlaps = claimedRanges.some(
          (r) => !(r.endLine < candidateRange.startLine || r.startLine > candidateRange.endLine),
        );
        if (!overlaps) {
          foundRange = candidateRange;
          claimedRanges.push(foundRange);
          break;
        } else {
          isAmbiguous = true;
        }
      } else if (matchCount > 1) {
        isAmbiguous = true;
      }
    }

    if (foundRange && !isAmbiguous) {
      const resultOffset = lineRangeToOffsetRange(
        resultLines,
        foundRange.startLine,
        foundRange.endLine,
      );
      mappedRegions.push({
        ...region,
        mapping: {
          confidence: "exact",
          resultRange: foundRange,
          resultOffset,
          hasConflictMarkers: false,
        },
        decision: existingDecision,
      });
    } else {
      const decisionWithReview: RegionDecisionState = {
        ...existingDecision,
        manualReview:
          existingDecision.manualReview === "reviewed"
            ? "reviewed"
            : "needs-review",
      };

      mappedRegions.push({
        ...region,
        mapping: {
          confidence: isAmbiguous ? "ambiguous" : "unmapped",
          resultRange: null,
          resultOffset: null,
          hasConflictMarkers: false,
        },
        decision: decisionWithReview,
      });
    }
  }

  return mappedRegions;
}

/**
 * Computes overall conflict readiness.
 */
export function computeConflictReadiness(
  regions: readonly ConflictMergeRegion[],
  resultText: string,
): ConflictReadiness {
  const conflictRegions = regions.filter((r) => !r.stable);
  const totalConflicts = conflictRegions.length;

  let resolvedConflicts = 0;
  let unresolvedConflicts = 0;
  let needsReviewConflicts = 0;
  let ambiguousRegions = 0;
  const unresolvedReasons: string[] = [];

  const parsedMarkers = parseResultMarkerBlocks(resultText);
  const hasMarkers = parsedMarkers.length > 0;

  if (hasMarkers) {
    unresolvedReasons.push(
      `Result text contains ${parsedMarkers.length} unresolved conflict marker block(s).`,
    );
  }

  for (const cr of conflictRegions) {
    if (cr.mapping.confidence === "ambiguous") {
      if (cr.decision.manualReview !== "reviewed") {
        ambiguousRegions++;
        unresolvedReasons.push(
          `Conflict region ${cr.id} has ambiguous mapping and requires manual review.`,
        );
      }
    }

    const isExplicitlyReviewed = cr.decision.manualReview === "reviewed";
    const isAcceptedSide =
      cr.decision.oursDecision === "accepted" ||
      cr.decision.theirsDecision === "accepted";
    const isBothIgnored =
      cr.decision.oursDecision === "ignored" &&
      cr.decision.theirsDecision === "ignored";

    if (isExplicitlyReviewed || isAcceptedSide || isBothIgnored) {
      if (isExplicitlyReviewed || !cr.mapping.hasConflictMarkers) {
        resolvedConflicts++;
      } else {
        unresolvedConflicts++;
        unresolvedReasons.push(
          `Conflict region ${cr.id} still contains raw conflict markers.`,
        );
      }
    } else if (cr.decision.manualReview === "needs-review") {
      needsReviewConflicts++;
      unresolvedConflicts++;
      unresolvedReasons.push(
        `Conflict region ${cr.id} requires manual review.`,
      );
    } else {
      unresolvedConflicts++;
      unresolvedReasons.push(
        `Conflict region ${cr.id} has no accepted or reviewed decision.`,
      );
    }
  }

  const isReady =
    unresolvedConflicts === 0 &&
    ambiguousRegions === 0 &&
    (!hasMarkers || conflictRegions.every((r) => r.decision.manualReview === "reviewed"));

  return {
    isReady,
    totalConflicts,
    resolvedConflicts,
    unresolvedConflicts,
    needsReviewConflicts,
    ambiguousRegions,
    hasMarkers,
    unresolvedReasons,
  };
}
