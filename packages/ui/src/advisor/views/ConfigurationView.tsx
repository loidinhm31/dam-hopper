/**
 * ConfigurationView component.
 *
 * Compares active account-wide owner routing policy alongside historical route and build groupings.
 */

import type { FC } from 'react';
import type { AppState } from '../app-state-types.js';
import { formatRatioPercent } from '../components/MetricRatio.js';
import { RouteGroupCard, type RouteGroupData } from '../components/RouteGroupCard.js';
import { PolicySummaryCard } from '../components/PolicySummaryCard.js';

export interface ConfigurationViewProps {
  readonly state: AppState;
}

export const ConfigurationView: FC<ConfigurationViewProps> = ({ state }) => {
  const { historySummary, activityScope } = state;

  // Derive route groups from historySummary metrics or routeDistribution
  const routeDist = historySummary?.metrics?.routeDistribution;
  const routeGroups: readonly RouteGroupData[] =
    routeDist
      ? Object.entries(routeDist).map(([key, count]) => {
          const parts = key.split('/');
          const backend = parts[0] || 'primary';
          const model = parts[1] || 'model';
          return {
            route_key: key,
            backend,
            model,
            effort: 'standard',
            count,
            counts: { consultations: count },
            avg_latency_ms: historySummary.metrics.avgLatencyMs,
            p95_latency_ms: historySummary.metrics.p95LatencyMs,
          };
        })
      : [];

  return (
    <section
      className="view-panel configuration-view"
      id="panel-configuration"
      role="tabpanel"
      aria-labelledby="tab-configuration"
      tabIndex={0}
    >
      <div className="view-header">
        <h2 className="view-title">Configuration &amp; Route Comparisons</h2>
        <p className="text-muted">
          Compare active owner routing policy alongside historical route and build groupings.
        </p>
      </div>

      <div className="config-grid">
        <PolicySummaryCard state={state} />

        <div className="config-card routes-section-card">
          <div className="routes-header">
            <div className="routes-title-group">
              <h3 className="card-subtitle">
                Historical Route Groups <span className="badge badge-secondary">{routeGroups.length}</span>
              </h3>
              <span className="badge badge-info history-scope-badge">
                Scope: {activityScope === 'all' ? 'All History' : 'Workspace Project'}
              </span>
            </div>
          </div>

          {routeGroups.length === 0 ? (
            <div className="historical-routes-empty alert alert-info">
              <p>
                <strong>No historical route metrics loaded.</strong>
              </p>
              <p className="text-muted">
                Historical route metrics reflect recorded consultations in the selected history scope (
                {activityScope === 'all' ? 'All History' : 'Workspace Project'}). Try refreshing history
                or select an active project in Workspace.
              </p>
            </div>
          ) : (
            <div className="routes-content">
              <div className="routes-cards-list" aria-label="Historical route group cards">
                {routeGroups.map((rg, idx) => (
                  <RouteGroupCard
                    key={`${rg.backend}-${rg.model}-${idx}`}
                    routeGroup={rg}
                    index={idx}
                  />
                ))}
              </div>

              <div className="routes-table-wrapper">
                <table className="routes-table" aria-label="Historical route metrics table">
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col">Count</th>
                      <th scope="col">Avg Latency</th>
                      <th scope="col">p95 Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeGroups.map((rg, idx) => (
                      <tr key={`${rg.backend}-${rg.model}-${idx}`}>
                        <td>
                          <strong>{rg.backend}</strong>/{rg.model}
                          <div className="text-submuted">{rg.effort}</div>
                        </td>
                        <td>{rg.counts?.consultations ?? rg.count ?? 0}</td>
                        <td>
                          {rg.avg_latency_ms !== null && rg.avg_latency_ms !== undefined
                            ? `${Math.round(rg.avg_latency_ms)} ms`
                            : '—'}
                        </td>
                        <td>
                          {rg.p95_latency_ms !== null && rg.p95_latency_ms !== undefined
                            ? `${Math.round(rg.p95_latency_ms)} ms`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
