/**
 * HistoryView component.
 *
 * Filterable consultation history with responsive card/table views and lazy detail inspect.
 */

import { useEffect, useState, type FC } from 'react';
import type { AppState, UiHistoryFilters, ActivityScope } from '../app-state-types.js';
import { selectSelectedRow, formatProjectName } from '../app-state-selectors.js';
import { PaginationControls } from '../components/PaginationControls.js';
import { ActivityScopeControl } from '../components/ActivityScopeControl.js';
import { HistoryDetail } from './HistoryDetail.js';
import type { ExecutionStatus, OutcomeResult } from '../advisor-types.js';

export interface HistoryViewProps {
  readonly state: AppState;
  readonly onSelectConsultation: (id: string | null, recordRef?: string) => void;
  readonly onSetFilters: (filters: Partial<UiHistoryFilters>) => void;
  readonly onScopeChange?: (scope: ActivityScope) => void;
  readonly onRefresh?: () => void;
  readonly onPageRequest: (cursor: string | null) => Promise<boolean>;
  readonly loading: boolean;
  readonly contextKey: string;
  readonly loadError: string | null;
}

const PAGE_SIZE = 100;

export const HistoryView: FC<HistoryViewProps> = ({
  state,
  onSelectConsultation,
  onSetFilters,
  onScopeChange,
  onRefresh,
  onPageRequest,
  loading,
  contextKey,
  loadError,
}) => {
  const [page, setPage] = useState<number>(0);
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([null]);
  const {
    selectedConsultationId,
    filters,
    historyPageEntries,
    historyPage,
    historySummary,
    historyDetail,
  } = state;
  const hasHistory =
    state.snapshotId !== null || historySummary !== null || historyPageEntries.length > 0;

  useEffect(() => {
    setPage(0);
    setCursorHistory([null]);
  }, [contextKey, filters]);

  if (!hasHistory) {
    const hasProject = Boolean(state.projectId && state.projectId.trim().length > 0);
    const isScanning = state.status === 'scanning' || state.status === 'selecting';

    return (
      <section
        className="view-panel history-empty"
        id="panel-history"
        role="tabpanel"
        aria-labelledby="tab-history"
      >
        <ActivityScopeControl
          scope={state.activityScope}
          projectId={state.projectId}
          projectLabel={state.projectLabel}
          isAvailable={state.isAvailable}
          onScopeChange={(newScope) => onScopeChange?.(newScope)}
        />
        <div className="empty-state-card" aria-live="polite">
          {isScanning ? (
            <>
              <h3>Scanning History Records...</h3>
              <p>Please wait while consultations are being loaded and parsed from the workspace.</p>
            </>
          ) : state.status === 'revoked' ? (
            <>
              <h3>Context Revoked</h3>
              <p>{state.staleReason ?? 'Session or host authorization was revoked. Prior data cleared.'}</p>
            </>
          ) : !state.isAvailable ? (
            <>
              <h3>History Provider Unavailable</h3>
              <p>The history data provider is currently unavailable or disconnected.</p>
            </>
          ) : !hasProject && state.activityScope === 'workspace-project' ? (
            <>
              <h3>No Project Selected</h3>
              <p>Please select a project in Workspace to load consultation history, or switch to All History.</p>
            </>
          ) : (
            <>
              <h3>No History Loaded</h3>
              <p>
                No consultation records available for this scope. Click &ldquo;Refresh History&rdquo; to load consultations from the active workspace.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  const totalItems =
    loading || loadError !== null
      ? 0
      : historySummary?.metrics.totalConsultations ?? historyPageEntries.length;
  const records = loading || loadError !== null ? [] : historyPageEntries;
  const selectedRecord = selectSelectedRow(state);

  const changePage = async (newPage: number) => {
    if (loading || loadError !== null || newPage < 0 || newPage === page) return;
    const cursor =
      newPage < page
        ? cursorHistory[newPage] ?? null
        : historyPage?.nextCursor ?? null;
    if (newPage > page && cursor === null) return;
    if (!(await onPageRequest(cursor))) return;
    if (newPage > page && cursor !== null) {
      setCursorHistory((prev) => [...prev.slice(0, page + 1), cursor]);
    }
    setPage(newPage);
  };

  return (
    <section
      className="view-panel history-view"
      id="panel-history"
      role="tabpanel"
      aria-labelledby="tab-history"
    >
      <div className="history-header">
        <h2 className="view-title">Consultation History ({totalItems})</h2>
        <ActivityScopeControl
          scope={state.activityScope}
          projectId={state.projectId}
          projectLabel={state.projectLabel}
          isAvailable={state.isAvailable}
          onScopeChange={(newScope) => onScopeChange?.(newScope)}
        />
        <div className="history-filters-bar" aria-label="History filters">
          <label className="filter-label">
            Status:
            <select
              className="form-select"
              value={filters.statuses?.[0] ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                onSetFilters({ statuses: val ? [val as ExecutionStatus] : undefined });
                setPage(0);
                setCursorHistory([null]);
              }}
            >
              <option value="">All Statuses</option>
              <option value="ADVICE_READY">ADVICE_READY</option>
              <option value="FAILED">FAILED</option>
              <option value="started">started</option>
            </select>
          </label>

          <label className="filter-label">
            Outcome:
            <select
              className="form-select"
              value={filters.outcomeResults?.[0] ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                onSetFilters({ outcomeResults: val ? [val as OutcomeResult] : undefined });
                setPage(0);
                setCursorHistory([null]);
              }}
            >
              <option value="">All Outcomes</option>
              <option value="resolved">resolved</option>
              <option value="unresolved">unresolved</option>
              <option value="regressed">regressed</option>
              <option value="unknown">unknown</option>
            </select>
          </label>

          {(filters.statuses || filters.outcomeResults || filters.taskRunId) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                onSetFilters({ statuses: undefined, outcomeResults: undefined, taskRunId: null });
                setPage(0);
                setCursorHistory([null]);
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      <div className={`history-content-layout ${selectedRecord || historyDetail?.status !== 'idle' ? 'has-detail' : ''}`}>
        <div className="history-list-pane">
          {/* Narrow Card Mode (for narrow dock / compact viewports) */}
          <div className="history-cards-list" role="feed" aria-label="Consultations cards">
            {loading || loadError !== null ? (
              <div className="history-status-card text-muted">
                {loadError ?? 'Loading consultation records…'}
              </div>
            ) : records.length === 0 ? (
              <div className="history-status-card text-muted">
                No consultation records match the active filters.
              </div>
            ) : (
              records.map((r) => {
                const isSelected = r.consultationId === selectedConsultationId;
                const recordRef = r.recordRef || r.consultationId;
                const rowKey = r.recordRef || `${r.projectId}:${r.consultationId}`;
                const projectEntry = state.inventory?.entries.find(
                  (e) => e.projectId === r.projectId,
                );
                const projectLabel = formatProjectName(r.projectId, projectEntry?.label);
                return (
                  <article
                    key={rowKey}
                    className={`history-card ${isSelected ? 'card-selected' : ''}`}
                    aria-label={`Consultation ${r.consultationId.slice(0, 8)}`}
                  >
                    <div className="card-header">
                      <div className="card-header-main">
                        <span className={`badge badge-${r.status}`}>{r.status}</span>
                        {r.outcomeResult ? (
                          <span className={`badge badge-result-${r.outcomeResult}`}>
                            {r.outcomeResult}
                          </span>
                        ) : (
                          <span className="card-outcome-state text-muted">{r.outcomeState}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm btn-inspect"
                        onClick={() =>
                          onSelectConsultation(isSelected ? null : r.consultationId, recordRef)
                        }
                        aria-label={`Inspect consultation ${r.consultationId.slice(0, 8)}`}
                        aria-expanded={isSelected}
                      >
                        {isSelected ? 'Hide' : 'Inspect'}
                      </button>
                    </div>

                    <div className="card-meta">
                      <span className="card-time">{new Date(r.startedAt).toLocaleString()}</span>
                      <span className="card-latency">
                        {r.receiptElapsedMs !== null ? `${r.receiptElapsedMs} ms` : '—'}
                      </span>
                    </div>

                    <div className="card-body">
                      <div className="card-field">
                        <span className="field-label text-muted">Project:</span>
                        <span className="field-value project-cell" title={r.projectId}>
                          {projectLabel}
                        </span>
                      </div>
                      <div className="card-field">
                        <span className="field-label text-muted">Route:</span>
                        <code className="field-value route-code">
                          {r.route.backend}/{r.route.model}
                        </code>
                      </div>
                      <div className="card-field">
                        <span className="field-label text-muted">ID:</span>
                        <code className="field-value id-code" title={r.consultationId}>
                          {r.consultationId.slice(0, 8)}…
                        </code>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Wide Table Mode */}
          <div className="history-table-container">
            <table className="history-table" aria-label="Consultations list">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Project</th>
                  <th scope="col">Route</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Latency</th>
                  <th scope="col">ID</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading || loadError !== null ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted">
                      {loadError ?? 'Loading consultation records…'}
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted">
                      No consultation records match the active filters.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => {
                    const isSelected = r.consultationId === selectedConsultationId;
                    const recordRef = r.recordRef || r.consultationId;
                    const rowKey = r.recordRef || `${r.projectId}:${r.consultationId}`;
                    const projectEntry = state.inventory?.entries.find(
                      (e) => e.projectId === r.projectId,
                    );
                    const projectLabel = formatProjectName(r.projectId, projectEntry?.label);
                    return (
                      <tr key={rowKey} className={isSelected ? 'row-selected' : ''}>
                        <td>
                          <span className={`badge badge-${r.status}`}>{r.status}</span>
                        </td>
                        <td>{new Date(r.startedAt).toLocaleString()}</td>
                        <td>
                          <span className="project-cell" title={r.projectId}>
                            {projectLabel}
                          </span>
                        </td>
                        <td>
                          <code>
                            {r.route.backend}/{r.route.model}
                          </code>
                        </td>
                        <td>
                          {r.outcomeResult ? (
                            <span className={`badge badge-result-${r.outcomeResult}`}>
                              {r.outcomeResult}
                            </span>
                          ) : (
                            <span className="text-muted">{r.outcomeState}</span>
                          )}
                        </td>
                        <td>{r.receiptElapsedMs !== null ? `${r.receiptElapsedMs} ms` : '—'}</td>
                        <td>
                          <code className="id-cell">{r.consultationId.slice(0, 8)}…</code>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              onSelectConsultation(isSelected ? null : r.consultationId, recordRef)
                            }
                            aria-label={`Inspect consultation ${r.consultationId.slice(0, 8)}`}
                          >
                            {isSelected ? 'Hide' : 'Inspect'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={totalItems}
            onPageChange={(nextPage) => {
              void changePage(nextPage);
            }}
          />
        </div>

        {(selectedRecord || historyDetail?.status !== 'idle') && (() => {
          const selectedProjectId =
            selectedRecord?.projectId ??
            (typeof historyDetail?.execution?.project_id === 'string'
              ? historyDetail.execution.project_id
              : null);
          const projectEntry = selectedProjectId
            ? state.inventory?.entries.find((e) => e.projectId === selectedProjectId)
            : undefined;
          const resolvedProjectName = projectEntry
            ? formatProjectName(projectEntry.projectId, projectEntry.label)
            : selectedProjectId
              ? formatProjectName(selectedProjectId, null)
              : null;
          return (
            <HistoryDetail
              record={selectedRecord}
              detail={historyDetail}
              projectName={resolvedProjectName}
              onClose={() => onSelectConsultation(null)}
              onRefresh={onRefresh}
            />
          );
        })()}
      </div>
    </section>
  );
};
