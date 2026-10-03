/**
 * CandidatePerformanceTable component.
 *
 * Renders candidate responses across models/routes with blinding toggle support.
 */

import type { FC } from 'react';
import type { CandidateResponseSummary } from '../advisor-types.js';

export interface CandidatePerformanceTableProps {
  readonly responses: readonly CandidateResponseSummary[];
  readonly revealCandidates: boolean;
  readonly candidateLabels: ReadonlyMap<string, string>;
}

export const CandidatePerformanceTable: FC<CandidatePerformanceTableProps> = ({
  responses,
  revealCandidates,
  candidateLabels,
}) => {
  return (
    <div className="eval-candidates-table-wrapper">
      <table className="eval-candidates-table" aria-label="Candidate performance table">
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            {revealCandidates && <th scope="col">Route / Build</th>}
            <th scope="col">Total</th>
            <th scope="col">Ready</th>
            <th scope="col">Failed</th>
            <th scope="col">Missing</th>
          </tr>
        </thead>
        <tbody>
          {responses.map((resp, idx) => {
            const raw = resp as unknown as Record<string, unknown>;
            const cid =
              resp.candidate_id ||
              (typeof raw.candidateId === 'string' ? raw.candidateId : `cand-${idx}`);
            const displayLabel = revealCandidates
              ? (resp.label ?? (typeof raw.label === 'string' ? raw.label : cid))
              : (candidateLabels.get(cid) ?? `Candidate ${String.fromCharCode(65 + idx)}`);
            const totalObs =
              resp.total_observations ??
              (typeof raw.totalObservations === 'number' ? raw.totalObservations : 0);
            const readyCount =
              resp.ready_count ?? (typeof raw.readyCount === 'number' ? raw.readyCount : 0);
            const failedCount =
              resp.failed_count ?? (typeof raw.failedCount === 'number' ? raw.failedCount : 0);
            const missingCount =
              resp.missing_count ?? (typeof raw.missingCount === 'number' ? raw.missingCount : 0);
            const route = resp.route ?? (raw.route as { backend?: string; model?: string } | undefined) ?? {
              backend: '—',
              model: '—',
            };
            const buildId =
              resp.build_identity ??
              (typeof raw.buildIdentity === 'string' ? raw.buildIdentity : null);

            return (
              <tr
                key={revealCandidates ? cid : `blinded-resp-${idx}`}
                aria-label={displayLabel}
              >
                <td>
                  <strong>{displayLabel}</strong>
                </td>
                {revealCandidates && (
                  <td>
                    <code>
                      {route.backend}/{route.model}
                    </code>
                    <div className="text-submuted">
                      Build: {buildId ? `${buildId.slice(0, 8)}…` : '—'}
                    </div>
                  </td>
                )}
                <td>{totalObs}</td>
                <td>
                  <span className="badge badge-success">{readyCount}</span>
                </td>
                <td>
                  {failedCount > 0 ? (
                    <span className="badge badge-danger">{failedCount}</span>
                  ) : (
                    '0'
                  )}
                </td>
                <td>
                  {missingCount > 0 ? (
                    <span className="badge badge-warning">{missingCount}</span>
                  ) : (
                    '0'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
