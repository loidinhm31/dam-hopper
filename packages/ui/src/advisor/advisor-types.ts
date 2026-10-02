/**
 * Native Advisor domain and wire DTO types.
 *
 * Wire API payloads follow Dam-Hopper camelCase convention.
 * Reused pure domain types and validators operate without Node builtins or plugin-sdk.
 */

// --- Error definitions ---

export type AdvisorErrorCode =
  | 'ADVISOR_DISABLED'
  | 'STATE_NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'STATE_LOCKED'
  | 'STATE_INVALID'
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_STALE'
  | 'SNAPSHOT_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'UNKNOWN';

export class AdvisorError extends Error {
  readonly code: AdvisorErrorCode;
  readonly status?: number;

  constructor(message: string, code: AdvisorErrorCode = 'UNKNOWN', status?: number) {
    super(message);
    this.name = 'AdvisorError';
    this.code = code;
    this.status = status;
  }
}

// --- Common Route & Execution Primitives ---

export interface AdvisorRouteTarget {
  readonly backend: string;
  readonly model: string;
  readonly effort: string;
}

export type ExecutionStatus = 'started' | 'ADVICE_READY' | 'FAILED';
export type OutcomeState = 'missing' | 'valid' | 'invalid';
export type OutcomeResult = 'resolved' | 'unresolved' | 'regressed' | 'unknown';

export interface RatioMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly ratio: number | null;
}

// --- Status & Settings DTOs ---

export interface AdvisorStatusDto {
  enabled: boolean;
  available: boolean;
  path: string | null;
  sourceError: string | null;
}

export interface AdvisorSettingsDto {
  enabled: boolean;
}

export interface AdvisorSettingsUpdateDto {
  enabled: boolean;
}

// --- History DTOs & Domain Types ---

export interface HistoryDiagnosticDto {
  code: string;
  taskRunId?: string;
  consultationId?: string;
}

export interface ScanDiagnostic {
  code: string;
  task_run_id?: string;
  consultation_id?: string;
}

export interface HistoryScanSummaryDto {
  status: 'complete' | 'complete_with_errors' | 'incomplete';
  projectsDiscovered: number;
  tasksDiscovered: number;
  consultationsDiscovered: number;
  acceptedRecords: number;
  invalidRecords: number;
  bytesDiscovered: number;
  bytesRead: number;
  diagnostics: HistoryDiagnosticDto[];
  suppressedDiagnostics: number;
  limitHit: boolean;
}

export interface HistoryMetricScanV1 {
  readonly status: 'complete' | 'complete_with_errors' | 'incomplete';
  readonly projects_discovered: number;
  readonly tasks_discovered: number;
  readonly consultations_discovered: number;
  readonly accepted_records: number;
  readonly invalid_records: number;
  readonly bytes_discovered: number;
  readonly bytes_read: number;
  readonly diagnostics: readonly ScanDiagnostic[];
  readonly suppressed_diagnostics: number;
  readonly limit_hit: boolean;
}

export interface ProjectInventoryItemDto {
  projectId: string;
  label: string | null;
  count: number;
}

export interface ProjectInventoryDto {
  entries: ProjectInventoryItemDto[];
  totalProjects: number;
  unfilteredTotalRecords: number;
}

export interface HistoryRefreshResultDto {
  state: 'fresh' | 'stale' | 'unavailable';
  snapshotId: string | null;
  observedAt: number;
  scan: HistoryScanSummaryDto;
  staleReason: 'incomplete' | 'cancelled' | 'deadline' | null;
  inventory: ProjectInventoryDto | null;
}

export interface HistoryMetricFiltersDto {
  statuses?: Array<'started' | 'ADVICE_READY' | 'FAILED'>;
  outcomeStates?: Array<'missing' | 'valid' | 'invalid'>;
  outcomeResults?: Array<'resolved' | 'unresolved' | 'regressed' | 'unknown'>;
  backends?: string[];
  models?: string[];
  efforts?: string[];
  promptIdentities?: string[];
  buildIdentities?: string[];
  startedAtFrom?: number;
  startedAtTo?: number;
}

