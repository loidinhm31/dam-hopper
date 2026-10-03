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
  const raw = score as unknown as Record<string, unknown>;
  const avg =
    typeof score.average_score === 'number'
      ? score.average_score
      : typeof raw.averageScore === 'number'
        ? raw.averageScore
        : null;
  const pass =
    typeof score.pass_rate === 'number'
      ? score.pass_rate
      : typeof raw.passRate === 'number'
        ? raw.passRate
        : null;
  const totalScored =
    score.total_scored_observations ??
    (typeof raw.totalScoredObservations === 'number' ? raw.totalScoredObservations : 0);
  const fullScore =
    score.full_score_count ??
    (typeof raw.fullScoreCount === 'number' ? raw.fullScoreCount : 0);
  const partialScore =
    score.partial_score_count ??
    (typeof raw.partialScoreCount === 'number' ? raw.partialScoreCount : 0);

  return (
    <div
      className={`score-summary-item ${provenanceType === 'human' ? 'score-provenance-human' : 'score-provenance-auto'}`}
      aria-label={`${provenanceType === 'human' ? 'Human' : 'Automated'} score for ${label}`}
    >
      <div className="score-item-header">
        <strong className={provenanceType === 'human' ? 'text-purple' : 'text-cyan'}>{label}</strong>
      </div>
      <div className="score-stat-line">
        Average:{' '}
        <strong className="text-cyan">
          {avg !== null ? `${avg.toFixed(2)} / 5.0` : 'Unavailable'}
        </strong>
      </div>
      <div className="score-stat-line">
        Pass rate:{' '}
        <strong className={pass !== null && pass >= 0.8 ? 'text-success' : pass !== null ? 'text-warning' : ''}>
          {pass !== null ? `${(pass * 100).toFixed(1)}%` : 'Unavailable'}
        </strong>
      </div>
      <div className="text-muted stat-sub">
        Scored: {totalScored} (Full: {fullScore}, Partial: {partialScore})
      </div>
    </div>
  );
};
