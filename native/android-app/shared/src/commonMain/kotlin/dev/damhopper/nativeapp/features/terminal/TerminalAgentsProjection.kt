package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

enum class TerminalAgentsStatus {
    NEEDS_ATTENTION,
    WORKING,
    IDLE,
    UNKNOWN,
    UNAVAILABLE,
    PLATFORM_UNQUALIFIED,
    UNSUPPORTED,
}

sealed interface TerminalAgentsFilterSelection {
    data object All : TerminalAgentsFilterSelection
    data class Selected(val statuses: List<TerminalAgentsStatus>) : TerminalAgentsFilterSelection
}

data class TerminalAgentsPresentation(
    val status: TerminalAgentsStatus,
    val reason: BlockedReason?,
    val doneTurnEnded: Boolean,
    val source: AgentObservationSource,
    val coverageHint: String?,
)

data class TerminalAgentsRow(
    val target: TerminalAgentsTarget,
    val projectLabel: String,
    val profileLabel: String,
    val terminalTitle: String,
    val agentKind: AgentKind,
    val presentation: TerminalAgentsPresentation,
)

data class TerminalAgentsGroupKey(
    val workspace: WorkspaceFileOwner,
    val status: TerminalAgentsStatus,
    val reason: BlockedReason?,
)

data class TerminalAgentsGroup(
    val key: TerminalAgentsGroupKey,
    val projectLabel: String,
    val profileLabel: String,
    val members: List<TerminalAgentsRow>,
    val agentKinds: List<AgentKind>,
    val sources: List<AgentObservationSource>,
    val coverageHints: List<String>,
    val doneTurnEnded: Boolean,
)

data class TerminalAgentsCounts(
    val all: Int,
    val byStatus: Map<TerminalAgentsStatus, Int>,
)

data class TerminalAgentsProjection(
    val rows: List<TerminalAgentsRow>,
    val groups: List<TerminalAgentsGroup>,
    val counts: TerminalAgentsCounts,
    val filteredCount: Int,
)

interface TerminalAgentsProjector {
    fun rows(input: TerminalAgentsProjectionInput): List<TerminalAgentsRow>
    fun project(input: TerminalAgentsProjectionInput, selection: TerminalAgentsFilterSelection): TerminalAgentsProjection
    fun nextTarget(group: TerminalAgentsGroup, active: TerminalAgentsInstanceKey?): TerminalAgentsTarget?
}

interface TerminalAgentsFilterCodec {
    fun decode(raw: String?): TerminalAgentsFilterSelection
    fun encode(selection: TerminalAgentsFilterSelection): String
    fun normalize(statuses: List<TerminalAgentsStatus>): TerminalAgentsFilterSelection
}
