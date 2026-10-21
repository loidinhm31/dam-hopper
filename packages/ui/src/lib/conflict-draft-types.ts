import type {
  ConflictStages,
  ConflictStatus,
  EffectiveAttributes,
  ResolveAction,
  StageRoleLabels,
  WorktreeDescriptor,
} from "@/api/client.js";
import type { ConflictMergeModel } from "./conflict-merge-types.js";
import type { RegionDecisionState } from "./conflict-merge-types.js";
import type { JointHistorySnapshot } from "./joint-history-authority.js";

export interface DraftOwnerScope {
  readonly profileId: string;
  readonly generation: number;
  readonly serverUrl: string;
  readonly configuredRoot?: string;
  readonly project: string;
  readonly worktreePath?: string | null;
  readonly root?: string | null;
}

export interface DraftTargetIdentity {
  readonly conflictId: string;
  readonly path: string;
  readonly snapshotVersion: string;
}

export interface DraftCapturedAuthority {
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly fullIndexFingerprint: string;
  readonly operationPrecondition?: string;
  readonly effectiveAttributes: EffectiveAttributes;
}

export interface DraftMemoryMetrics {
  readonly sourceBytes: number;
  readonly resultBytes: number;
  readonly historyBytes: number;
  readonly recoveryBytes: number;
  readonly totalBytes: number;
}

export interface DraftHistoryEntry {
  readonly text: string;
  readonly timestamp: number;
  readonly decisions?: Record<string, RegionDecisionState>;
  readonly description?: string;
}

export interface InFlightResolveAttempt {
  readonly attemptId: string;
  readonly submittedRevision: number;
  readonly submittedTokens: string[];
  readonly action: ResolveAction;
  readonly dispatchedAt: number;
}

export interface ConflictDraft {
  readonly id: string;
  readonly scope: DraftOwnerScope;
  readonly target: DraftTargetIdentity;
  readonly authority: DraftCapturedAuthority;
  readonly stages: ConflictStages;
  readonly worktree: WorktreeDescriptor;
  readonly status: ConflictStatus;
  readonly unsupportedReason?: string;
  readonly stageRoleLabels?: StageRoleLabels;
  readonly initialResult: string;
  result: string;
  resultRevision: number;
  isDirty: boolean;
  isResolving: boolean;
  isApplied: boolean;
  appliedResult?: string;
  inFlightAttempt: InFlightResolveAttempt | null;
  isRecovery: boolean;
  requiresReview: boolean;
  recoveryText?: string;
  recoveryReason?: string;
  history: {
    past: DraftHistoryEntry[];
    future: DraftHistoryEntry[];
  };
  canCoalesceHistory: boolean;
  metrics: DraftMemoryMetrics;
  mergeModel?: ConflictMergeModel;
  jointHistory?: JointHistorySnapshot;
  readonly createdAt: number;
  updatedAt: number;
}

export interface TerminalHandoffContext {
  readonly reason: string;
  readonly worktreeRoot: string;
  readonly profileId: string;
  readonly generation: number;
  readonly serverUrl: string;
  readonly project: string;
  readonly worktreePath?: string | null;
  readonly root?: string | null;
}
