import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflictDraftStore } from "./conflict-draft-store.js";
import {
  createDraftKey,
  isOwnerActive,
  matchesOwnerScope,
} from "./conflict-draft-key.js";
import type {
  ConflictSnapshot,
  ConflictStages,
  ResolveOutcome,
  WorktreeDescriptor,
} from "@/api/client.js";
import type { ConflictDraft, DraftOwnerScope } from "./conflict-draft-types.js";

function makeScope(overrides: Partial<DraftOwnerScope> = {}): DraftOwnerScope {
  return {
    profileId: "profile-1",
    generation: 1,
    serverUrl: "http://127.0.0.1:4801",
    project: "repo-alpha",
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ConflictSnapshot> = {},
): ConflictSnapshot {
  const stages: ConflictStages = {
    base: {
      stage: 1,
      oid: "oid-b",
      mode: 0o100644,
      byteSize: 10,
      kind: "text",
      textTokens: ["base\n"],
    },
    ours: {
      stage: 2,
      oid: "oid-o",
      mode: 0o100644,
      byteSize: 10,
      kind: "text",
      textTokens: ["ours\n"],
    },
    theirs: {
      stage: 3,
      oid: "oid-t",
      mode: 0o100644,
      byteSize: 10,
      kind: "text",
      textTokens: ["theirs\n"],
    },
  };
  const worktree: WorktreeDescriptor = {
    exists: true,
    kind: "regular",
    mode: 0o100644,
    byteLength: 20,
    textTokens: [
      "<<<<<<< ours\n",
      "ours\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> theirs\n",
    ],
    hasConflictMarkers: true,
    isDirtyVsStages: true,
  };

  return {
    conflictId: "c-1",
    path: "src/file.ts",
    repositoryRoot: "/repo",
    worktreeRoot: "/repo",
    snapshotVersion: "snap-1",
    fullIndexFingerprint: "fp-1",
    status: "bothModified",
    stages,
    worktree,
    effectiveAttributes: { ident: false, filterQualified: false },
    ...overrides,
  };
}

function loadOrThrow(
  scope: DraftOwnerScope,
  snapshot: ConflictSnapshot,
): ConflictDraft {
  const res = conflictDraftStore.loadSnapshot(scope, snapshot);
  if ("error" in res) throw new Error(res.error);
  return res.draft;
}

describe("Conflict Draft Key & Ownership Fencing", () => {
  it("generates deterministic keys distinguishing profile, generation, and target", () => {
    const scope1 = makeScope({ profileId: "p1", generation: 1 });
    const scope2 = makeScope({ profileId: "p1", generation: 2 });
    const target = { conflictId: "c1", snapshotVersion: "v1" };

    expect(createDraftKey(scope1, target)).not.toBe(
      createDraftKey(scope2, target),
    );
    expect(isOwnerActive(scope1, "p1", 1)).toBe(true);
    expect(isOwnerActive(scope1, "p1", 2)).toBe(false);
    expect(
      matchesOwnerScope(scope1, makeScope({ profileId: "p1", generation: 1 })),
    ).toBe(true);
  });
});

describe("Conflict Draft Store — Lifecycle & History", () => {
  beforeEach(() => {
    conflictDraftStore.resetForTesting();
  });

  it("publishes stable snapshots until a store transition occurs", () => {
    const before = conflictDraftStore.getSnapshot();
    expect(conflictDraftStore.getSnapshot()).toBe(before);

    conflictDraftStore.loadSnapshot(makeScope(), makeSnapshot());
    expect(conflictDraftStore.getSnapshot()).not.toBe(before);
    expect(conflictDraftStore.getSnapshot()).toBe(
      conflictDraftStore.getSnapshot(),
    );
  });

  it("loads snapshot and retains dirty modifications on re-load", () => {
    const scope = makeScope();
    const snapshot = makeSnapshot();
    const draft = loadOrThrow(scope, snapshot);

    expect(draft.isDirty).toBe(false);
    conflictDraftStore.updateResult(draft.id, "my resolution");
    expect(draft.isDirty).toBe(true);

    const reloaded = loadOrThrow(scope, snapshot);
    expect(reloaded.result).toBe("my resolution");
    expect(reloaded.isDirty).toBe(true);
  });

  it("handles undo and redo history accurately across edit transactions", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    conflictDraftStore.updateResult(draft.id, "step 1");
    clock.mockReturnValue(2_000);
    conflictDraftStore.updateResult(draft.id, "step 2");
    expect(draft.result).toBe("step 2");

    expect(conflictDraftStore.undo(draft.id)).toBe(true);
    expect(draft.result).toBe("step 1");

    expect(conflictDraftStore.redo(draft.id)).toBe(true);
    expect(draft.result).toBe("step 2");
    clock.mockRestore();
  });
  it("coalesces rapid typing into a reversible edit group", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    let text = "";
    for (let index = 0; index < 80; index += 1) {
      clock.mockReturnValue(10_000 + index * 10);
      text += "x";
      expect(conflictDraftStore.updateResult(draft.id, text).success).toBe(
        true,
      );
    }

    expect(draft.history.past).toHaveLength(1);
    expect(conflictDraftStore.undo(draft.id)).toBe(true);
    expect(draft.result).toBe(draft.initialResult);
    expect(conflictDraftStore.redo(draft.id)).toBe(true);
    expect(draft.result).toBe(text);
    clock.mockRestore();
  });

  it("requires confirmation to discard dirty drafts, clean drafts discard directly", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    expect(conflictDraftStore.discardDraft(draft.id, false)).toBe(true);

    const dirtyDraft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(dirtyDraft.id, "dirty content");
    expect(conflictDraftStore.discardDraft(dirtyDraft.id, false)).toBe(false);
    expect(conflictDraftStore.discardDraft(dirtyDraft.id, true)).toBe(true);
  });
});

