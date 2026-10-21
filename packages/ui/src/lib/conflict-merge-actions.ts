import type {
  ConflictMergeModel,
  ConflictMergeRegion,
  CreateModelOptions,
  LineRange,
  RegionDecisionState,
  WholeFileActionPreview,
  SourceConflictRegion,
} from "./conflict-merge-types.js";
import {
  applyBOM,
  detectLineEnding,
  stripBOM,
  tokenizeLosslessLines,
} from "./conflict-tokenization.js";
import {
  buildSourceRegions,
  computeConflictReadiness,
  mapRegionsToResultText,
} from "./conflict-region-mapper.js";

/**
 * Initializes a new ConflictMergeModel from raw stages and worktree content.
 * Worktree content is treated as the initial authoritative result, never automatically overwritten.
 */
export function createConflictMergeModel(
  options: CreateModelOptions,
): ConflictMergeModel {
  const {
    baseContent,
    basePresent,
    oursContent,
    oursPresent,
    theirsContent,
    theirsPresent,
    worktreeContent,
  } = options;

  const { text: cleanWorktree, hasBOM } = stripBOM(worktreeContent);
  const eol = detectLineEnding(cleanWorktree);

  const baseTokens = basePresent ? tokenizeLosslessLines(stripBOM(baseContent).text) : [];
  const oursTokens = oursPresent ? tokenizeLosslessLines(stripBOM(oursContent).text) : [];
  const theirsTokens = theirsPresent
    ? tokenizeLosslessLines(stripBOM(theirsContent).text)
    : [];

  const sourceRegions = buildSourceRegions(oursTokens, baseTokens, theirsTokens);
  const mappedRegions = mapRegionsToResultText(sourceRegions, cleanWorktree);
  const readiness = computeConflictReadiness(mappedRegions, cleanWorktree);
  return {
    stages: {
      base: { content: baseContent, present: basePresent, tokens: baseTokens },
      ours: { content: oursContent, present: oursPresent, tokens: oursTokens },
      theirs: {
        content: theirsContent,
        present: theirsPresent,
        tokens: theirsTokens,
      },
    },
    eol,
    hasBom: hasBOM,
    regions: mappedRegions,
    resultText: cleanWorktree,
    resultRevision: 1,
    readiness,
  };
}

function replaceRegionTextInResult(
  resultText: string,
  region: ConflictMergeRegion,
  replacementText: string,
): string {
  if (!region.mapping.resultOffset) {
    throw new Error(
      `Cannot replace text: region ${region.id} has no exact result mapping offset.`,
    );
  }
  const { startOffset, endOffset } = region.mapping.resultOffset;
  return (
    resultText.slice(0, startOffset) +
    replacementText +
    resultText.slice(endOffset)
  );
}
function extractSourceRegions(
  regions: readonly ConflictMergeRegion[],
): SourceConflictRegion[] {
  return regions.map((r) => ({
    id: r.id,
    index: r.index,
    stable: r.stable,
    oursTokens: r.oursTokens,
    oursRange: r.oursRange,
    theirsTokens: r.theirsTokens,
    theirsRange: r.theirsRange,
    baseTokens: r.baseTokens,
    baseRange: r.baseRange,
    stableSource: r.stableSource,
  }));
}


/**
 * Accepts a side ("ours" | "theirs") for a specific conflict region.
 * Throws if region mapping is ambiguous or unmapped.
 */
