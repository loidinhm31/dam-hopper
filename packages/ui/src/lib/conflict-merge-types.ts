export type SideChoice = "ours" | "theirs" | "base";
export type RegionDecision = "pending" | "accepted" | "ignored";
export type BothOrder = "ours-then-theirs" | "theirs-then-ours" | null;
export type ManualReviewState = "none" | "needs-review" | "reviewed";
export type MappingConfidence = "exact" | "ambiguous" | "unmapped";
export type LineEnding = "crlf" | "lf" | "mixed" | "none";

export interface LineRange {
  /** 1-based start line */
  startLine: number;
  /** 1-based end line (inclusive) */
  endLine: number;
}

export interface OffsetRange {
  startOffset: number;
  endOffset: number;
}

export interface SourceConflictRegion {
  /** Deterministic stable region ID (e.g. "conflict-1", "stable-1") */
  id: string;
  index: number;
  stable: boolean;
  /** Ours (stage 2) tokens and 1-based line range in stage 2 */
  oursTokens: string[];
  oursRange: LineRange;
  /** Theirs (stage 3) tokens and 1-based line range in stage 3 */
  theirsTokens: string[];
  theirsRange: LineRange;
  /** Base (stage 1) tokens and 1-based line range in stage 1 */
  baseTokens: string[];
  baseRange: LineRange;
  /** If stable, which buffer it came from: "o" | "a" | "b" */
  stableSource?: "o" | "a" | "b";
}

export interface RegionMapping {
  confidence: MappingConfidence;
  /** 1-based line range in the current result text, or null if unmapped */
  resultRange: LineRange | null;
  /** Character offset range in the current result text, or null if unmapped */
  resultOffset: OffsetRange | null;
  /** True if this mapped region currently contains Git conflict markers in result text */
  hasConflictMarkers: boolean;
  /** Matched marker style if present */
  markerStyle?: "diff3" | "zdiff3" | "normal" | "partial";
}

export interface RegionDecisionState {
  oursDecision: RegionDecision;
  theirsDecision: RegionDecision;
  bothOrder: BothOrder;
  manualReview: ManualReviewState;
}

export interface ConflictMergeRegion extends SourceConflictRegion {
  mapping: RegionMapping;
  decision: RegionDecisionState;
}

export interface ConflictReadiness {
  isReady: boolean;
  totalConflicts: number;
  resolvedConflicts: number;
  unresolvedConflicts: number;
  needsReviewConflicts: number;
  ambiguousRegions: number;
  hasMarkers: boolean;
  unresolvedReasons: string[];
}

export interface StageContentDescriptor {
  content: string;
  present: boolean;
  tokens: string[];
}

export interface ConflictMergeModel {
  readonly stages: {
    readonly base: StageContentDescriptor;
    readonly ours: StageContentDescriptor;
    readonly theirs: StageContentDescriptor;
  };
  readonly eol: LineEnding;
  readonly hasBom: boolean;
  readonly regions: readonly ConflictMergeRegion[];
  readonly resultText: string;
  readonly resultRevision: number;
  readonly readiness: ConflictReadiness;
}

export interface WholeFileActionPreview {
  action: "accept-all-ours" | "accept-all-theirs" | "rebuild-clean";
  draftKey?: string;
  previewText: string;
  targetRevision: number;
  affectedRegions: number;
  newDecisions: Record<string, RegionDecisionState>;
}

export interface CreateModelOptions {
  baseContent: string;
  basePresent: boolean;
  oursContent: string;
  oursPresent: boolean;
  theirsContent: string;
  theirsPresent: boolean;
  worktreeContent: string;
}
