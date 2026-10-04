// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluationsView } from './EvaluationsView.js';
import type { AppState } from '../app-state-types.js';
import {
  INITIAL_BOUND_POLICY_STATE,
  INITIAL_BOUND_EVALUATIONS_STATE,
} from '../app-state-types.js';
import type { EvaluationDescriptorDto, EvaluationsListResultDto } from '../advisor-types.js';

describe('EvaluationsView', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  const baseState: AppState = {
    providerKind: 'native',
    label: 'Native Advisor',
    capabilities: ['evaluations.list', 'evaluations.read', 'evaluations.compare'],
    isAvailable: true,
    policyState: INITIAL_BOUND_POLICY_STATE,
    evaluationsState: INITIAL_BOUND_EVALUATIONS_STATE,
    comparisonState: {
      status: 'idle',
      comparison: null,
      cursor: null,
      error: null,
    },
    status: 'ready',
    activeView: 'evaluations',
    selectedSessionId: null,
    selectedTurnIndex: null,
    drawerOpen: false,
    selectedCategory: null,
    revealCandidates: false,
    currentPolicy: null,
    evaluationsList: null,
    selectedEvaluation: {
      status: 'idle',
      evaluationRef: null,
      descriptor: null,
      document: null,
      observedRevision: null,
      error: null,
    },
    evaluationsComparison: null,
    inventory: null,
  };

  it('renders empty state when no evaluations are loaded', () => {
    act(() => {
      root?.render(
        <EvaluationsView
          state={baseState}
          onRevealChange={vi.fn()}
        />,
      );
    });

    expect(container?.textContent).toContain('No Counsel Evaluations Loaded');
  });

  it('renders Counsel Evaluations (2 descriptors) with responsive header and cards', () => {
    const descriptors: EvaluationDescriptorDto[] = [
      {
        evaluationRef: 'eval-rubric-v2-run-4821',
        sourceRevision: 'abc123def4567890',
        sourceDigest: 'digest000111222333444555666777888999',
        evaluationId: 'e-1',
        runId: 'r-1',
        createdAt: 1728000000000,
        candidateCount: 4,
        caseCount: 12,
        observationCount: 48,
      },
      {
        evaluationRef: 'eval-rubric-v2-run-4822',
        sourceRevision: 'fed987cba6543210',
        sourceDigest: 'digest999888777666555444333222111000',
        evaluationId: 'e-2',
        runId: 'r-2',
        createdAt: 1728003600000,
        candidateCount: 2,
        caseCount: 6,
        observationCount: 24,
      },
    ];

    const evaluationsList: EvaluationsListResultDto = {
      status: 'ready',
      observedAt: 1728003600000,
      bindingRevision: 'rev-binding-1',
      items: descriptors,
      nextCursor: null,
    };

    const stateWithEvals: AppState = {
      ...baseState,
      evaluationsList,
      evaluationsState: {
        status: 'ready',
        list: evaluationsList,
        error: null,
      },
    };

    const onCompareDescriptors = vi.fn();
    const onInspectDescriptor = vi.fn();
    const onRevealChange = vi.fn();

    act(() => {
      root?.render(
        <EvaluationsView
          state={stateWithEvals}
          onRevealChange={onRevealChange}
          onCompareDescriptors={onCompareDescriptors}
          onInspectDescriptor={onInspectDescriptor}
        />,
      );
    });

    // 1. Verify summary header reads Counsel Evaluations (2 descriptors)
    const headerTitle = container?.querySelector('.view-title');
    expect(headerTitle?.textContent).toBe('Counsel Evaluations (2 descriptors)');

    // 2. Verify header structure has main info and controls
    expect(container?.querySelector('.evaluations-header')).not.toBeNull();
    expect(container?.querySelector('.evaluations-header-main')).not.toBeNull();
    expect(container?.querySelector('.evaluations-controls')).not.toBeNull();

    // 3. Verify descriptors list contains 2 cards
    const cards = container?.querySelectorAll('.descriptor-card');
    expect(cards?.length).toBe(2);

    // 4. Verify card content and fields
    expect(container?.textContent).toContain('eval-rubric-v2-run-4821');
    expect(container?.textContent).toContain('eval-rubric-v2-run-4822');
    expect(container?.textContent).toContain('4 candidates');
    expect(container?.textContent).toContain('12 cases');
    expect(container?.textContent).toContain('48 observations');

    // 5. Verify inspect action triggers onInspectDescriptor
    const inspectButtons = container?.querySelectorAll<HTMLButtonElement>('button[aria-label^="Inspect descriptor"]');
    expect(inspectButtons?.length).toBe(2);
    act(() => {
      inspectButtons?.[0]?.click();
    });
    expect(onInspectDescriptor).toHaveBeenCalledWith(
      'eval-rubric-v2-run-4821',
      'abc123def4567890',
    );

    // 6. Verify compare button triggers onCompareDescriptors with both descriptors
    const compareButton = container?.querySelector<HTMLButtonElement>('button[aria-label^="Compare available descriptors"]');
    expect(compareButton).not.toBeNull();
    act(() => {
      compareButton?.click();
    });
    expect(onCompareDescriptors).toHaveBeenCalledWith([
      { evaluationRef: 'eval-rubric-v2-run-4821', expectedRevision: 'abc123def4567890' },
      { evaluationRef: 'eval-rubric-v2-run-4822', expectedRevision: 'fed987cba6543210' },
    ]);
  });
});