export function acceptRegionSide(
  model: ConflictMergeModel,
  regionId: string,
  side: "ours" | "theirs",
): ConflictMergeModel {
  const region = model.regions.find((r) => r.id === regionId);
  if (!region) throw new Error(`Region ${regionId} not found in model.`);
  if (region.stable) {
    throw new Error(`Cannot perform conflict decision on stable region ${regionId}.`);
  }
  if (
    region.mapping.confidence !== "exact" ||
    region.mapping.resultOffset === null
  ) {
    throw new Error(
      `Cannot accept side for region ${regionId}: mapping is ${region.mapping.confidence}. Manual review required.`,
    );
  }

  const replacementTokens =
    side === "ours" ? region.oursTokens : region.theirsTokens;
  const replacementText = replacementTokens.join("");
  const newResultText = replaceRegionTextInResult(
    model.resultText,
    region,
    replacementText,
  );

  const updatedDecisions: Record<string, RegionDecisionState> = {};
  for (const r of model.regions) {
    if (r.id === regionId) {
      updatedDecisions[r.id] = {
        oursDecision: side === "ours" ? "accepted" : "ignored",
        theirsDecision: side === "theirs" ? "accepted" : "ignored",
        bothOrder: null,
        manualReview: "reviewed",
      };
    } else {
      updatedDecisions[r.id] = { ...r.decision };
    }
  }

  const sourceRegions = extractSourceRegions(model.regions);
  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    newResultText,
    updatedDecisions,
  );
  const readiness = computeConflictReadiness(newMappedRegions, newResultText);

  return {
    ...model,
    regions: newMappedRegions,
    resultText: newResultText,
    resultRevision: model.resultRevision + 1,
    readiness,
  };
}

/**
 * Ignores a side ("ours" | "theirs") for a region.
 * Invariant: Ignore retains the current result text untouched; it only records a per-side decision.
 */
export function ignoreRegionSide(
  model: ConflictMergeModel,
  regionId: string,
  side: "ours" | "theirs",
): ConflictMergeModel {
  const region = model.regions.find((r) => r.id === regionId);
  if (!region) throw new Error(`Region ${regionId} not found in model.`);
  if (region.stable) {
    throw new Error(`Cannot perform conflict decision on stable region ${regionId}.`);
  }

  const updatedDecisions: Record<string, RegionDecisionState> = {};
  for (const r of model.regions) {
    if (r.id === regionId) {
      const current = r.decision;
      const newOurs = side === "ours" ? "ignored" : current.oursDecision;
      const newTheirs =
        side === "theirs" ? "ignored" : current.theirsDecision;
      const bothIgnored = newOurs === "ignored" && newTheirs === "ignored";

      updatedDecisions[r.id] = {
        oursDecision: newOurs,
        theirsDecision: newTheirs,
        bothOrder: null,
        manualReview: bothIgnored ? "reviewed" : current.manualReview,
      };
    } else {
      updatedDecisions[r.id] = { ...r.decision };
    }
  }

  const sourceRegions = extractSourceRegions(model.regions);
  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    model.resultText,
    updatedDecisions,
  );
  const readiness = computeConflictReadiness(newMappedRegions, model.resultText);

  return {
    ...model,
    regions: newMappedRegions,
    resultRevision: model.resultRevision + 1,
    readiness,
  };
}

/**
 * Accepts both sides in specified order ("ours-then-theirs" | "theirs-then-ours").
 * Throws if region mapping is ambiguous or unmapped.
 */
