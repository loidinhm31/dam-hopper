import { describe, expect, it } from "vitest";
import { diff3Merge, diff3MergeRegions } from "node-diff3";
import {
  tokenizeLosslessLines,
  detectLineEnding,
  detectBOM,
  stripBOM,
  applyBOM,
  createConflictMergeModel,
  acceptRegionSide,
  ignoreRegionSide,
  acceptRegionBoth,
  markRegionReviewed,
  previewAcceptAllOurs,
  previewAcceptAllTheirs,
  previewRebuildClean,
  confirmWholeFileAction,
  applyManualResultTextEdit,
  findNextUnresolvedRegion,
  findPreviousUnresolvedRegion,
  getBaseComparisonForRegion,
  computeConflictReadiness,
  getModelSerializedResult,
} from "./conflict-merge-model.js";

describe("Phase 01: node-diff3 & lossless tokenization feasibility", () => {
  it("losslessly round-trips CRLF, LF, mixed endings, and missing final newline", () => {
    const fixtures = [
      "line1\r\nline2\r\nline3\r\n", // Pure CRLF
      "line1\nline2\nline3\n", // Pure LF
      "line1\r\nline2\nline3\r", // Mixed endings including lone CR
      "no-trailing-newline", // No final newline
      "first\r\nsecond-no-newline", // Mixed with missing final newline
      "", // Empty file
      "   trailing whitespace   \n\t\ttabs\r\n",
    ];

    for (const fixture of fixtures) {
      const tokens = tokenizeLosslessLines(fixture);
      const roundtrip = tokens.join("");
      expect(roundtrip).toBe(fixture);
      if (fixture.length > 0) {
        expect(tokens.length).toBeGreaterThan(0);
      } else {
        expect(tokens.length).toBe(0);
      }
    }
  });

  it("handles diff3 with empty files across all combinations", () => {
    const r1 = diff3Merge([], [], []);
    expect(r1).toEqual([]);

    const oursTokens = ["added in ours\n"];
    const baseTokens: string[] = [];
    const theirsTokens = ["added in theirs\n"];
    const r2 = diff3Merge(oursTokens, baseTokens, theirsTokens);

    expect(r2).toHaveLength(1);
    expect(r2[0]).toHaveProperty("conflict");
    if ("conflict" in r2[0]) {
      expect(r2[0].conflict.a).toEqual(["added in ours\n"]);
      expect(r2[0].conflict.o).toEqual([]);
      expect(r2[0].conflict.b).toEqual(["added in theirs\n"]);
    }
  });

  it("merges non-conflicting identical changes cleanly", () => {
    const base = tokenizeLosslessLines("common header\nold body\ncommon footer\n");
    const ours = tokenizeLosslessLines("common header\nnew body\ncommon footer\n");
    const theirs = tokenizeLosslessLines("common header\nnew body\ncommon footer\n");

    const result = diff3Merge(ours, base, theirs);
    expect(result).toEqual([
      { ok: ["common header\n", "new body\n", "common footer\n"] },
    ]);
  });

  it("preserves exact CRLF line terminators in diff3 regions", () => {
    const base = tokenizeLosslessLines("header\r\nbase val\r\nfooter");
    const ours = tokenizeLosslessLines("header\r\nours val\r\nfooter");
    const theirs = tokenizeLosslessLines("header\r\ntheirs val\r\nfooter");

    const regions = diff3MergeRegions(ours, base, theirs);
    expect(regions.length).toBeGreaterThanOrEqual(1);

    const conflictRegion = regions.find((r) => !r.stable);
    expect(conflictRegion).toBeDefined();

    if (conflictRegion && !conflictRegion.stable) {
      expect(conflictRegion.aContent[0]).toBe("ours val\r\n");
      expect(conflictRegion.bContent[0]).toBe("theirs val\r\n");
      expect(conflictRegion.oContent[0]).toBe("base val\r\n");
    }
  });

  it("handles repeated lines and adjacent insertions without crashing or dropping tokens", () => {
    const repeated = ["repeat\n", "repeat\n", "repeat\n"];
    const ours = ["repeat\n", "repeat\n", "ours insert\n", "repeat\n"];
    const theirs = ["repeat\n", "theirs insert\n", "repeat\n", "repeat\n"];

    const regions = diff3MergeRegions(ours, repeated, theirs);
    expect(regions.length).toBeGreaterThan(0);

    let totalTokensReassembled = 0;
    for (const r of regions) {
      if (r.stable) {
        totalTokensReassembled += r.bufferLength;
      }
    }
    expect(totalTokensReassembled).toBeGreaterThan(0);
  });

  it("preserves imported partial worktree results without automatic rebuild", () => {
    const importedWorktreeBytes =
      "<<<<<<< HEAD\npartial manual ours\n=======\ntheirs version\n>>>>>>> branch\n";
    const tokens = tokenizeLosslessLines(importedWorktreeBytes);

    const restoredText = tokens.join("");
    expect(restoredText).toBe(importedWorktreeBytes);
    expect(Buffer.from(restoredText, "utf-8")).toEqual(
      Buffer.from(importedWorktreeBytes, "utf-8"),
    );
  });

  it("measures performance across scaling line counts and conflict regions", () => {
    const lineCounts = [100, 1000, 5000];
    const metrics: Array<{ lines: number; tokenizeMs: number; diff3Ms: number }> = [];

    for (const count of lineCounts) {
      const baseLines: string[] = [];
      const oursLines: string[] = [];
      const theirsLines: string[] = [];

      for (let i = 0; i < count; i++) {
        const isConflict = i % 20 === 0;
        if (isConflict) {
          baseLines.push(`base line content ${i}\n`);
          oursLines.push(`ours changed content ${i}\n`);
          theirsLines.push(`theirs changed content ${i}\n`);
        } else {
          const line = `stable common line content ${i}\n`;
          baseLines.push(line);
          oursLines.push(line);
          theirsLines.push(line);
        }
      }

      const rawText = baseLines.join("");
      const t0 = performance.now();
      const tokens = tokenizeLosslessLines(rawText);
      const t1 = performance.now();

      const t2 = performance.now();
      const regions = diff3MergeRegions(oursLines, baseLines, theirsLines);
      const t3 = performance.now();

      expect(tokens.length).toBe(count);
      expect(regions.length).toBeGreaterThan(0);

      metrics.push({
        lines: count,
        tokenizeMs: Number((t1 - t0).toFixed(2)),
        diff3Ms: Number((t3 - t2).toFixed(2)),
      });
    }

    const m1000 = metrics.find((m) => m.lines === 1000);
    expect(m1000).toBeDefined();
    expect(m1000!.diff3Ms).toBeLessThan(100);
  });
});

