import { describe, expect, it } from "vitest";
import {
  canAdmitDraft,
  checkProspectiveEditGrowth,
  DEFAULT_MAX_DIRTY_DRAFTS,
  DEFAULT_MAX_DRAFT_BYTES,
} from "./conflict-draft-capacity.js";
import type { ConflictDraft } from "./conflict-draft-types.js";

function makeStubDraft(
  id: string,
  isDirty: boolean,
  totalBytes: number,
  result = "sample",
): ConflictDraft {
  return {
    id,
    scope: {
      profileId: "p1",
      generation: 1,
      serverUrl: "http://127.0.0.1:4801",
      project: "proj",
    },
    target: {
      conflictId: id,
      path: `file-${id}.ts`,
      snapshotVersion: "v1",
    },
    authority: {
      repositoryRoot: "/repo",
      worktreeRoot: "/repo",
      fullIndexFingerprint: "fp",
      effectiveAttributes: { ident: false, filterQualified: false },
    },
    stages: {
      ours: { stage: 2, mode: 0o100644, byteSize: 10, kind: "text" },
      theirs: { stage: 3, mode: 0o100644, byteSize: 10, kind: "text" },
    },
    worktree: {
      exists: true,
      kind: "regular",
      mode: 0o100644,
      byteLength: 20,
      hasConflictMarkers: true,
      isDirtyVsStages: true,
    },
    status: "bothModified",
    initialResult: result,
    result,
    resultRevision: 1,
    isDirty,
    isResolving: false,
    isApplied: false,
    inFlightAttempt: null,
    isRecovery: false,
    requiresReview: false,
    canCoalesceHistory: false,
    history: { past: [], future: [] },
    metrics: {
      sourceBytes: Math.floor(totalBytes / 2),
      resultBytes: Math.ceil(totalBytes / 2),
      historyBytes: 0,
      recoveryBytes: 0,
      totalBytes,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("Conflict Draft Capacity & Prospective Edit Guards", () => {
  it("rejects prospective edits exceeding draft budget without modifying draft", () => {
    const draft = makeStubDraft("d1", false, 100);
    const hugeString = "a".repeat(DEFAULT_MAX_DRAFT_BYTES + 1024);
    const check = checkProspectiveEditGrowth(draft, 100, hugeString);

    expect(check.accepted).toBe(false);
    expect(check.reason).toContain("exceed single draft memory budget");
  });

  it("evicts only clean drafts when admitting new drafts, preserving dirty drafts", () => {
    const cleanDrafts: ConflictDraft[] = [
      makeStubDraft("clean-0", false, 200),
      makeStubDraft("clean-1", false, 200),
    ];
    const dirtyDraft = makeStubDraft("dirty-0", true, 200);

    const check = canAdmitDraft(
      [...cleanDrafts, dirtyDraft],
      200,
      500,
      1000,
      10,
    );
    expect(check.admitted).toBe(true);
    expect(check.evictableDraftIds).toContain("clean-0");
    expect(check.evictableDraftIds).not.toContain("dirty-0");
  });

  it("refuses new drafts when maximum dirty drafts limit is reached", () => {
    const dirtyDrafts = Array.from(
      { length: DEFAULT_MAX_DIRTY_DRAFTS },
      (_, i) => makeStubDraft(`dirty-${i}`, true, 50),
    );

    const check = canAdmitDraft(dirtyDrafts, 100);
    expect(check.admitted).toBe(false);
    expect(check.reason).toContain("Maximum dirty drafts limit");
  });
});
