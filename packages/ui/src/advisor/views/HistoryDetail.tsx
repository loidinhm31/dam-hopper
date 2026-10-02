/**
 * HistoryDetail component.
 *
 * Drawer displaying execution metadata, route, outcome, checkpoint proposal, and advisor response.
 * Handles loading, changed revision, missing record, and error states.
 */

import type { FC } from 'react';
import type { HistoryRowDto } from '../advisor-types.js';
import type { HistoryDetailState } from '../app-state-types.js';
import { TextBlock } from '../components/TextBlock.js';

export interface HistoryDetailProps {
  readonly record?: HistoryRowDto | null;
  readonly detail?: HistoryDetailState | null;
  readonly projectName?: string | null;
  readonly onClose: () => void;
  readonly onRefresh?: () => void;
}

export const HistoryDetail: FC<HistoryDetailProps> = ({
  record,
  detail,
  projectName,
  onClose,
  onRefresh,
}) => {
  const consultationId = detail?.consultationId ?? record?.consultationId ?? null;
  if (!consultationId && !record && !detail) return null;

  if (detail?.status === 'loading') {
    return (
      <aside className="history-detail-drawer" aria-label="Consultation Details">
        <div className="drawer-header">
          <div className="drawer-title-group">
            <h3 className="drawer-title">Consultation Detail</h3>
            <code className="drawer-id">{consultationId}</code>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label="Close detail view"
          >
            &times; Close
          </button>
        </div>
        <div className="drawer-content" style={{ padding: 24 }}>
          <p className="text-muted">Loading consultation detail from provider...</p>
        </div>
      </aside>
    );
  }

  if (detail?.status === 'changed') {
    return (
      <aside className="history-detail-drawer" aria-label="Consultation Details">
        <div className="drawer-header">
          <div className="drawer-title-group">
            <h3 className="drawer-title text-warning">Record Detail Changed</h3>
            <code className="drawer-id">{consultationId}</code>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label="Close detail view"
          >
            &times; Close
          </button>
        </div>
        <div className="drawer-content" style={{ padding: 24 }}>
          <div className="alert alert-warning" role="alert">
            <strong>Detail revision mismatch:</strong> The underlying consultation record was modified after this snapshot was acquired.
          </div>
          <p className="text-muted">To protect diagnostic integrity, row data is not shown as full detail after a revision mismatch.</p>
          {onRefresh && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRefresh}
              style={{ marginTop: 12 }}
            >
              Refresh History
            </button>
          )}
        </div>
      </aside>
    );
  }

  if (detail?.status === 'missing') {
    return (
      <aside className="history-detail-drawer" aria-label="Consultation Details">
        <div className="drawer-header">
          <div className="drawer-title-group">
            <h3 className="drawer-title text-danger">Record Missing</h3>
            <code className="drawer-id">{consultationId}</code>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label="Close detail view"
          >
            &times; Close
          </button>
        </div>
        <div className="drawer-content" style={{ padding: 24 }}>
          <div className="alert alert-danger" role="alert">
            <strong>Record not found:</strong> This consultation is no longer available in the active history source.
          </div>
          {onRefresh && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRefresh}
              style={{ marginTop: 12 }}
            >
              Refresh History
            </button>
          )}
        </div>
      </aside>
    );
  }

  if (detail?.status === 'error') {
    return (
      <aside className="history-detail-drawer" aria-label="Consultation Details">
        <div className="drawer-header">
          <div className="drawer-title-group">
            <h3 className="drawer-title text-danger">Detail Error</h3>
            <code className="drawer-id">{consultationId}</code>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-drawer-close"
            onClick={onClose}
            aria-label="Close detail view"
          >
            &larr; Back / Close
          </button>
        </div>
        <div className="drawer-content" style={{ padding: 24 }}>
          <div className="alert alert-danger" role="alert">
            <strong>Failed to load detail:</strong> {detail.error ?? 'An unexpected error occurred while reading consultation detail.'}
          </div>
          {onRefresh && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRefresh}
              style={{ marginTop: 12 }}
            >
              Refresh History
            </button>
          )}
        </div>
      </aside>
    );
  }

  const exec = detail?.execution;
  const status = (typeof exec?.status === 'string' ? exec.status : null) ?? record?.status ?? 'started';
  const projectId = (typeof exec?.project_id === 'string' ? exec.project_id : null) ?? record?.projectId ?? '';
  const taskRunId = (typeof exec?.task_run_id === 'string' ? exec.task_run_id : null) ?? record?.taskRunId ?? '';
  const startedAt = (typeof exec?.started_at === 'number' ? exec.started_at : null) ?? record?.startedAt ?? Date.now();
  const receiptObj = exec?.receipt as Record<string, unknown> | undefined;
  const elapsedMs = (typeof receiptObj?.elapsed_ms === 'number' ? receiptObj.elapsed_ms : null) ?? record?.receiptElapsedMs ?? null;
  const checkpointDigest = (typeof exec?.checkpoint_digest === 'string' ? exec.checkpoint_digest : null) ?? record?.checkpointDigest ?? '';
  const routeObj = exec?.route as { backend?: string; model?: string; effort?: string } | undefined;
  const route = {
    backend: routeObj?.backend ?? record?.route.backend ?? 'omp',
    model: routeObj?.model ?? record?.route.model ?? '',
    effort: routeObj?.effort ?? record?.route.effort ?? '',
  };
  const promptId = (typeof exec?.prompt_identity === 'string' ? exec.prompt_identity : null) ?? record?.promptIdentity ?? '';
  const buildId = (typeof exec?.build_identity === 'string' ? exec.build_identity : null) ?? record?.buildIdentity ?? '';
  const outcomeObj = detail?.outcome as Record<string, unknown> | undefined;
  const outcomeResult = (typeof outcomeObj?.outcome === 'string' ? outcomeObj.outcome : null) ?? record?.outcomeResult ?? null;
  const outcomeState = record?.outcomeState ?? (outcomeResult ? 'valid' : 'missing');

  const attempts = Array.isArray(exec?.attempts)
    ? (exec.attempts as Array<{
        route?: { backend?: string; model?: string };
        terminal_classification?: string;
        elapsed_ms?: number;
      }>)
    : [];

  const errorObj = exec?.error;
  const checkpoint = exec?.checkpoint as Record<string, unknown> | undefined;
  const taskGoal = (checkpoint?.task as Record<string, unknown> | undefined)?.goal as string | undefined;
  const question = checkpoint?.question as string | undefined;

  const result = exec?.result as Record<string, unknown> | undefined;
  const recommendation = result?.recommendation as string | undefined;
  const rationale = result?.rationale as string | undefined;
  const mustFix = Array.isArray(result?.must_fix) ? (result.must_fix as string[]) : [];
  const cautions = Array.isArray(result?.cautions) ? (result.cautions as string[]) : [];
  const successChecks = Array.isArray(result?.success_checks) ? (result.success_checks as string[]) : [];

  return (
    <aside className="history-detail-drawer" aria-label="Consultation Details">
      <div className="drawer-header">
        <div className="drawer-title-group">
          <h3 className="drawer-title">Consultation Detail</h3>
          <code className="drawer-id">{consultationId}</code>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-drawer-close"
          onClick={onClose}
          aria-label="Close detail view"
        >
          &larr; Back / Close
        </button>
      </div>

      <div className="drawer-content">
        <section className="drawer-section">
          <h4 className="section-label">Execution Summary</h4>
          <dl className="detail-dl">
            <dt>Status:</dt>
            <dd>
              <span className={`badge badge-${status}`}>{status}</span>
            </dd>
            <dt>Project Target:</dt>
            <dd>
              <strong>
                {projectName || (projectId.length > 8 ? `${projectId.slice(0, 8)}…` : projectId)}
              </strong>{' '}
              <code className="id-text" style={{ fontSize: '0.85em', marginLeft: 4 }}>
                ({projectId.length > 16 ? `${projectId.slice(0, 16)}…` : projectId})
              </code>
            </dd>
            <dt>Task Run ID:</dt>
            <dd>
              <code className="id-text">{taskRunId}</code>
            </dd>
            <dt>Started:</dt>
            <dd>{new Date(startedAt).toLocaleString()}</dd>
            <dt>Elapsed:</dt>
            <dd>{elapsedMs !== null ? `${elapsedMs} ms` : '—'}</dd>
            <dt>Checkpoint Digest:</dt>
            <dd>
              <code className="digest-text">{checkpointDigest}</code>
            </dd>
          </dl>
        </section>

        <section className="drawer-section">
          <h4 className="section-label">Advisor Route</h4>
          <dl className="detail-dl">
            <dt>Backend:</dt>
            <dd>
              <strong>{route.backend}</strong>
            </dd>
            <dt>Model:</dt>
            <dd>{route.model}</dd>
            <dt>Effort:</dt>
            <dd>{route.effort}</dd>
            <dt>Prompt Identity:</dt>
            <dd>
              <code>{promptId}</code>
            </dd>
            <dt>Build Identity:</dt>
            <dd>
              <code>{buildId}</code>
            </dd>
          </dl>
        </section>

        <section className="drawer-section">
          <h4 className="section-label">Outcome</h4>
          <dl className="detail-dl">
            <dt>Outcome State:</dt>
            <dd>
              <span className={`badge badge-state-${outcomeState}`}>{outcomeState}</span>
            </dd>
            <dt>Outcome Result:</dt>
            <dd>
              {outcomeResult ? (
                <span className={`badge badge-result-${outcomeResult}`}>{outcomeResult}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </dl>
        </section>

        {attempts.length > 0 && (
          <section className="drawer-section">
            <h4 className="section-label">Attempts ({attempts.length})</h4>
            <div className="attempts-table-wrapper">
              <table className="attempts-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Model</th>
                    <th>Result</th>
                    <th>Elapsed</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((att, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td>
                      <td>
                        <code>
                          {att.route?.backend}/{att.route?.model}
                        </code>
                      </td>
                      <td>
                        <span className={`badge badge-att-${att.terminal_classification}`}>
                          {att.terminal_classification}
                        </span>
                      </td>
                      <td>{att.elapsed_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {Boolean(checkpoint && (question || taskGoal)) && (
          <section className="drawer-section">
            <h4 className="section-label">Checkpoint Request</h4>
            {taskGoal && (
              <div style={{ marginBottom: 8 }}>
                <strong>Task Goal:</strong> <span>{taskGoal}</span>
              </div>
            )}
            {question && (
              <div className="checkpoint-question">
                <strong>Question:</strong>
                <p className="text-muted" style={{ margin: '4px 0 0 0', fontStyle: 'italic' }}>
                  {question}
                </p>
              </div>
            )}
          </section>
        )}

        {Boolean(
          result &&
            (recommendation ||
              rationale ||
              mustFix.length > 0 ||
              cautions.length > 0 ||
              successChecks.length > 0),
        ) && (
            <section className="drawer-section">
              <h4 className="section-label">Advisor Response</h4>
              {recommendation && (
                <div className="recommendation-block" style={{ marginBottom: 12 }}>
                  <strong>Recommendation:</strong>
                  <p style={{ margin: '4px 0 0 0', fontWeight: 500 }}>{recommendation}</p>
                </div>
              )}
              {rationale && (
                <div className="rationale-block" style={{ marginBottom: 12 }}>
                  <strong>Rationale:</strong>
                  <p className="text-muted" style={{ margin: '4px 0 0 0' }}>
                    {rationale}
                  </p>
                </div>
              )}
              {mustFix.length > 0 && (
                <div className="must-fix-block" style={{ marginBottom: 12 }}>
                  <strong className="text-danger">Must Fix ({mustFix.length}):</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {mustFix.map((item, idx) => (
                      <li key={idx} className="text-danger">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cautions.length > 0 && (
                <div className="cautions-block" style={{ marginBottom: 12 }}>
                  <strong className="text-warning">Cautions ({cautions.length}):</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {cautions.map((item, idx) => (
                      <li key={idx} className="text-warning">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {successChecks.length > 0 && (
                <div className="checks-block">
                  <strong>Success Checks ({successChecks.length}):</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {successChecks.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

        {Boolean(errorObj) && (
          <section className="drawer-section">
            <h4 className="section-label text-danger">Sanitized Error</h4>
            <TextBlock content={errorObj} label="Error Details" />
          </section>
        )}
      </div>
    </aside>
  );
};
