package dev.damhopper.nativeapp.features.host

/**
 * UI presentation state for the Usage analytics views.
 */
data class UsageUiState(
    val timeWindow: String = "30d",
    val bucket: String = "day",
    val modelFilter: String? = null,
    val summary: UsageSummaryResponse? = null,
    val isLoadingSummary: Boolean = false,
    val summaryError: String? = null,
    val sessions: List<SessionSummaryDto> = emptyList(),
    val nextCursor: String? = null,
    val isLoadingSessions: Boolean = false,
    val sessionsError: String? = null,
    val selectedSessionId: String? = null,
    val selectedSessionDetail: SessionDetailResponse? = null,
    val isLoadingDetail: Boolean = false,
    val settings: UsageSettingsResponse? = null,
    val setup: UsageSetupStatusResponse? = null,
    val health: UsageHealth? = null,
    val isDeleting: Boolean = false,
    val deleteError: String? = null,
    val knownModels: List<String> = emptyList(),
)