describe("Conflict Draft Store — Apply & Reconciliation", () => {
  beforeEach(() => {
    conflictDraftStore.resetForTesting();
  });

  it("settles applied drafts and excludes their retained history from dirty warnings", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(draft.id, "resolved text");
    const attempt = conflictDraftStore.beginResolve(draft.id, {
      type: "reviewedText",
      tokens: [draft.result],
    });

    conflictDraftStore.reconcileOutcome(draft.id, attempt.attemptId, {
      outcome: "applied",
    });
    expect(draft.isResolving).toBe(false);
    expect(draft.isDirty).toBe(false);
    expect(draft.isApplied).toBe(true);
    expect(draft.history.past).toHaveLength(1);
    expect(conflictDraftStore.hasDirtyDrafts()).toBe(false);
  });
  it("blocks repeat Apply and moves post-apply edits into recovery", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(draft.id, "resolved text");
    const attempt = conflictDraftStore.beginResolve(draft.id, {
      type: "reviewedText",
      tokens: [draft.result],
    });
    conflictDraftStore.reconcileOutcome(draft.id, attempt.attemptId, {
      outcome: "applied",
    });

    expect(() =>
      conflictDraftStore.beginResolve(draft.id, {
        type: "reviewedText",
        tokens: [draft.result],
      }),
    ).toThrow();
    expect(
      conflictDraftStore.updateResult(draft.id, "edited after apply").success,
    ).toBe(true);
    expect(draft.isRecovery).toBe(true);
    expect(draft.recoveryText).toBe("edited after apply");
  });

  it("preserves post-submit typing and remains dirty when user edited in flight", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(draft.id, "revision 2");
    const attempt = conflictDraftStore.beginResolve(draft.id, {
      type: "reviewedText",
      tokens: [draft.result],
    });

    conflictDraftStore.updateResult(draft.id, "revision 3 typed in-flight");
    conflictDraftStore.reconcileOutcome(draft.id, attempt.attemptId, {
      outcome: "applied",
    });

    expect(draft.isResolving).toBe(false);
    expect(draft.result).toBe("revision 3 typed in-flight");
    expect(draft.isDirty).toBe(true);
  });

  it("transitions to recovery mode on non-applied outcomes", () => {
    const outcomes: ResolveOutcome[] = [
      { outcome: "stale", reason: "Index changed", requiredRefresh: true },
      { outcome: "busy", reason: "Git locked" },
      { outcome: "unsupported", reason: "Filter failed" },
      { outcome: "failedBeforeWrite", error: "Permission error" },
    ];

    for (const [index, outcome] of outcomes.entries()) {
      const draft = loadOrThrow(
        makeScope(),
        makeSnapshot({
          conflictId: `c-${index}`,
          path: `src/file-${index}.ts`,
          snapshotVersion: `snap-${index}`,
          fullIndexFingerprint: `fp-${index}`,
        }),
      );
      const attempt = conflictDraftStore.beginResolve(draft.id, {
        type: "delete",
      });
      conflictDraftStore.reconcileOutcome(draft.id, attempt.attemptId, outcome);

      expect(draft.isResolving).toBe(false);
      expect(draft.isRecovery).toBe(true);
      expect(draft.recoveryReason).toContain(outcome.outcome);
      expect(() =>
        conflictDraftStore.beginResolve(draft.id, { type: "delete" }),
      ).toThrow();
      expect(draft.isResolving).toBe(false);
      expect(draft.inFlightAttempt).toBeNull();
    }
  });

  it("prevents concurrent in-flight mutations and ignores stale attempt IDs", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.beginResolve(draft.id, { type: "delete" });
    expect(() =>
      conflictDraftStore.beginResolve(draft.id, { type: "delete" }),
    ).toThrow();

    conflictDraftStore.reconcileOutcome(draft.id, "wrong-id", {
      outcome: "applied",
    });
    expect(draft.isResolving).toBe(true);
  });

  it("retires scopes on profile/generation changes and marks drafts for recovery", () => {
    const draft = loadOrThrow(
      makeScope({ profileId: "p1", generation: 1 }),
      makeSnapshot(),
    );
    conflictDraftStore.updateResult(draft.id, "important work");
    conflictDraftStore.retireScope("p1", 1);

    expect(draft.isRecovery).toBe(true);
    expect(draft.recoveryText).toBe("important work");
  });
  it("moves dirty drafts to recovery when a same-owner snapshot changes", () => {
    const scope = makeScope();
    const stale = loadOrThrow(scope, makeSnapshot());
    conflictDraftStore.updateResult(stale.id, "unsent resolution");

    const fresh = loadOrThrow(
      scope,
      makeSnapshot({
        snapshotVersion: "snap-2",
        fullIndexFingerprint: "fp-2",
      }),
    );
    expect(stale.isRecovery).toBe(true);
    expect(stale.recoveryText).toBe("unsent resolution");
    expect(
      conflictDraftStore.importRecoveryDraft(stale.id, fresh.id).success,
    ).toBe(true);
    expect(fresh.requiresReview).toBe(true);
    expect(() =>
      conflictDraftStore.beginResolve(stale.id, { type: "delete" }),
    ).toThrow();
  });

  it("retains missing conflicts as recovery instead of dropping dirty text", () => {
    const scope = makeScope();
    const draft = loadOrThrow(scope, makeSnapshot());
    conflictDraftStore.updateResult(
      draft.id,
      "keep this if conflict disappears",
    );

    conflictDraftStore.markMissingConflicts(scope, new Set());

    expect(draft.isRecovery).toBe(true);
    expect(draft.recoveryText).toBe("keep this if conflict disappears");
    expect(() =>
      conflictDraftStore.beginResolve(draft.id, { type: "delete" }),
    ).toThrow();
  });

  it("imports recovery into a fresh same-owner snapshot and blocks Apply until reviewed", () => {
    const source = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(source.id, "recovered resolution");
    conflictDraftStore.retireScope("profile-1", 1);

    const fresh = loadOrThrow(
      makeScope({ generation: 2, serverUrl: "http://127.0.0.1:4801/" }),
      makeSnapshot({
        snapshotVersion: "snap-2",
        fullIndexFingerprint: "fp-2",
      }),
    );
    expect(conflictDraftStore.importRecoveryDraft(source.id, fresh.id)).toEqual(
      { success: true },
    );
    expect(fresh.result).toBe("recovered resolution");
    expect(fresh.requiresReview).toBe(true);
    expect(() =>
      conflictDraftStore.beginResolve(fresh.id, {
        type: "reviewedText",
        tokens: [fresh.result],
      }),
    ).toThrow();
    expect(fresh.isResolving).toBe(false);

    expect(conflictDraftStore.confirmFreshReview(fresh.id)).toBe(true);
    expect(fresh.requiresReview).toBe(false);
    expect(fresh.recoveryText).toBeUndefined();
  });
  it("rejects recovery replay against the unchanged snapshot", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(draft.id, "uncertain submitted text");
    conflictDraftStore.markAsRecovery(draft.id, "Outcome unknown");

    const result = conflictDraftStore.importRecoveryDraft(draft.id, draft.id);

    expect(result.success).toBe(false);
    expect(result.error).toContain("distinct fresh snapshot");
    expect(draft.isRecovery).toBe(true);
    expect(draft.requiresReview).toBe(false);
  });

  it("refuses recovery import to a different profile endpoint", () => {
    const source = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.updateResult(source.id, "recovered resolution");
    conflictDraftStore.retireScope("profile-1", 1);

    const fresh = loadOrThrow(
      makeScope({
        generation: 2,
        serverUrl: "http://127.0.0.1:4802",
      }),
      makeSnapshot({ snapshotVersion: "snap-2" }),
    );
    expect(
      conflictDraftStore.importRecoveryDraft(source.id, fresh.id).success,
    ).toBe(false);
    expect(fresh.result).toBe(fresh.initialResult);
    expect(fresh.requiresReview).toBe(false);
  });
});

