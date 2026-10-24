import type {
  ConflictDraft,
  DraftHistoryEntry,
  DraftMemoryMetrics,
} from "./conflict-draft-types.js";
import type { ConflictStages, WorktreeDescriptor } from "@/api/client.js";

export const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_MAX_DRAFT_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_MAX_DIRTY_DRAFTS = 10;
const encoder = new TextEncoder();

export function measureSourceBytes(
  stages: ConflictStages,
  worktree: WorktreeDescriptor,
): number {
  let bytes = 0;
  if (stages.base?.textTokens) {
    bytes += stages.base.textTokens.reduce(
      (acc, t) => acc + encoder.encode(t).length,
      0,
    );
  }
  if (stages.ours?.textTokens) {
    bytes += stages.ours.textTokens.reduce(
      (acc, t) => acc + encoder.encode(t).length,
      0,
    );
  }
  if (stages.theirs?.textTokens) {
    bytes += stages.theirs.textTokens.reduce(
      (acc, t) => acc + encoder.encode(t).length,
      0,
    );
  }
  if (worktree.textTokens) {
    bytes += worktree.textTokens.reduce(
      (acc, t) => acc + encoder.encode(t).length,
      0,
    );
  }
  return bytes;
}

export function measureHistoryBytes(entries: DraftHistoryEntry[]): number {
  return entries.reduce((acc, e) => acc + encoder.encode(e.text).length, 0);
}

export function calculateDraftMetrics(
  sourceBytes: number,
  result: string,
  history: { past: DraftHistoryEntry[]; future: DraftHistoryEntry[] },
  recoveryText?: string,
): DraftMemoryMetrics {
  const resultBytes = encoder.encode(result).length;
  const historyBytes =
    measureHistoryBytes(history.past) + measureHistoryBytes(history.future);
  const recoveryBytes = recoveryText ? encoder.encode(recoveryText).length : 0;
  const totalBytes = sourceBytes + resultBytes + historyBytes + recoveryBytes;

  return {
    sourceBytes,
    resultBytes,
    historyBytes,
    recoveryBytes,
    totalBytes,
  };
}

export interface AdmissionCheck {
  readonly admitted: boolean;
  readonly reason?: string;
  readonly evictableDraftIds: string[];
}

export function canAdmitDraft(
  existingDrafts: ReadonlyArray<ConflictDraft>,
  newDraftBytes: number,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxDraftBytes = DEFAULT_MAX_DRAFT_BYTES,
  maxDirtyDrafts = DEFAULT_MAX_DIRTY_DRAFTS,
): AdmissionCheck {
  if (newDraftBytes > maxDraftBytes) {
    return {
      admitted: false,
      reason: `Conflict snapshot (${Math.round(newDraftBytes / 1024)} KB) exceeds single draft limit (${Math.round(maxDraftBytes / 1024)} KB).`,
      evictableDraftIds: [],
    };
  }

  const dirtyCount = existingDrafts.filter(
    (d) => d.isDirty || d.isResolving || d.isRecovery,
  ).length;
  if (dirtyCount >= maxDirtyDrafts) {
    return {
      admitted: false,
      reason: `Maximum dirty drafts limit (${maxDirtyDrafts}) reached. Discard or resolve existing drafts first.`,
      evictableDraftIds: [],
    };
  }

  let totalBytes = existingDrafts.reduce(
    (acc, d) => acc + d.metrics.totalBytes,
    0,
  );
  if (totalBytes + newDraftBytes <= maxTotalBytes) {
    return { admitted: true, evictableDraftIds: [] };
  }

  // Find clean, non-resolving, non-recovery drafts to evict
  const cleanCandidates = existingDrafts.filter(
    (d) =>
      !d.isDirty &&
      !d.isResolving &&
      !d.isRecovery &&
      (d.isApplied ||
        (d.history.past.length === 0 && d.history.future.length === 0)),
  );

  const evictableDraftIds: string[] = [];
  for (const candidate of cleanCandidates) {
    totalBytes -= candidate.metrics.totalBytes;
    evictableDraftIds.push(candidate.id);
    if (totalBytes + newDraftBytes <= maxTotalBytes) {
      return { admitted: true, evictableDraftIds };
    }
  }

  return {
    admitted: false,
    reason: `Total memory budget (${Math.round(maxTotalBytes / 1024)} KB) exceeded. Clean drafts were insufficient; discard dirty drafts to free capacity.`,
    evictableDraftIds: [],
  };
}

export interface EditGrowthCheck {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly projectedMetrics?: DraftMemoryMetrics;
}

export function checkProspectiveEditGrowth(
  draft: ConflictDraft,
  totalRegistryBytes: number,
  newText: string,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxDraftBytes = DEFAULT_MAX_DRAFT_BYTES,
  willCreateHistoryEntry = true,
): EditGrowthCheck {
  const newResultBytes = encoder.encode(newText).length;
  const addingHistoryBytes =
    willCreateHistoryEntry && draft.result !== newText
      ? draft.metrics.resultBytes
      : 0;
  const projectedHistoryBytes = draft.metrics.historyBytes + addingHistoryBytes;
  const projectedDraftBytes =
    draft.metrics.sourceBytes +
    newResultBytes +
    projectedHistoryBytes +
    draft.metrics.recoveryBytes;
  // Reserve a second result copy for an uncertain write's recovery snapshot.
  const budgetDraftBytes = projectedDraftBytes + newResultBytes;

  if (budgetDraftBytes > maxDraftBytes) {
    return {
      accepted: false,
      reason: `Edit would exceed single draft memory budget (${Math.round(maxDraftBytes / 1024)} KB), including recovery headroom. Prior edits and undo history preserved.`,
    };
  }

  const deltaBytes = budgetDraftBytes - draft.metrics.totalBytes;
  if (totalRegistryBytes + deltaBytes > maxTotalBytes) {
    return {
      accepted: false,
      reason: `Edit would exceed total workspace draft memory budget (${Math.round(maxTotalBytes / 1024)} KB), including recovery headroom. Prior edits and undo history preserved.`,
    };
  }

  const projectedMetrics: DraftMemoryMetrics = {
    sourceBytes: draft.metrics.sourceBytes,
    resultBytes: newResultBytes,
    historyBytes: projectedHistoryBytes,
    recoveryBytes: draft.metrics.recoveryBytes,
    totalBytes: projectedDraftBytes,
  };

  return { accepted: true, projectedMetrics };
}
