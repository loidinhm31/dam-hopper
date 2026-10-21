import type {
  ConflictSnapshot,
  ResolveAction,
  ResolveOutcome,
  StageRoleLabels,
} from "@/api/client.js";
import { haveServerUrlsChanged } from "@/api/server-config.js";
import { createDraftKey } from "./conflict-draft-key.js";
import { matchesOwnerScope } from "./conflict-draft-key.js";
import {
  calculateDraftMetrics,
  canAdmitDraft,
} from "./conflict-draft-capacity.js";
import type {
  ConflictDraft,
  DraftOwnerScope,
  InFlightResolveAttempt,
} from "./conflict-draft-types.js";
import {
  applyDraftRedo,
  applyDraftUndo,
  applyDraftUpdate,
  completeResolveAttempt,
  createInitialDraft,
  startResolveAttempt,
} from "./conflict-draft-transitions.js";
import {
  acceptRegionSide,
  ignoreRegionSide,
  acceptRegionBoth,
  markRegionReviewed,
  previewAcceptAllOurs,
  previewAcceptAllTheirs,
  previewRebuildClean,
  confirmWholeFileAction,
  extractModelDecisions,
  getModelSerializedResult,
  type WholeFileActionPreview,
} from "./conflict-merge-model.js";
import type { JointHistorySnapshot } from "./joint-history-authority.js";

interface ConflictDraftStoreSnapshot {
  drafts: ConflictDraft[];
  activeDraft: ConflictDraft | null;
  activeDraftKey: string | null;
  isPanelVisible: boolean;
}

class ConflictDraftRegistry {
  private drafts = new Map<string, ConflictDraft>();
  private activeDraftKey: string | null = null;
  private isPanelVisible = false;
  private listeners = new Set<() => void>();
  private snapshot: ConflictDraftStoreSnapshot = {
    drafts: [],
    activeDraft: null,
    activeDraftKey: null,
    isPanelVisible: false,
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.snapshot = {
      drafts: Array.from(this.drafts.values()),
      activeDraft: this.activeDraftKey
        ? (this.drafts.get(this.activeDraftKey) ?? null)
        : null,
      activeDraftKey: this.activeDraftKey,
      isPanelVisible: this.isPanelVisible,
    };
    this.listeners.forEach((l) => l());
  }

  getSnapshot(): ConflictDraftStoreSnapshot {
    return this.snapshot;
  }

  loadSnapshot(
    scope: DraftOwnerScope,
    snapshot: ConflictSnapshot,
    roleLabels?: StageRoleLabels,
  ): { draft: ConflictDraft } | { error: string } {
    const key = createDraftKey(scope, snapshot, snapshot);
    const existing = this.drafts.get(key);
    if (existing) return { draft: existing };
    let staleDraftsChanged = false;
    for (const existingDraft of this.drafts.values()) {
      if (
        existingDraft.target.conflictId === snapshot.conflictId &&
        matchesOwnerScope(existingDraft.scope, scope) &&
        existingDraft.id !== key &&
        (existingDraft.isDirty ||
          existingDraft.isRecovery ||
          existingDraft.isResolving)
      ) {
        existingDraft.isRecovery = true;
        existingDraft.recoveryText = existingDraft.result;
        existingDraft.recoveryReason =
          "Conflict snapshot changed; import into a fresh snapshot and review";
        existingDraft.metrics = calculateDraftMetrics(
          existingDraft.metrics.sourceBytes,
          existingDraft.result,
          existingDraft.history,
          existingDraft.recoveryText,
        );
        staleDraftsChanged = true;
      }
    }

    const draft = createInitialDraft(key, scope, snapshot, roleLabels);
    const admission = canAdmitDraft(
      Array.from(this.drafts.values()),
      draft.metrics.totalBytes,
    );
    if (!admission.admitted) {
      if (staleDraftsChanged) this.notify();
      return { error: admission.reason ?? "Memory capacity exceeded" };
    }

    admission.evictableDraftIds.forEach((id) => this.drafts.delete(id));
    this.drafts.set(key, draft);
    this.notify();
    return { draft };
  }

