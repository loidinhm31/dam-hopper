/**
 * AdvisorPanel component.
 *
 * Native React entry point for EVCrate Advisor in Dam-Hopper Workspace.
 * Operates without iframe, MessagePort, plugin-sdk, or window hash routing.
 */

import {
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useState,
  type FC,
} from 'react';
import './advisor.css';
import type { ApiClient } from '@/api/client.js';
import { api } from '@/api/client.js';
import type { ConnectionSnapshot } from '@/api/connections.js';
import type { ProjectTargetSnapshot } from '@/stores/project-target.js';
import { cn } from '@/lib/utils.js';
import { appReducer } from './app-state-reducer.js';
import {
  INITIAL_STATE,
  type AppState,
  type AdvisorView,
  type ActivityScope,
  type UiHistoryFilters,
} from './app-state-types.js';
import { selectHistoryQuery } from './app-state-selectors.js';
import type { AdvisorDataProvider } from './advisor-data-provider.js';
import { NativeAdvisorProvider } from './native-advisor-provider.js';
import { DataControls } from './components/DataControls.js';
import { StatusBanner } from './components/StatusBanner.js';
import { PanelTabs } from './components/PanelTabs.js';
import { DiagnosticPanel } from './components/DiagnosticPanel.js';
import { OverviewView } from './views/OverviewView.js';
import { HistoryView } from './views/HistoryView.js';
import { ConfigurationView } from './views/ConfigurationView.js';
import { EvaluationsView } from './views/EvaluationsView.js';

export interface AdvisorPanelProps {
  readonly provider?: AdvisorDataProvider;
  readonly client?: ApiClient;
  readonly projectTarget?: ProjectTargetSnapshot | null;
  readonly connection?: ConnectionSnapshot | null;
  readonly className?: string;
  readonly defaultView?: AdvisorView;
  readonly onViewChange?: (view: AdvisorView) => void;
  readonly autoRefreshOnMount?: boolean;
}

