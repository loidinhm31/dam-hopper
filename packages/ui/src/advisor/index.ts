/**
 * Native Advisor module exports.
 */

export { AdvisorPanel, type AdvisorPanelProps } from './AdvisorPanel.js';
export {
  NativeAdvisorProvider,
  type NativeAdvisorProviderOptions,
} from './native-advisor-provider.js';
export type {
  AdvisorDataProvider,
  ProviderContextDescriptor,
  ProviderEvent,
  ProviderEventListener,
  ProviderKind,
} from './advisor-data-provider.js';
export {
  AdvisorError,
  type AdvisorErrorCode,
  type AdvisorStatusDto,
  type AdvisorSettingsDto,
  type AdvisorSettingsUpdateDto,
  type HistoryDiagnosticDto,
  type HistoryScanSummaryDto,
  type HistoryRefreshResultDto,
  type HistorySummaryQueryParams,
  type HistorySummaryParamsDto,
  type HistorySummaryMetricsDto,
  type HistorySummaryResultDto,
  type HistoryRowDto,
  type HistoryPageQueryParams,
  type HistoryPageParamsDto,
  type HistoryPageResultDto,
  type HistoryDetailParamsDto,
  type HistoryDetailResultDto,
  type HistoryMetricFiltersDto,
  type ProjectInventoryItemDto,
  type ProjectInventoryDto,
  type PolicyReadCurrentResultDto,
  type PolicyUpdateParamsDto,
  type AdvisorBackend,
  type AdvisorModelsParamsDto,
  type AdvisorModelOptionDto,
  type AdvisorModelsResultDto,
  type AdvisorPolicyV2,
  type EvaluationDescriptorDto,
  type EvaluationsListParamsDto,
  type EvaluationsListResultDto,
  type EvaluationsReadParamsDto,
  type EvaluationsReadResultDto,
  type EvaluationsCompareParamsDto,
  type EvaluationsCompareResultDto,
  type EvaluationDocumentV1,
  type ExecutionStatus,
  type OutcomeState,
  type OutcomeResult,
  type RatioMetric,
} from './advisor-types.js';
export {
  computeComparisonKey,
  computeProvenanceGroupKey,
  aggregateEvaluationGroups,
  type CandidateEvaluationSummary,
  type CandidateResponseSummary,
  type ComparableEvaluationGroup,
} from './evaluation-comparison-helpers.js';
export {
  type AppState,
  type AdvisorView,
  type ActivityScope,
  type BoundSourceStatus,
  type ViewerStatus,
  type DetailStatus,
  type UiHistoryFilters,
  type HistoryDetailState,
  type EvaluationDetailState,
  INITIAL_STATE,
  INITIAL_FILTERS,
  INITIAL_DETAIL_STATE,
  INITIAL_EVALUATION_DETAIL_STATE,
} from './app-state-types.js';
export { appReducer } from './app-state-reducer.js';
export type { AppAction } from './app-actions.js';
export {
  selectHistoryQuery,
  selectFilteredRecords,
  selectSelectedRow,
  extractDomainFilters,
  extractDomainQuery,
  formatProjectName,
  formatRatioPercent,
  type HistoryQueryResult,
} from './app-state-selectors.js';

// Component exports
export { PanelTabs, ADVISOR_VIEWS, type PanelTabsProps } from './components/PanelTabs.js';
export { DataControls, type DataControlsProps } from './components/DataControls.js';
export { StatusBanner, type StatusBannerProps } from './components/StatusBanner.js';
export { DiagnosticPanel, type DiagnosticPanelProps } from './components/DiagnosticPanel.js';
export { ActivityScopeControl, type ActivityScopeControlProps } from './components/ActivityScopeControl.js';
export { MetricRatio, type MetricRatioProps } from './components/MetricRatio.js';
export { PaginationControls, type PaginationControlsProps } from './components/PaginationControls.js';
export { PolicySummaryCard, type PolicySummaryCardProps } from './components/PolicySummaryCard.js';
export { RouteGroupCard, type RouteGroupCardProps } from './components/RouteGroupCard.js';
export { ScoreProvenanceCard, type ScoreProvenanceCardProps } from './components/ScoreProvenanceCard.js';
export { TextBlock, sanitizeTextContent, type TextBlockProps } from './components/TextBlock.js';
export { CandidatePerformanceTable, type CandidatePerformanceTableProps } from './components/CandidatePerformanceTable.js';
export { ComparableGroupsSection, type ComparableGroupsSectionProps } from './components/ComparableGroupsSection.js';
export { EvaluationDescriptorCard, type EvaluationDescriptorCardProps } from './components/EvaluationDescriptorCard.js';
export { EvaluationDescriptorsSection, type EvaluationDescriptorsSectionProps } from './components/EvaluationDescriptorsSection.js';
export { EvaluationGroupCard, type EvaluationGroupCardProps } from './components/EvaluationGroupCard.js';
export { EvaluationsHeader, type EvaluationsHeaderProps } from './components/EvaluationsHeader.js';

// View exports
export { OverviewView, type OverviewViewProps } from './views/OverviewView.js';
export { HistoryView, type HistoryViewProps } from './views/HistoryView.js';
export { HistoryDetail, type HistoryDetailProps } from './views/HistoryDetail.js';
export { ConfigurationView, type ConfigurationViewProps } from './views/ConfigurationView.js';
export { EvaluationsView, type EvaluationsViewProps } from './views/EvaluationsView.js';
export { EvaluationDetail, type EvaluationDetailProps } from './views/EvaluationDetail.js';

// Routing policy validation exports
export {
  ENABLED_BACKENDS,
  CUSTOM_MODEL_SENTINEL,
  BACKEND_EFFORTS,
  DEFAULT_BACKEND_EFFORT,
  isKnownBackend,
  isValidEffortForBackend,
  validateRoute,
  validateRoutingDraft,
  isDraftDirty,
  createDraftFromPolicy,
  type RouteDraft,
  type PolicyRoutingDraft,
  type RoutingValidationResult,
} from './policy-routing-validation.js';
