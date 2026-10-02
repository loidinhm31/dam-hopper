/**
 * EvaluationsView component.
 *
 * Discovered evaluation descriptors listing, comparison grouping, and candidate inspect.
 */

import { useState, useMemo, type FC } from 'react';
import type { AppState } from '../app-state-types.js';
import type {
  ComparableEvaluationGroup,
  EvaluationDescriptorDto,
} from '../advisor-types.js';
import { EvaluationsHeader } from '../components/EvaluationsHeader.js';
import { EvaluationDescriptorsSection } from '../components/EvaluationDescriptorsSection.js';
import { ComparableGroupsSection } from '../components/ComparableGroupsSection.js';

export interface EvaluationsViewProps {
  readonly state: AppState;
  readonly onRevealChange: (reveal: boolean) => void;
  readonly onCompareDescriptors?: (
    items: readonly { evaluationRef: string; expectedRevision: string }[],
  ) => void;
  readonly onInspectDescriptor?: (evaluationRef: string, expectedRevision: string) => void;
}

export const EvaluationsView: FC<EvaluationsViewProps> = ({
  state,
  onRevealChange,
  onCompareDescriptors,
  onInspectDescriptor,
}) => {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const {
    evaluationsList,
    evaluationsComparison,
    revealCandidates,
    capabilities,
    evaluationsState,
    comparisonState,
    selectedEvaluation,
  } = state;

  const hasEvalPerm = capabilities.length === 0 || capabilities.includes('evaluations.list');

  const groups: readonly ComparableEvaluationGroup[] = useMemo(() => {
    if (evaluationsComparison && evaluationsComparison.status === 'ready' && evaluationsComparison.groups) {
      return evaluationsComparison.groups as unknown as readonly ComparableEvaluationGroup[];
    }
    return [];
  }, [evaluationsComparison]);

  const descriptors: readonly EvaluationDescriptorDto[] = useMemo(() => {
    return evaluationsList?.items ?? [];
  }, [evaluationsList]);

  const isComparing = comparisonState?.status === 'loading';
  const listStatus = evaluationsState?.status ?? evaluationsList?.status ?? 'idle';

  const handleCompareClick = () => {
    if (descriptors.length === 0) return;
    const boundedItems = descriptors.slice(0, 32).map((d) => ({
      evaluationRef: d.evaluationRef,
      expectedRevision: d.sourceRevision,
    }));
    onCompareDescriptors?.(boundedItems);
  };

  if (!hasEvalPerm) {
    return (
      <section
        className="view-panel evaluations-empty"
        id="panel-evaluations"
        role="tabpanel"
        aria-labelledby="tab-evaluations"
        tabIndex={0}
      >
        <div className="empty-state-card alert-danger">
          <h3>Evaluation Inspection Forbidden</h3>
          <p>Evaluation inspection is not permitted under current administrator role.</p>
        </div>
      </section>
    );
  }

  if (
    evaluationsList?.status === 'not_configured' ||
    (descriptors.length === 0 && groups.length === 0 && !evaluationsList)
  ) {
    return (
      <section
        className="view-panel evaluations-empty"
        id="panel-evaluations"
        role="tabpanel"
        aria-labelledby="tab-evaluations"
        tabIndex={0}
      >
        <div className="empty-state-card">
          <h3>No Counsel Evaluations Loaded</h3>
          <p>
            {evaluationsList?.status === 'not_configured'
              ? 'No evaluation source is configured or discovered on the server.'
              : 'Click "Refresh History" or check server evaluation directories.'}
          </p>
          <div className="empty-state-notice text-muted">
            Evaluation source — not filtered by History project. Documents are grouped strictly by matching rubric and input digests.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="view-panel evaluations-view"
      id="panel-evaluations"
      role="tabpanel"
      aria-labelledby="tab-evaluations"
      tabIndex={0}
    >
      <EvaluationsHeader
        descriptorsCount={descriptors.length}
        groupsCount={groups.length}
        listStatus={listStatus}
        comparisonStatus={comparisonState?.status}
        comparisonError={comparisonState?.error}
        isComparing={isComparing}
        revealCandidates={revealCandidates}
        onCompare={handleCompareClick}
        onRevealChange={onRevealChange}
      />

      {selectedEvaluation && selectedEvaluation.status !== 'idle' && (
        <div
          className={`inspected-evaluation-card alert ${
            selectedEvaluation.status === 'error'
              ? 'alert-danger'
              : selectedEvaluation.status === 'ready'
                ? 'alert-success'
                : 'alert-info'
          }`}
          role="region"
          aria-label="Inspected Evaluation Document"
        >
          <div className="inspected-eval-header">
            <strong>
              Inspected Evaluation: <code>{selectedEvaluation.evaluationRef}</code>
            </strong>
            <span className="badge badge-secondary" style={{ marginLeft: 8 }}>
              {selectedEvaluation.status}
            </span>
          </div>
          {selectedEvaluation.status === 'loading' && (
            <p className="text-muted" style={{ margin: '6px 0 0' }}>
              Loading evaluation document…
            </p>
          )}
          {selectedEvaluation.status === 'error' && (
            <p className="text-danger" style={{ margin: '6px 0 0' }}>
              {selectedEvaluation.error ?? 'Failed to inspect evaluation document.'}
            </p>
          )}
          {selectedEvaluation.status === 'ready' && selectedEvaluation.document && (
            <div className="inspected-eval-details" style={{ marginTop: 8 }}>
              <dl className="detail-dl">
                <dt>Evaluation ID</dt>
                <dd>
                  <code>{selectedEvaluation.document.evaluation_id}</code>
                </dd>
                <dt>Run ID</dt>
                <dd>
                  <code>{selectedEvaluation.document.run_id}</code>
                </dd>
                <dt>Revision</dt>
                <dd>
                  <code>{selectedEvaluation.observedRevision ?? '—'}</code>
                </dd>
                <dt>Rubric</dt>
                <dd>
                  <code>{selectedEvaluation.document.rubric_digest.slice(0, 12)}…</code>
                </dd>
                <dt>Candidates</dt>
                <dd>{selectedEvaluation.document.candidates.length} candidates</dd>
                <dt>Cases</dt>
                <dd>{selectedEvaluation.document.cases.length} cases</dd>
              </dl>
            </div>
          )}
        </div>
      )}

      <EvaluationDescriptorsSection
        descriptors={descriptors}
        onInspect={onInspectDescriptor}
        pageSize={10}
      />

      <ComparableGroupsSection
        groups={groups}
        selectedGroupKey={selectedGroupKey}
        revealCandidates={revealCandidates}
        onSelectGroup={setSelectedGroupKey}
      />

      <div className="eval-limitations-notice text-muted">
        <strong>Methodological limitations:</strong> Observations are grouped strictly by matching rubric and input digests. Grouping does not represent an account-wide benchmark or causal model ranking. Candidate blinding is enabled by default to prevent evaluation bias.
      </div>
    </section>
  );
};