export interface HistoryMetricFiltersV1 {
  readonly statuses?: readonly ('started' | 'ADVICE_READY' | 'FAILED')[] | null;
  readonly outcome_states?: readonly ('missing' | 'valid' | 'invalid')[] | null;
  readonly outcome_results?: readonly ('resolved' | 'unresolved' | 'regressed' | 'unknown')[] | null;
  readonly backends?: readonly string[] | null;
  readonly models?: readonly string[] | null;
  readonly efforts?: readonly string[] | null;
  readonly prompt_identities?: readonly string[] | null;
  readonly build_identities?: readonly string[] | null;
  readonly started_at_from?: number | null;
  readonly started_at_to?: number | null;
}

export interface HistorySummaryQueryParams {
  projectId?: string | null;
  taskRunId?: string | null;
  filters?: HistoryMetricFiltersDto;
}

export interface HistorySummaryParamsDto {
  snapshotId: string;
  query: HistorySummaryQueryParams;
}

export interface HistorySummaryMetricsDto {
  metricDefinitionVersion: 1;
  totalConsultations: number;
  completedConsultations: number;
  adviceReadyCount: number;
  failedCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  regressedCount: number;
  missingOutcomeCount: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  routeDistribution: Record<string, number>;
}

export interface HistorySummaryResultDto {
  state: 'fresh' | 'stale';
  snapshotId: string;
  metrics: HistorySummaryMetricsDto;
  inventory: ProjectInventoryDto;
}

export interface HistoryRowDto {
  recordRef: string;
  projectId: string;
  taskRunId: string;
  consultationId: string;
  status: 'started' | 'ADVICE_READY' | 'FAILED';
  route: {
    backend: string;
    model: string;
    effort: string;
  };
  checkpointDigest: string;
  promptIdentity: string;
  buildIdentity: string;
  startedAt: number;
  completedAt: number | null;
  receiptElapsedMs: number | null;
  outcomeState: 'missing' | 'valid' | 'invalid';
  outcomeResult: 'resolved' | 'unresolved' | 'regressed' | 'unknown' | null;
}

export interface NormalizedHistoryRecordV1 {
  readonly record_ref: string;
  readonly project_id: string;
  readonly task_run_id: string;
  readonly consultation_id: string;
  readonly status: 'started' | 'ADVICE_READY' | 'FAILED';
  readonly route: {
    readonly backend: string;
    readonly model: string;
    readonly effort: string;
  };
  readonly checkpoint_digest: string;
  readonly prompt_identity: string;
  readonly build_identity: string;
  readonly started_at: number;
  readonly completed_at: number | null;
  readonly receipt_elapsed_ms: number | null;
  readonly outcome_state: 'missing' | 'valid' | 'invalid';
  readonly outcome_result: 'resolved' | 'unresolved' | 'regressed' | 'unknown' | null;
}

export interface HistoryPageQueryParams {
  projectId?: string | null;
  taskRunId?: string | null;
  filters?: HistoryMetricFiltersDto;
}

export interface HistoryPageParamsDto {
  snapshotId: string;
  query: HistoryPageQueryParams;
  sort: 'started_at_desc';
  cursor?: string | null;
  limit?: number;
}

export interface HistoryPageResultDto {
  state: 'fresh' | 'stale';
  snapshotId: string;
  entries: HistoryRowDto[];
  nextCursor: string | null;
  returnedBytes: number;
}

export interface HistoryDetailParamsDto {
  snapshotId: string;
  recordRef: string;
}

export type HistoryDetailResultDto =
  | {
      status: 'ready';
      snapshotId: string;
      recordRef: string;
      detailRevision: string;
      execution: Record<string, unknown>;
      outcome: Record<string, unknown> | null;
    }
  | {
      status: 'changed' | 'missing';
      snapshotId: string;
      recordRef: string;
      observedRevision: string | null;
    };

