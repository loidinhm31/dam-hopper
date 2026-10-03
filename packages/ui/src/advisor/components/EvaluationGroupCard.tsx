/**
 * EvaluationGroupCard component.
 *
 * Displays an aggregated comparable evaluation group with digests and metrics.
 */

import type { FC } from 'react';
import type { ComparableEvaluationGroup } from '../advisor-types.js';

export interface EvaluationGroupCardProps {
  readonly group: ComparableEvaluationGroup;
  readonly isSelected: boolean;
  readonly onToggleSelect: () => void;
}

export const EvaluationGroupCard: FC<EvaluationGroupCardProps> = ({
  group: g,
  isSelected,
  onToggleSelect,
}) => {
  const raw = g as unknown as Record<string, unknown>;
  const rubricDigest =
    (typeof g.rubric_digest === 'string' ? g.rubric_digest : null) ??
    (typeof raw.rubricDigest === 'string' ? raw.rubricDigest : '');
  const inputDigest =
    (typeof g.input_digest === 'string' ? g.input_digest : null) ??
    (typeof raw.inputDigest === 'string' ? raw.inputDigest : '');
  const cases = Array.isArray(g.cases) ? g.cases : [];
  const responses = Array.isArray(g.responses) ? g.responses : [];
  const humanScores = Array.isArray(g.human_scores)
    ? g.human_scores
    : Array.isArray(raw.humanScores)
      ? (raw.humanScores as readonly unknown[])
      : [];
  const automatedScores = Array.isArray(g.automated_scores)
    ? g.automated_scores
    : Array.isArray(raw.automatedScores)
      ? (raw.automatedScores as readonly unknown[])
      : [];
  const groupKey = g.key || (typeof raw.groupKey === 'string' ? raw.groupKey : '');

  return (
    <div className={`eval-group-card ${isSelected ? 'card-selected' : ''}`}>
      <div className="group-card-header">
        <div className="group-key-line">
          <strong className="group-key-label">Comparable Key:</strong>
          <code className="key-code" title={groupKey}>
            {groupKey.slice(0, 16)}…
          </code>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${isSelected ? 'btn-info' : 'btn-secondary'}`}
          onClick={onToggleSelect}
          aria-expanded={isSelected}
          aria-label={`${isSelected ? 'Hide' : 'Inspect'} evaluation group ${groupKey.slice(0, 8)}`}
        >
          {isSelected ? 'Hide Group' : 'Inspect Group'}
        </button>
      </div>

      <div className="group-card-body">
        <div className="digest-badges">
          <div className="digest-item">
            <span className="digest-label">Rubric:</span>{' '}
            <code className="digest-code" title={rubricDigest}>
              {rubricDigest ? `${rubricDigest.slice(0, 10)}…` : '—'}
            </code>
          </div>
          <div className="digest-item">
            <span className="digest-label">Input:</span>{' '}
            <code className="digest-code" title={inputDigest}>
              {inputDigest ? `${inputDigest.slice(0, 10)}…` : '—'}
            </code>
          </div>
        </div>

        <div className="group-metrics-row">
          <div className="group-metric-item">
            <span className="metric-label">Cases:</span>{' '}
            <strong>{cases.length}</strong>
          </div>
          <div className="group-metric-item">
            <span className="metric-label">Candidates:</span>{' '}
            <strong>{responses.length}</strong>
          </div>
          <div className="group-metric-item">
            <span className="metric-label">Human Scored:</span>{' '}
            <strong>{humanScores.length}</strong>
          </div>
          <div className="group-metric-item">
            <span className="metric-label">Auto Scored:</span>{' '}
            <strong>{automatedScores.length}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
