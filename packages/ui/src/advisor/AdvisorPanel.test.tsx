// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvisorPanel } from './AdvisorPanel.js';
import type { AdvisorDataProvider, ProviderEventListener } from './advisor-data-provider.js';
import type {
  HistoryRefreshResultDto,
  HistorySummaryResultDto,
  HistoryPageResultDto,
  HistoryDetailResultDto,
  PolicyReadCurrentResultDto,
  EvaluationsListResultDto,
} from './advisor-types.js';

describe('AdvisorPanel', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let mockProvider: AdvisorDataProvider;
  let listeners: Set<ProviderEventListener>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listeners = new Set();

    const sampleSummary: HistorySummaryResultDto = {
      state: 'fresh',
      snapshotId: 'snap-test',
      metrics: {
        metricDefinitionVersion: 1,
        totalConsultations: 5,
        completedConsultations: 5,
        adviceReadyCount: 4,
        failedCount: 1,
        resolvedCount: 3,
        unresolvedCount: 1,
        regressedCount: 0,
        missingOutcomeCount: 1,
        avgLatencyMs: 150,
        p95LatencyMs: 250,
        routeDistribution: { 'omp/claude-3-7-sonnet': 5 },
      },
      inventory: {
        entries: [{ projectId: 'proj-1', label: 'Test Project', count: 5 }],
        totalProjects: 1,
        unfilteredTotalRecords: 5,
      },
    };

    const samplePage: HistoryPageResultDto = {
      state: 'fresh',
      snapshotId: 'snap-test',
      entries: [
        {
          recordRef: 'rec-test-1',
          projectId: 'proj-1',
          taskRunId: 'task-test-1',
          consultationId: 'consult-test-1',
          status: 'ADVICE_READY',
          route: { backend: 'omp', model: 'claude-3-7-sonnet', effort: 'high' },
          checkpointDigest: 'd'.repeat(64),
          promptIdentity: 'prompt-1',
          buildIdentity: 'build-1',
          startedAt: 1000,
          completedAt: 1150,
          receiptElapsedMs: 150,
          outcomeState: 'valid',
          outcomeResult: 'resolved',
        },
      ],
      nextCursor: null,
      returnedBytes: 500,
    };

    const sampleDetail: HistoryDetailResultDto = {
      status: 'ready',
      snapshotId: 'snap-test',
      recordRef: 'rec-test-1',
      detailRevision: 'detail-rev-1',
      execution: {
        status: 'ADVICE_READY',
        project_id: 'proj-1',
        task_run_id: 'task-test-1',
        started_at: 1000,
        receipt: { elapsed_ms: 150 },
        checkpoint_digest: 'd'.repeat(64),
        route: { backend: 'omp', model: 'claude-3-7-sonnet', effort: 'high' },
        prompt_identity: 'prompt-1',
        build_identity: 'build-1',
        result: {
          recommendation: 'Apply bounded patch',
          rationale: 'Validation passed successfully',
          must_fix: [],
          cautions: [],
          success_checks: ['Verify cargo test'],
        },
      },
      outcome: {
        outcome: 'resolved',
      },
    };

    const sampleRefresh: HistoryRefreshResultDto = {
      state: 'fresh',
      snapshotId: 'snap-test',
      observedAt: 1000,
      scan: {
        status: 'complete',
        projectsDiscovered: 1,
        tasksDiscovered: 1,
        consultationsDiscovered: 5,
        acceptedRecords: 5,
        invalidRecords: 0,
        bytesDiscovered: 2048,
        bytesRead: 2048,
        diagnostics: [],
        suppressedDiagnostics: 0,
        limitHit: false,
      },
      staleReason: null,
      inventory: {
        entries: [{ projectId: 'proj-1', label: 'Test Project', count: 5 }],
        totalProjects: 1,
        unfilteredTotalRecords: 5,
      },
    };

    const samplePolicy: PolicyReadCurrentResultDto = {
      status: 'ready',
      scope: 'account',
      temporal: 'current',
      observedAt: 1000,
      revision: 'p'.repeat(64),
      policy: {
        version: 2,
        advisor: {
          primary: { backend: 'omp', model: 'claude-3-7-sonnet', effort: 'high' },
          backup: { backend: 'omp', model: 'claude-3-5-haiku', effort: 'standard' },
        },
        wait: { mode: 'until_terminal', warnAfterMs: 3000, warnEveryMs: 5000 },
        history: { retentionDays: 30, maxBytes: 1048576 },
      },
    };

    const sampleEvals: EvaluationsListResultDto = {
      status: 'ready',
      observedAt: 1000,
      bindingRevision: 'b'.repeat(64),
      items: [
        {
          evaluationRef: 'eval-group-a',
          sourceRevision: 'r'.repeat(64),
          sourceDigest: 's'.repeat(64),
          evaluationId: 'e-1',
          runId: 'r-1',
          createdAt: 1000,
          candidateCount: 2,
          caseCount: 4,
          observationCount: 8,
        },
      ],
      nextCursor: null,
    };

    mockProvider = {
      descriptor: {
        kind: 'native',
        label: 'Mock Native Advisor',
        path: '/mock/advisor-history',
        isAvailable: true,
        capabilities: ['history.refresh', 'history.summary', 'history.page', 'policy.readCurrent', 'evaluations.list'],
        hasHistorySource: true,
        hasPolicySource: true,
        hasEvaluationSource: true,
        sourceError: null,
      },
      subscribe: vi.fn((listener: ProviderEventListener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
      refreshHistory: vi.fn().mockResolvedValue(sampleRefresh),
      getHistorySummary: vi.fn().mockResolvedValue(sampleSummary),
      getHistoryPage: vi.fn().mockResolvedValue(samplePage),
      getHistoryDetail: vi.fn().mockResolvedValue(sampleDetail),
      readCurrentPolicy: vi.fn().mockResolvedValue(samplePolicy),
      listEvaluations: vi.fn().mockResolvedValue(sampleEvals),
      readEvaluation: vi.fn(),
      compareEvaluations: vi.fn(),
      cancel: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it('renders .native-advisor root container and Overview view by default', async () => {
    await act(async () => {
      root?.render(<AdvisorPanel provider={mockProvider} autoRefreshOnMount={false} />);
    });

    const rootEl = container?.querySelector('.native-advisor');
    expect(rootEl).not.toBeNull();
    expect(rootEl?.getAttribute('data-testid')).toBe('native-advisor-panel');

    const overviewPanel = container?.querySelector('#panel-overview');
    expect(overviewPanel).not.toBeNull();
  });

  it('switches views when clicking tabs', async () => {
    const onViewChange = vi.fn();
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={mockProvider}
          autoRefreshOnMount={false}
          onViewChange={onViewChange}
        />,
      );
    });

    // Click History tab
    const historyTab = container?.querySelector<HTMLButtonElement>('#tab-history');
    await act(async () => {
      historyTab?.click();
    });

    expect(onViewChange).toHaveBeenCalledWith('history');
    expect(container?.querySelector('#panel-history')).not.toBeNull();

    // Click Configuration tab
    const configTab = container?.querySelector<HTMLButtonElement>('#tab-configuration');
    await act(async () => {
      configTab?.click();
    });
    expect(onViewChange).toHaveBeenCalledWith('configuration');
    expect(container?.querySelector('#panel-configuration')).not.toBeNull();

    // Click Evaluations tab
    const evalsTab = container?.querySelector<HTMLButtonElement>('#tab-evaluations');
    await act(async () => {
      evalsTab?.click();
    });
    expect(onViewChange).toHaveBeenCalledWith('evaluations');
    expect(container?.querySelector('#panel-evaluations')).not.toBeNull();
  });

  it('auto-refreshes data on mount and updates state', async () => {
    await act(async () => {
      root?.render(<AdvisorPanel provider={mockProvider} autoRefreshOnMount={true} />);
    });

    expect(mockProvider.refreshHistory).toHaveBeenCalled();
    expect(mockProvider.readCurrentPolicy).toHaveBeenCalled();
    expect(mockProvider.listEvaluations).toHaveBeenCalled();
  });

  it('inspects consultation detail and closes drawer in History view', async () => {
    const validProjectId = 'a'.repeat(64);
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={mockProvider}
          autoRefreshOnMount={true}
          defaultView="history"
          projectTarget={{
            project: validProjectId,
            label: 'Test Project',
            target: { profileId: 'p1', project: validProjectId },
            targetKey: 'k1',
            isRoot: true,
            available: true,
          }}
        />,
      );
    });
    const inspectBtn = container?.querySelector<HTMLButtonElement>('.btn-inspect');
    expect(inspectBtn).not.toBeNull();

    await act(async () => {
      inspectBtn?.click();
    });

    expect(mockProvider.getHistoryDetail).toHaveBeenCalledWith(
      expect.any(String),
      'snap-test',
      'rec-test-1',
    );

    // Detail drawer should be visible
    const drawer = container?.querySelector('.history-detail-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain('Consultation Detail');
    expect(drawer?.textContent).toContain('consult-test-1');

    // Close drawer
    const closeBtn = drawer?.querySelector<HTMLButtonElement>('.btn-drawer-close');
    await act(async () => {
      closeBtn?.click();
    });

    expect(container?.querySelector('.history-detail-drawer')).toBeNull();
  });
});