export interface HistoryRouteGroupMetricV1 {
  readonly route_key: string;
  readonly backend: string;
  readonly model: string;
  readonly effort: string;
  readonly count: number;
  readonly share: number;
  readonly advice_ready_count: number;
  readonly failed_count: number;
  readonly resolved_count: number;
  readonly unresolved_count: number;
  readonly regressed_count: number;
  readonly missing_outcome_count: number;
  readonly avg_latency_ms: number | null;
  readonly p95_latency_ms: number | null;
}

// --- Policy DTOs ---

export interface PolicyReadCurrentResultDto {
  status: 'ready' | 'migration_required' | 'unsupported' | 'invalid' | 'not_configured';
  scope: 'account';
  temporal: 'current';
  observedAt: number;
  revision: string;
  policy?: {
    version: 2;
    advisor: {
      primary: { backend: string; model: string; effort: string };
      backup: { backend: string; model: string; effort: string };
    };
    wait: {
      mode: 'until_terminal';
      warnAfterMs: number;
      warnEveryMs: number;
    };
    history: {
      retentionDays: number;
      maxBytes: number;
    };
  } | null;
  issueCode?: string | null;
}

export interface AdvisorPolicyV2 {
  readonly version: 2;
  readonly advisor: {
    readonly primary: AdvisorRouteTarget;
    readonly backup: AdvisorRouteTarget;
  };
  readonly wait: {
    readonly mode: 'until_terminal';
    readonly warnAfterMs: number;
    readonly warnEveryMs: number;
  };
  readonly history: {
    readonly retentionDays: number;
    readonly maxBytes: number;
  };
}

// --- Evaluation DTOs & Domain Types ---

export interface EvaluationDescriptorDto {
  evaluationRef: string;
  sourceRevision: string;
  sourceDigest: string;
  evaluationId: string;
  runId: string;
  createdAt: number;
  candidateCount: number;
  caseCount: number;
  observationCount: number;
}

export interface EvaluationsListParamsDto {
  target?: string | null;
  cursor?: string | null;
  limit?: number;
}

export interface EvaluationsListResultDto {
  status: 'ready' | 'not_configured';
  observedAt: number;
  bindingRevision: string;
  items: EvaluationDescriptorDto[];
  nextCursor: string | null;
}

export interface EvaluationsReadParamsDto {
  target?: string | null;
  evaluationRef: string;
  expectedRevision: string;
}

export type EvaluationsReadResultDto =
  | {
      status: 'ready';
      descriptor: EvaluationDescriptorDto;
      document: EvaluationDocumentV1;
    }
  | {
      status: 'changed' | 'missing';
      evaluationRef: string;
      observedRevision: string | null;
    };

export interface EvaluationsCompareParamsDto {
  target?: string | null;
  items: Array<{
    evaluationRef: string;
    expectedRevision: string;
  }>;
  cursor?: string | null;
  limit?: number;
}

export type EvaluationsCompareResultDto =
  | {
      status: 'ready';
      sourceRevisions: Array<{ evaluationRef: string; observedRevision: string }>;
      groups: Array<{
        groupKey: string;
        rubricDigest: string;
        inputDigest: string;
        caseCount: number;
        items: unknown[];
      }>;
      nextCursor: string | null;
      returnedBytes: number;
    }
  | {
      status: 'changed' | 'missing';
      evaluationRef: string;
      observedRevision: string | null;
    };

// --- Evaluation Protocol Types ---

export const EVALUATION_PROTOCOL_V1 = 'evcrate-advisor-counsel-evaluation' as const;
export const EVALUATION_VERSION_V1 = 1 as const;
export type EvaluationProvenance = 'human' | 'automated';
export type EvaluationDimensionScore = 1 | 2 | 3 | 4 | 5 | null;

export interface EvaluationRubricDimensionV1 {
  readonly id: string;
  readonly description: string;
  readonly scale: readonly [1, 5];
}

