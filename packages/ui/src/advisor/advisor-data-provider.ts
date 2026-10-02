/**
 * Advisor Data Provider contract.
 *
 * Provides domain-level operations for the Advisor UI without plugin bridge or frame state.
 */

import type {
  HistoryRefreshResultDto,
  HistorySummaryResultDto,
  HistorySummaryQueryParams,
  HistoryPageResultDto,
  HistoryDetailResultDto,
  PolicyReadCurrentResultDto,
  EvaluationsListResultDto,
  EvaluationsReadResultDto,
  EvaluationsCompareResultDto,
} from './advisor-types.js';

export type ProviderKind = 'native' | 'standalone' | 'dam-hopper';

export interface ProviderContextDescriptor {
  readonly kind: ProviderKind;
  readonly label: string | null;
  readonly path: string | null;
  readonly isAvailable: boolean;
  readonly capabilities: readonly string[];
  readonly hasHistorySource: boolean;
  readonly hasPolicySource: boolean;
  readonly hasEvaluationSource: boolean;
  readonly sourceError: string | null;
}

export type ProviderEvent =
  | { readonly type: 'ready'; readonly descriptor: ProviderContextDescriptor }
  | { readonly type: 'context-changed'; readonly descriptor: ProviderContextDescriptor }
  | { readonly type: 'availability-changed'; readonly available: boolean; readonly capabilities: readonly string[] }
  | { readonly type: 'workspace-project-changed'; readonly projectId: string | null; readonly label: string | null }
  | { readonly type: 'disconnected'; readonly reason?: string }
  | { readonly type: 'revoked'; readonly reason: string }
  | { readonly type: 'incompatible'; readonly reason: string };

export type ProviderEventListener = (event: ProviderEvent) => void;

export interface AdvisorDataProvider {
  readonly descriptor: ProviderContextDescriptor;
  subscribe(listener: ProviderEventListener): () => void;
  refreshHistory(requestId: string, projectId?: string | null): Promise<HistoryRefreshResultDto>;
  getHistorySummary(
    requestId: string,
    snapshotId: string,
    query: HistorySummaryQueryParams,
  ): Promise<HistorySummaryResultDto>;
  getHistoryPage(
    requestId: string,
    snapshotId: string,
    query: HistorySummaryQueryParams,
    sort: 'started_at_desc',
    cursor: string | null,
    limit: number,
  ): Promise<HistoryPageResultDto>;
  getHistoryDetail(
    requestId: string,
    snapshotId: string,
    recordRef: string,
  ): Promise<HistoryDetailResultDto>;
  readCurrentPolicy(requestId: string): Promise<PolicyReadCurrentResultDto>;
  listEvaluations(
    requestId: string,
    cursor: string | null,
    limit: number,
    target?: string | null,
  ): Promise<EvaluationsListResultDto>;
  readEvaluation(
    requestId: string,
    evaluationRef: string,
    expectedRevision: string,
    target?: string | null,
  ): Promise<EvaluationsReadResultDto>;
  compareEvaluations(
    requestId: string,
    items: readonly { evaluationRef: string; expectedRevision: string }[],
    cursor: string | null,
    limit: number,
    target?: string | null,
  ): Promise<EvaluationsCompareResultDto>;
  cancel(requestId: string): void;
  destroy?(): void;
}