  updateResult(
    key: string,
    newText: string,
  ): { success: boolean; error?: string } {
    const draft = this.drafts.get(key);
    if (!draft) return { success: false, error: "Draft not found" };
    const totalBytes = Array.from(this.drafts.values()).reduce(
      (acc, current) =>
        acc +
        current.metrics.totalBytes +
        (current.id !== key && current.isDirty
          ? current.metrics.resultBytes
          : 0),
      0,
    );
    const result = applyDraftUpdate(draft, totalBytes, newText);
    if (result.success) this.notify();
    return result;
  }

  undo(key: string): boolean {
    const draft = this.drafts.get(key);
    if (!draft || !applyDraftUndo(draft)) return false;
    this.notify();
    return true;
  }

  redo(key: string): boolean {
    const draft = this.drafts.get(key);
    if (!draft || !applyDraftRedo(draft)) return false;
    this.notify();
    return true;
  }

  beginResolve(key: string, action: ResolveAction): InFlightResolveAttempt {
    const draft = this.drafts.get(key);
    if (!draft) throw new Error("Draft not found");
    const attempt = startResolveAttempt(draft, action);
    this.notify();
    return attempt;
  }

  reconcileOutcome(
    key: string,
    attemptId: string,
    outcome: ResolveOutcome,
  ): void {
    const draft = this.drafts.get(key);
    if (!draft) return;
    completeResolveAttempt(draft, attemptId, outcome);
    this.notify();
  }

  cancelResolve(key: string, attemptId: string): void {
    const draft = this.drafts.get(key);
    if (!draft || draft.inFlightAttempt?.attemptId !== attemptId) return;
    draft.isResolving = false;
    draft.inFlightAttempt = null;
    this.notify();
  }

  discardDraft(key: string, confirmDirtyLoss = false): boolean {
    const draft = this.drafts.get(key);
    if (!draft) return false;
    if (draft.isResolving) return false;
    if (
      !confirmDirtyLoss &&
      (draft.isDirty ||
        draft.isRecovery ||
        draft.history.past.length > 0 ||
        draft.history.future.length > 0)
    ) {
      return false;
    }
    this.drafts.delete(key);
    if (this.activeDraftKey === key) this.activeDraftKey = null;
    this.notify();
    return true;
  }

  importRecoveryDraft(
    recoveryId: string,
    freshDraftId: string,
  ): { success: boolean; error?: string } {
    const source = this.drafts.get(recoveryId);
    const fresh = this.drafts.get(freshDraftId);
    if (!source?.isRecovery || typeof source.recoveryText !== "string") {
      return { success: false, error: "Source draft is not in recovery" };
    }
    if (
      !fresh ||
      fresh.requiresReview ||
      fresh.isResolving ||
      fresh.isApplied
    ) {
      return {
        success: false,
        error: "A fresh, unrecovered snapshot is required",
      };
    }
    if (
      source.scope.profileId !== fresh.scope.profileId ||
      haveServerUrlsChanged(source.scope.serverUrl, fresh.scope.serverUrl) ||
      (source.scope.configuredRoot ?? "") !==
        (fresh.scope.configuredRoot ?? "") ||
      source.scope.project !== fresh.scope.project ||
      (source.scope.worktreePath ?? "") !== (fresh.scope.worktreePath ?? "") ||
      (source.scope.root ?? "") !== (fresh.scope.root ?? "") ||
      source.target.path !== fresh.target.path ||
      source.authority.repositoryRoot !== fresh.authority.repositoryRoot ||
      source.authority.worktreeRoot !== fresh.authority.worktreeRoot
    ) {
      return {
        success: false,
        error:
          "Recovery text belongs to a different server, worktree, root, or path",
      };
    }
    if (source.id === fresh.id) {
      return {
        success: false,
        error:
          "Recovery requires a distinct fresh snapshot; replay on the same snapshot is blocked",
      };
    }
    if (
      fresh.isRecovery ||
      fresh.isDirty ||
      fresh.history.past.length > 0 ||
      fresh.history.future.length > 0
    ) {
      return {
        success: false,
        error: "Fresh draft already contains recovery or edits",
      };
    }

    fresh.requiresReview = true;
    const result = this.updateResult(freshDraftId, source.recoveryText);
    if (!result.success) {
      fresh.requiresReview = false;
      return result;
    }
    fresh.isApplied = false;
    fresh.canCoalesceHistory = false;
    this.notify();
    return { success: true };
  }