export function acceptRegionBoth(
  model: ConflictMergeModel,
  regionId: string,
  order: "ours-then-theirs" | "theirs-then-ours",
): ConflictMergeModel {
  const region = model.regions.find((r) => r.id === regionId);
  if (!region) throw new Error(`Region ${regionId} not found in model.`);
  if (region.stable) {
    throw new Error(`Cannot perform conflict decision on stable region ${regionId}.`);
  }
  if (
    region.mapping.confidence !== "exact" ||
    region.mapping.resultOffset === null
  ) {
    throw new Error(
      `Cannot accept both sides for region ${regionId}: mapping is ${region.mapping.confidence}. Manual review required.`,
    );
  }

  const firstTokens =
    order === "ours-then-theirs" ? region.oursTokens : region.theirsTokens;
  const secondTokens =
    order === "ours-then-theirs" ? region.theirsTokens : region.oursTokens;
  const firstStr = firstTokens.join("");
  const secondStr = secondTokens.join("");
  const eolChar = model.eol === "crlf" ? "\r\n" : "\n";
  const needsSep =
    firstStr.length > 0 &&
    secondStr.length > 0 &&
    !firstStr.endsWith("\n") &&
    !firstStr.endsWith("\r");
  const replacementText = needsSep ? firstStr + eolChar + secondStr : firstStr + secondStr;

  const newResultText = replaceRegionTextInResult(
    model.resultText,
    region,
    replacementText,
  );

  const updatedDecisions: Record<string, RegionDecisionState> = {};
  for (const r of model.regions) {
    if (r.id === regionId) {
      updatedDecisions[r.id] = {
        oursDecision: "accepted",
        theirsDecision: "accepted",
        bothOrder: order,
        manualReview: "reviewed",
      };
    } else {
      updatedDecisions[r.id] = { ...r.decision };
    }
  }

  const sourceRegions = extractSourceRegions(model.regions);
  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    newResultText,
    updatedDecisions,
  );
  const readiness = computeConflictReadiness(newMappedRegions, newResultText);

  return {
    ...model,
    regions: newMappedRegions,
    resultText: newResultText,
    resultRevision: model.resultRevision + 1,
    readiness,
  };
}

/**
 * Explicitly marks a region as reviewed (text unchanged).
 */
export function markRegionReviewed(
  model: ConflictMergeModel,
  regionId: string,
): ConflictMergeModel {
  const region = model.regions.find((r) => r.id === regionId);
  if (!region) throw new Error(`Region ${regionId} not found in model.`);

  const updatedDecisions: Record<string, RegionDecisionState> = {};
  for (const r of model.regions) {
    if (r.id === regionId) {
      updatedDecisions[r.id] = {
        ...r.decision,
        manualReview: "reviewed",
      };
    } else {
      updatedDecisions[r.id] = { ...r.decision };
    }
  }

  const sourceRegions = extractSourceRegions(model.regions);
  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    model.resultText,
    updatedDecisions,
  );
  const readiness = computeConflictReadiness(newMappedRegions, model.resultText);

  return {
    ...model,
    regions: newMappedRegions,
    resultRevision: model.resultRevision + 1,
    readiness,
  };
}

/**
 * Previews accepting all "ours" sides across all conflict regions.
 */
export function previewAcceptAllOurs(
  model: ConflictMergeModel,
): WholeFileActionPreview {
  const pieces: string[] = [];
  const newDecisions: Record<string, RegionDecisionState> = {};
  let affected = 0;

  for (const region of model.regions) {
    if (region.stable) {
      if (region.stableSource === "a") {
        pieces.push(region.oursTokens.join(""));
      } else if (region.stableSource === "b") {
        pieces.push(region.theirsTokens.join(""));
      } else {
        pieces.push(region.baseTokens.join(""));
      }
      newDecisions[region.id] = { ...region.decision };
    } else {
      pieces.push(region.oursTokens.join(""));
      newDecisions[region.id] = {
        oursDecision: "accepted",
        theirsDecision: "ignored",
        bothOrder: null,
        manualReview: "reviewed",
      };
      affected++;
    }
  }

  return {
    action: "accept-all-ours",
    previewText: pieces.join(""),
    targetRevision: model.resultRevision,
    affectedRegions: affected,
    newDecisions,
  };
}

/**
 * Previews accepting all "theirs" sides across all conflict regions.
 */
export function previewAcceptAllTheirs(
  model: ConflictMergeModel,
): WholeFileActionPreview {
  const pieces: string[] = [];
  const newDecisions: Record<string, RegionDecisionState> = {};
  let affected = 0;

  for (const region of model.regions) {
    if (region.stable) {
      if (region.stableSource === "a") {
        pieces.push(region.oursTokens.join(""));
      } else if (region.stableSource === "b") {
        pieces.push(region.theirsTokens.join(""));
      } else {
        pieces.push(region.baseTokens.join(""));
      }
      newDecisions[region.id] = { ...region.decision };
    } else {
      pieces.push(region.theirsTokens.join(""));
      newDecisions[region.id] = {
        oursDecision: "ignored",
        theirsDecision: "accepted",
        bothOrder: null,
        manualReview: "reviewed",
      };
      affected++;
    }
  }

  return {
    action: "accept-all-theirs",
    previewText: pieces.join(""),
    targetRevision: model.resultRevision,
    affectedRegions: affected,
    newDecisions,
  };
}

