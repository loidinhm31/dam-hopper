package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.flow.StateFlow

interface TerminalAgentsFilterStore {
    fun load(): TerminalAgentsFilterSelection
    fun save(selection: TerminalAgentsFilterSelection)
}

data class TerminalAgentsActivationReceipt(
    val requestId: Long,
    val result: TerminalAgentsActivationResult,
)

sealed interface TerminalAgentsActivationResult {
    data object Committed : TerminalAgentsActivationResult
    data class Deferred(val requestId: Long) : TerminalAgentsActivationResult
    data class Refused(val reason: String) : TerminalAgentsActivationResult
}

data class TerminalAgentsState(
    val projection: TerminalAgentsProjection,
    val filter: TerminalAgentsFilterSelection,
    val loading: Boolean,
    val refreshNotice: String?,
    val lastActivation: TerminalAgentsActivationReceipt?,
)

interface RetainedTerminalAgentsService {
    val state: StateFlow<TerminalAgentsState>
    val inventories: StateFlow<Map<TerminalAgentsRuntimeKey, TerminalAgentsInventoryReceipt>>
    fun registerWorkspace(owner: WorkspaceFileOwner): TerminalAgentsRegistration
    fun closeWorkspace(registration: TerminalAgentsRegistration)
    suspend fun refreshInventory(
        runtime: TerminalAgentsRuntimeKey,
        reason: TerminalAgentsRefreshReason,
    ): TerminalAgentsInventoryReceipt?
    fun publishWorkspaceTabs(
        registration: TerminalAgentsRegistration,
        receipt: TerminalAgentsInventoryReceipt,
        visibleTabs: List<TerminalSessionDetailed>,
        excludedTerminalIds: Set<String>,
    )
    fun setFilter(selection: TerminalAgentsFilterSelection)
    suspend fun activate(target: TerminalAgentsTarget): TerminalAgentsActivationReceipt
}