  confirmFreshReview(key: string): boolean {
    const draft = this.drafts.get(key);
    if (!draft || draft.isRecovery || !draft.requiresReview) return false;
    draft.requiresReview = false;
    draft.recoveryText = undefined;
    draft.recoveryReason = undefined;
    draft.metrics = calculateDraftMetrics(
      draft.metrics.sourceBytes,
      draft.result,
      draft.history,
    );
    this.notify();
    return true;
  }

  markMissingConflicts(
    scope: DraftOwnerScope,
    conflictIds: ReadonlySet<string>,
  ): void {
    let changed = false;
    const reason =
      "Conflict disappeared from authoritative inventory; retained as recovery text";
    for (const draft of this.drafts.values()) {
      if (
        !matchesOwnerScope(draft.scope, scope) ||
        conflictIds.has(draft.target.conflictId) ||
        (!draft.isDirty && !draft.isRecovery && !draft.isResolving) ||
        (draft.isRecovery &&
          draft.recoveryReason === reason &&
          !draft.isResolving &&
          !draft.inFlightAttempt)
      ) {
        continue;
      }
      draft.isRecovery = true;
      draft.recoveryText = draft.result;
      draft.recoveryReason = reason;
      draft.metrics = calculateDraftMetrics(
        draft.metrics.sourceBytes,
        draft.result,
        draft.history,
        draft.recoveryText,
      );
      draft.isResolving = false;
      draft.inFlightAttempt = null;
      changed = true;
    }
    if (changed) this.notify();
  }

  markAsRecovery(key: string, reason: string): void {
    const draft = this.drafts.get(key);
    if (!draft) return;
    draft.isRecovery = true;
    draft.recoveryReason = reason;
    draft.recoveryText = draft.result;
    draft.metrics = calculateDraftMetrics(
      draft.metrics.sourceBytes,
      draft.result,
      draft.history,
      draft.recoveryText,
    );
    this.notify();
  }

  retireScope(profileId: string, generation: number): void {
    let changed = false;
    const reason = "Connection retired or server generation changed";
    for (const draft of this.drafts.values()) {
      if (
        draft.scope.profileId !== profileId ||
        draft.scope.generation !== generation ||
        (draft.isRecovery &&
          draft.recoveryReason === reason &&
          !draft.isResolving &&
          !draft.inFlightAttempt)
      ) {
        continue;
      }
      draft.isRecovery = true;
      draft.recoveryText = draft.result;
      draft.recoveryReason = reason;
      draft.metrics = calculateDraftMetrics(
        draft.metrics.sourceBytes,
        draft.result,
        draft.history,
        draft.recoveryText,
      );
      if (draft.isResolving) {
        draft.isResolving = false;
        draft.inFlightAttempt = null;
      }
      changed = true;
    }
    if (changed) this.notify();
  }

  setActiveDraft(key: string | null): void {
    this.activeDraftKey = key;
    this.notify();
  }

  setVisible(visible: boolean): void {
    this.isPanelVisible = visible;
    this.notify();
  }

