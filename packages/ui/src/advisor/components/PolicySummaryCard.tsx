/**
 * PolicySummaryCard component.
 *
 * Renders the active account-wide advisor routing policy.
 * Distinct from historical route groups; not filtered by workspace project.
 */

import type { FC } from 'react';
import type { AppState } from '../app-state-types.js';

export interface PolicySummaryCardProps {
  readonly state: AppState;
}

export const PolicySummaryCard: FC<PolicySummaryCardProps> = ({ state }) => {
  const { currentPolicy, capabilities, policyState } = state;
  const policy = currentPolicy?.policy ?? policyState?.policy?.policy;

  const hasPolicyPerm = capabilities.length === 0 || capabilities.includes('policy.readCurrent');
  const policyStatus =
    policyState?.status && policyState.status !== 'ready' && policyState.status !== 'idle'
      ? policyState.status
      : currentPolicy?.status ?? 'not_configured';

  const revision = currentPolicy?.revision ?? policyState?.policy?.revision ?? 'none';
  const observedAt = currentPolicy?.observedAt ?? policyState?.policy?.observedAt;

  const statusBadge =
    !hasPolicyPerm || policyStatus === 'forbidden' ? (
      <span className="badge badge-danger">Forbidden</span>
    ) : policyStatus === 'missing' ? (
      <span className="badge badge-danger">Missing</span>
    ) : policyStatus === 'migration_required' ? (
      <span className="badge badge-warning">Migration Required</span>
    ) : policyStatus === 'ready' ? (
      <span className="badge badge-success">Ready</span>
    ) : policyStatus === 'not_configured' ? (
      <span className="badge badge-secondary">Not Configured</span>
    ) : policyStatus === 'loading' ? (
      <span className="badge badge-info">Loading...</span>
    ) : (
      <span className="badge badge-danger">{String(policyStatus)}</span>
    );

  const primary = policy?.advisor?.primary;
  const backup = policy?.advisor?.backup;
  const waitMode = policy?.wait?.mode ?? 'until_terminal';
  const waitObj = policy?.wait as Record<string, unknown> | undefined;
  const historyObj = policy?.history as Record<string, unknown> | undefined;
  const waitWarnAfter =
    policy?.wait?.warnAfterMs ??
    (typeof waitObj?.warn_after_ms === 'number' ? waitObj.warn_after_ms : '—');
  const waitWarnEvery =
    policy?.wait?.warnEveryMs ??
    (typeof waitObj?.warn_every_ms === 'number' ? waitObj.warn_every_ms : '—');
  const retentionDays =
    policy?.history?.retentionDays ??
    (typeof historyObj?.retention_days === 'number' ? historyObj.retention_days : '—');
  const maxBytes =
    policy?.history?.maxBytes ??
    (typeof historyObj?.max_bytes === 'number' ? historyObj.max_bytes : '—');

  return (
    <div className="config-card policy-card">
      <div className="policy-card-header">
        <h3 className="card-subtitle">Active Owner Policy</h3>
        <div className="policy-badge-row">
          <span className="badge badge-info">Current account policy — not filtered by History project</span>
          {statusBadge}
          <span className="badge badge-secondary">Revision: {revision.slice(0, 12)}…</span>
          {observedAt && (
            <span className="text-muted stat-sub">
              Observed: {new Date(observedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {!hasPolicyPerm || policyStatus === 'forbidden' ? (
        <div className="policy-state-banner alert alert-danger" role="alert">
          <strong>Forbidden:</strong> Policy inspection is not permitted under current administrator role.
        </div>
      ) : policyStatus === 'missing' ? (
        <div className="policy-state-banner alert alert-danger" role="alert">
          <strong>Missing Policy:</strong> Current routing policy document could not be located or was removed.
        </div>
      ) : policyStatus === 'not_configured' ? (
        <div className="policy-state-banner alert alert-info">
          <strong>Not Configured:</strong> No account-wide advisor routing policy is configured at $HOME/.evcrate/advisor-routing.json.
        </div>
      ) : policyStatus === 'migration_required' ? (
        <div className="policy-state-banner alert alert-warning">
          <strong>Migration Required:</strong> Policy uses legacy v1 format. Update to v2 specification with primary and backup routes.
        </div>
      ) : policyStatus === 'loading' ? (
        <div className="policy-state-banner alert alert-info">
          <strong>Loading Policy:</strong> Loading active advisor routing policy…
        </div>
      ) : policyStatus !== 'ready' ? (
        <div className="policy-state-banner alert alert-danger">
          <strong>Policy inspection status:</strong> <code>{String(policyStatus)}</code>
          {policyState?.error && <div className="policy-error-msg">{policyState.error}</div>}
        </div>
      ) : (
        <div className="policy-content">
          {primary && backup && (
            <div className="policy-routes-summary">
              <div className="policy-route-item primary-route">
                <span className="route-role-badge badge badge-info">Primary</span>
                <div className="route-details">
                  <code className="route-target-code">
                    {primary.backend} / {primary.model}
                  </code>
                  <span className="text-submuted">({primary.effort})</span>
                </div>
              </div>
              <div className="policy-route-item backup-route">
                <span className="route-role-badge badge badge-secondary">Backup</span>
                <div className="route-details">
                  <code className="route-target-code">
                    {backup.backend} / {backup.model}
                  </code>
                  <span className="text-submuted">({backup.effort})</span>
                </div>
              </div>
            </div>
          )}

          <details className="policy-disclosure">
            <summary className="policy-disclosure-summary">
              <span className="disclosure-label">View full routing policy &amp; runtime parameters</span>
            </summary>
            <div className="policy-disclosure-content">
              <dl className="detail-dl policy-params-dl">
                <dt>Policy Version</dt>
                <dd><code>{policy?.version ?? 2}</code></dd>
                <dt>Primary Route</dt>
                <dd>
                  <code>{primary ? `${primary.backend} / ${primary.model}` : '—'}</code> ({primary?.effort ?? '—'})
                </dd>
                <dt>Backup Route</dt>
                <dd>
                  <code>{backup ? `${backup.backend} / ${backup.model}` : '—'}</code> ({backup?.effort ?? '—'})
                </dd>
                <dt>Wait Mode</dt>
                <dd><code>{waitMode}</code></dd>
                <dt>Wait Warning</dt>
                <dd>Warn after {waitWarnAfter} ms (repeat every {waitWarnEvery} ms)</dd>
                <dt>History Policy</dt>
                <dd>Retention: {retentionDays} days &bull; Max: {maxBytes} bytes</dd>
              </dl>

              <div className="policy-json-wrapper">
                <span className="json-label">Raw Policy JSON:</span>
                <pre className="policy-json-block">
                  <code>{JSON.stringify(policy, null, 2)}</code>
                </pre>
              </div>
            </div>
          </details>
        </div>
      )}

      <div className="card-disclaimer text-muted">
        <em>Observational notice:</em> This displays current account-wide owner policy only (not filtered by History project). It is not historical route evidence and does not represent past execution configurations.
      </div>
    </div>
  );
};
