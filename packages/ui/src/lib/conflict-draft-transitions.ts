import type {
  ConflictSnapshot,
  ResolveAction,
  ResolveOutcome,
  StageRoleLabels,
} from "@/api/client.js";
import {
  calculateDraftMetrics,
  checkProspectiveEditGrowth,
  measureSourceBytes,
} from "./conflict-draft-capacity.js";
import type {
  ConflictDraft,
  DraftOwnerScope,
  InFlightResolveAttempt,
} from "./conflict-draft-types.js";

export function createInitialDraft(
  key: string,
  scope: DraftOwnerScope,
  snapshot: ConflictSnapshot,
  roleLabels?: StageRoleLabels,
): ConflictDraft {
  const initialText =
    snapshot.worktree.textTokens?.join("") ??
    snapshot.stages.ours?.textTokens?.join("") ??
    "";
  const sourceBytes = measureSourceBytes(snapshot.stages, snapshot.worktree);
  const metrics = calculateDraftMetrics(sourceBytes, initialText, {
    past: [],
    future: [],
  });

  return {
    id: key,
    scope,
    target: {
      conflictId: snapshot.conflictId,
      path: snapshot.path,
      snapshotVersion: snapshot.snapshotVersion,
    },
    authority: {
      repositoryRoot: snapshot.repositoryRoot,
      worktreeRoot: snapshot.worktreeRoot,
      fullIndexFingerprint: snapshot.fullIndexFingerprint,
      effectiveAttributes: snapshot.effectiveAttributes,
    },
    stages: snapshot.stages,
    worktree: snapshot.worktree,
    status: snapshot.status,
    unsupportedReason: snapshot.unsupportedReason,
    stageRoleLabels: roleLabels,
    initialResult: initialText,
    result: initialText,
    resultRevision: 1,
    isDirty: false,
    isResolving: false,
    isApplied: false,
    inFlightAttempt: null,
    isRecovery: false,
    requiresReview: false,
    canCoalesceHistory: false,
    history: { past: [], future: [] },
    metrics,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function retainRecoveryResult(draft: ConflictDraft): void {
  if (draft.isApplied && draft.isDirty) {
    draft.isRecovery = true;
    draft.recoveryReason =
      "Previously applied draft was edited; refresh and import before another Apply";
  }
  if (draft.isRecovery) draft.recoveryText = draft.result;
}

export function applyDraftUpdate(
  draft: ConflictDraft,
  totalRegistryBytes: number,
  newText: string,
): { success: boolean; error?: string } {
  if (draft.isRecovery) {
    return {
      success: false,
      error: "Draft is in recovery; revalidation required",
    };
  }
  if (draft.result === newText) {
    return { success: true };
  }

  const timestamp = Date.now();
  const previousHistory = draft.history.past.at(-1);
  const coalescing =
    draft.canCoalesceHistory &&
    previousHistory !== undefined &&
    timestamp - previousHistory.timestamp <= 500;
  const check = checkProspectiveEditGrowth(
    draft,
    totalRegistryBytes,
    newText,
    undefined,
    undefined,
    !coalescing,
  );
  if (!check.accepted) {
    return { success: false, error: check.reason };
  }

  if (coalescing) {
    const lastHistoryIndex = draft.history.past.length - 1;
    draft.history.past[lastHistoryIndex] = {
      ...previousHistory,
      timestamp,
    };
  } else {
    draft.history.past.push({ text: draft.result, timestamp });
  }
  draft.history.future = [];
  draft.canCoalesceHistory = !draft.isApplied;
  draft.result = newText;
  draft.resultRevision++;
  draft.isDirty = draft.result !== (draft.appliedResult ?? draft.initialResult);
  retainRecoveryResult(draft);
  draft.metrics = calculateDraftMetrics(
    draft.metrics.sourceBytes,
    draft.result,
    draft.history,
    draft.recoveryText,
  );
  draft.updatedAt = timestamp;
  return { success: true };
}

export function applyDraftUndo(draft: ConflictDraft): boolean {
  if (draft.history.past.length === 0) return false;
  const prev = draft.history.past.pop()!;
  draft.history.future.push({ text: draft.result, timestamp: Date.now() });
  draft.result = prev.text;
  draft.resultRevision++;
  draft.isDirty = draft.result !== (draft.appliedResult ?? draft.initialResult);
  retainRecoveryResult(draft);
  draft.canCoalesceHistory = false;
  draft.metrics = calculateDraftMetrics(
    draft.metrics.sourceBytes,
    draft.result,
    draft.history,
    draft.recoveryText,
  );
  draft.updatedAt = Date.now();
  return true;
}

export function applyDraftRedo(draft: ConflictDraft): boolean {
  if (draft.history.future.length === 0) return false;
  const next = draft.history.future.pop()!;
  draft.history.past.push({ text: draft.result, timestamp: Date.now() });
  draft.result = next.text;
  draft.resultRevision++;
  draft.isDirty = draft.result !== (draft.appliedResult ?? draft.initialResult);
  retainRecoveryResult(draft);
  draft.canCoalesceHistory = false;
  draft.metrics = calculateDraftMetrics(
    draft.metrics.sourceBytes,
    draft.result,
    draft.history,
    draft.recoveryText,
  );
  draft.updatedAt = Date.now();
  return true;
}

export function startResolveAttempt(
  draft: ConflictDraft,
  action: ResolveAction,
): InFlightResolveAttempt {
  if (draft.isRecovery || draft.requiresReview || draft.isApplied) {
    throw new Error("Draft requires a fresh snapshot before another Apply");
  }
  if (draft.isResolving) {
    throw new Error("Mutation already in flight for this draft");
  }

  draft.isResolving = true;
  draft.canCoalesceHistory = false;
  const attemptAction: ResolveAction =
    action.type === "reviewedText"
      ? { ...action, tokens: [...action.tokens] }
      : action.type === "indexSide"
        ? { ...action }
        : { type: "delete" };
  const attempt: InFlightResolveAttempt = {
    attemptId: crypto.randomUUID(),
    submittedRevision: draft.resultRevision,
    submittedTokens:
      attemptAction.type === "reviewedText" ? [...attemptAction.tokens] : [],
    action: attemptAction,
    dispatchedAt: Date.now(),
  };
  draft.inFlightAttempt = attempt;
  return attempt;
}

export function completeResolveAttempt(
  draft: ConflictDraft,
  attemptId: string,
  outcome: ResolveOutcome,
): void {
  if (!draft.inFlightAttempt || draft.inFlightAttempt.attemptId !== attemptId) {
    return;
  }

  const attempt = draft.inFlightAttempt;
  draft.isResolving = false;
  draft.canCoalesceHistory = false;
  if (outcome.outcome === "applied") {
    const submittedResult =
      attempt.action.type === "reviewedText"
        ? attempt.submittedTokens.join("")
        : draft.result;
    draft.appliedResult = submittedResult;
    draft.isApplied = true;
    draft.isDirty = draft.result !== submittedResult;
    if (draft.isDirty) {
      draft.isRecovery = true;
      draft.recoveryText = draft.result;
      draft.recoveryReason =
        "The submitted revision was applied; later typing remains unsent and requires fresh review";
    }
    draft.inFlightAttempt = null;
  } else {
    draft.isApplied = false;
    draft.isRecovery = true;
    draft.recoveryText = draft.result;
    const reason =
      outcome.outcome === "stale" ||
      outcome.outcome === "unsupported" ||
      outcome.outcome === "busy"
        ? outcome.reason
        : outcome.error;
    draft.recoveryReason = `[${outcome.outcome}] ${reason}`;
    draft.inFlightAttempt = null;
  }
  draft.metrics = calculateDraftMetrics(
    draft.metrics.sourceBytes,
    draft.result,
    draft.history,
    draft.recoveryText,
  );
  draft.updatedAt = Date.now();
}
