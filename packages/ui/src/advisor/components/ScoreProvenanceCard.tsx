/**
 * ScoreProvenanceCard component.
 *
 * Displays score metrics (average, pass rate, observation counts)
 * for a candidate under human or automated judgment provenance.
 */

import type { FC } from 'react';
import type { CandidateEvaluationSummary } from '../advisor-types.js';

export interface ScoreProvenanceCardProps {
  readonly summary: CandidateEvaluationSummary;
  readonly label: string;
  readonly provenanceType: 'human' | 'automated';
  readonly revealCandidates?: boolean;
  readonly index?: number;
}

export const ScoreProvenanceCard: FC<ScoreProvenanceCardProps> = ({
  summary: score,
  label,
  provenanceType,
}) => {
  return (
    <div
      className="score-summary-item"
      aria-label={`${provenanceType === 'human' ? 'Human' : 'Automated'} score for ${label}`}
    >
      <div className="score-item-header">
        <strong>{label}</strong>
      </div>
      <div className="score-stat-line">
        Average:{' '}
        <strong>
          {score.average_score !== null ? `${score.average_score.toFixed(2)} / 5.0` : 'Unavailable'}
        </strong>
      </div>
      <div className="score-stat-line">
        Pass rate:{' '}
        <strong>
          {score.pass_rate !== null ? `${(score.pass_rate * 100).toFixed(1)}%` : 'Unavailable'}
        </strong>
      </div>
      <div className="text-muted stat-sub">
        Scored: {score.total_scored_observations} (Full: {score.full_score_count}, Partial: {score.partial_score_count})
      </div>
    </div>
  );
};