describe("Phase 06: Byte fidelity & Line Endings", () => {
  it("detects line endings accurately across CRLF, LF, mixed, and none", () => {
    expect(detectLineEnding("a\r\nb\r\nc\r\n")).toBe("crlf");
    expect(detectLineEnding("a\nb\nc\n")).toBe("lf");
    expect(detectLineEnding("a\r\nb\nc\n")).toBe("mixed");
    expect(detectLineEnding("no newline")).toBe("none");
  });

  it("detects, strips, and re-applies UTF-8 BOM", () => {
    const textWithBOM = "\uFEFFheader\ncontent\n";
    expect(detectBOM(textWithBOM)).toBe(true);
    expect(detectBOM("header\ncontent\n")).toBe(false);

    const stripped = stripBOM(textWithBOM);
    expect(stripped.hasBOM).toBe(true);
    expect(stripped.text).toBe("header\ncontent\n");

    const reApplied = applyBOM(stripped.text, true);
    expect(reApplied).toBe(textWithBOM);
    expect(applyBOM(stripped.text, false)).toBe("header\ncontent\n");
  });
});

describe("Phase 06: Deterministic Regions and Conservative Mapping", () => {
  const baseContent = "common header\nbase body\ncommon footer\n";
  const oursContent = "common header\nours body\ncommon footer\n";
  const theirsContent = "common header\ntheirs body\ncommon footer\n";
  const worktreeWith2WayMarkers =
    "common header\n<<<<<<< HEAD\nours body\n=======\ntheirs body\n>>>>>>> branch\ncommon footer\n";
  const worktreeWithDiff3Markers =
    "common header\n<<<<<<< HEAD\nours body\n||||||| merged common ancestors\nbase body\n=======\ntheirs body\n>>>>>>> branch\ncommon footer\n";

  it("initializes model from 2-way conflict markers with exact mapping", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: worktreeWith2WayMarkers,
    });

    expect(model.regions.length).toBeGreaterThanOrEqual(3); // stable-1, conflict-1, stable-2
    const conflict = model.regions.find((r) => !r.stable);
    expect(conflict).toBeDefined();
    expect(conflict!.mapping.confidence).toBe("exact");
    expect(conflict!.mapping.hasConflictMarkers).toBe(true);
    expect(conflict!.mapping.resultRange).toEqual({ startLine: 2, endLine: 6 });
    expect(model.readiness.isReady).toBe(false);
    expect(model.readiness.hasMarkers).toBe(true);
  });

  it("initializes model from diff3 conflict markers with exact mapping", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: worktreeWithDiff3Markers,
    });

    const conflict = model.regions.find((r) => !r.stable);
    expect(conflict).toBeDefined();
    expect(conflict!.mapping.confidence).toBe("exact");
    expect(conflict!.mapping.hasConflictMarkers).toBe(true);
    expect(conflict!.mapping.markerStyle).toBe("diff3");
    expect(conflict!.mapping.resultRange).toEqual({ startLine: 2, endLine: 8 });
  });

  it("flags ambiguous mapping when repeated lines prevent unique offset match", () => {
    const repeatedBase = "repeat\nrepeat\nrepeat\n";
    const repeatedOurs = "repeat\nrepeat changed\nrepeat\n";
    const repeatedTheirs = "repeat\nrepeat changed 2\nrepeat\n";
    // Worktree where conflict markers were deleted, but repeated lines exist
    const worktreeAmbiguous = "repeat\nrepeat\nrepeat\nrepeat\n";

    const model = createConflictMergeModel({
      baseContent: repeatedBase,
      basePresent: true,
      oursContent: repeatedOurs,
      oursPresent: true,
      theirsContent: repeatedTheirs,
      theirsPresent: true,
      worktreeContent: worktreeAmbiguous,
    });

    const conflict = model.regions.find((r) => !r.stable);
    expect(conflict).toBeDefined();
    expect(conflict!.decision.manualReview).toBe("needs-review");
  });

  it("handles add/add conflict with absent base stage (present: false)", () => {
    const model = createConflictMergeModel({
      baseContent: "",
      basePresent: false,
      oursContent: "added in ours\n",
      oursPresent: true,
      theirsContent: "added in theirs\n",
      theirsPresent: true,
      worktreeContent: "<<<<<<< HEAD\nadded in ours\n=======\nadded in theirs\n>>>>>>> branch\n",
    });

    expect(model.stages.base.present).toBe(false);
    expect(model.stages.base.tokens).toEqual([]);
    const conflict = model.regions.find((r) => !r.stable);
    expect(conflict).toBeDefined();
    expect(conflict!.baseTokens).toEqual([]);
    expect(conflict!.baseRange).toEqual({ startLine: 0, endLine: 0 });
  });
});

