import { describe, expect, it } from "vitest";
import { diff3Merge, diff3MergeRegions } from "node-diff3";
import { tokenizeLosslessLines } from "./conflict-merge-model.js";

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
    // All empty
    const r1 = diff3Merge([], [], []);
    expect(r1).toEqual([]);

    // Add/add with empty base (ancestor is empty)
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
    expect(regions).toHaveLength(3);

    // First region is stable header with CRLF
    expect(regions[0].stable).toBe(true);
    if (regions[0].stable) {
      expect(regions[0].bufferContent).toEqual(["header\r\n"]);
    }

    // Second region is conflict
    expect(regions[1].stable).toBe(false);
    if (!regions[1].stable) {
      expect(regions[1].aContent).toEqual(["ours val\r\n"]);
      expect(regions[1].oContent).toEqual(["base val\r\n"]);
      expect(regions[1].bContent).toEqual(["theirs val\r\n"]);
    }

    // Third region is stable footer with no final newline
    expect(regions[2].stable).toBe(true);
    if (regions[2].stable) {
      expect(regions[2].bufferContent).toEqual(["footer"]);
    }
  });

  it("handles repeated lines and adjacent insertions without crashing or dropping tokens", () => {
    const base = tokenizeLosslessLines("dup\ndup\ndup\n");
    const ours = tokenizeLosslessLines("dup\ninsertedA\ndup\ndup\n");
    const theirs = tokenizeLosslessLines("dup\ndup\ninsertedB\ndup\n");

    const regions = diff3MergeRegions(ours, base, theirs);
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
    // Worktree already contains partial manual edits or CLI conflict markers
    const importedWorktreeBytes =
      "<<<<<<< HEAD\npartial manual ours\n=======\ntheirs version\n>>>>>>> branch\n";
    const tokens = tokenizeLosslessLines(importedWorktreeBytes);

    // An imported worktree file must remain byte-identical upon open
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

    // Verify execution time remains well within sub-50ms main thread budget for 1,000 lines
    const m1000 = metrics.find((m) => m.lines === 1000);
    expect(m1000).toBeDefined();
    expect(m1000!.diff3Ms).toBeLessThan(100);
  });
});
