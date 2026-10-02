/**
 * OverviewView component.
 *
 * Renders key summary rate metrics, latency percentiles, outcome counts, and limitations.
 */

import type { FC } from 'react';
import type { AppState, ActivityScope } from '../app-state-types.js';
import { MetricRatio } from '../components/MetricRatio.js';
import { formatProjectName } from '../app-state-selectors.js';
import { ActivityScopeControl } from '../components/ActivityScopeControl.js';

export interface OverviewViewProps {
  readonly state: AppState;
  readonly onScopeChange?: (scope: ActivityScope) => void;
}

function formatLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'Unavailable';
  return `${Math.round(ms)} ms`;
}

export const OverviewView: FC<OverviewViewProps> = ({ state, onScopeChange }) => {
  const { historySummary, status, staleReason, scan } = state;
  const metrics = historySummary?.metrics;

  if (!metrics) {
    const hasProject = Boolean(state.projectId && state.projectId.trim().length > 0);
    const isScanning = status === 'scanning' || status === 'selecting';

    return (
      <section
        className="view-panel overview-empty"
        id="panel-overview"
        role="tabpanel"
        aria-labelledby="tab-overview"
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
              <p>Please wait while consultation records are discovered, parsed, and validated.</p>
            </>
          ) : status === 'revoked' ? (
            <>
              <h3>Context Revoked</h3>
              <p>{staleReason ?? 'Session or host authorization was revoked. Prior data cleared.'}</p>
            </>
          ) : !state.isAvailable ? (
            <>
              <h3>History Provider Unavailable</h3>
              <p>The history data provider is currently unavailable or disconnected.</p>
            </>
          ) : !hasProject && state.activityScope === 'workspace-project' ? (
            <>
              <h3>No Project Selected</h3>
              <p>Please select a project in Workspace to load and inspect advisor consultations, or switch to All History.</p>
            </>
          ) : (
            <>
              <h3>No Advisor History Loaded</h3>
              <p>
                No consultation records found for this scope. Click &ldquo;Refresh History&rdquo; above to inspect diagnostic metrics,
                outcome distributions, latency, and limitations.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  const total = metrics.totalConsultations;
  const completed = metrics.completedConsultations;
  const adviceReady = metrics.adviceReadyCount;
  const resolved = metrics.resolvedCount;
  const unresolved = metrics.unresolvedCount;
  const regressed = metrics.regressedCount;
  const missingOutcome = metrics.missingOutcomeCount;
  const reportedOutcomes = resolved + unresolved + regressed;

  const deliveryRatio = {
    numerator: adviceReady,
    denominator: completed,
    ratio: completed > 0 ? adviceReady / completed : null,
  };

  const outcomeCoverageRatio = {
    numerator: reportedOutcomes,
    denominator: completed,
    ratio: completed > 0 ? reportedOutcomes / completed : null,
  };

  const resolutionRatio = {
    numerator: resolved,
    denominator: reportedOutcomes,
    ratio: reportedOutcomes > 0 ? resolved / reportedOutcomes : null,
  };

  const currentProjectName = state.projectId
    ? formatProjectName(
        state.projectId,
        state.inventory?.entries.find((e) => e.projectId === state.projectId)?.label ??
          state.projectLabel,
      )
    : null;

  return (
    <section
      className="view-panel overview-view"
      id="panel-overview"
      role="tabpanel"
      aria-labelledby="tab-overview"
    >
      <div className="overview-header">
        <h2 className="view-title">
          Overview Metrics
          {status === 'stale' && (
            <span className="badge badge-warning" style={{ marginLeft: 8 }}>
              Stale Data
            </span>
          )}
          {scan?.status === 'incomplete' && (
            <span className="badge badge-warning" style={{ marginLeft: 8 }}>
              Incomplete Snapshot
            </span>
          )}
        </h2>
        <ActivityScopeControl
          scope={state.activityScope}
          projectId={state.projectId}
          projectLabel={state.projectLabel}
          isAvailable={state.isAvailable}
          onScopeChange={(newScope) => onScopeChange?.(newScope)}
        />
        <div className="overview-meta text-muted" aria-label="Scope and record counts">
          <span className="meta-item">
            Scope: <strong>{state.activityScope === 'all' ? 'All Projects' : 'Filtered Project'}</strong>
          </span>
          {currentProjectName && state.activityScope !== 'all' && (
            <>
              <span className="meta-sep" aria-hidden="true">
                &bull;
              </span>
              <span className="meta-item">
                Project: <strong>{currentProjectName}</strong>
              </span>
            </>
          )}
          <span className="meta-sep" aria-hidden="true">
            &bull;
          </span>
          <span className="meta-item">
            Consultations: <strong>{total}</strong>
          </span>
        </div>
      </div>

      {status === 'stale' && staleReason && (
        <div className="alert alert-warning" role="alert" style={{ marginBottom: 16 }}>
          <strong>Stale notice:</strong> {staleReason}
        </div>
      )}

      <div className="metrics-grid" aria-label="Key Rate Metrics">
        <MetricRatio
          label="Delivery Rate"
          metric={deliveryRatio}
          description="Delivered ADVICE_READY responses over total terminal consultations."
        />
        <MetricRatio
          label="Outcome Coverage"
          metric={outcomeCoverageRatio}
          description="Valid executor outcome reports recorded for consultations."
        />
        <MetricRatio
          label="Resolution Rate"
          metric={resolutionRatio}
          description="Outcomes with resolved status among reported outcomes."
        />
      </div>

      <div className="overview-sections-grid">
        <div className="overview-card latency-card">
          <h3 className="section-subtitle">Receipt Latency</h3>
          <div className="latency-stats-grid">
            <div className="stat-item">
              <span className="stat-label">Average</span>
              <strong className="stat-value">{formatLatencyMs(metrics.avgLatencyMs)}</strong>
            </div>
            <div className="stat-item">
              <span className="stat-label">p95</span>
              <strong className="stat-value">{formatLatencyMs(metrics.p95LatencyMs)}</strong>
            </div>
          </div>
        </div>

        <div className="overview-card counts-card">
          <h3 className="section-subtitle">Outcome &amp; Missingness</h3>
          <div className="counts-breakdown">
            <div className="breakdown-row">
              <span>Resolved:</span>
              <strong>{resolved}</strong>
            </div>
            <div className="breakdown-row">
              <span>Unresolved:</span>
              <strong>{unresolved}</strong>
            </div>
            <div className="breakdown-row">
              <span>Regressed:</span>
              <strong>{regressed}</strong>
            </div>
            <div className="breakdown-row">
              <span>Missing Outcome:</span>
              <span className="text-warning">{missingOutcome}</span>
            </div>
          </div>
        </div>

        <div className="overview-card limitations-card">
          <h3 className="section-subtitle">Methodological Limitations</h3>
          <ul className="limitations-list">
            <li className="limitation-item">
              <code>Historical consultations represent captured local advisor evaluations.</code>
            </li>
            <li className="limitation-item">
              <code>Outcomes depend on faithful executor reporting and matching validation.</code>
            </li>
          </ul>
          <p className="limitations-footnote text-muted">
            Observational only. This tool does not claim causal effectiveness, saved time, or cost evaluation.
          </p>
        </div>
      </div>
    </section>
  );
};