/**
 * Previews rebuilding clean diff3 text with standard conflict markers.
 */
export function previewRebuildClean(
  model: ConflictMergeModel,
): WholeFileActionPreview {
  const pieces: string[] = [];
  const newDecisions: Record<string, RegionDecisionState> = {};
  let affected = 0;

  for (const region of model.regions) {
    if (region.stable) {
      if (region.stableSource === "a") {
        pieces.push(region.oursTokens.join(""));
      } else if (region.stableSource === "b") {
        pieces.push(region.theirsTokens.join(""));
      } else {
        pieces.push(region.baseTokens.join(""));
      }
      newDecisions[region.id] = { ...region.decision };
    } else {
      const eolChar = model.eol === "crlf" ? "\r\n" : "\n";
      pieces.push(`<<<<<<< ours${eolChar}`);
      const oursStr = region.oursTokens.join("");
      pieces.push(oursStr);
      if (oursStr.length > 0 && !oursStr.endsWith("\n") && !oursStr.endsWith("\r")) {
        pieces.push(eolChar);
      }
      if (region.baseTokens.length > 0) {
        pieces.push(`||||||| base${eolChar}`);
        const baseStr = region.baseTokens.join("");
        pieces.push(baseStr);
        if (baseStr.length > 0 && !baseStr.endsWith("\n") && !baseStr.endsWith("\r")) {
          pieces.push(eolChar);
        }
      }
      pieces.push(`=======${eolChar}`);
      const theirsStr = region.theirsTokens.join("");
      pieces.push(theirsStr);
      if (theirsStr.length > 0 && !theirsStr.endsWith("\n") && !theirsStr.endsWith("\r")) {
        pieces.push(eolChar);
      }
      pieces.push(`>>>>>>> theirs${eolChar}`);
      newDecisions[region.id] = {
        oursDecision: "pending",
        theirsDecision: "pending",
        bothOrder: null,
        manualReview: "none",
      };
      affected++;
    }
  }

  return {
    action: "rebuild-clean",
    previewText: pieces.join(""),
    targetRevision: model.resultRevision,
    affectedRegions: affected,
    newDecisions,
  };
}

/**
 * Confirms a whole-file action transaction, strictly validating that the draft revision has not drifted.
 */
export function confirmWholeFileAction(
  model: ConflictMergeModel,
  preview: WholeFileActionPreview,
): ConflictMergeModel {
  if (model.resultRevision !== preview.targetRevision) {
    throw new Error(
      `Cannot confirm ${preview.action}: model revision drifted (expected ${preview.targetRevision}, current ${model.resultRevision}).`,
    );
  }

  const cleanPreview = stripBOM(preview.previewText).text;
  const sourceRegions = extractSourceRegions(model.regions);
  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    cleanPreview,
    preview.newDecisions,
  );
  const readiness = computeConflictReadiness(
    newMappedRegions,
    cleanPreview,
  );

  return {
    ...model,
    regions: newMappedRegions,
    resultText: cleanPreview,
    resultRevision: model.resultRevision + 1,
    readiness,
  };
}

/**
 * Observes manual edits in the editor, synchronously re-evaluating mapping and invalidating unsafe regions.
 */