describe("Phase 06: Decision Transitions & Action Semantics", () => {
  const baseContent = "common header\nbase body\ncommon footer\n";
  const oursContent = "common header\nours body\ncommon footer\n";
  const theirsContent = "common header\ntheirs body\ncommon footer\n";
  const worktreeWithMarkers =
    "common header\n<<<<<<< HEAD\nours body\n=======\ntheirs body\n>>>>>>> branch\ncommon footer\n";

  it("accepts 'ours' side, replaces text, and marks ours accepted and theirs ignored", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: worktreeWithMarkers,
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    const resolved = acceptRegionSide(model, conflict.id, "ours");

    expect(resolved.resultText).toBe("common header\nours body\ncommon footer\n");
    const updatedConflict = resolved.regions.find((r) => r.id === conflict.id)!;
    expect(updatedConflict.decision.oursDecision).toBe("accepted");
    expect(updatedConflict.decision.theirsDecision).toBe("ignored");
    expect(updatedConflict.decision.manualReview).toBe("reviewed");
    expect(resolved.readiness.isReady).toBe(true);
  });

  it("accepts 'theirs' side, replaces text, and marks theirs accepted and ours ignored", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: worktreeWithMarkers,
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    const resolved = acceptRegionSide(model, conflict.id, "theirs");

    expect(resolved.resultText).toBe("common header\ntheirs body\ncommon footer\n");
    const updatedConflict = resolved.regions.find((r) => r.id === conflict.id)!;
    expect(updatedConflict.decision.theirsDecision).toBe("accepted");
    expect(updatedConflict.decision.oursDecision).toBe("ignored");
    expect(updatedConflict.decision.manualReview).toBe("reviewed");
    expect(resolved.readiness.isReady).toBe(true);
  });

  it("ignores a side without touching result text", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: worktreeWithMarkers,
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    const ignoredOurs = ignoreRegionSide(model, conflict.id, "ours");

    // Invariant: Result text is 100% UNCHANGED by ignore!
    expect(ignoredOurs.resultText).toBe(worktreeWithMarkers);
    const updated1 = ignoredOurs.regions.find((r) => r.id === conflict.id)!;
    expect(updated1.decision.oursDecision).toBe("ignored");
    expect(updated1.decision.theirsDecision).toBe("pending");

    // Ignoring both sides marks manualReview as "reviewed"
    const ignoredBoth = ignoreRegionSide(ignoredOurs, conflict.id, "theirs");
    expect(ignoredBoth.resultText).toBe(worktreeWithMarkers);
    const updated2 = ignoredBoth.regions.find((r) => r.id === conflict.id)!;
    expect(updated2.decision.oursDecision).toBe("ignored");
    expect(updated2.decision.theirsDecision).toBe("ignored");
    expect(updated2.decision.manualReview).toBe("reviewed");
  });

  it("accepts both sides in both orders: ours-then-theirs and theirs-then-ours", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: worktreeWithMarkers,
    });

    const conflict = model.regions.find((r) => !r.stable)!;

    // 1. Ours then theirs
    const both1 = acceptRegionBoth(model, conflict.id, "ours-then-theirs");
    expect(both1.resultText).toBe(
      "common header\nours body\ntheirs body\ncommon footer\n",
    );
    const updated1 = both1.regions.find((r) => r.id === conflict.id)!;
    expect(updated1.decision.bothOrder).toBe("ours-then-theirs");
    expect(updated1.decision.oursDecision).toBe("accepted");
    expect(updated1.decision.theirsDecision).toBe("accepted");

    // 2. Theirs then ours
    const both2 = acceptRegionBoth(model, conflict.id, "theirs-then-ours");
    expect(both2.resultText).toBe(
      "common header\ntheirs body\nours body\ncommon footer\n",
    );
    const updated2 = both2.regions.find((r) => r.id === conflict.id)!;
    expect(updated2.decision.bothOrder).toBe("theirs-then-ours");
  });

  it("rejects destructive block actions when mapping is ambiguous or unmapped", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent: "corrupted text without markers\n",
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    expect(conflict.mapping.confidence).not.toBe("exact");

    expect(() => acceptRegionSide(model, conflict.id, "ours")).toThrowError(
      /Cannot accept side/i,
    );
    expect(() =>
      acceptRegionBoth(model, conflict.id, "ours-then-theirs"),
    ).toThrowError(/Cannot accept both sides/i);
  });
});

