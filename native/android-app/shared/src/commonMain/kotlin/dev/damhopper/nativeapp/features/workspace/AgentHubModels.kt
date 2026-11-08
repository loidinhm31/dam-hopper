package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.FilesystemTargetRef
import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentState
import dev.damhopper.nativeapp.features.terminal.BlockedReason
import dev.damhopper.nativeapp.features.terminal.TurnOutcome
import dev.damhopper.nativeapp.features.terminal.UncertainCreateRecord
import kotlinx.serialization.Serializable

/**
 * Single terminal session row presented in the Agent Hub.
 */
@Serializable
data class HubTerminalRow(
    val id: String,
    val displayName: String,
    val command: String,
    val projectTarget: ProjectTargetRef? = null,
    val incarnation: ULong = 0uL,
    val alive: Boolean = true,
    val exitCode: Int? = null,
    val isPinned: Boolean = false,
    val isHidden: Boolean = false,
    val hasPendingAttention: Boolean = false,
    val agentSession: HubAgentRow? = null,
)

/**
 * Observed agent state row associated with a terminal.
 */
@Serializable
data class HubAgentRow(
    val terminalId: String,
    val agentKind: AgentKind,
    val agentSessionId: String,
    val state: AgentState,
    val reason: BlockedReason? = null,
    val lastOutcome: TurnOutcome? = null,
    val turnId: String? = null,
    val attentionRevision: ULong = 0uL,
)

/**
 * Immutable view snapshot of the Agent Hub root state.
 */
data class AgentHubSnapshot(
    val profileId: ProfileId? = null,
    val selectedProjectTarget: ProjectTargetRef? = null,
    val zeroSessionOpenTargets: List<ProjectTargetRef> = emptyList(),
    val terminalRows: List<HubTerminalRow> = emptyList(),
    val pinnedTerminalIds: Set<String> = emptySet(),
    val hiddenTerminalIds: Set<String> = emptySet(),
    val pendingCreateIntents: List<UncertainCreateRecord> = emptyList(),
    val isInventoryLoaded: Boolean = false,
    val isConnected: Boolean = true,
    val unsupportedNotice: String? = null,
) {
    val activeTerminals: List<HubTerminalRow>
        get() = terminalRows.filter { !it.isHidden }

    val hiddenTerminals: List<HubTerminalRow>
        get() = terminalRows.filter { it.isHidden }

    val pinnedTerminals: List<HubTerminalRow>
        get() = terminalRows.filter { it.isPinned }
}

/**
 * Explicit action requests for the Agent Hub.
 */
sealed class AgentHubAction {
    data class SelectProjectTarget(val target: ProjectTargetRef?) : AgentHubAction()
    data class OpenZeroSessionProject(val target: ProjectTargetRef) : AgentHubAction()
    data class DismissZeroSessionProject(val target: ProjectTargetRef) : AgentHubAction()
    data class SelectTerminal(val terminalId: String, val profileId: ProfileId? = null) : AgentHubAction()
    data class CreateTerminalIntent(val target: ProjectTargetRef?, val command: String? = null) : AgentHubAction()
    data class HideTerminal(val terminalId: String, val profileId: ProfileId? = null) : AgentHubAction() // Local Close View, NOT remote kill
    data class ReopenTerminal(val terminalId: String, val profileId: ProfileId? = null) : AgentHubAction()
    data class PinTerminal(val terminalId: String, val pinned: Boolean, val profileId: ProfileId? = null) : AgentHubAction()
    data class TerminateTerminal(
        val terminalId: String,
        val expectedServerEpoch: String,
        val expectedIncarnation: String,
        val profileId: ProfileId? = null,
    ) : AgentHubAction() // Guarded POST /api/terminal/:id/terminate
    data class OpenFiles(val target: FilesystemTargetRef) : AgentHubAction()
    data class OpenEditor(val fileRef: String, val target: FilesystemTargetRef? = null) : AgentHubAction()
    data class OpenGit(val target: ProjectTargetRef) : AgentHubAction()
    data class OpenSettings(val targetCategory: String? = null) : AgentHubAction()
    object OpenNotifications : AgentHubAction()
    object HandleBackPressed : AgentHubAction()
}
