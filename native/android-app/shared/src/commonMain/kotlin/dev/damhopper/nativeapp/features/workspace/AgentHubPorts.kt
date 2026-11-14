package dev.damhopper.nativeapp.features.workspace

import kotlinx.coroutines.flow.StateFlow

/**
 * Port providing read-only observation of the immutable AgentHubSnapshot.
 */
interface AgentHubSnapshotPort {
    val hubSnapshot: StateFlow<AgentHubSnapshot>
}

/**
 * Port for dispatching user actions to the Agent Hub authority.
 */
interface AgentHubActionPort {
    suspend fun dispatchAction(action: AgentHubAction)
}