export function applyManualResultTextEdit(
  model: ConflictMergeModel,
  newResultText: string,
): ConflictMergeModel {
  const { text: cleanNewText, hasBOM: newHasBOM } = stripBOM(newResultText);
  if (model.resultText === cleanNewText) {
    return model;
  }

  const sourceRegions = extractSourceRegions(model.regions);

  const existingDecisions: Record<string, RegionDecisionState> = {};
  for (const r of model.regions) {
    existingDecisions[r.id] = { ...r.decision };
  }

  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    cleanNewText,
    existingDecisions,
  );

  for (const r of newMappedRegions) {
    if (!r.stable && (r.mapping.confidence === "ambiguous" || r.mapping.confidence === "unmapped")) {
      r.decision.manualReview = "needs-review";
      r.decision.oursDecision = "pending";
      r.decision.theirsDecision = "pending";
      r.decision.bothOrder = null;
    }
  }

  const readiness = computeConflictReadiness(newMappedRegions, cleanNewText);

  return {
    ...model,
    regions: newMappedRegions,
    resultText: cleanNewText,
    hasBom: model.hasBom || newHasBOM,
    resultRevision: model.resultRevision + 1,
    readiness,
  };
}

/**
 * Finds next unresolved or review-needed conflict region from current line.
 */
export function findNextUnresolvedRegion(
  model: ConflictMergeModel,
  currentLine: number,
): ConflictMergeRegion | null {
  const unresolved = model.regions.filter(
    (r) =>
      !r.stable &&
      (r.decision.manualReview === "needs-review" ||
        (r.decision.oursDecision === "pending" &&
          r.decision.theirsDecision === "pending" &&
          r.decision.manualReview !== "reviewed")),
  );

  for (const r of unresolved) {
    if (r.mapping.resultRange && r.mapping.resultRange.startLine > currentLine) {
      return r;
    }
  }
  return unresolved.length > 0 ? unresolved[0] : null;
}

/**
 * Finds previous unresolved or review-needed conflict region from current line.
 */
export function findPreviousUnresolvedRegion(
  model: ConflictMergeModel,
  currentLine: number,
): ConflictMergeRegion | null {
  const unresolved = model.regions.filter(
    (r) =>
      !r.stable &&
      (r.decision.manualReview === "needs-review" ||
        (r.decision.oursDecision === "pending" &&
          r.decision.theirsDecision === "pending" &&
          r.decision.manualReview !== "reviewed")),
  );

  for (let i = unresolved.length - 1; i >= 0; i--) {
    const r = unresolved[i];
    if (r.mapping.resultRange && r.mapping.resultRange.startLine < currentLine) {
      return r;
    }
  }
  return unresolved.length > 0 ? unresolved[unresolved.length - 1] : null;
}

/**
 * Read-only base comparison: returns base text and range for a region.
 */
export function getBaseComparisonForRegion(
  model: ConflictMergeModel,
  regionId: string,
): { baseText: string; baseRange: LineRange; present: boolean } {
  const region = model.regions.find((r) => r.id === regionId);
  if (!region) throw new Error(`Region ${regionId} not found.`);
  return {
    baseText: region.baseTokens.join(""),
    baseRange: region.baseRange,
    present: model.stages.base.present,
  };
}

/**
 * Extracts a record of all current region decisions from the model.
 */
export function extractModelDecisions(
  model: ConflictMergeModel,
): Record<string, RegionDecisionState> {
  const map: Record<string, RegionDecisionState> = {};
  for (const r of model.regions) {
    map[r.id] = { ...r.decision };
  }
  return map;
}

/**
 * Restores saved region decisions onto the model and re-evaluates mappings and readiness.
 */
export function restoreModelDecisions(
  model: ConflictMergeModel,
  decisions: Record<string, RegionDecisionState>,
): ConflictMergeModel {
  const sourceRegions = extractSourceRegions(model.regions);
  const newMappedRegions = mapRegionsToResultText(
    sourceRegions,
    model.resultText,
    decisions,
  );
  const readiness = computeConflictReadiness(newMappedRegions, model.resultText);
  return {
    ...model,
    regions: newMappedRegions,
    readiness,
  };
}

/**
 * Returns the final serialized result string with BOM applied if hasBom is true.
 */
export function getModelSerializedResult(model: ConflictMergeModel): string {
  return applyBOM(model.resultText, model.hasBom);
}
