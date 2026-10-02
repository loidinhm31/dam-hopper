import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeAdvisorProvider } from './native-advisor-provider.js';
import { AdvisorError, type HistoryRefreshResultDto } from './advisor-types.js';
import type { ApiClient } from '@/api/client.js';

describe('NativeAdvisorProvider', () => {
  let mockClient: ApiClient;

  beforeEach(() => {
    mockClient = {
      owner: { profileId: 'test-profile', generation: 1 },
      advisor: {
        status: vi.fn().mockResolvedValue({
          enabled: true,
          available: true,
          path: '/home/test/.evcrate/advisor-history',
          sourceError: null,
        }),
        updateSettings: vi.fn().mockResolvedValue({ enabled: true }),
        refreshHistory: vi.fn().mockResolvedValue({
          state: 'fresh',
          snapshotId: 'snap-1',
          observedAt: 1000,
          scan: {
            status: 'complete',
            projectsDiscovered: 1,
            tasksDiscovered: 1,
            consultationsDiscovered: 2,
            acceptedRecords: 2,
            invalidRecords: 0,
            bytesDiscovered: 1024,
            bytesRead: 1024,
            diagnostics: [],
            suppressedDiagnostics: 0,
            limitHit: false,
          },
          staleReason: null,
          inventory: {
            entries: [{ projectId: 'proj-1', label: 'Project 1', count: 2 }],
            totalProjects: 1,
            unfilteredTotalRecords: 2,
          },
        }),
        historySummary: vi.fn().mockResolvedValue({
          state: 'fresh',
          snapshotId: 'snap-1',
          metrics: {
            metricDefinitionVersion: 1,
            totalConsultations: 2,
            completedConsultations: 2,
            adviceReadyCount: 2,
            failedCount: 0,
            resolvedCount: 1,
            unresolvedCount: 0,
            regressedCount: 0,
            missingOutcomeCount: 1,
            avgLatencyMs: 120,
            p95LatencyMs: 150,
            routeDistribution: { 'claude-3-7-sonnet': 2 },
          },
          inventory: {
            entries: [{ projectId: 'proj-1', label: 'Project 1', count: 2 }],
            totalProjects: 1,
            unfilteredTotalRecords: 2,
          },
        }),
        historyPage: vi.fn().mockResolvedValue({
          state: 'fresh',
          snapshotId: 'snap-1',
          entries: [
            {
              recordRef: 'rec-1',
              projectId: 'proj-1',
              taskRunId: 'task-1',
              consultationId: 'consult-1',
              status: 'ADVICE_READY',
              route: { backend: 'omp', model: 'claude', effort: 'high' },
              checkpointDigest: 'digest-1',
              promptIdentity: 'prompt-1',
              buildIdentity: 'build-1',
              startedAt: 1000,
              completedAt: 1100,
              receiptElapsedMs: 100,
              outcomeState: 'valid',
              outcomeResult: 'resolved',
            },
          ],
          nextCursor: null,
          returnedBytes: 500,
        }),
        historyDetail: vi.fn().mockResolvedValue({
          status: 'ready',
          snapshotId: 'snap-1',
          recordRef: 'rec-1',
          detailRevision: 'rev-1',
          execution: { status: 'ADVICE_READY', consultation_id: 'consult-1' },
          outcome: { outcome: 'resolved' },
        }),
        policyCurrent: vi.fn().mockResolvedValue({
          status: 'ready',
          scope: 'account',
          temporal: 'current',
          observedAt: 1000,
          revision: 'pol-rev-1',
          policy: {
            version: 2,
            advisor: {
              primary: { backend: 'omp', model: 'sonnet', effort: 'high' },
              backup: { backend: 'omp', model: 'haiku', effort: 'standard' },
            },
            wait: { mode: 'until_terminal', warnAfterMs: 3000, warnEveryMs: 5000 },
            history: { retentionDays: 30, maxBytes: 1048576 },
          },
        }),
        evaluationsList: vi.fn().mockResolvedValue({
          status: 'ready',
          observedAt: 1000,
          bindingRevision: 'bind-rev-1',
          items: [
            {
              evaluationRef: 'eval-1',
              sourceRevision: 'rev-1',
              sourceDigest: 'digest-1',
              evaluationId: 'e-1',
              runId: 'r-1',
              createdAt: 1000,
              candidateCount: 2,
              caseCount: 4,
              observationCount: 8,
            },
          ],
          nextCursor: null,
        }),
        evaluationsRead: vi.fn().mockResolvedValue({
          status: 'ready',
          descriptor: {
            evaluationRef: 'eval-1',
            sourceRevision: 'rev-1',
            sourceDigest: 'digest-1',
            evaluationId: 'e-1',
            runId: 'r-1',
            createdAt: 1000,
            candidateCount: 2,
            caseCount: 4,
            observationCount: 8,
          },
          document: {
            protocol: 'evcrate-advisor-counsel-evaluation',
            version: 1,
            evaluation_id: 'e-1',
            run_id: 'r-1',
            created_at: 1000,
            rubric: { version: 1, dimensions: [], pass_threshold: 3 },
            rubric_digest: 'rd-1',
            candidates: [],
            cases: [],
          },
        }),
        evaluationsCompare: vi.fn().mockResolvedValue({
          status: 'ready',
          sourceRevisions: [{ evaluationRef: 'eval-1', observedRevision: 'rev-1' }],
          groups: [],
          nextCursor: null,
          returnedBytes: 250,
        }),
      },
    } as unknown as ApiClient;
  });

  it('initializes with default descriptor and owner', () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    expect(provider.descriptor.kind).toBe('native');
    expect(provider.descriptor.isAvailable).toBe(true);
    expect(provider.activeOwner).toEqual({ profileId: 'test-profile', generation: 1 });
  });

  it('refreshes history and passes signal', async () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const res = await provider.refreshHistory('req-1', 'proj-1');
    expect(res.snapshotId).toBe('snap-1');
    expect(mockClient.advisor.refreshHistory).toHaveBeenCalledWith(
      { projectId: 'proj-1' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('fetches history summary and page', async () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const summary = await provider.getHistorySummary('req-2', 'snap-1', { projectId: 'proj-1' });
    expect(summary.metrics.totalConsultations).toBe(2);

    const page = await provider.getHistoryPage(
      'req-3',
      'snap-1',
      { projectId: 'proj-1' },
      'started_at_desc',
      null,
      100,
    );
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].consultationId).toBe('consult-1');
  });

  it('fetches history detail', async () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const detail = await provider.getHistoryDetail('req-4', 'snap-1', 'rec-1');
    expect(detail.status).toBe('ready');
  });

  it('reads policy and evaluations list, read, compare', async () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const pol = await provider.readCurrentPolicy('req-5');
    expect(pol.status).toBe('ready');

    const evList = await provider.listEvaluations('req-6', null, 50, 'proj-1');
    expect(evList.items).toHaveLength(1);

    const evRead = await provider.readEvaluation('req-7', 'eval-1', 'rev-1', 'proj-1');
    expect(evRead.status).toBe('ready');

    const evCmp = await provider.compareEvaluations(
      'req-8',
      [{ evaluationRef: 'eval-1', expectedRevision: 'rev-1' }],
      null,
      10,
      'proj-1',
    );
    expect(evCmp.status).toBe('ready');
  });

  it('cancels an in-flight operation by requestId', async () => {
    const { promise: hangPromise, resolve: hangResolve } =
      Promise.withResolvers<HistoryRefreshResultDto>();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(mockClient.advisor.refreshHistory).mockImplementation((_body, opts) => {
      capturedSignal = opts?.signal;
      capturedSignal?.addEventListener('abort', () => {
        hangResolve({
          state: 'fresh',
          snapshotId: 'snap-1',
          observedAt: 1000,
          scan: {
            status: 'complete',
            projectsDiscovered: 0,
            tasksDiscovered: 0,
            consultationsDiscovered: 0,
            acceptedRecords: 0,
            invalidRecords: 0,
            bytesDiscovered: 0,
            bytesRead: 0,
            diagnostics: [],
            suppressedDiagnostics: 0,
            limitHit: false,
          },
          staleReason: null,
          inventory: null,
        });
      });
      return hangPromise;
    });

    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const promise = provider.refreshHistory('cancel-test-req');
    provider.cancel('cancel-test-req');

    expect(capturedSignal?.aborted).toBe(true);
    await expect(promise).rejects.toThrow(AdvisorError);
  });

  it('maps ADVISOR_DISABLED error to typed AdvisorError', async () => {
    vi.mocked(mockClient.advisor.historySummary).mockRejectedValueOnce(
      new Error('Advisor is disabled: ADVISOR_DISABLED'),
    );

    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    await expect(
      provider.getHistorySummary('err-req', 'snap-1', {}),
    ).rejects.toMatchObject({
      code: 'ADVISOR_DISABLED',
    });
  });

  it('probes status and notifies listeners on availability changes', async () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const listener = vi.fn();
    const unsub = provider.subscribe(listener);

    vi.mocked(mockClient.advisor.status).mockResolvedValueOnce({
      enabled: false,
      available: false,
      path: null,
      sourceError: 'Source directory is a symlink: rejected',
    });

    const desc = await provider.probeStatus();
    expect(desc.isAvailable).toBe(false);
    expect(desc.sourceError).toContain('symlink');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'availability-changed',
        available: false,
      }),
    );

    unsub();
  });

  it('destroys provider, aborting active controllers and clearing listeners', async () => {
    const provider = new NativeAdvisorProvider({ apiClient: mockClient });
    const listener = vi.fn();
    provider.subscribe(listener);

    provider.destroy();
    expect(provider.descriptor.isAvailable).toBe(false);

    // After destroy, operations reject immediately
    await expect(provider.readCurrentPolicy('req-after-destroy')).rejects.toThrow(AdvisorError);
  });
});
