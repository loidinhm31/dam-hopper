package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

data class TerminalAgentsRuntimeKey(
    val connection: ConnectionRef,
    val socket: SocketInstanceRef,
    val attachmentIncarnation: Long,
    val endpoint: String,
    val accountUser: String,
)

data class TerminalAgentsInstanceKey(
    val profileId: String,
    val terminalId: String,
    val incarnation: ULong,
)

data class TerminalAgentsRegistration(
    val owner: WorkspaceFileOwner,
    val registrationId: Long,
    val order: Long,
)

data class TerminalAgentsInventoryReceipt(
    val runtime: TerminalAgentsRuntimeKey,
    val requestTicket: Long,
    val invalidationRevision: Long,
    val sessions: List<TerminalSessionDetailed>,
)

data class TerminalAgentsWorkspaceSnapshot(
    val registration: TerminalAgentsRegistration,
    val runtime: TerminalAgentsRuntimeKey,
    val inventoryTicket: Long,
    val visibleTabs: List<TerminalSessionDetailed>,
    val excludedTerminalIds: Set<String>,
)

data class TerminalAgentsTarget(
    val registration: TerminalAgentsRegistration,
    val runtime: TerminalAgentsRuntimeKey,
    val instance: TerminalAgentsInstanceKey,
    val serverEpoch: ULong?,
    val statusAuthorityRevision: Long,
)

enum class TerminalAgentsRefreshReason {
    CONNECTED,
    FOREGROUND,
    SIDEBAR_OPENED,
    USER_RETRY,
    TERMINAL_LIFECYCLE,
    AGENT_MEMBERSHIP_CHANGED,
    ACTIVATION_VALIDATION,
    POST_GUARD_VALIDATION,
}

enum class TerminalAgentsInventoryHealth {
    CURRENT,
    REFRESHING,
    UNAVAILABLE,
    CONFLICT,
}

enum class TerminalAgentsAvailability {
    READY,
    UNAVAILABLE,
    PLATFORM_UNQUALIFIED,
    UNSUPPORTED,
}

enum class TerminalAgentsSnapshotFailure {
    HTTP_NOT_FOUND,
    OTHER,
}

data class TerminalAgentsRuntimeSnapshot(
    val runtime: TerminalAgentsRuntimeKey,
    val isCurrentIdentity: Boolean,
    val isCurrentConnectedSocket: Boolean,
    val inventoryHealth: TerminalAgentsInventoryHealth,
    val inventory: TerminalAgentsInventoryReceipt?,
    val statusBaselineInstalled: Boolean,
    val statusAuthorityRevision: Long,
    val status: AgentStatusState,
    val snapshotFailure: TerminalAgentsSnapshotFailure?,
    val cachedObservations: List<TerminalAgentStatusRow>,
)

data class TerminalAgentsProjectionInput(
    val workspaces: List<TerminalAgentsWorkspaceSnapshot>,
    val runtimes: List<TerminalAgentsRuntimeSnapshot>,
    val profileLabels: Map<String, String>,
)
