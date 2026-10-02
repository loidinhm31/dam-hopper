/**
 * EvaluationDescriptorCard component.
 *
 * Displays a single discovered evaluation descriptor with metadata and inspect action.
 */

import type { FC } from 'react';
import type { EvaluationDescriptorDto } from '../advisor-types.js';

export interface EvaluationDescriptorCardProps {
  readonly descriptor: EvaluationDescriptorDto;
  readonly onInspect?: (evaluationRef: string, expectedRevision: string) => void;
}

export const EvaluationDescriptorCard: FC<EvaluationDescriptorCardProps> = ({
  descriptor: d,
  onInspect,
}) => {
  const raw = d as unknown as Record<string, unknown>;
  const ref = d.evaluationRef || (typeof raw.evaluation_ref === 'string' ? raw.evaluation_ref : '');
  const rev = d.sourceRevision || (typeof raw.source_revision === 'string' ? raw.source_revision : '');
  const digest = d.sourceDigest || (typeof raw.source_digest === 'string' ? raw.source_digest : '');
  const candidateCount = d.candidateCount ?? (typeof raw.candidate_count === 'number' ? raw.candidate_count : 0);
  const caseCount = d.caseCount ?? (typeof raw.case_count === 'number' ? raw.case_count : 0);
  const observationCount = d.observationCount ?? (typeof raw.observation_count === 'number' ? raw.observation_count : 0);
  const createdAt = d.createdAt ?? (typeof raw.created_at === 'number' ? raw.created_at : Date.now());
  return (
    <div className="descriptor-card">
      <div className="descriptor-card-header">
        <div className="descriptor-ref-group">
          <code className="descriptor-ref" title={ref}>
            {ref}
          </code>
          <span className="badge badge-secondary">Rev: {rev.slice(0, 12)}…</span>
        </div>
        {onInspect && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onInspect(ref, rev)}
            aria-label={`Inspect descriptor ${ref}`}
          >
            Inspect Descriptor
          </button>
        )}
      </div>

      <div className="descriptor-card-body">
        <div className="card-field">
          <span className="field-label">Digest:</span>
          <code className="id-code" title={digest}>
            {digest.slice(0, 12)}…
          </code>
        </div>
        <div className="card-field">
          <span className="field-label">Counts:</span>
          <span className="field-value">
            <strong>{candidateCount}</strong> candidates &bull;{' '}
            <strong>{caseCount}</strong> cases &bull;{' '}
            <strong>{observationCount}</strong> observations
          </span>
        </div>
        <div className="card-field">
          <span className="field-label">Created:</span>
          <span className="text-muted stat-sub">
            {new Date(createdAt).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};