describe("Phase 06: Confirmed Whole-File Actions & Base Comparison", () => {
  const baseContent = "h\nbase 1\nm\nbase 2\nf\n";
  const oursContent = "h\nours 1\nm\nours 2\nf\n";
  const theirsContent = "h\ntheirs 1\nm\ntheirs 2\nf\n";
  const worktreeContent =
    "h\n<<<<<<< HEAD\nours 1\n=======\ntheirs 1\n>>>>>>> b\nm\n<<<<<<< HEAD\nours 2\n=======\ntheirs 2\n>>>>>>> b\nf\n";

  it("previews and confirms accept-all-ours", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent,
    });

    const preview = previewAcceptAllOurs(model);
    expect(preview.action).toBe("accept-all-ours");
    expect(preview.previewText).toBe("h\nours 1\nm\nours 2\nf\n");
    expect(preview.affectedRegions).toBe(2);

    const confirmed = confirmWholeFileAction(model, preview);
    expect(confirmed.resultText).toBe("h\nours 1\nm\nours 2\nf\n");
    expect(confirmed.readiness.isReady).toBe(true);
  });

  it("previews and confirms accept-all-theirs", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent,
    });

    const preview = previewAcceptAllTheirs(model);
    expect(preview.previewText).toBe("h\ntheirs 1\nm\ntheirs 2\nf\n");

    const confirmed = confirmWholeFileAction(model, preview);
    expect(confirmed.resultText).toBe("h\ntheirs 1\nm\ntheirs 2\nf\n");
    expect(confirmed.readiness.isReady).toBe(true);
  });

  it("rejects confirming a whole-file action when revision has drifted", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent,
    });

    const preview = previewAcceptAllOurs(model);
    // User made an edit in the meantime, advancing the revision!
    const editedModel = applyManualResultTextEdit(model, "edited result\n");
    expect(editedModel.resultRevision).toBeGreaterThan(preview.targetRevision);

    expect(() => confirmWholeFileAction(editedModel, preview)).toThrowError(
      /model revision drifted/i,
    );
  });

  it("provides read-only base comparison without mutating result text", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent,
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    const baseInfo = getBaseComparisonForRegion(model, conflict.id);
    expect(baseInfo.baseText).toBe("base 1\n");
    expect(baseInfo.present).toBe(true);
    expect(model.resultText).toBe(worktreeContent);
  });
});