  hasDirtyDrafts(): boolean {
    return Array.from(this.drafts.values()).some(
      (d) => d.isDirty || d.isRecovery || d.isResolving,
    );
  }
  acceptSide(
    key: string,
    regionId: string,
    side: "ours" | "theirs",
  ): { success: boolean; error?: string } {
    const draft = this.drafts.get(key);
    if (!draft) return { success: false, error: "Draft not found" };
    if (draft.isRecovery || draft.isResolving || draft.isApplied) {
      return { success: false, error: "Draft cannot be modified in current state" };
    }
    if (!draft.mergeModel) {
      return { success: false, error: "Draft has no merge model" };
    }
    try {
      const beforeDecisions = extractModelDecisions(draft.mergeModel);
      const updatedModel = acceptRegionSide(draft.mergeModel, regionId, side);
      const serialized = getModelSerializedResult(updatedModel);
      if (draft.result === serialized) {
        draft.history.past.push({
          text: draft.result,
          timestamp: Date.now(),
          decisions: beforeDecisions,
          description: `Accept ${side} on ${regionId}`,
        });
        if (draft.history.past.length > 100) draft.history.past.shift();
        draft.history.future = [];
        draft.canCoalesceHistory = false;
        draft.isDirty = true;
        draft.resultRevision++;
        draft.metrics = calculateDraftMetrics(
          draft.metrics.sourceBytes,
          draft.result,
          draft.history,
          draft.recoveryText,
        );
        draft.mergeModel = updatedModel;
        this.notify();
        return { success: true };
      }
      draft.canCoalesceHistory = false;
      const res = this.updateResult(key, serialized);
      if (!res.success) return res;
      draft.canCoalesceHistory = false;
      draft.mergeModel = updatedModel;
      this.notify();
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  ignoreSide(
    key: string,
    regionId: string,
    side: "ours" | "theirs",
  ): { success: boolean; error?: string } {
    const draft = this.drafts.get(key);
    if (!draft) return { success: false, error: "Draft not found" };
    if (draft.isRecovery || draft.isResolving || draft.isApplied) {
      return { success: false, error: "Draft cannot be modified in current state" };
    }
    if (!draft.mergeModel) {
      return { success: false, error: "Draft has no merge model" };
    }
    try {
      const beforeDecisions = extractModelDecisions(draft.mergeModel);
      const updatedModel = ignoreRegionSide(draft.mergeModel, regionId, side);
      draft.history.past.push({
        text: draft.result,
        timestamp: Date.now(),
        decisions: beforeDecisions,
        description: `Ignore ${side} on ${regionId}`,
      });
      if (draft.history.past.length > 100) draft.history.past.shift();
      draft.history.future = [];
      draft.canCoalesceHistory = false;
      draft.isDirty = true;
      draft.metrics = calculateDraftMetrics(
        draft.metrics.sourceBytes,
        draft.result,
        draft.history,
        draft.recoveryText,
      );
      draft.mergeModel = updatedModel;
      this.notify();
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  acceptBoth(
    key: string,
    regionId: string,
    order: "ours-then-theirs" | "theirs-then-ours",
  ): { success: boolean; error?: string } {
    const draft = this.drafts.get(key);
    if (!draft) return { success: false, error: "Draft not found" };
    if (draft.isRecovery || draft.isResolving || draft.isApplied) {
      return { success: false, error: "Draft cannot be modified in current state" };
    }
    if (!draft.mergeModel) {
      return { success: false, error: "Draft has no merge model" };
    }
    try {
      const beforeDecisions = extractModelDecisions(draft.mergeModel);
      const updatedModel = acceptRegionBoth(draft.mergeModel, regionId, order);
      const serialized = getModelSerializedResult(updatedModel);
      if (draft.result === serialized) {
        draft.history.past.push({
          text: draft.result,
          timestamp: Date.now(),
          decisions: beforeDecisions,
          description: `Accept both on ${regionId}`,
        });
        if (draft.history.past.length > 100) draft.history.past.shift();
        draft.history.future = [];
        draft.canCoalesceHistory = false;
        draft.isDirty = true;
        draft.resultRevision++;
        draft.metrics = calculateDraftMetrics(
          draft.metrics.sourceBytes,
          draft.result,
          draft.history,
          draft.recoveryText,
        );
        draft.mergeModel = updatedModel;
        this.notify();
        return { success: true };
      }
      draft.canCoalesceHistory = false;
      const res = this.updateResult(key, serialized);
      if (!res.success) return res;
      draft.canCoalesceHistory = false;
      draft.mergeModel = updatedModel;
      this.notify();
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  markReviewed(
    key: string,
    regionId: string,
  ): { success: boolean; error?: string } {
    const draft = this.drafts.get(key);
    if (!draft) return { success: false, error: "Draft not found" };
    if (draft.isRecovery || draft.isResolving || draft.isApplied) {
      return { success: false, error: "Draft cannot be modified in current state" };
    }
    if (!draft.mergeModel) {
      return { success: false, error: "Draft has no merge model" };
    }
    try {
      const beforeDecisions = extractModelDecisions(draft.mergeModel);
      const updatedModel = markRegionReviewed(draft.mergeModel, regionId);
      draft.history.past.push({
        text: draft.result,
        timestamp: Date.now(),
        decisions: beforeDecisions,
        description: `Mark reviewed ${regionId}`,
      });
      if (draft.history.past.length > 100) draft.history.past.shift();
      draft.history.future = [];
      draft.canCoalesceHistory = false;
      draft.isDirty = true;
      draft.metrics = calculateDraftMetrics(
        draft.metrics.sourceBytes,
        draft.result,
        draft.history,
        draft.recoveryText,
      );
      draft.mergeModel = updatedModel;
      this.notify();
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  previewAcceptAllOurs(key: string): WholeFileActionPreview | null {
    const draft = this.drafts.get(key);
    if (!draft?.mergeModel) return null;
    const preview = previewAcceptAllOurs(draft.mergeModel);
    preview.draftKey = key;
    return preview;
  }

  previewAcceptAllTheirs(key: string): WholeFileActionPreview | null {
    const draft = this.drafts.get(key);
    if (!draft?.mergeModel) return null;
    const preview = previewAcceptAllTheirs(draft.mergeModel);
    preview.draftKey = key;
    return preview;
  }

  previewRebuildClean(key: string): WholeFileActionPreview | null {
    const draft = this.drafts.get(key);
    if (!draft?.mergeModel) return null;
    const preview = previewRebuildClean(draft.mergeModel);
    preview.draftKey = key;
    return preview;
  }

  confirmWholeFileAction(
    key: string,
    preview: WholeFileActionPreview,
  ): { success: boolean; error?: string } {
    const draft = this.drafts.get(key);
    if (!draft) return { success: false, error: "Draft not found" };
    if (draft.isRecovery || draft.isResolving || draft.isApplied) {
      return { success: false, error: "Draft cannot be modified in current state" };
    }
    if (!preview.draftKey || preview.draftKey !== key) {
      return { success: false, error: "Preview lacks draftKey or was generated for a different draft" };
    }
    if (preview.targetRevision !== undefined && preview.targetRevision !== draft.resultRevision) {
      return { success: false, error: "Draft was modified after preview was generated" };
    }
    if (!draft.mergeModel) {
      return { success: false, error: "Draft has no merge model" };
    }
    try {
      const beforeDecisions = extractModelDecisions(draft.mergeModel);
      const updatedModel = confirmWholeFileAction(draft.mergeModel, preview);
      const serialized = getModelSerializedResult(updatedModel);
      if (draft.result === serialized) {
        draft.history.past.push({
          text: draft.result,
          timestamp: Date.now(),
          decisions: beforeDecisions,
          description: `Confirm ${preview.action}`,
        });
        if (draft.history.past.length > 100) draft.history.past.shift();
        draft.history.future = [];
        draft.canCoalesceHistory = false;
        draft.isDirty = true;
        draft.resultRevision++;
        draft.metrics = calculateDraftMetrics(
          draft.metrics.sourceBytes,
          draft.result,
          draft.history,
          draft.recoveryText,
        );
        draft.mergeModel = updatedModel;
        this.notify();
        return { success: true };
      }
      draft.canCoalesceHistory = false;
      const res = this.updateResult(key, serialized);
      if (!res.success) return res;
      draft.canCoalesceHistory = false;
      draft.mergeModel = updatedModel;
      this.notify();
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  saveJointHistory(key: string, history: JointHistorySnapshot): void {
    const draft = this.drafts.get(key);
    if (draft) {
      draft.jointHistory = history;
    }
  }

  getJointHistory(key: string): JointHistorySnapshot | undefined {
    return this.drafts.get(key)?.jointHistory;
  }


  resetForTesting(): void {
    this.drafts.clear();
    this.activeDraftKey = null;
    this.isPanelVisible = false;
    this.notify();
    this.listeners.clear();
  }
}

export const conflictDraftStore = new ConflictDraftRegistry();
