/**
 * Advisor UI state selectors and formatting helpers.
 */

import type { AppState, UiHistoryFilters } from './app-state-types.js';
import type {
  HistoryRowDto,
  HistoryMetricFiltersDto,
  HistorySummaryQueryParams,
} from './advisor-types.js';

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export type HistoryQueryResult =
  | { readonly available: true; readonly query: HistorySummaryQueryParams; readonly reason: null }
  | { readonly available: false; readonly query: null; readonly reason: string };

export function selectHistoryQuery(state: AppState): HistoryQueryResult {
  if (!state.isAvailable) {
    return { available: false, query: null, reason: 'Advisor history source is unavailable' };
  }

  if (state.activityScope === 'all') {
    return {
      available: true,
      query: {
        projectId: null,
        taskRunId: state.filters.taskRunId ?? null,
        filters: extractDomainFilters(state.filters),
      },
      reason: null,
    };
  }

  // Workspace project scope
  const projectId = state.projectId?.trim() ?? null;
  if (!projectId) {
    return {
      available: false,
      query: null,
      reason: 'No active project selected. Select a project or view All Projects.',
    };
  }

  if (!SHA256_HEX_PATTERN.test(projectId)) {
    return {
      available: false,
      query: null,
      reason: 'Unresolved Workspace project ID hash',
    };
  }

  return {
    available: true,
    query: {
      projectId,
      taskRunId: state.filters.taskRunId ?? null,
      filters: extractDomainFilters(state.filters),
    },
    reason: null,
  };
}

export function selectFilteredRecords(
  state: AppState,
): readonly HistoryRowDto[] {
  return state.historyPageEntries;
}

export function selectSelectedRow(
  state: AppState,
): HistoryRowDto | null {
  if (!state.selectedConsultationId) return null;
  return (
    state.historyPageEntries.find(
      (r) => r.consultationId === state.selectedConsultationId,
    ) ?? null
  );
}

export function extractDomainFilters(filters: UiHistoryFilters): HistoryMetricFiltersDto {
  return {
    statuses: filters.statuses,
    outcomeStates: filters.outcomeStates,
    outcomeResults: filters.outcomeResults,
    backends: filters.backends,
    models: filters.models,
    efforts: filters.efforts,
    promptIdentities: filters.promptIdentities,
    buildIdentities: filters.buildIdentities,
    startedAtFrom: filters.startedAtFrom,
    startedAtTo: filters.startedAtTo,
  };
}

export function extractDomainQuery(
  filters: UiHistoryFilters,
  projectId: string | null = null,
): HistorySummaryQueryParams {
  return {
    projectId,
    taskRunId: filters.taskRunId ?? null,
    filters: extractDomainFilters(filters),
  };
}

export function formatProjectName(projectId: string, label?: string | null): string {
  if (label && label.trim().length > 0) {
    return label.trim();
  }
  return projectId.length > 8 ? `${projectId.slice(0, 8)}…` : projectId;
}

export function formatRatioPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return `${(value * 100).toFixed(1)}%`;
}
