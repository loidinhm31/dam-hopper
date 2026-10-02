/**
 * Advisor UI application state types.
 *
 * Scoped to native React workspace hosting without plugin bridge or frame state.
 */

import type {
  AdvisorStatusDto,
  HistoryScanSummaryDto,
  ProjectInventoryDto,
  HistorySummaryResultDto,
  HistoryPageResultDto,
  HistoryRowDto,
  HistoryMetricFiltersDto,
  PolicyReadCurrentResultDto,
  EvaluationsListResultDto,
  EvaluationDescriptorDto,
  EvaluationsCompareResultDto,
  EvaluationDocumentV1,
} from './advisor-types.js';
import type { ProviderKind } from './advisor-data-provider.js';

export type AdvisorView = 'overview' | 'history' | 'configuration' | 'evaluations';
export type ActivityScope = 'workspace-project' | 'all';

export type BoundSourceStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'forbidden'
  | 'missing'
  | 'not_configured'
  | 'changed'
  | 'error';

export interface BoundPolicyState {
  readonly status: BoundSourceStatus;
  readonly policy: PolicyReadCurrentResultDto | null;
  readonly error: string | null;
}

export interface BoundEvaluationsState {
  readonly status: BoundSourceStatus;
  readonly list: EvaluationsListResultDto | null;
  readonly error: string | null;
}

export interface BoundComparisonState {
  readonly status: BoundSourceStatus;
  readonly comparison: EvaluationsCompareResultDto | null;
  readonly cursor: string | null;
  readonly error: string | null;
}

export type ViewerStatus =
  | 'idle'
  | 'selecting'
  | 'scanning'
  | 'fresh'
  | 'stale'
  | 'unsupported'
  | 'revoked';

export type DetailStatus = 'idle' | 'loading' | 'ready' | 'changed' | 'missing' | 'error';

export interface UiHistoryFilters extends HistoryMetricFiltersDto {
  readonly taskRunId?: string | null;
}

export interface HistoryDetailState {
  readonly status: DetailStatus;
  readonly recordRef: string | null;
  readonly consultationId: string | null;
  readonly detailRevision: string | null;
  readonly execution: Record<string, unknown> | null;
  readonly outcome: Record<string, unknown> | null;
  readonly observedRevision: string | null;
  readonly error: string | null;
}

export interface EvaluationDetailState {
  readonly status: DetailStatus;
  readonly evaluationRef: string | null;
  readonly descriptor: EvaluationDescriptorDto | null;
  readonly document: EvaluationDocumentV1 | null;
  readonly observedRevision: string | null;
  readonly error: string | null;
}

export interface AppState {
  readonly activityScope: ActivityScope;
  readonly projectId: string | null;
  readonly projectLabel: string | null;
  readonly ownerKey: string | null;
  readonly contextEpoch: number;
  readonly historyQueryRevision: number;
  readonly observedAt: number | null;
  readonly policyState: BoundPolicyState;
  readonly evaluationsState: BoundEvaluationsState;
  readonly comparisonState: BoundComparisonState;
  readonly status: ViewerStatus;
  readonly activeView: AdvisorView;
  readonly generation: number;
  readonly scan: HistoryScanSummaryDto | null;
  readonly staleReason: string | null;
  readonly unsupportedReason: string | null;
  readonly historySourceLabel: string | null;
  readonly filters: UiHistoryFilters;
  readonly selectedConsultationId: string | null;
  readonly revealCandidates: boolean;
  readonly providerKind: ProviderKind;
  readonly capabilities: readonly string[];
  readonly isAvailable: boolean;
  readonly snapshotId: string | null;
  readonly historySummary: HistorySummaryResultDto | null;
  readonly historyPage: HistoryPageResultDto | null;
  readonly historyPageCursor: string | null;
  readonly historyPageEntries: readonly HistoryRowDto[];
  readonly historyDetail: HistoryDetailState;
  readonly currentPolicy: PolicyReadCurrentResultDto | null;
  readonly evaluationsList: EvaluationsListResultDto | null;
  readonly selectedEvaluation: EvaluationDetailState;
  readonly evaluationsComparison: EvaluationsCompareResultDto | null;
  readonly inventory: ProjectInventoryDto | null;
}

export const INITIAL_FILTERS: UiHistoryFilters = Object.freeze({
  taskRunId: null,
  statuses: undefined,
  outcomeStates: undefined,
  outcomeResults: undefined,
  backends: undefined,
  models: undefined,
  efforts: undefined,
  promptIdentities: undefined,
  buildIdentities: undefined,
  startedAtFrom: undefined,
  startedAtTo: undefined,
});

export const INITIAL_DETAIL_STATE: HistoryDetailState = Object.freeze({
  status: 'idle',
  recordRef: null,
  consultationId: null,
  detailRevision: null,
  execution: null,
  outcome: null,
  observedRevision: null,
  error: null,
});

export const INITIAL_EVALUATION_DETAIL_STATE: EvaluationDetailState = Object.freeze({
  status: 'idle',
  evaluationRef: null,
  descriptor: null,
  document: null,
  observedRevision: null,
  error: null,
});

export const INITIAL_BOUND_POLICY_STATE: BoundPolicyState = Object.freeze({
  status: 'idle',
  policy: null,
  error: null,
});

export const INITIAL_BOUND_EVALUATIONS_STATE: BoundEvaluationsState = Object.freeze({
  status: 'idle',
  list: null,
  error: null,
});

export const INITIAL_BOUND_COMPARISON_STATE: BoundComparisonState = Object.freeze({
  status: 'idle',
  comparison: null,
  cursor: null,
  error: null,
});

export const INITIAL_STATE: AppState = Object.freeze({
  status: 'idle',
  activeView: 'overview',
  activityScope: 'workspace-project',
  projectId: null,
  projectLabel: null,
  ownerKey: null,
  contextEpoch: 0,
  historyQueryRevision: 0,
  observedAt: null,
  policyState: INITIAL_BOUND_POLICY_STATE,
  evaluationsState: INITIAL_BOUND_EVALUATIONS_STATE,
  comparisonState: INITIAL_BOUND_COMPARISON_STATE,
  generation: 0,
  scan: null,
  staleReason: null,
  unsupportedReason: null,
  historySourceLabel: null,
  filters: INITIAL_FILTERS,
  selectedConsultationId: null,
  revealCandidates: false,
  providerKind: 'native',
  capabilities: Object.freeze([]),
  isAvailable: true,
  snapshotId: null,
  historySummary: null,
  historyPage: null,
  historyPageCursor: null,
  historyPageEntries: Object.freeze([]),
  historyDetail: INITIAL_DETAIL_STATE,
  currentPolicy: null,
  evaluationsList: null,
  selectedEvaluation: INITIAL_EVALUATION_DETAIL_STATE,
  evaluationsComparison: null,
  inventory: null,
});
