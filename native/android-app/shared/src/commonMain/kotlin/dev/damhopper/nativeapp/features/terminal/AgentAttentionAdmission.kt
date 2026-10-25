package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef

// Accepted live attention boundary (C3) and runtime readiness handoff (C3a). Terminal wire DTOs stay in
// TerminalModels.kt unchanged.

/**
 * An attention event that passed the owner/socket-bound reducer: baseline installed, contiguous connection
 * revision, matching row/attention identity, revision above both the row and the retained high-water.
 * Only the retained runtime owner may hand this to the notification coordinator.
 */
data class AcceptedLiveAttention(
    val owner: ConnectionRef,
    val socket: SocketInstanceRef,
    val serverEpoch: ULong,
    val revision: ULong,
    val row: TerminalAgentStatusRow,
    val attention: AgentAttentionEvent,
)

/**
 * Reducer verdict for `applyStatusChanged(owner, socket, msg)`.
 * [Accepted] may produce effects; [Silent] never does (baseline/uninstalled, stale, malformed, duplicate);
 * [Reconcile] closes alert admission until the retained runtime re-installs a fresh owner/socket-bound
 * snapshot silently (no catch-up alerts).
 */
sealed interface AgentAdmission {
    data class Accepted(val event: AcceptedLiveAttention) : AgentAdmission
    data object Silent : AgentAdmission
    data object Reconcile : AgentAdmission
}

/**
 * Exact runtime an event belongs to. Captured by the runtime BEFORE reducer suspension and passed unchanged
 * with [AgentAdmission.Accepted]; preference source A and Settings target B can never stand in for it,
 * and a matching profile with a different generation/socket/path revision is a different owner.
 */
data class IntegrationOwner(
    val owner: ConnectionRef,
    val socket: SocketInstanceRef,
    val endpoint: String,
    val accountId: String,
    val pathConfigRevision: Long,
)

enum class IntegrationReadinessState { UNKNOWN, UNAVAILABLE, VERIFIED }

/**
 * Immutable owner+path-revision-qualified result built from authoritative path/status calls (never row
 * labels or Android path probes). [IntegrationReadinessState.VERIFIED] is the only state that may authorize
 * an effect.
 */
data class IntegrationReadiness(
    val owner: IntegrationOwner,
    val agent: AgentKind,
    val state: IntegrationReadinessState,
    val paths: AgentPathsVerification?,
    val omp: ExtensionStatusReport?,
    val integration: NativeIntegrationStatusReport?,
)

/**
 * Runtime readiness/effect gate (implemented by the retained VM in Phase04).
 *
 * - [current] is a display snapshot only, never effect authorization.
 * - [withVerified] runs the synchronous [effect] (history/post/audio) only if, under the provider's single
 *   readiness/effect mutex, the exact key is current, VERIFIED and the registry still lists the owner (read
 *   from `registry.connectionsState.value`, which omits pending/failed retirement). Returns whether it ran.
 * - [invalidate] advances the revision to UNKNOWN/UNAVAILABLE, awaits the prior admitted effect, runs [effect]
 *   (old-owner prune/cancel/audio cleanup), attempts all cleanup even after failures and propagates the aggregate.
 *
 * Transitive restriction: no callback or awaited work may re-enter the profile repository or the connection
 * registry (the caller may hold the profile mutex through the whole drain), and none may use the network.
 */
interface IntegrationReadinessProvider {
    fun current(owner: IntegrationOwner, agent: AgentKind): IntegrationReadiness?
    suspend fun withVerified(owner: IntegrationOwner, agent: AgentKind, effect: (IntegrationReadiness) -> Unit): Boolean
    suspend fun invalidate(owner: ConnectionRef, effect: () -> Unit)
}
