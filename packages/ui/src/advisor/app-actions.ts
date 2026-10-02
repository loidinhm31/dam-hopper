/**
 * Advisor UI action types.
 */

import type {
  AdvisorView,
  ActivityScope,
  UiHistoryFilters,
  BoundSourceStatus,
} from './app-state-types.js';
import type { ProviderKind } from './advisor-data-provider.js';
import type {
  HistoryRefreshResultDto,
  HistorySummaryResultDto,
  HistoryPageResultDto,
  HistoryDetailResultDto,
  PolicyReadCurrentResultDto,
  EvaluationsListResultDto,
  EvaluationsReadResultDto,
  EvaluationsCompareResultDto,
} from './advisor-types.js';

export type AppAction =
  | { type: 'SET_VIEW'; view: AdvisorView }
  | { type: 'SET_ACTIVITY_SCOPE'; scope: ActivityScope }
  | { type: 'SET_WORKSPACE_PROJECT'; projectId: string | null; projectLabel: string | null }
  | { type: 'SET_FILTERS'; filters: Partial<UiHistoryFilters> }
  | { type: 'SELECT_CONSULTATION'; consultationId: string | null; recordRef?: string; contextEpoch?: number }
  | { type: 'REVEAL_CANDIDATES'; reveal: boolean }
  | {
      type: 'PROVIDER_READY';
      providerKind: ProviderKind;
      label: string | null;
      capabilities: readonly string[];
      isAvailable: boolean;
      path?: string | null;
      sourceError?: string | null;
      projectId?: string | null;
      projectLabel?: string | null;
      ownerKey?: string | null;
    }
  | {
      type: 'CONTEXT_CHANGED';
      ownerKey?: string | null;
      projectId?: string | null;
      projectLabel?: string | null;
      label?: string | null;
      capabilities?: readonly string[];
      isAvailable?: boolean;
    }
  | { type: 'AVAILABILITY_CHANGED'; available: boolean; capabilities: readonly string[] }
  | { type: 'DISCONNECTED'; reason?: string }
  | { type: 'HISTORY_REFRESH_START'; generation: number; contextEpoch?: number }
  | {
      type: 'HISTORY_REFRESH_COMMIT';
      generation: number;
      result: HistoryRefreshResultDto;
      contextEpoch?: number;
      observedAt?: number;
    }
  | {
      type: 'HISTORY_SUMMARY_COMMIT';
      summary: HistorySummaryResultDto;
      queryRevision?: number;
      contextEpoch?: number;
    }
  | {
      type: 'HISTORY_PAGE_COMMIT';
      page: HistoryPageResultDto;
      queryRevision?: number;
      contextEpoch?: number;
    }
  | {
      type: 'HISTORY_QUERY_PAIR_COMMIT';
      summary: HistorySummaryResultDto;
      page: HistoryPageResultDto;
      queryRevision?: number;
      contextEpoch?: number;
    }
  | {
      type: 'HISTORY_QUERY_ERROR';
      error: string;
      queryRevision?: number;
      contextEpoch?: number;
    }
  | { type: 'HISTORY_DETAIL_START'; recordRef: string; consultationId: string | null; contextEpoch?: number }
  | { type: 'HISTORY_DETAIL_COMMIT'; result: HistoryDetailResultDto; consultationId: string | null; contextEpoch?: number }
  | { type: 'HISTORY_DETAIL_ERROR'; recordRef: string; consultationId: string | null; error: string; contextEpoch?: number }
  | { type: 'POLICY_START'; contextEpoch?: number }
  | { type: 'POLICY_COMMIT'; policy: PolicyReadCurrentResultDto; contextEpoch?: number }
  | { type: 'POLICY_ERROR'; error: string; status?: BoundSourceStatus; contextEpoch?: number }
  | { type: 'EVALUATIONS_LIST_START'; contextEpoch?: number }
  | { type: 'EVALUATIONS_LIST_COMMIT'; list: EvaluationsListResultDto; contextEpoch?: number }
  | { type: 'EVALUATIONS_LIST_ERROR'; error: string; status?: BoundSourceStatus; contextEpoch?: number }
  | { type: 'EVALUATION_READ_START'; evaluationRef: string; contextEpoch?: number }
  | { type: 'EVALUATION_READ_COMMIT'; result: EvaluationsReadResultDto; contextEpoch?: number }
  | { type: 'EVALUATION_READ_ERROR'; evaluationRef: string; error: string; contextEpoch?: number }
  | { type: 'EVALUATIONS_COMPARE_START'; contextEpoch?: number }
  | {
      type: 'EVALUATIONS_COMPARE_COMMIT';
      comparison: EvaluationsCompareResultDto;
      cursor?: string | null;
      contextEpoch?: number;
    }
  | { type: 'EVALUATIONS_COMPARE_ERROR'; error: string; contextEpoch?: number };
