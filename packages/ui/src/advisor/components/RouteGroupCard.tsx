/**
 * RouteGroupCard component.
 *
 * Compact, responsive card representing a historical route and build group.
 * Handles zero-horizontal-overflow safely across viewports.
 */

import type { FC } from 'react';
import { formatRatioPercent } from './MetricRatio.js';

export interface RouteGroupData {
  route_key?: string;
  route?: {
    backend: string;
    model: string;
    effort: string;
  };
  backend?: string;
  model?: string;
  effort?: string;
  prompt_identity?: string;
  build_identity?: string;
  count?: number;
  share?: number;
  counts?: {
    consultations: number;
  };
  delivery?: {
    value?: number | null;
    numerator?: number;
    denominator?: number;
  };
  known_outcome_resolution?: {
    value?: number | null;
    numerator?: number;
    denominator?: number;
  };
  latency?: {
    p50?: number | null;
    p95?: number | null;
  };
  avg_latency_ms?: number | null;
  p95_latency_ms?: number | null;
}

export interface RouteGroupCardProps {
  readonly routeGroup: RouteGroupData;
  readonly index?: number;
}

export const RouteGroupCard: FC<RouteGroupCardProps> = ({ routeGroup: rg }) => {
  const backend = rg.route?.backend ?? rg.backend ?? 'unknown';
  const model = rg.route?.model ?? rg.model ?? 'unknown';
  const effort = rg.route?.effort ?? rg.effort ?? 'standard';
  const runsCount = rg.counts?.consultations ?? rg.count ?? 0;
  const promptId = rg.prompt_identity ?? '—';
  const buildId = rg.build_identity ?? '—';

  const deliveryVal = rg.delivery?.value ?? null;
  const deliveryNum = rg.delivery?.numerator ?? 0;
  const deliveryDenom = rg.delivery?.denominator ?? 0;

  const resolutionVal = rg.known_outcome_resolution?.value ?? null;
  const resolutionNum = rg.known_outcome_resolution?.numerator ?? 0;
  const resolutionDenom = rg.known_outcome_resolution?.denominator ?? 0;

  const p50 = rg.latency?.p50 ?? rg.avg_latency_ms ?? null;
  const p95 = rg.latency?.p95 ?? rg.p95_latency_ms ?? null;

  return (
    <div className="route-card">
      <div className="route-card-header">
        <div className="route-title-line">
          <strong className="route-name">
            {backend}/{model}
          </strong>
          <span className="badge badge-secondary">{effort}</span>
        </div>
        <span className="badge badge-info">{runsCount} runs</span>
      </div>

      <div className="route-card-body">
        <div className="card-field">
          <span className="field-label">Identities:</span>
          <div className="identity-tags">
            <code className="id-code" title={`Prompt: ${promptId}`}>
              p:{promptId.slice(0, 8)}…
            </code>
            <code className="id-code" title={`Build: ${buildId}`}>
              b:{buildId.slice(0, 8)}…
            </code>
          </div>
        </div>

        {deliveryVal !== null && (
          <div className="card-field">
            <span className="field-label">Delivery:</span>
            <div className="field-value">
              <strong className="metric-rate">{formatRatioPercent(deliveryVal)}</strong>{' '}
              <span className="text-muted">
                ({deliveryNum}/{deliveryDenom})
              </span>
            </div>
          </div>
        )}

        {resolutionVal !== null && (
          <div className="card-field">
            <span className="field-label">Resolution:</span>
            <div className="field-value">
              <strong className="metric-rate">
                {formatRatioPercent(resolutionVal)}
              </strong>{' '}
              <span className="text-muted">
                ({resolutionNum}/{resolutionDenom})
              </span>
            </div>
          </div>
        )}

        <div className="card-field">
          <span className="field-label">Latency:</span>
          <div className="field-value">
            p50: <strong>{p50 !== null ? `${Math.round(p50)} ms` : '—'}</strong>
            {' '}&bull;{' '}
            p95: <strong>{p95 !== null ? `${Math.round(p95)} ms` : '—'}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
