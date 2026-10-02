import { describe, it, expect } from 'vitest';
import { appReducer } from './app-state-reducer.js';
import { INITIAL_STATE, type AppState } from './app-state-types.js';
import type {
  HistoryRefreshResultDto,
  HistorySummaryResultDto,
  HistoryPageResultDto,
  PolicyReadCurrentResultDto,
  EvaluationsListResultDto,
  EvaluationsReadResultDto,
  EvaluationsCompareResultDto,
} from './advisor-types.js';

describe('appReducer', () => {
  it('handles SET_VIEW', () => {
    const s1 = appReducer(INITIAL_STATE, { type: 'SET_VIEW', view: 'history' });
    expect(s1.activeView).toBe('history');
  });

  it('handles SET_ACTIVITY_SCOPE', () => {
    const s1: AppState = {
      ...INITIAL_STATE,
      activityScope: 'workspace-project',
      historyQueryRevision: 1,
      historyPageCursor: 'cur-1',
      selectedConsultationId: 'c-1',
    };

    const s2 = appReducer(s1, { type: 'SET_ACTIVITY_SCOPE', scope: 'all' });
    expect(s2.activityScope).toBe('all');
    expect(s2.historyQueryRevision).toBe(2);
    expect(s2.historyPageCursor).toBeNull();
    expect(s2.selectedConsultationId).toBeNull();

    // No-op if same scope
    const s3 = appReducer(s2, { type: 'SET_ACTIVITY_SCOPE', scope: 'all' });
    expect(s3).toBe(s2);
  });

  it('handles SET_WORKSPACE_PROJECT', () => {
    const s1 = appReducer(INITIAL_STATE, {
      type: 'SET_WORKSPACE_PROJECT',
      projectId: 'proj-a',
      projectLabel: 'Project A',
    });
    expect(s1.projectId).toBe('proj-a');
    expect(s1.projectLabel).toBe('Project A');
    expect(s1.historyQueryRevision).toBe(1);

    // When scope is 'all', project change does not increment historyQueryRevision
    const sAll: AppState = { ...s1, activityScope: 'all' };
    const s2 = appReducer(sAll, {
      type: 'SET_WORKSPACE_PROJECT',
      projectId: 'proj-b',
      projectLabel: 'Project B',
    });
    expect(s2.projectId).toBe('proj-b');
    expect(s2.historyQueryRevision).toBe(1);
  });

  it('handles SET_FILTERS', () => {
    const s1 = appReducer(INITIAL_STATE, {
      type: 'SET_FILTERS',
      filters: { statuses: ['ADVICE_READY'] },
    });
    expect(s1.filters.statuses).toEqual(['ADVICE_READY']);
    expect(s1.historyQueryRevision).toBe(1);
  });

  it('handles SELECT_CONSULTATION', () => {
    const s1 = appReducer(INITIAL_STATE, {
      type: 'SELECT_CONSULTATION',
      consultationId: 'consult-1',
      recordRef: 'ref-1',
    });
    expect(s1.selectedConsultationId).toBe('consult-1');
    expect(s1.historyDetail.consultationId).toBe('consult-1');
    expect(s1.historyDetail.recordRef).toBe('ref-1');

    const s2 = appReducer(s1, {
      type: 'SELECT_CONSULTATION',
      consultationId: null,
    });
    expect(s2.selectedConsultationId).toBeNull();
    expect(s2.historyDetail.consultationId).toBeNull();
  });

  it('handles CONTEXT_CHANGED and clears state', () => {
    const loadedState: AppState = {
      ...INITIAL_STATE,
      snapshotId: 'snap-1',
      selectedConsultationId: 'c-1',
      contextEpoch: 1,
    };

    const s = appReducer(loadedState, {
      type: 'CONTEXT_CHANGED',
      ownerKey: 'owner-2',
      projectId: 'proj-2',
      projectLabel: 'Project 2',
    });

    expect(s.contextEpoch).toBe(2);
    expect(s.ownerKey).toBe('owner-2');
    expect(s.projectId).toBe('proj-2');
    expect(s.snapshotId).toBeNull();
    expect(s.selectedConsultationId).toBeNull();
  });

  it('handles HISTORY_REFRESH_START and HISTORY_REFRESH_COMMIT (fresh & stale)', () => {
    const s1 = appReducer(INITIAL_STATE, {
      type: 'HISTORY_REFRESH_START',
      generation: 1,
    });
    expect(s1.status).toBe('scanning');
    expect(s1.generation).toBe(1);

    const freshResult: HistoryRefreshResultDto = {
      state: 'fresh',
      snapshotId: 'snap-1',
      observedAt: 5000,
      scan: {
        status: 'complete',
        projectsDiscovered: 1,
        tasksDiscovered: 2,
        consultationsDiscovered: 3,
        acceptedRecords: 3,
        invalidRecords: 0,
        bytesDiscovered: 100,
        bytesRead: 100,
        diagnostics: [],
        suppressedDiagnostics: 0,
        limitHit: false,
      },
      staleReason: null,
      inventory: null,
    };

    const s2 = appReducer(s1, {
      type: 'HISTORY_REFRESH_COMMIT',
      generation: 1,
      result: freshResult,
    });
    expect(s2.status).toBe('fresh');
    expect(s2.snapshotId).toBe('snap-1');

    // Stale result
    const staleResult: HistoryRefreshResultDto = {
      ...freshResult,
      state: 'stale',
      staleReason: 'deadline',
    };
    const s3 = appReducer(s2, {
      type: 'HISTORY_REFRESH_COMMIT',
      generation: 1,
      result: staleResult,
    });
    expect(s3.status).toBe('stale');
    expect(s3.staleReason).toContain('deadline');
  });

  it('handles HISTORY_QUERY_PAIR_COMMIT and HISTORY_QUERY_ERROR', () => {
    const summary: HistorySummaryResultDto = {
      state: 'fresh',
      snapshotId: 'snap-1',
      metrics: {
        metricDefinitionVersion: 1,
        totalConsultations: 10,
        completedConsultations: 10,
        adviceReadyCount: 9,
        failedCount: 1,
        resolvedCount: 8,
        unresolvedCount: 1,
        regressedCount: 0,
        missingOutcomeCount: 0,
        avgLatencyMs: 200,
        p95LatencyMs: 300,
        routeDistribution: { default: 10 },
      },
      inventory: { entries: [], totalProjects: 0, unfilteredTotalRecords: 10 },
    };

    const page: HistoryPageResultDto = {
      state: 'fresh',
      snapshotId: 'snap-1',
      entries: [
        {
          recordRef: 'r-1',
          projectId: 'p-1',
          taskRunId: 't-1',
          consultationId: 'c-1',
          status: 'ADVICE_READY',
          route: { backend: 'omp', model: 'claude', effort: 'high' },
          checkpointDigest: 'd-1',
          promptIdentity: 'p',
          buildIdentity: 'b',
          startedAt: 1000,
          completedAt: 1200,
          receiptElapsedMs: 200,
          outcomeState: 'valid',
          outcomeResult: 'resolved',
        },
      ],
      nextCursor: 'next-cur',
      returnedBytes: 100,
    };

    const s1 = appReducer(INITIAL_STATE, {
      type: 'HISTORY_QUERY_PAIR_COMMIT',
      summary,
      page,
      queryRevision: 0,
    });
    expect(s1.historySummary).toBe(summary);
    expect(s1.historyPageEntries).toHaveLength(1);
    expect(s1.historyPageCursor).toBe('next-cur');

    // On error, clears query data
    const s2 = appReducer(s1, {
      type: 'HISTORY_QUERY_ERROR',
      error: 'Query failed',
      queryRevision: 0,
    });
    expect(s2.historySummary).toBeNull();
    expect(s2.historyPageEntries).toHaveLength(0);
    expect(s2.historyPageCursor).toBeNull();
  });

  it('handles HISTORY_DETAIL lifecycle (start, ready, changed, missing, error)', () => {
    const s1 = appReducer(INITIAL_STATE, {
      type: 'HISTORY_DETAIL_START',
      recordRef: 'ref-1',
      consultationId: 'c-1',
    });
    expect(s1.historyDetail.status).toBe('loading');

    // Ready
    const sReady = appReducer(s1, {
      type: 'HISTORY_DETAIL_COMMIT',
      consultationId: 'c-1',
      result: {
        status: 'ready',
        snapshotId: 'snap-1',
        recordRef: 'ref-1',
        detailRevision: 'rev-1',
        execution: { task_run_id: 't-1' },
        outcome: { outcome: 'resolved' },
      },
    });
    expect(sReady.historyDetail.status).toBe('ready');
    expect(sReady.historyDetail.detailRevision).toBe('rev-1');

    // Changed
    const sChanged = appReducer(s1, {
      type: 'HISTORY_DETAIL_COMMIT',
      consultationId: 'c-1',
      result: {
        status: 'changed',
        snapshotId: 'snap-1',
        recordRef: 'ref-1',
        observedRevision: 'new-rev',
      },
    });
    expect(sChanged.historyDetail.status).toBe('changed');
    expect(sChanged.historyDetail.observedRevision).toBe('new-rev');

    // Missing
    const sMissing = appReducer(s1, {
      type: 'HISTORY_DETAIL_COMMIT',
      consultationId: 'c-1',
      result: {
        status: 'missing',
        snapshotId: 'snap-1',
        recordRef: 'ref-1',
        observedRevision: null,
      },
    });
    expect(sMissing.historyDetail.status).toBe('missing');

    // Error
    const sError = appReducer(s1, {
      type: 'HISTORY_DETAIL_ERROR',
      consultationId: 'c-1',
      recordRef: 'ref-1',
      error: 'Disk unreadable',
    });
    expect(sError.historyDetail.status).toBe('error');
    expect(sError.historyDetail.error).toBe('Disk unreadable');
  });

  it('handles POLICY lifecycle (start, commit, error)', () => {
    const s1 = appReducer(INITIAL_STATE, { type: 'POLICY_START' });
    expect(s1.policyState.status).toBe('loading');

    const policy: PolicyReadCurrentResultDto = {
      status: 'ready',
      scope: 'account',
      temporal: 'current',
      observedAt: 1000,
      revision: 'rev-p',
      policy: null,
    };
    const s2 = appReducer(s1, { type: 'POLICY_COMMIT', policy });
    expect(s2.policyState.status).toBe('ready');
    expect(s2.currentPolicy).toBe(policy);

    const s3 = appReducer(s1, { type: 'POLICY_ERROR', error: 'Forbidden', status: 'forbidden' });
    expect(s3.policyState.status).toBe('forbidden');
    expect(s3.policyState.error).toBe('Forbidden');
  });

  it('handles EVALUATIONS_LIST and EVALUATION_READ lifecycle', () => {
    const s1 = appReducer(INITIAL_STATE, { type: 'EVALUATIONS_LIST_START' });
    expect(s1.evaluationsState.status).toBe('loading');

    const list: EvaluationsListResultDto = {
      status: 'ready',
      observedAt: 1000,
      bindingRevision: 'b-1',
      items: [],
      nextCursor: null,
    };
    const s2 = appReducer(s1, { type: 'EVALUATIONS_LIST_COMMIT', list });
    expect(s2.evaluationsState.status).toBe('ready');

    // Read evaluation
    const s3 = appReducer(s2, { type: 'EVALUATION_READ_START', evaluationRef: 'eval-1' });
    expect(s3.selectedEvaluation.status).toBe('loading');

    const readRes: EvaluationsReadResultDto = {
      status: 'ready',
      descriptor: {
        evaluationRef: 'eval-1',
        sourceRevision: 'r-1',
        sourceDigest: 'd-1',
        evaluationId: 'e-1',
        runId: 'rn-1',
        createdAt: 1000,
        candidateCount: 2,
        caseCount: 2,
        observationCount: 4,
      },
      document: {
        protocol: 'evcrate-advisor-counsel-evaluation',
        version: 1,
        evaluation_id: 'e-1',
        run_id: 'rn-1',
        created_at: 1000,
        rubric: { version: 1, dimensions: [], pass_threshold: 3 },
        rubric_digest: 'rd-1',
        candidates: [],
        cases: [],
      },
    };
    const s4 = appReducer(s3, { type: 'EVALUATION_READ_COMMIT', result: readRes });
    expect(s4.selectedEvaluation.status).toBe('ready');
    expect(s4.selectedEvaluation.evaluationRef).toBe('eval-1');
  });

  it('handles EVALUATIONS_COMPARE lifecycle', () => {
    const s1 = appReducer(INITIAL_STATE, { type: 'EVALUATIONS_COMPARE_START' });
    expect(s1.comparisonState.status).toBe('loading');

    const compareRes: EvaluationsCompareResultDto = {
      status: 'ready',
      sourceRevisions: [],
      groups: [],
      nextCursor: null,
      returnedBytes: 50,
    };
    const s2 = appReducer(s1, { type: 'EVALUATIONS_COMPARE_COMMIT', comparison: compareRes });
    expect(s2.comparisonState.status).toBe('ready');
    expect(s2.evaluationsComparison).toBe(compareRes);

    const s3 = appReducer(s1, { type: 'EVALUATIONS_COMPARE_ERROR', error: 'Comparison failed' });
    expect(s3.comparisonState.status).toBe('error');
    expect(s3.comparisonState.error).toBe('Comparison failed');
  });
});