export const AdvisorPanel: FC<AdvisorPanelProps> = ({
  provider,
  client,
  projectTarget,
  connection,
  className,
  defaultView,
  onViewChange,
  autoRefreshOnMount = true,
}) => {
  const [state, dispatch] = useReducer(appReducer, {
    ...INITIAL_STATE,
    activeView: defaultView ?? 'overview',
    projectId: projectTarget?.project ?? null,
    projectLabel: projectTarget?.label ?? projectTarget?.project ?? null,
  });

  const stateRef = useRef<AppState>(state);
  stateRef.current = state;

  const defaultProviderRef = useRef<AdvisorDataProvider | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const requestSeqRef = useRef<number>(0);
  const providerRef = useRef<AdvisorDataProvider | null>(null);
  const providerRevisionRef = useRef<number>(0);

  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Derive native provider if not explicitly provided
  const activeClient = client ?? api;
  if (!provider && !defaultProviderRef.current) {
    defaultProviderRef.current = new NativeAdvisorProvider({
      apiClient: activeClient,
      owner: connection?.owner ?? activeClient.owner,
    });
  }

  const activeProvider = provider ?? defaultProviderRef.current!;

  const makeRequestId = useCallback((prefix: string): string => {
    return `${prefix}-${Date.now()}-${++requestSeqRef.current}`;
  }, []);

  // Provider subscription & lifecycle
  useEffect(() => {
    const providerChanged =
      providerRef.current !== null && providerRef.current !== activeProvider;
    if (providerChanged) {
      providerRevisionRef.current += 1;
    }
    providerRef.current = activeProvider;

    setHistoryLoading(false);
    setHistoryError(null);

    const unsub = activeProvider.subscribe((event) => {
      if (event.type === 'ready') {
        setHistoryLoading(false);
        setHistoryError(null);
        dispatch({
          type: 'PROVIDER_READY',
          providerKind: event.descriptor.kind,
          label: event.descriptor.label,
          capabilities: event.descriptor.capabilities,
          isAvailable: event.descriptor.isAvailable,
          path: event.descriptor.path,
          sourceError: event.descriptor.sourceError,
        });
      } else if (event.type === 'context-changed') {
        setHistoryLoading(false);
        setHistoryError(null);
        dispatch({
          type: 'CONTEXT_CHANGED',
          label: event.descriptor.label,
          capabilities: event.descriptor.capabilities,
          isAvailable: event.descriptor.isAvailable,
        });
      } else if (event.type === 'availability-changed') {
        dispatch({
          type: 'AVAILABILITY_CHANGED',
          available: event.available,
          capabilities: event.capabilities,
        });
      } else if (event.type === 'disconnected') {
        setHistoryLoading(false);
        setHistoryError('Provider disconnected.');
        dispatch({ type: 'DISCONNECTED', reason: event.reason });
      }
    });

    const d = activeProvider.descriptor;
    if (providerChanged) {
      dispatch({
        type: 'CONTEXT_CHANGED',
        label: d.label,
        capabilities: d.capabilities,
        isAvailable: d.isAvailable,
      });
    } else {
      dispatch({
        type: 'PROVIDER_READY',
        providerKind: d.kind,
        label: d.label,
        capabilities: d.capabilities,
        isAvailable: d.isAvailable,
        path: d.path,
        sourceError: d.sourceError,
      });
    }

    return () => {
      unsub();
    };
  }, [activeProvider]);

  // Project target sync
  useEffect(() => {
    const rawProject = projectTarget?.project ?? null;
    const projectLabel = projectTarget?.label ?? rawProject;
    dispatch({
      type: 'SET_WORKSPACE_PROJECT',
      projectId: rawProject,
      projectLabel,
    });
  }, [projectTarget]);

  // Data fetching operations
  const refreshData = useCallback(async () => {
    const s = stateRef.current;
    const epoch = s.contextEpoch;
    const gen = s.generation + 1;
    const reqId = makeRequestId('refresh');
    activeRequestIdRef.current = reqId;

    dispatch({
      type: 'HISTORY_REFRESH_START',
      generation: gen,
      contextEpoch: epoch,
    });
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const res = await activeProvider.refreshHistory(reqId, s.projectId);
      if (
        providerRef.current !== activeProvider ||
        stateRef.current.contextEpoch !== epoch
      ) {
        return;
      }

      dispatch({
        type: 'HISTORY_REFRESH_COMMIT',
        generation: gen,
        result: res,
        contextEpoch: epoch,
        observedAt: res.observedAt,
      });

      if (res.snapshotId) {
        const nextQueryRes = selectHistoryQuery(stateRef.current);
        if (nextQueryRes.available) {
          const query = nextQueryRes.query;
          const [summary, page] = await Promise.all([
            activeProvider.getHistorySummary(makeRequestId('sum'), res.snapshotId, query),
            activeProvider.getHistoryPage(
              makeRequestId('page'),
              res.snapshotId,
              query,
              'started_at_desc',
              null,
              100,
            ),
          ]);

          if (
            providerRef.current === activeProvider &&
            stateRef.current.contextEpoch === epoch
          ) {
            dispatch({
              type: 'HISTORY_QUERY_PAIR_COMMIT',
              summary,
              page,
              queryRevision: stateRef.current.historyQueryRevision,
              contextEpoch: epoch,
            });
          }
        }
      }
    } catch (err: unknown) {
      if (
        providerRef.current === activeProvider &&
        stateRef.current.contextEpoch === epoch
      ) {
        const msg = err instanceof Error ? err.message : String(err);
        setHistoryError(msg || 'Failed to refresh history.');
      }
    } finally {
      if (
        providerRef.current === activeProvider &&
        stateRef.current.contextEpoch === epoch
      ) {
        setHistoryLoading(false);
      }
    }

    // Policy read (independent)
    dispatch({ type: 'POLICY_START', contextEpoch: epoch });
    activeProvider
      .readCurrentPolicy(makeRequestId('policy'))
      .then((policy) => {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({ type: 'POLICY_COMMIT', policy, contextEpoch: epoch });
        }
      })
      .catch((err: unknown) => {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({
            type: 'POLICY_ERROR',
            error: err instanceof Error ? err.message : String(err),
            contextEpoch: epoch,
          });
        }
      });

    // Evaluations list (independent)
    dispatch({ type: 'EVALUATIONS_LIST_START', contextEpoch: epoch });
    activeProvider
      .listEvaluations(makeRequestId('eval'), null, 100, s.projectId)
      .then((list) => {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({ type: 'EVALUATIONS_LIST_COMMIT', list, contextEpoch: epoch });
        }
      })
      .catch((err: unknown) => {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({
            type: 'EVALUATIONS_LIST_ERROR',
            error: err instanceof Error ? err.message : String(err),
            contextEpoch: epoch,
          });
        }
      });
  }, [activeProvider, makeRequestId]);

  const handleScopeChange = useCallback(
    async (scope: ActivityScope) => {
      const s = stateRef.current;
      if (s.activityScope === scope) return;

      dispatch({ type: 'SET_ACTIVITY_SCOPE', scope });
      const nextQueryRev = s.historyQueryRevision + 1;
      const epoch = s.contextEpoch;

      if (!s.snapshotId) return;

      const nextState: AppState = {
        ...s,
        activityScope: scope,
        historyQueryRevision: nextQueryRev,
      };
      const qResult = selectHistoryQuery(nextState);
      if (!qResult.available) {
        setHistoryLoading(false);
        if (qResult.reason) setHistoryError(qResult.reason);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const [summary, page] = await Promise.all([
          activeProvider.getHistorySummary(makeRequestId('sum'), s.snapshotId, qResult.query),
          activeProvider.getHistoryPage(
            makeRequestId('page'),
            s.snapshotId,
            qResult.query,
            'started_at_desc',
            null,
            100,
          ),
        ]);

        if (
          providerRef.current !== activeProvider ||
          stateRef.current.contextEpoch !== epoch ||
          stateRef.current.historyQueryRevision !== nextQueryRev
        ) {
          return;
        }

        dispatch({
          type: 'HISTORY_QUERY_PAIR_COMMIT',
          summary,
          page,
          queryRevision: nextQueryRev,
          contextEpoch: epoch,
        });
      } catch (err: unknown) {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch &&
          stateRef.current.historyQueryRevision === nextQueryRev
        ) {
          const msg = err instanceof Error ? err.message : String(err);
          setHistoryError(msg || 'Failed to load history for selected scope.');
          dispatch({
            type: 'HISTORY_QUERY_ERROR',
            error: msg,
            queryRevision: nextQueryRev,
            contextEpoch: epoch,
          });
        }
      } finally {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch &&
          stateRef.current.historyQueryRevision === nextQueryRev
        ) {
          setHistoryLoading(false);
        }
      }
    },
    [activeProvider, makeRequestId],
  );

  const handleSetFilters = useCallback(
    async (filters: Partial<UiHistoryFilters>) => {
      const s = stateRef.current;
      dispatch({ type: 'SET_FILTERS', filters });

      const nextQueryRev = s.historyQueryRevision + 1;
      const epoch = s.contextEpoch;

      if (!s.snapshotId) return;

      const nextState: AppState = {
        ...s,
        filters: { ...s.filters, ...filters },
        historyQueryRevision: nextQueryRev,
      };
      const qResult = selectHistoryQuery(nextState);
      if (!qResult.available) {
        setHistoryLoading(false);
        if (qResult.reason) setHistoryError(qResult.reason);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const [summary, page] = await Promise.all([
          activeProvider.getHistorySummary(makeRequestId('sum'), s.snapshotId, qResult.query),
          activeProvider.getHistoryPage(
            makeRequestId('page'),
            s.snapshotId,
            qResult.query,
            'started_at_desc',
            null,
            100,
          ),
        ]);

        if (
          providerRef.current !== activeProvider ||
          stateRef.current.contextEpoch !== epoch ||
          stateRef.current.historyQueryRevision !== nextQueryRev
        ) {
          return;
        }

        dispatch({
          type: 'HISTORY_QUERY_PAIR_COMMIT',
          summary,
          page,
          queryRevision: nextQueryRev,
          contextEpoch: epoch,
        });
      } catch (err: unknown) {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch &&
          stateRef.current.historyQueryRevision === nextQueryRev
        ) {
          const msg = err instanceof Error ? err.message : String(err);
          setHistoryError(msg || 'Failed to apply filters.');
        }
      } finally {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch &&
          stateRef.current.historyQueryRevision === nextQueryRev
        ) {
          setHistoryLoading(false);
        }
      }
    },
    [activeProvider, makeRequestId],
  );

  const handleHistoryPage = useCallback(
    async (cursor: string | null): Promise<boolean> => {
      const s = stateRef.current;
      if (!s.snapshotId) return false;

      const qResult = selectHistoryQuery(s);
      if (!qResult.available) return false;

      const queryRev = s.historyQueryRevision;
      const epoch = s.contextEpoch;

      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = await activeProvider.getHistoryPage(
          makeRequestId('page'),
          s.snapshotId,
          qResult.query,
          'started_at_desc',
          cursor,
          100,
        );

        if (
          providerRef.current !== activeProvider ||
          stateRef.current.contextEpoch !== epoch ||
          stateRef.current.historyQueryRevision !== queryRev
        ) {
          return false;
        }

        dispatch({
          type: 'HISTORY_PAGE_COMMIT',
          page,
          queryRevision: queryRev,
          contextEpoch: epoch,
        });
        return true;
      } catch {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch &&
          stateRef.current.historyQueryRevision === queryRev
        ) {
          setHistoryError('Failed to load page.');
        }
        return false;
      } finally {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch &&
          stateRef.current.historyQueryRevision === queryRev
        ) {
          setHistoryLoading(false);
        }
      }
    },
    [activeProvider, makeRequestId],
  );

  const handleSelectConsultation = useCallback(
    async (id: string | null, recordRef?: string) => {
      const s = stateRef.current;
      const epoch = s.contextEpoch;

      dispatch({
        type: 'SELECT_CONSULTATION',
        consultationId: id,
        recordRef,
        contextEpoch: epoch,
      });

      if (!id || !s.snapshotId) return;

      const ref = recordRef ?? id;
      dispatch({
        type: 'HISTORY_DETAIL_START',
        recordRef: ref,
        consultationId: id,
        contextEpoch: epoch,
      });

      try {
        const detail = await activeProvider.getHistoryDetail(
          makeRequestId('det'),
          s.snapshotId,
          ref,
        );
        if (
          providerRef.current !== activeProvider ||
          stateRef.current.contextEpoch !== epoch
        ) {
          return;
        }

        dispatch({
          type: 'HISTORY_DETAIL_COMMIT',
          result: detail,
          consultationId: id,
          contextEpoch: epoch,
        });
      } catch (err: unknown) {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({
            type: 'HISTORY_DETAIL_ERROR',
            recordRef: ref,
            consultationId: id,
            error: err instanceof Error ? err.message : String(err),
            contextEpoch: epoch,
          });
        }
      }
    },
    [activeProvider, makeRequestId],
  );

  const handleReadEvaluation = useCallback(
    async (evaluationRef: string, expectedRevision: string) => {
      const epoch = stateRef.current.contextEpoch;
      dispatch({ type: 'EVALUATION_READ_START', evaluationRef, contextEpoch: epoch });

      try {
        const res = await activeProvider.readEvaluation(
          makeRequestId('eval-read'),
          evaluationRef,
          expectedRevision,
          stateRef.current.projectId,
        );
        if (
          providerRef.current !== activeProvider ||
          stateRef.current.contextEpoch !== epoch
        ) {
          return;
        }

        dispatch({ type: 'EVALUATION_READ_COMMIT', result: res, contextEpoch: epoch });
      } catch (err: unknown) {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({
            type: 'EVALUATION_READ_ERROR',
            evaluationRef,
            error: err instanceof Error ? err.message : String(err),
            contextEpoch: epoch,
          });
        }
      }
    },
    [activeProvider, makeRequestId],
  );

  const handleCompareEvaluations = useCallback(
    async (
      items: readonly { evaluationRef: string; expectedRevision: string }[],
      cursor: string | null = null,
      limit = 32,
    ) => {
      const epoch = stateRef.current.contextEpoch;
      const boundedItems = items.slice(0, 32);
      dispatch({ type: 'EVALUATIONS_COMPARE_START', contextEpoch: epoch });

      try {
        const cmp = await activeProvider.compareEvaluations(
          makeRequestId('eval-cmp'),
          boundedItems,
          cursor,
          limit,
          stateRef.current.projectId,
        );
        if (
          providerRef.current !== activeProvider ||
          stateRef.current.contextEpoch !== epoch
        ) {
          return;
        }

        if (cmp.status === 'ready') {
          dispatch({
            type: 'EVALUATIONS_COMPARE_COMMIT',
            comparison: cmp,
            cursor,
            contextEpoch: epoch,
          });
        } else {
          dispatch({
            type: 'EVALUATIONS_COMPARE_ERROR',
            error: `Comparison returned status: ${cmp.status}`,
            contextEpoch: epoch,
          });
        }
      } catch (err: unknown) {
        if (
          providerRef.current === activeProvider &&
          stateRef.current.contextEpoch === epoch
        ) {
          dispatch({
            type: 'EVALUATIONS_COMPARE_ERROR',
            error: err instanceof Error ? err.message : String(err),
            contextEpoch: epoch,
          });
        }
      }
    },
    [activeProvider, makeRequestId],
  );

  // Auto-refresh once on mount if enabled
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current && autoRefreshOnMount) {
      mountedRef.current = true;
      void refreshData();
    }
  }, [autoRefreshOnMount, refreshData]);

  return (
    <div className={cn('native-advisor', className)} data-testid="native-advisor-panel">
      <div className="app-container">
        <header className="app-header">
          <div className="header-brand">
            <h1 className="brand-title">EVCrate Advisor Metrics Explorer</h1>
            <p className="brand-subtitle text-muted">Native Workspace Advisor</p>
          </div>
          <DataControls
            status={state.status}
            providerKind={state.providerKind}
            sourceLabel={state.historySourceLabel}
            isAvailable={state.isAvailable}
            observedAt={state.observedAt}
            onRefresh={refreshData}
            onCancel={() => {
              if (activeRequestIdRef.current) {
                activeProvider.cancel(activeRequestIdRef.current);
              }
            }}
          />
        </header>

        <StatusBanner
          status={state.status}
          staleReason={state.staleReason}
          unsupportedReason={state.unsupportedReason}
          scan={state.scan}
          scannedAt={state.observedAt}
          sourceError={state.staleReason}
        />

        <PanelTabs
          activeView={state.activeView}
          onSelectView={(v) => {
            dispatch({ type: 'SET_VIEW', view: v });
            onViewChange?.(v);
          }}
          counts={{
            historyRecords:
              state.historySummary?.metrics.totalConsultations ??
              state.historyPageEntries.length,
            evaluationDocs: state.evaluationsList?.items.length ?? 0,
          }}
        />

        <main className="app-main" id="main-content" tabIndex={-1}>
          {state.activeView === 'overview' && (
            <OverviewView state={state} onScopeChange={handleScopeChange} />
          )}
          {state.activeView === 'history' && (
            <HistoryView
              state={state}
              onSelectConsultation={handleSelectConsultation}
              onSetFilters={handleSetFilters}
              onScopeChange={handleScopeChange}
              onRefresh={refreshData}
              onPageRequest={handleHistoryPage}
              loading={historyLoading}
              loadError={historyError}
              contextKey={`${providerRevisionRef.current}:${state.snapshotId ?? ''}:${state.activityScope}`}
            />
          )}
          {state.activeView === 'configuration' && (
            <ConfigurationView state={state} />
          )}
          {state.activeView === 'evaluations' && (
            <EvaluationsView
              state={state}
              onRevealChange={(rev) => dispatch({ type: 'REVEAL_CANDIDATES', reveal: rev })}
              onCompareDescriptors={(items) => handleCompareEvaluations(items)}
              onInspectDescriptor={(ref, rev) => handleReadEvaluation(ref, rev)}
            />
          )}
        </main>

        {Boolean(state.scan && state.scan.diagnostics.length > 0) && (
          <section className="diagnostics-section" aria-label="Session diagnostics">
            <DiagnosticPanel
              diagnostics={state.scan!.diagnostics}
              suppressedCount={state.scan!.suppressedDiagnostics}
            />
          </section>
        )}

        <footer className="app-footer text-muted">
          <span>Dam-Hopper Native Advisor &bull; Local Evaluated Intelligence</span>
        </footer>
      </div>
    </div>
  );
};
