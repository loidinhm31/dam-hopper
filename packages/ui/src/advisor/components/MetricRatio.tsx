/**
 * MetricRatio component.
 *
 * Renders percentage metrics alongside fractional and excluded counts.
 */

import type { FC } from 'react';
import type { RatioMetric } from '../advisor-types.js';
import { formatRatioPercent } from '../app-state-selectors.js';

export { formatRatioPercent };

export interface RatioMetricWithDetails extends RatioMetric {
  readonly value?: number | null;
  readonly excluded?: number;
}

export interface MetricRatioProps {
  readonly label: string;
  readonly metric: RatioMetricWithDetails | null | undefined;
  readonly description?: string;
  readonly variant?: 'card' | 'inline';
}

export const MetricRatio: FC<MetricRatioProps> = ({
  label,
  metric,
  description,
  variant = 'card',
}) => {
  const ratioVal = metric?.ratio ?? metric?.value ?? null;
  const percentText = formatRatioPercent(ratioVal);
  const numerator = metric?.numerator ?? 0;
  const denominator = metric?.denominator ?? 0;
  const excluded = metric?.excluded ?? 0;
  const isAvailable = ratioVal !== null && ratioVal !== undefined;

  if (variant === 'inline') {
    return (
      <span className="metric-ratio-inline">
        <strong className="metric-val">{percentText}</strong>
        <span className="metric-fraction">
          {' '}
          ({numerator}/{denominator})
        </span>
        {excluded > 0 && <span className="metric-excluded"> [{excluded} excluded]</span>}
      </span>
    );
  }

  return (
    <div className={`metric-card ${isAvailable ? 'available' : 'unavailable'}`}>
      <div className="metric-card-header">
        <h4 className="metric-card-title">{label}</h4>
        {description && <p className="metric-card-desc">{description}</p>}
      </div>

      <div className="metric-card-body">
        <div className="metric-value-display">
          <span className={`metric-value ${isAvailable ? '' : 'text-muted'}`}>
            {percentText}
          </span>
        </div>

        <div className="metric-details">
          <div className="metric-fraction">
            <span className="detail-label">Counts:</span>{' '}
            <span className="detail-value">
              {numerator} / {denominator}
            </span>
          </div>
          <div className="metric-excluded">
            <span className="detail-label">Excluded:</span>{' '}
            <span className="detail-value">{excluded}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