export interface EvaluationRubricV1 {
  readonly version: 1;
  readonly dimensions: readonly EvaluationRubricDimensionV1[];
  readonly pass_threshold: number;
}

export interface EvaluationCandidateV1 {
  readonly candidate_id: string;
  readonly label: string | null;
  readonly route: AdvisorRouteTarget;
  readonly prompt_identity: string | null;
  readonly build_identity: string | null;
}

export interface EvaluationCaseInputContextV1 {
  readonly goal: string;
  readonly non_goals: readonly string[];
  readonly authorized_paths: readonly string[];
}

export interface EvaluationCaseInputProposalV1 {
  readonly hypothesis: string;
  readonly intended_action: string;
}

export interface EvaluationCaseInputEvidenceV1 {
  readonly observed_failure: string;
  readonly files: readonly string[];
  readonly validation_command: string;
}

export interface EvaluationCaseInputV1 {
  readonly context: EvaluationCaseInputContextV1;
  readonly executor_proposal: EvaluationCaseInputProposalV1;
  readonly evidence: EvaluationCaseInputEvidenceV1;
}

export interface EvaluationResponseResultV1 {
  readonly recommendation: string;
  readonly rationale: string;
  readonly must_fix: readonly string[];
  readonly cautions: readonly string[];
  readonly assumptions: readonly string[];
  readonly success_checks: readonly string[];
  readonly unresolved_questions: readonly string[];
}

export interface EvaluationResponseReadyV1 {
  readonly status: 'ADVICE_READY';
  readonly result: EvaluationResponseResultV1;
  readonly error: null;
  readonly captured_at: number;
}

export interface EvaluationResponseFailedV1 {
  readonly status: 'FAILED';
  readonly result: null;
  readonly error: {
    readonly code: string;
    readonly category: string;
    readonly message: string;
  };
  readonly captured_at: number;
}

export interface EvaluationResponseMissingV1 {
  readonly status: 'MISSING';
  readonly result: null;
  readonly error: null;
  readonly captured_at: null;
}

export type EvaluationResponseV1 =
  | EvaluationResponseReadyV1
  | EvaluationResponseFailedV1
  | EvaluationResponseMissingV1;

export interface EvaluationScoreDimensionV1 {
  readonly dimension_id: string;
  readonly score: EvaluationDimensionScore;
}

export interface EvaluationScoreV1 {
  readonly provenance: EvaluationProvenance;
  readonly judge_id: string;
  readonly judge_version: string;
  readonly scored_at: number;
  readonly dimensions: readonly EvaluationScoreDimensionV1[];
  readonly average_score: number | null;
  readonly passed: boolean | null;
  readonly issues: readonly string[];
}

export interface EvaluationObservationV1 {
  readonly candidate_id: string;
  readonly response: EvaluationResponseV1;
  readonly score: EvaluationScoreV1 | null;
}

export interface EvaluationCaseV1 {
  readonly case_id: string;
  readonly name: string;
  readonly category: string;
  readonly input: EvaluationCaseInputV1;
  readonly input_digest: string;
  readonly observations: readonly EvaluationObservationV1[];
}

export interface EvaluationDocumentV1 {
  readonly protocol: typeof EVALUATION_PROTOCOL_V1;
  readonly version: typeof EVALUATION_VERSION_V1;
  readonly evaluation_id: string;
  readonly run_id: string;
  readonly created_at: number;
  readonly rubric: EvaluationRubricV1;
  readonly rubric_digest: string;
  readonly candidates: readonly EvaluationCandidateV1[];
  readonly cases: readonly EvaluationCaseV1[];
}

// --- Evaluation Comparison Types ---
export {
  computeComparisonKey,
  computeProvenanceGroupKey,
  aggregateEvaluationGroups,
  type CandidateEvaluationSummary,
  type CandidateResponseSummary,
  type ComparableEvaluationGroup,
} from './evaluation-comparison-helpers.js';
