package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.features.terminal.RetainedTerminalAgentsService
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationResult
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterCodec
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterStore
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInventoryReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsMembership
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsProjectionInput
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsProjector
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRegistration
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsTarget
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * The ONE retained Agents service (constructed once by the retained ViewModel in the retained runtime scope; no
 * Activity/composable scope is held). It composes the owner-qualified inventory coordinator, the retained activation
 * coordinator, the pure projector and the dedicated device-local filter store:
 *
 * - [state] is recomputed from [TerminalAgentsInventoryCoordinator.snapshotInput] whenever inventory, reducer
 *   mirrors, the filter or the shown activation receipt change; a roster projection never emits attention and never
 *   touches notification delivery or admission.
 * - [inventories] is the accepted current-owner receipt stream that terminal screens consume instead of fetching
 *   their own full server lists.
 * - Filter writes happen only through [setFilter] (a user action); construction merely loads.
 */
class RetainedTerminalAgentsCoordinator(
    private val scope: CoroutineScope,
    private val inventory: TerminalAgentsInventoryCoordinator,
    private val activation: TerminalAgentsActivationCoordinator,
    private val projector: TerminalAgentsProjector,
    private val filterStore: TerminalAgentsFilterStore,
    private val codec: TerminalAgentsFilterCodec,
    private val profileLabels: () -> Map<String, String>,
) : RetainedTerminalAgentsService, AutoCloseable {

    private val filter = MutableStateFlow(filterStore.load())
    private val shownActivation = MutableStateFlow<TerminalAgentsActivationReceipt?>(null)

    private val _state = MutableStateFlow(
        TerminalAgentsState(
            projection = projector.project(
                TerminalAgentsProjectionInput(emptyList(), emptyList(), emptyMap()),
                filter.value,
            ),
            filter = filter.value,
            loading = false,
            refreshNotice = null,
            lastActivation = null,
        ),
    )
    override val state: StateFlow<TerminalAgentsState> = _state.asStateFlow()

    override val inventories: StateFlow<Map<TerminalAgentsRuntimeKey, TerminalAgentsInventoryReceipt>> = inventory.inventories

    /** Request currently validating or waiting behind the dirty prompt (drives the sidebar's pending indicator). */
    val pendingActivationId: StateFlow<Long?> get() = activation.pendingRequestId

    private val jobs: List<Job> = listOf(
        scope.launch { activation.lastActivation.collect { shownActivation.value = it } },
        scope.launch {
            combine(inventory.changes, filter, shownActivation) { _, selection, shown -> selection to shown }
                .collect { (selection, shown) -> recompute(selection, shown) }
        },
    )

    private fun recompute(selection: TerminalAgentsFilterSelection, shown: TerminalAgentsActivationReceipt?) {
        val snapshot = inventory.snapshotInput(profileLabels())
        // The pure join reports contradictory accepted metadata; feed it into the runtime's inventory health.
        val membership = TerminalAgentsMembership.join(snapshot.input)
        membership.conflicts.map { it.runtime }.distinct().forEach { inventory.markConflict(it) }
        val projection = projector.project(snapshot.input, selection)
        val refusal = (shown?.result as? TerminalAgentsActivationResult.Refused)?.reason
        _state.value = TerminalAgentsState(
            projection = projection,
            filter = selection,
            loading = snapshot.refreshing,
            refreshNotice = refusal ?: snapshot.notices.firstOrNull(),
            lastActivation = shown,
        )
    }

    override fun registerWorkspace(owner: WorkspaceFileOwner): TerminalAgentsRegistration =
        inventory.registerWorkspace(owner)

    override fun closeWorkspace(registration: TerminalAgentsRegistration) = inventory.closeWorkspace(registration)

    override suspend fun refreshInventory(
        runtime: TerminalAgentsRuntimeKey,
        reason: TerminalAgentsRefreshReason,
    ): TerminalAgentsInventoryReceipt? {
        if (reason == TerminalAgentsRefreshReason.USER_RETRY) shownActivation.value = null
        return inventory.refresh(runtime, reason)
    }

    /** Refreshes every currently attached, connected runtime (foreground, sidebar open, manual retry). */
    fun refreshAll(reason: TerminalAgentsRefreshReason) {
        if (reason == TerminalAgentsRefreshReason.USER_RETRY) shownActivation.value = null
        for (runtime in inventory.currentRuntimeKeys()) {
            scope.launch { inventory.refresh(runtime, reason) }
        }
    }

    override fun publishWorkspaceTabs(
        registration: TerminalAgentsRegistration,
        receipt: TerminalAgentsInventoryReceipt,
        visibleTabs: List<TerminalSessionDetailed>,
        excludedTerminalIds: Set<String>,
    ) = inventory.publishWorkspaceTabs(registration, receipt, visibleTabs, excludedTerminalIds)

    override fun setFilter(selection: TerminalAgentsFilterSelection) {
        val normalized = when (selection) {
            TerminalAgentsFilterSelection.All -> selection
            is TerminalAgentsFilterSelection.Selected -> codec.normalize(selection.statuses)
        }
        filter.value = normalized
        // A user action only; a storage failure keeps the process-local selection (the store never throws).
        filterStore.save(normalized)
    }

    override suspend fun activate(target: TerminalAgentsTarget): TerminalAgentsActivationReceipt =
        activation.activate(target)

    /** Spends every live activation (ordinary navigation, retirement or teardown). */
    fun cancelPendingActivations(reason: String) = activation.cancelPending(reason)

    override fun close() {
        activation.cancelPending("Agents service closed.")
        jobs.forEach { it.cancel() }
        inventory.clear()
    }
}