describe("Phase 06: Synchronous Edit Observation & Navigation", () => {
  const baseContent = "h\nbase 1\nm\nbase 2\nf\n";
  const oursContent = "h\nours 1\nm\nours 2\nf\n";
  const theirsContent = "h\ntheirs 1\nm\ntheirs 2\nf\n";
  const worktreeContent =
    "h\n<<<<<<< HEAD\nours 1\n=======\ntheirs 1\n>>>>>>> b\nm\n<<<<<<< HEAD\nours 2\n=======\ntheirs 2\n>>>>>>> b\nf\n";

  it("navigates next and previous unresolved conflict regions", () => {
    const model = createConflictMergeModel({
      baseContent,
      basePresent: true,
      oursContent,
      oursPresent: true,
      theirsContent,
      theirsPresent: true,
      worktreeContent,
    });

    const first = findNextUnresolvedRegion(model, 1);
    expect(first).not.toBeNull();
    expect(first!.id).toBe("conflict-1");

    const second = findNextUnresolvedRegion(model, 7);
    expect(second).not.toBeNull();
    expect(second!.id).toBe("conflict-2");

    const prev = findPreviousUnresolvedRegion(model, 10);
    expect(prev).not.toBeNull();
    expect(prev!.id).toBe("conflict-2");
  });

  it("permits valid empty string as reviewed text outcome", () => {
    const model = createConflictMergeModel({
      baseContent: "base text\n",
      basePresent: true,
      oursContent: "ours text\n",
      oursPresent: true,
      theirsContent: "theirs text\n",
      theirsPresent: true,
      worktreeContent: "",
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    const reviewed = markRegionReviewed(model, conflict.id);
    expect(reviewed.resultText).toBe("");
    expect(reviewed.readiness.isReady).toBe(true);
  });

  it("prevents multiple conflict regions from claiming colliding line ranges", () => {
    const base = "h\nconflict line\nm\nconflict line\nf\n";
    const ours = "h\nours 1\nm\nours 2\nf\n";
    const theirs = "h\ntheirs 1\nm\ntheirs 2\nf\n";
    // Worktree where both conflict blocks have identical text and markers were partially cleared
    const worktree = "h\nours 1\nm\nours 2\nf\n";

    const model = createConflictMergeModel({
      baseContent: base,
      basePresent: true,
      oursContent: ours,
      oursPresent: true,
      theirsContent: theirs,
      theirsPresent: true,
      worktreeContent: worktree,
    });

    const conflicts = model.regions.filter((r) => !r.stable);
    expect(conflicts.length).toBe(2);
    // Both regions cannot claim the same line range
    if (conflicts[0].mapping.resultRange && conflicts[1].mapping.resultRange) {
      const r0 = conflicts[0].mapping.resultRange;
      const r1 = conflicts[1].mapping.resultRange;
      const overlap = !(r0.endLine < r1.startLine || r0.startLine > r1.endLine);
      expect(overlap).toBe(false);
    }
  });

  it("properly inserts newlines when stage tokens lack trailing newline in rebuild clean and both orders", () => {
    const base = "h\nbase"; // no trailing newline
    const ours = "h\nours"; // no trailing newline
    const theirs = "h\ntheirs"; // no trailing newline
    const worktree = "h\nours\n";

    const model = createConflictMergeModel({
      baseContent: base,
      basePresent: true,
      oursContent: ours,
      oursPresent: true,
      theirsContent: theirs,
      theirsPresent: true,
      worktreeContent: worktree,
    });

    const rebuild = previewRebuildClean(model);
    expect(rebuild.previewText).toContain("ours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>>");
    expect(rebuild.previewText).not.toContain("ours=======");
    expect(rebuild.previewText).not.toContain("theirs>>>>>>>");
  });

  it("preserves BOM on model creation, actions, and output text", () => {
    const worktreeBOM = "\uFEFFh\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\nf\n";
    const model = createConflictMergeModel({
      baseContent: "h\nbase\nf\n",
      basePresent: true,
      oursContent: "h\nours\nf\n",
      oursPresent: true,
      theirsContent: "h\ntheirs\nf\n",
      theirsPresent: true,
      worktreeContent: worktreeBOM,
    });

    expect(model.hasBom).toBe(true);
    // Inside model, resultText is clean (BOM-less) to guarantee offset sync
    expect(model.resultText.startsWith("h\n")).toBe(true);
    // Serialized output retains BOM
    expect(getModelSerializedResult(model).charCodeAt(0)).toBe(0xfeff);

    const conflict = model.regions.find((r) => !r.stable)!;
    const accepted = acceptRegionSide(model, conflict.id, "ours");
    expect(accepted.hasBom).toBe(true);
    expect(accepted.resultText).toBe("h\nours\nf\n");
    expect(getModelSerializedResult(accepted)).toBe("\uFEFFh\nours\nf\n");
    expect(getModelSerializedResult(accepted).charCodeAt(0)).toBe(0xfeff);
  });
  it("parses conflict on line 1 correctly when file has UTF-8 BOM", () => {
    const line1BOM = "\uFEFF<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\nfooter\n";
    const model = createConflictMergeModel({
      baseContent: "base\nfooter\n",
      basePresent: true,
      oursContent: "ours\nfooter\n",
      oursPresent: true,
      theirsContent: "theirs\nfooter\n",
      theirsPresent: true,
      worktreeContent: line1BOM,
    });

    expect(model.hasBom).toBe(true);
    expect(model.resultText.startsWith("<<<<<<< HEAD\n")).toBe(true);
    expect(model.readiness.hasMarkers).toBe(true);
    const conflict = model.regions.find((r) => !r.stable)!;
    expect(conflict).toBeDefined();
    expect(conflict.mapping.confidence).toBe("exact");
    expect(conflict.mapping.hasConflictMarkers).toBe(true);
    expect(conflict.mapping.resultRange?.startLine).toBe(1);

    const accepted = acceptRegionSide(model, conflict.id, "ours");
    expect(accepted.resultText).toBe("ours\nfooter\n");
    expect(getModelSerializedResult(accepted)).toBe("\uFEFFours\nfooter\n");
  });

  it("preserves BOM offsets across rebuild-clean confirm and accept actions without desync", () => {
    const multiConflictBOM = "\uFEFFh\n<<<<<<< HEAD\nours1\n=======\ntheirs1\n>>>>>>> b\nm\n<<<<<<< HEAD\nours2\n=======\ntheirs2\n>>>>>>> b\nf\n";
    const model = createConflictMergeModel({
      baseContent: "h\nbase1\nm\nbase2\nf\n",
      basePresent: true,
      oursContent: "h\nours1\nm\nours2\nf\n",
      oursPresent: true,
      theirsContent: "h\ntheirs1\nm\ntheirs2\nf\n",
      theirsPresent: true,
      worktreeContent: multiConflictBOM,
    });

    const rebuild = previewRebuildClean(model);
    const confirmed = confirmWholeFileAction(model, rebuild);
    expect(confirmed.hasBom).toBe(true);
    expect(confirmed.resultText.startsWith("h\n")).toBe(true);

    const conflicts = confirmed.regions.filter((r) => !r.stable);
    expect(conflicts).toHaveLength(2);
    const accepted1 = acceptRegionSide(confirmed, conflicts[0].id, "ours");
    expect(accepted1.hasBom).toBe(true);
    expect(accepted1.resultText).toContain("h\nours1\nm\n");

    const secondConflict = accepted1.regions.find((r) => !r.stable && r.id === conflicts[1].id)!;
    expect(secondConflict).toBeDefined();
    expect(secondConflict.mapping.confidence).toBe("exact");
    const accepted2 = acceptRegionSide(accepted1, secondConflict.id, "theirs");
    expect(accepted2.hasBom).toBe(true);
    expect(accepted2.resultText).toBe("h\nours1\nm\ntheirs2\nf\n");
    expect(getModelSerializedResult(accepted2)).toBe("\uFEFFh\nours1\nm\ntheirs2\nf\n");
  });

  it("preserves BOM offsets across manual text edits and accept actions", () => {
    const worktreeBOM = "\uFEFFh\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\nf\n";
    const model = createConflictMergeModel({
      baseContent: "h\nbase\nf\n",
      basePresent: true,
      oursContent: "h\nours\nf\n",
      oursPresent: true,
      theirsContent: "h\ntheirs\nf\n",
      theirsPresent: true,
      worktreeContent: worktreeBOM,
    });

    const edited = applyManualResultTextEdit(model, "header-edited\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\nf\n");
    expect(edited.hasBom).toBe(true);
    expect(edited.resultText.startsWith("header-edited\n")).toBe(true);

    const conflict = edited.regions.find((r) => !r.stable)!;
    expect(conflict.mapping.confidence).toBe("exact");
    const accepted = acceptRegionSide(edited, conflict.id, "theirs");
    expect(accepted.resultText).toBe("header-edited\ntheirs\nf\n");
    expect(getModelSerializedResult(accepted)).toBe("\uFEFFheader-edited\ntheirs\nf\n");
  });

  it("marks file ready when all regions are reviewed even if advisory markers remain in content", () => {
    const worktreeWithMarkers = "h\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\nf\n";
    const model = createConflictMergeModel({
      baseContent: "h\nbase\nf\n",
      basePresent: true,
      oursContent: "h\nours\nf\n",
      oursPresent: true,
      theirsContent: "h\ntheirs\nf\n",
      theirsPresent: true,
      worktreeContent: worktreeWithMarkers,
    });

    const conflict = model.regions.find((r) => !r.stable)!;
    // User explicitly marks the conflict region reviewed with literal markers retained
    const reviewed = markRegionReviewed(model, conflict.id);
    expect(reviewed.readiness.isReady).toBe(true);
    expect(reviewed.readiness.hasMarkers).toBe(true);
    expect(reviewed.readiness.unresolvedConflicts).toBe(0);
  });
});