describe("Conflict Draft Store — Phase 06 Merge Model & Unified History", () => {
  beforeEach(() => {
    conflictDraftStore.resetForTesting();
  });

  it("restores decision states and text atomically on undo and redo", () => {
    const snapshot = makeSnapshot({
      worktree: {
        kind: "normal",
        sizeBytes: 100,
        mtimeSeconds: 1000,
        textTokens: [
          "h\n",
          "<<<<<<< ours\n",
          "ours 1\n",
          "=======\n",
          "theirs 1\n",
          ">>>>>>> theirs\n",
          "f\n",
        ],
      },
      stages: {
        base: { stage: 1, oid: "b1", mode: 0o100644, textTokens: ["h\n", "base 1\n", "f\n"] },
        ours: { stage: 2, oid: "o1", mode: 0o100644, textTokens: ["h\n", "ours 1\n", "f\n"] },
        theirs: { stage: 3, oid: "t1", mode: 0o100644, textTokens: ["h\n", "theirs 1\n", "f\n"] },
      },
    });

    const draft = loadOrThrow(makeScope(), snapshot);
    expect(draft.mergeModel).toBeDefined();
    const conflict = draft.mergeModel!.regions.find((r) => !r.stable)!;
    expect(conflict.decision.oursDecision).toBe("pending");

    // 1. Accept Ours
    const acceptRes = conflictDraftStore.acceptSide(draft.id, conflict.id, "ours");
    expect(acceptRes.success).toBe(true);
    expect(draft.result).toBe("h\nours 1\nf\n");
    const updatedConflict = draft.mergeModel!.regions.find((r) => r.id === conflict.id)!;
    expect(updatedConflict.decision.oursDecision).toBe("accepted");

    // 2. Undo: must restore text AND revert decisions back to pending
    const undoOk = conflictDraftStore.undo(draft.id);
    expect(undoOk).toBe(true);
    expect(draft.result).toContain("<<<<<<< ours");
    const revertedConflict = draft.mergeModel!.regions.find((r) => r.id === conflict.id)!;
    expect(revertedConflict.decision.oursDecision).toBe("pending");
    expect(revertedConflict.decision.manualReview).toBe("none");

    // 3. Redo: must re-apply text and accepted decisions
    const redoOk = conflictDraftStore.redo(draft.id);
    expect(redoOk).toBe(true);
    expect(draft.result).toBe("h\nours 1\nf\n");
    const redoneConflict = draft.mergeModel!.regions.find((r) => r.id === conflict.id)!;
    expect(redoneConflict.decision.oursDecision).toBe("accepted");
  });

  it("records metadata-only Ignore side and restores decisions on undo without touching text", () => {
    const snapshot = makeSnapshot({
      worktree: {
        kind: "normal",
        sizeBytes: 100,
        mtimeSeconds: 1000,
        textTokens: [
          "h\n",
          "<<<<<<< ours\n",
          "ours 1\n",
          "=======\n",
          "theirs 1\n",
          ">>>>>>> theirs\n",
          "f\n",
        ],
      },
      stages: {
        base: { stage: 1, oid: "b1", mode: 0o100644, textTokens: ["h\n", "base 1\n", "f\n"] },
        ours: { stage: 2, oid: "o1", mode: 0o100644, textTokens: ["h\n", "ours 1\n", "f\n"] },
        theirs: { stage: 3, oid: "t1", mode: 0o100644, textTokens: ["h\n", "theirs 1\n", "f\n"] },
      },
    });

    const draft = loadOrThrow(makeScope(), snapshot);
    const initialText = draft.result;
    const conflict = draft.mergeModel!.regions.find((r) => !r.stable)!;

    // Ignore ours
    const ignoreRes = conflictDraftStore.ignoreSide(draft.id, conflict.id, "ours");
    expect(ignoreRes.success).toBe(true);
    // Text is 100% unchanged
    expect(draft.result).toBe(initialText);
    expect(draft.history.past.length).toBe(1);
    expect(draft.mergeModel!.regions.find((r) => r.id === conflict.id)!.decision.oursDecision).toBe("ignored");

    // Undo ignore: reverts decision to pending, text still unchanged
    const undoOk = conflictDraftStore.undo(draft.id);
    expect(undoOk).toBe(true);
    expect(draft.result).toBe(initialText);
    expect(draft.mergeModel!.regions.find((r) => r.id === conflict.id)!.decision.oursDecision).toBe("pending");
  });
  it("records accept side even when text is identical to side and restores decisions on undo (C-B)", () => {
    const snapshot = makeSnapshot({
      worktree: {
        kind: "normal",
        sizeBytes: 100,
        mtimeSeconds: 1000,
        textTokens: ["h\n", "ours 1\n", "f\n"],
      },
      stages: {
        base: { stage: 1, oid: "b1", mode: 0o100644, textTokens: ["h\n", "base 1\n", "f\n"] },
        ours: { stage: 2, oid: "o1", mode: 0o100644, textTokens: ["h\n", "ours 1\n", "f\n"] },
        theirs: { stage: 3, oid: "t1", mode: 0o100644, textTokens: ["h\n", "theirs 1\n", "f\n"] },
      },
    });

    const draft = loadOrThrow(makeScope(), snapshot);
    const conflict = draft.mergeModel!.regions.find((r) => !r.stable)!;
    expect(conflict).toBeDefined();
    expect(conflict.decision.oursDecision).toBe("pending");
    expect(draft.history.past.length).toBe(0);

    // Accept ours: text is already identical to ours
    const acceptRes = conflictDraftStore.acceptSide(draft.id, conflict.id, "ours");
    expect(acceptRes.success).toBe(true);
    expect(draft.isDirty).toBe(true);
    expect(draft.history.past.length).toBe(1);
    expect(draft.mergeModel!.regions.find((r) => r.id === conflict.id)!.decision.oursDecision).toBe("accepted");

    // Undo: decision reverts to pending
    const undoOk = conflictDraftStore.undo(draft.id);
    expect(undoOk).toBe(true);
    expect(draft.mergeModel!.regions.find((r) => r.id === conflict.id)!.decision.oursDecision).toBe("pending");

    // Redo: decision restored to accepted
    const redoOk = conflictDraftStore.redo(draft.id);
    expect(redoOk).toBe(true);
    expect(draft.mergeModel!.regions.find((r) => r.id === conflict.id)!.decision.oursDecision).toBe("accepted");
  });

  it("blocks conflict actions and whole-file confirm on recovery or applied drafts", () => {
    const draft = loadOrThrow(makeScope(), makeSnapshot());
    conflictDraftStore.markAsRecovery(draft.id, "Stale test");

    const acceptRes = conflictDraftStore.acceptSide(draft.id, "conflict-1", "ours");
    expect(acceptRes.success).toBe(false);
    expect(acceptRes.error).toContain("cannot be modified in current state");

    const ignoreRes = conflictDraftStore.ignoreSide(draft.id, "conflict-1", "ours");
    expect(ignoreRes.success).toBe(false);

    const confirmRes = conflictDraftStore.confirmWholeFileAction(draft.id, {
      action: "accept-all-ours",
      previewText: "any",
      targetRevision: 1,
      affectedRegions: 1,
      newDecisions: {},
      draftKey: "different-draft-id",
    });
    expect(confirmRes.success).toBe(false);
  });
});
