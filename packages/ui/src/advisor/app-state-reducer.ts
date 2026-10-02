/**
 * Advisor UI state reducer.
 *
 * Handles domain state transitions for history, policy, and evaluations views.
 */

import type { AppState, BoundSourceStatus } from './app-state-types.js';
import type { AppAction } from './app-actions.js';
import {
  INITIAL_DETAIL_STATE,
  INITIAL_EVALUATION_DETAIL_STATE,
  INITIAL_BOUND_POLICY_STATE,
  INITIAL_BOUND_EVALUATIONS_STATE,
  INITIAL_BOUND_COMPARISON_STATE,
} from './app-state-types.js';

function matchesContext(state: AppState, epoch?: number): boolean {
  if (state.status === 'revoked' || !state.isAvailable) return false;
  if (epoch !== undefined && epoch !== state.contextEpoch) return false;
  return true;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, activeView: action.view };
    case 'SET_ACTIVITY_SCOPE': {
      if (action.scope === state.activityScope) return state;
      return {
        ...state,
        activityScope: action.scope,
        historyQueryRevision: state.historyQueryRevision + 1,
        historyPageCursor: null,
        historyPageEntries: Object.freeze([]),
        historyPage: null,
        historySummary: null,
        selectedConsultationId: null,
        historyDetail: INITIAL_DETAIL_STATE,
      };
    }

    case 'SET_WORKSPACE_PROJECT': {
      if (action.projectId === state.projectId && action.projectLabel === state.projectLabel) {
        return state;
      }
      const isAll = state.activityScope === 'all';
      return {
        ...state,
        projectId: action.projectId,
        projectLabel: action.projectLabel,
        ...(isAll
          ? {}
          : {
              historyQueryRevision: state.historyQueryRevision + 1,
              historyPageCursor: null,
              historyPageEntries: Object.freeze([]),
              historyPage: null,
              historySummary: null,
              selectedConsultationId: null,
              historyDetail: INITIAL_DETAIL_STATE,
            }),
      };
    }

    case 'SET_FILTERS': {
      return {
        ...state,
        filters: { ...state.filters, ...action.filters },
        historyQueryRevision: state.historyQueryRevision + 1,
        historyPageCursor: null,
        historyPageEntries: Object.freeze([]),
        historyPage: null,
        historySummary: null,
        selectedConsultationId: null,
        historyDetail: INITIAL_DETAIL_STATE,
      };
    }

    case 'SELECT_CONSULTATION': {
      if (action.consultationId === null) {
        return {
          ...state,
          selectedConsultationId: null,
          historyDetail: INITIAL_DETAIL_STATE,
        };
      }
      return {
        ...state,
        selectedConsultationId: action.consultationId,
        historyDetail:
          state.historyDetail.consultationId === action.consultationId
            ? state.historyDetail
            : {
                ...INITIAL_DETAIL_STATE,
                consultationId: action.consultationId,
                recordRef: action.recordRef ?? null,
              },
      };
    }

    case 'REVEAL_CANDIDATES':
      return { ...state, revealCandidates: action.reveal };

    case 'PROVIDER_READY':
      return {
        ...state,
        providerKind: action.providerKind,
        historySourceLabel: action.label,
        capabilities: action.capabilities,
        isAvailable: action.isAvailable,
        staleReason: null,
        unsupportedReason: null,
        projectId: action.projectId !== undefined ? action.projectId : state.projectId,
        projectLabel: action.projectLabel !== undefined ? action.projectLabel : state.projectLabel,
        ownerKey: action.ownerKey !== undefined ? action.ownerKey : state.ownerKey,
      };

    case 'CONTEXT_CHANGED': {
      const nextEpoch = state.contextEpoch + 1;
      return {
        ...state,
        ownerKey: action.ownerKey ?? null,
        projectId: action.projectId ?? null,
        projectLabel: action.projectLabel ?? null,
        historySourceLabel: action.label ?? state.historySourceLabel,
        capabilities: action.capabilities ?? state.capabilities,
        isAvailable: action.isAvailable ?? true,
        contextEpoch: nextEpoch,
        status: 'idle',
        snapshotId: null,
        scan: null,
        observedAt: null,
        staleReason: null,
        unsupportedReason: null,
        selectedConsultationId: null,
        historySummary: null,
        historyPage: null,
        historyPageCursor: null,
        historyPageEntries: Object.freeze([]),
        historyDetail: INITIAL_DETAIL_STATE,
        currentPolicy: null,
        policyState: INITIAL_BOUND_POLICY_STATE,
        evaluationsList: null,
        evaluationsState: INITIAL_BOUND_EVALUATIONS_STATE,
        selectedEvaluation: INITIAL_EVALUATION_DETAIL_STATE,
        evaluationsComparison: null,
        comparisonState: INITIAL_BOUND_COMPARISON_STATE,
        inventory: null,
        revealCandidates: false,
      };
    }

    case 'AVAILABILITY_CHANGED':
      return {
        ...state,
        isAvailable: action.available,
        capabilities: action.capabilities,
      };

    case 'DISCONNECTED': {
      const nextEpoch = state.contextEpoch + 1;
      return {
        ...state,
        status: 'idle',
        isAvailable: false,
        staleReason: action.reason ?? 'Provider disconnected',
        contextEpoch: nextEpoch,
        snapshotId: null,
        scan: null,
        observedAt: null,
        historySourceLabel: null,
        selectedConsultationId: null,
        historySummary: null,
        historyPage: null,
        historyPageCursor: null,
        historyPageEntries: Object.freeze([]),
        historyDetail: INITIAL_DETAIL_STATE,
        currentPolicy: null,
        policyState: INITIAL_BOUND_POLICY_STATE,
        evaluationsList: null,
        evaluationsState: INITIAL_BOUND_EVALUATIONS_STATE,
        selectedEvaluation: INITIAL_EVALUATION_DETAIL_STATE,
        evaluationsComparison: null,
        comparisonState: INITIAL_BOUND_COMPARISON_STATE,
        inventory: null,
        revealCandidates: false,
      };
    }

    case 'HISTORY_REFRESH_START': {
      if (state.status === 'revoked' || !state.isAvailable) return state;
      return {
        ...state,
        status: 'scanning',
        generation: action.generation,
        historyQueryRevision: state.historyQueryRevision + 1,
        staleReason: null,
        selectedConsultationId: null,
        historyDetail: INITIAL_DETAIL_STATE,
        historyPageCursor: null,
        historyPageEntries: Object.freeze([]),
        historyPage: null,
        historySummary: null,
      };
    }

    case 'HISTORY_REFRESH_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (action.generation !== state.generation) return state;
      const res = action.result;
      const inventory = res.inventory ?? state.inventory;
      const isIncomplete = Boolean(res.scan && res.scan.status === 'incomplete');

      if (res.state === 'fresh') {
        return {
          ...state,
          status: 'fresh',
          snapshotId: res.snapshotId,
          scan: res.scan,
          inventory,
          observedAt: action.observedAt ?? res.observedAt ?? Date.now(),
          staleReason: isIncomplete ? 'Incomplete snapshot; scan bounded' : null,
          selectedConsultationId: null,
          historyDetail: INITIAL_DETAIL_STATE,
        };
      }
      if (res.state === 'stale') {
        const hasPrior = state.snapshotId !== null;
        return {
          ...state,
          status: hasPrior ? 'stale' : 'idle',
          snapshotId: res.snapshotId ?? state.snapshotId,
          scan: res.scan,
          inventory,
          observedAt: state.observedAt ?? res.observedAt ?? null,
          staleReason: res.staleReason
            ? `Stale: ${res.staleReason}`
            : isIncomplete
              ? 'Incomplete snapshot; scan interrupted'
              : 'Scan incomplete; retained prior data',
          selectedConsultationId: null,
          historyDetail: INITIAL_DETAIL_STATE,
        };
      }
      return {
        ...state,
        status: 'idle',
        snapshotId: null,
        scan: res.scan,
        inventory: null,
        observedAt: null,
        staleReason: 'History source unavailable',
        selectedConsultationId: null,
        historyDetail: INITIAL_DETAIL_STATE,
      };
    }

    case 'HISTORY_QUERY_PAIR_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (
        action.queryRevision !== undefined &&
        action.queryRevision !== state.historyQueryRevision
      ) {
        return state;
      }
      const inv = action.summary.inventory ?? state.inventory;
      return {
        ...state,
        historySummary: action.summary,
        historyPage: action.page,
        historyPageCursor: action.page.nextCursor,
        historyPageEntries: action.page.entries,
        inventory: inv,
      };
    }

    case 'HISTORY_QUERY_ERROR': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (
        action.queryRevision !== undefined &&
        action.queryRevision !== state.historyQueryRevision
      ) {
        return state;
      }
      return {
        ...state,
        historySummary: null,
        historyPage: null,
        historyPageCursor: null,
        historyPageEntries: Object.freeze([]),
      };
    }

    case 'HISTORY_SUMMARY_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (
        action.queryRevision !== undefined &&
        action.queryRevision !== state.historyQueryRevision
      ) {
        return state;
      }
      const inv = action.summary.inventory ?? state.inventory;
      return {
        ...state,
        historySummary: action.summary,
        inventory: inv,
      };
    }

    case 'HISTORY_PAGE_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (
        action.queryRevision !== undefined &&
        action.queryRevision !== state.historyQueryRevision
      ) {
        return state;
      }
      return {
        ...state,
        historyPage: action.page,
        historyPageCursor: action.page.nextCursor,
        historyPageEntries: action.page.entries,
      };
    }

    case 'HISTORY_DETAIL_START': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        historyDetail: {
          ...INITIAL_DETAIL_STATE,
          status: 'loading',
          recordRef: action.recordRef,
          consultationId: action.consultationId,
        },
      };
    }

    case 'HISTORY_DETAIL_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (
        action.consultationId === null ||
        state.historyDetail.consultationId !== action.consultationId
      ) {
        return state;
      }
      const res = action.result;
      if (res.status === 'ready') {
        return {
          ...state,
          historyDetail: {
            status: 'ready',
            recordRef: res.recordRef,
            consultationId: action.consultationId,
            detailRevision: res.detailRevision,
            execution: res.execution,
            outcome: res.outcome,
            observedRevision: null,
            error: null,
          },
        };
      }
      return {
        ...state,
        historyDetail: {
          status: res.status,
          recordRef: res.recordRef,
          consultationId: action.consultationId,
          detailRevision: null,
          execution: null,
          outcome: null,
          observedRevision: res.observedRevision,
          error: null,
        },
      };
    }

    case 'HISTORY_DETAIL_ERROR': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      if (
        action.consultationId === null ||
        state.historyDetail.consultationId !== action.consultationId
      ) {
        return state;
      }
      return {
        ...state,
        historyDetail: {
          ...INITIAL_DETAIL_STATE,
          status: 'error',
          recordRef: action.recordRef,
          consultationId: action.consultationId,
          error: action.error,
        },
      };
    }

    case 'POLICY_START': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        policyState: { status: 'loading', policy: null, error: null },
      };
    }

    case 'POLICY_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      const status: BoundSourceStatus =
        action.policy.status === 'ready'
          ? 'ready'
          : action.policy.status === 'not_configured'
            ? 'not_configured'
            : 'error';
      return {
        ...state,
        currentPolicy: action.policy,
        policyState: { status, policy: action.policy, error: null },
      };
    }

    case 'POLICY_ERROR': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        policyState: {
          status: action.status ?? 'error',
          policy: null,
          error: action.error,
        },
      };
    }

    case 'EVALUATIONS_LIST_START': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        evaluationsState: { status: 'loading', list: null, error: null },
      };
    }

    case 'EVALUATIONS_LIST_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      const status: BoundSourceStatus =
        action.list.status === 'ready'
          ? 'ready'
          : action.list.status === 'not_configured'
            ? 'not_configured'
            : 'error';
      return {
        ...state,
        evaluationsList: action.list,
        evaluationsState: { status, list: action.list, error: null },
      };
    }

    case 'EVALUATIONS_LIST_ERROR': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        evaluationsState: {
          status: action.status ?? 'error',
          list: null,
          error: action.error,
        },
      };
    }

    case 'EVALUATION_READ_START': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        selectedEvaluation: {
          ...INITIAL_EVALUATION_DETAIL_STATE,
          status: 'loading',
          evaluationRef: action.evaluationRef,
        },
      };
    }

    case 'EVALUATION_READ_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      const res = action.result;
      if (res.status === 'ready') {
        return {
          ...state,
          selectedEvaluation: {
            status: 'ready',
            evaluationRef: res.descriptor.evaluationRef,
            descriptor: res.descriptor,
            document: res.document,
            observedRevision: null,
            error: null,
          },
        };
      }
      return {
        ...state,
        selectedEvaluation: {
          status: res.status,
          evaluationRef: res.evaluationRef,
          descriptor: null,
          document: null,
          observedRevision: res.observedRevision,
          error: null,
        },
      };
    }

    case 'EVALUATION_READ_ERROR': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        selectedEvaluation: {
          ...INITIAL_EVALUATION_DETAIL_STATE,
          status: 'error',
          evaluationRef: action.evaluationRef,
          error: action.error,
        },
      };
    }

    case 'EVALUATIONS_COMPARE_START': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        comparisonState: { status: 'loading', comparison: null, cursor: null, error: null },
      };
    }

    case 'EVALUATIONS_COMPARE_COMMIT': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        evaluationsComparison: action.comparison,
        comparisonState: {
          status: 'ready',
          comparison: action.comparison,
          cursor: action.cursor ?? null,
          error: null,
        },
      };
    }

    case 'EVALUATIONS_COMPARE_ERROR': {
      if (!matchesContext(state, action.contextEpoch)) return state;
      return {
        ...state,
        comparisonState: {
          status: 'error',
          comparison: null,
          cursor: null,
          error: action.error,
        },
      };
    }

    default:
      return state;
  }
}
