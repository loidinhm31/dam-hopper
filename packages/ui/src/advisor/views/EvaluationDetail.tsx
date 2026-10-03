/**
 * EvaluationDetail component.
 *
 * Accessible drawer presenting in-depth cases, candidate response
 * performance, and score provenance for an aggregated comparable evaluation group.
 */

import { useEffect, useMemo, useRef, type FC } from 'react';
import type { ComparableEvaluationGroup } from '../advisor-types.js';
import { ScoreProvenanceCard } from '../components/ScoreProvenanceCard.js';
import { CandidatePerformanceTable } from '../components/CandidatePerformanceTable.js';

export interface EvaluationDetailProps {
  readonly group: ComparableEvaluationGroup;
  readonly revealCandidates: boolean;
  readonly onClose: () => void;
}

export const EvaluationDetail: FC<EvaluationDetailProps> = ({
  group,
  revealCandidates,
  onClose,
}) => {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previousFocus =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    };
  }, []);

  const raw = group as unknown as Record<string, unknown>;
  const rubricDigest =
    (typeof group.rubric_digest === 'string' ? group.rubric_digest : null) ??
    (typeof raw.rubricDigest === 'string' ? raw.rubricDigest : '');
  const inputDigest =
    (typeof group.input_digest === 'string' ? group.input_digest : null) ??
    (typeof raw.inputDigest === 'string' ? raw.inputDigest : '');
  const cases = Array.isArray(group.cases) ? group.cases : [];
  const responses = Array.isArray(group.responses) ? group.responses : [];
  const humanScores = Array.isArray(group.human_scores)
    ? group.human_scores
    : Array.isArray(raw.humanScores)
      ? (raw.humanScores as readonly CandidateEvaluationSummary[])
      : [];
  const automatedScores = Array.isArray(group.automated_scores)
    ? group.automated_scores
    : Array.isArray(raw.automatedScores)
      ? (raw.automatedScores as readonly CandidateEvaluationSummary[])
      : [];

  const candidateLabels = useMemo(() => {
    const idSet = new Set<string>();
    for (const r of responses) {
      const cid = r.candidate_id || (r as unknown as { candidateId?: string }).candidateId;
      if (cid) idSet.add(cid);
    }
    for (const h of humanScores) {
      const cid = h.candidate_id || (h as unknown as { candidateId?: string }).candidateId;
      if (cid) idSet.add(cid);
    }
    for (const a of automatedScores) {
      const cid = a.candidate_id || (a as unknown as { candidateId?: string }).candidateId;
      if (cid) idSet.add(cid);
    }

    const sortedIds = Array.from(idSet).sort();
    const map = new Map<string, string>();
    sortedIds.forEach((id, idx) => {
      const letter = String.fromCharCode(65 + (idx % 26));
      const suffix = idx >= 26 ? String(Math.floor(idx / 26) + 1) : '';
      map.set(id, `Candidate ${letter}${suffix}`);
    });
    return map;
  }, [responses, humanScores, automatedScores]);

  return (
    <aside
      className="eval-detail-drawer"
      aria-label="Evaluation Group Details"
      role="region"
    >
      <div className="drawer-header">
        <div className="drawer-title-group">
          <h3 className="drawer-title">Comparable Evaluation Group</h3>
          <div className="drawer-digests">
            <span className="drawer-digest-item">
              Rubric: <code>{rubricDigest ? `${rubricDigest.slice(0, 10)}…` : '—'}</code>
            </span>
            <span className="drawer-digest-divider">&bull;</span>
            <span className="drawer-digest-item">
              Input: <code>{inputDigest ? `${inputDigest.slice(0, 10)}…` : '—'}</code>
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-drawer-close"
          onClick={onClose}
          aria-label="Close evaluation group details"
        >
          &times; Close
        </button>
      </div>

      <div className="drawer-content">
        <section className="drawer-section" aria-label="Included Evaluation Cases">
          <h4 className="section-label">Included Evaluation Cases ({cases.length})</h4>
          <ul className="eval-cases-list">
            {cases.map((c, idx) => {
              const rawCase = c as unknown as Record<string, unknown>;
              const caseId =
                (typeof c.case_id === 'string' ? c.case_id : null) ??
                (typeof rawCase.caseId === 'string' ? rawCase.caseId : `case-${idx}`);
              const runId =
                (typeof c.run_id === 'string' ? c.run_id : null) ??
                (typeof rawCase.runId === 'string' ? rawCase.runId : '');
              const name = c.name || (typeof rawCase.name === 'string' ? rawCase.name : caseId);
              const category =
                c.category || (typeof rawCase.category === 'string' ? rawCase.category : '');
              return (
                <li key={`${caseId}-${idx}`} className="eval-case-item">
                  <div className="case-item-title">
                    <strong>{name}</strong>{' '}
                    {category && <span className="badge badge-info">{category}</span>}
                  </div>
                  <div className="text-muted id-sub">
                    Case: <code>{caseId}</code> &bull; Run:{' '}
                    <code>{runId ? `${runId.slice(0, 8)}…` : '—'}</code>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="drawer-section" aria-label="Candidate Response Performance">
          <div className="section-header-row">
            <h4 className="section-label">Candidate Response Performance</h4>
            {!revealCandidates && (
              <span className="badge badge-secondary blinding-badge">Blinded</span>
            )}
          </div>

          <CandidatePerformanceTable
            responses={responses}
            revealCandidates={revealCandidates}
            candidateLabels={candidateLabels}
          />
        </section>

        {(humanScores.length > 0 || automatedScores.length > 0) && (
          <section className="drawer-section" aria-label="Scores by Provenance">
            <h4 className="section-label">Scores by Provenance</h4>
            <div className="scores-columns">
              {humanScores.length > 0 && (
                <div className="score-provenance-col">
                  <h5 className="score-col-heading">Human Judge Scores</h5>
                  <div className="score-cards-list">
                    {humanScores.map((hs, idx) => (
                      <ScoreProvenanceCard
                        key={revealCandidates ? hs.candidate_id : `blinded-hs-${idx}`}
                        summary={hs}
                        label={
                          revealCandidates
                            ? (hs.label ?? hs.candidate_id)
                            : (candidateLabels.get(hs.candidate_id) ??
                              `Candidate ${String.fromCharCode(65 + idx)}`)
                        }
                        provenanceType="human"
                        revealCandidates={revealCandidates}
                        index={idx}
                      />
                    ))}
                  </div>
                </div>
              )}

              {automatedScores.length > 0 && (
                <div className="score-provenance-col">
                  <h5 className="score-col-heading">Automated Judge Scores</h5>
                  <div className="score-cards-list">
                    {automatedScores.map((as, idx) => (
                      <ScoreProvenanceCard
                        key={revealCandidates ? as.candidate_id : `blinded-as-${idx}`}
                        summary={as}
                        label={
                          revealCandidates
                            ? (as.label ?? as.candidate_id)
                            : (candidateLabels.get(as.candidate_id) ??
                              `Candidate ${String.fromCharCode(65 + idx)}`)
                        }
                        provenanceType="automated"
                        revealCandidates={revealCandidates}
                        index={idx}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};
