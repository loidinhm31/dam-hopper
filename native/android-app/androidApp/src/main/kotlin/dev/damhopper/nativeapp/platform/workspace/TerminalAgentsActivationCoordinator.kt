package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.core.transport.WsSocketAdmission
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.profiles.ProfileRouteAdmission
import dev.damhopper.nativeapp.features.terminal.AgentRouteAdmission
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationResult
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInventoryReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsMembership
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsTarget
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.TerminalRouteGate
import dev.damhopper.nativeapp.ui.flow.VerifiedTerminalRoute
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.CoroutineContext

/**
 * Retained panel/session seam of an admitted route. [canCommit] and [commit] run on Main inside every held gate:
 * [commit] is mutation-only (no logging, callbacks, attach, controller creation or IO); [afterCommit] applies the
 * ordinary input-policy/attachment effects AFTER all gates were released.
 */
interface TerminalAgentsSelectionPort {
    fun canCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey): Boolean
    fun commit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey)
    fun afterCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey)
}

/** The two independent try-gates below the roster gate; replaceable only so tests can contend each one. */
interface TerminalAgentsAdmissionGates {
    fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission

    fun admitReducer(
        reducer: AgentStatusReducer,
        owner: ConnectionRef,
        socket: SocketInstanceRef,
        expectedEpoch: ULong?,
        expectedAuthorityRevision: Long,
        commit: () -> Boolean,
    ): AgentRouteAdmission
}

/** The real captured-object gates (`WsConnection.lifecycleMutex.tryLock`, reducer mutex `tryLock`). */
object RealTerminalAgentsAdmissionGates : TerminalAgentsAdmissionGates {
    override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission =
        ws.tryAdmitCurrentSocket(expected, commit)

    override fun admitReducer(
        reducer: AgentStatusReducer,
        owner: ConnectionRef,
        socket: SocketInstanceRef,
        expectedEpoch: ULong?,
        expectedAuthorityRevision: Long,
        commit: () -> Boolean,
    ): AgentRouteAdmission =
        reducer.tryAdmitTerminalAgentsRoute(owner, socket, expectedEpoch, expectedAuthorityRevision, commit)
}

/**
 * Retained manual activation of a roster [TerminalAgentsTarget].
 *
 * 1. Capture + validate the exact target (attachment object/token, socket, registration) - no side effects.
 * 2. `ACTIVATION_VALIDATION` fresh inventory, then the departure guard WITHOUT any selection effect.
 * 3. PROCEED commits with that fresh evidence; DEFERRED returns `Deferred(requestId)`, and only after the user
 *    confirms a NEW inventory request (`POST_GUARD_VALIDATION`) is started - never a pre-confirmation receipt.
 * 4. Final local transaction on Main: await profile mutex -> await registry admission -> TRY roster gate -> TRY the
 *    captured socket gate -> TRY the captured reducer gate. BUSY/STALE at any step is an explicit Refused with no
 *    route/profile/session mutation. The admitted leaf marks the request COMMITTING, writes the retained panel/session,
 *    the flow route and the active profile, and installs the Committed receipt - the local linearization point. Later
 *    cancellation, replacement or persistence failure can never rewrite it.
 *
 * Notification routing, admission, read state and auto-switch semantics are not involved.
 */
class TerminalAgentsActivationCoordinator(
    private val scope: CoroutineScope,
    private val inventory: TerminalAgentsInventoryCoordinator,
    private val flow: AppFlowNavigation,
    private val profiles: ProfileRepository,
    private val selection: TerminalAgentsSelectionPort,
    private val mainContext: CoroutineContext,
    private val gates: TerminalAgentsAdmissionGates = RealTerminalAgentsAdmissionGates,
    private val validationTimeoutMs: Long = VALIDATION_TIMEOUT_MS,
) {
    private enum class RequestState { LIVE, COMMITTING, COMMITTED, REFUSED, CANCELLED }

    private class Request(val id: Long, val target: TerminalAgentsTarget) {
        var state = RequestState.LIVE
        var deferred = false
        var confirmed = false
        var receipt: TerminalAgentsActivationReceipt? = null
        var refusal: String? = null
        var activatingJob: Job? = null
    }

    private var requestSeq = 0L
    private val requests = HashMap<Long, Request>()
    private val _lastActivation = MutableStateFlow<TerminalAgentsActivationReceipt?>(null)

    /** The latest terminal (Committed/Refused) receipt of any request; consumers match it by request id. */
    val lastActivation: StateFlow<TerminalAgentsActivationReceipt?> = _lastActivation.asStateFlow()

    private val _pendingRequestId = MutableStateFlow<Long?>(null)

    /** The one live request that has not reached a terminal state (validating or awaiting the dirty prompt). */
    val pendingRequestId: StateFlow<Long?> = _pendingRequestId.asStateFlow()

    suspend fun activate(target: TerminalAgentsTarget): TerminalAgentsActivationReceipt {
        val request = inventory.underRosterGate {
            // A newer request supersedes older deferred work; an already-open dirty prompt is never overwritten.
            cancelLiveLocked("Superseded by a newer Agents request.")
            Request(++requestSeq, target).also {
                requests[it.id] = it
                _pendingRequestId.value = it.id
            }
        }
        request.activatingJob = currentCoroutineContext()[Job]
        return try {
            run(request)
        } catch (ce: CancellationException) {
            cancel(request, "Agents activation was cancelled.")
            throw ce
        }
    }

    /** Spends every live request (ordinary navigation requested, retirement or teardown); committing ones stay. */
    fun cancelPending(reason: String) {
        inventory.underRosterGate { cancelLiveLocked(reason) }
    }

    private fun cancelLiveLocked(reason: String) {
        for (request in requests.values.toList()) {
            if (request.state == RequestState.LIVE) finishLocked(request, RequestState.CANCELLED, reason)
        }
    }

    private fun cancel(request: Request, reason: String) {
        inventory.underRosterGate { if (request.state == RequestState.LIVE) finishLocked(request, RequestState.CANCELLED, reason) }
    }

    private fun refuse(request: Request, reason: String): TerminalAgentsActivationReceipt =
        inventory.underRosterGate {
            if (request.state == RequestState.LIVE) finishLocked(request, RequestState.REFUSED, reason)
            request.receipt ?: TerminalAgentsActivationReceipt(request.id, TerminalAgentsActivationResult.Refused(reason))
        }

    /** Locked: moves a LIVE request to a terminal Refused state exactly once and publishes its receipt. */
    private fun finishLocked(request: Request, state: RequestState, reason: String) {
        val receipt = TerminalAgentsActivationReceipt(request.id, TerminalAgentsActivationResult.Refused(reason))
        request.state = state
        request.receipt = receipt
        _lastActivation.value = receipt
        if (_pendingRequestId.value == request.id) _pendingRequestId.value = null
        requests.remove(request.id)
    }

    private fun isSpent(request: Request): Boolean = inventory.underRosterGate { request.state != RequestState.LIVE }

    private fun routeOf(target: TerminalAgentsTarget): VerifiedTerminalRoute {
        val owner = target.registration.owner
        return VerifiedTerminalRoute(
            profileId = target.instance.profileId,
            project = owner.project,
            worktreePath = owner.worktreePath,
            sessionId = target.instance.terminalId,
            incarnation = target.instance.incarnation,
            notificationRouteActive = false,
        )
    }

    private suspend fun run(request: Request): TerminalAgentsActivationReceipt {
        val target = request.target
        precheck(request)?.let { return refuse(request, it) }
        val fresh = fetchFresh(target, TerminalAgentsRefreshReason.ACTIVATION_VALIDATION)
            ?: return refuse(request, FRESH_UNAVAILABLE)
        validateMetadata(request, fresh)?.let { return refuse(request, it) }
        if (isSpent(request)) return request.receipt ?: refuse(request, SPENT)

        val gate = withContext(mainContext) {
            flow.requestVerifiedTerminalRoute(
                route = routeOf(target),
                onProceed = { onConfirmed(request) },
                onCancelled = { cancel(request, "The departure confirmation was cancelled.") },
            )
        }
        return when (gate) {
            TerminalRouteGate.PROCEED -> commit(request, fresh)
            TerminalRouteGate.DEFERRED -> markDeferred(request)
        }
    }

    private fun markDeferred(request: Request): TerminalAgentsActivationReceipt {
        var launchNow = false
        val receipt = inventory.underRosterGate {
            if (request.state != RequestState.LIVE) return@underRosterGate request.receipt!!
            request.deferred = true
            launchNow = request.confirmed
            TerminalAgentsActivationReceipt(request.id, TerminalAgentsActivationResult.Deferred(request.id))
        }
        if (launchNow) launchConfirmed(request)
        return receipt
    }

    /** User confirmed the departure prompt (Main): the continuation of a spent request is inert. */
    private fun onConfirmed(request: Request) {
        val launch = inventory.underRosterGate {
            if (request.state != RequestState.LIVE) return@underRosterGate false
            request.confirmed = true
            request.deferred
        }
        if (launch) launchConfirmed(request)
    }

    private fun launchConfirmed(request: Request) {
        val job = scope.launch {
            request.activatingJob = coroutineContext[Job]
            try {
                // A NEW inventory request STARTS after the confirmation; no pre-dialog receipt is ever reused.
                val fresh = fetchFresh(request.target, TerminalAgentsRefreshReason.POST_GUARD_VALIDATION)
                    ?: run { refuse(request, FRESH_UNAVAILABLE); return@launch }
                val problem = precheck(request) ?: validateMetadata(request, fresh)
                if (problem != null) {
                    refuse(request, problem)
                    return@launch
                }
                if (!isSpent(request)) commit(request, fresh)
            } catch (ce: CancellationException) {
                cancel(request, "Agents activation was cancelled.")
                throw ce
            }
        }
    }

    private suspend fun fetchFresh(target: TerminalAgentsTarget, reason: TerminalAgentsRefreshReason): TerminalAgentsInventoryReceipt? {
        val receipt = withTimeoutOrNull(validationTimeoutMs) { inventory.refresh(target.runtime, reason) } ?: return null
        return receipt.takeIf { it.runtime == target.runtime }
    }

    /** Null when the captured target still names a live registration/attachment/socket; else the refusal text. */
    private fun precheck(request: Request): String? = inventory.underRosterGate {
        val target = request.target
        when {
            request.state != RequestState.LIVE -> SPENT
            target.statusAuthorityRevision == TerminalAgentsMembership.NO_AUTHORITY ->
                "That agent list is out of date for this server connection. Refresh Agents and try again."
            !inventory.registrationLiveLocked(target.registration) -> "That workspace is no longer open."
            inventory.attachmentForLocked(target.runtime) == null ->
                "The server connection changed. Refresh Agents and try again."
            else -> null
        }
    }

    /** Pure: the fresh accepted inventory must still contain the exact live Traditional terminal of the workspace. */
    private fun validateMetadata(request: Request, fresh: TerminalAgentsInventoryReceipt): String? {
        val target = request.target
        val excluded = inventory.underRosterGate { inventory.excludedLocked(target.registration) }
        return metadataProblem(target, fresh, excluded)
    }

    private fun metadataProblem(target: TerminalAgentsTarget, fresh: TerminalAgentsInventoryReceipt, excluded: Set<String>): String? {
        val owner = target.registration.owner
        val matches = fresh.sessions.filter { it.id == target.instance.terminalId }
        if (matches.isEmpty()) return "That terminal no longer exists on the server."
        if (matches.size > 1) return "The terminal list contains conflicting duplicate entries. Refresh Agents and try again."
        val session = matches.single()
        return when {
            session.incarnation != target.instance.incarnation -> "That terminal was restarted."
            !session.alive -> "That terminal has exited."
            !TerminalAgentsMembership.isTraditionalType(session.sessionType) -> "That terminal is not a Traditional terminal."
            session.targetUnavailable -> "That terminal's project is unavailable."
            session.project != owner.project ||
                WorkspaceFileOwner.normalizeWorktree(session.worktreePath) != owner.normalizedWorktreePath ->
                "That terminal moved to another project or worktree."
            session.id in excluded -> "That terminal is being closed."
            else -> null
        }
    }

    private suspend fun commit(request: Request, fresh: TerminalAgentsInventoryReceipt): TerminalAgentsActivationReceipt {
        val target = request.target
        val owner = target.registration.owner
        val outcome = try {
            withContext(mainContext) {
                ensureActive()
                profiles.commitExistingProfileRoute(
                    connection = target.runtime.connection,
                    endpoint = target.runtime.endpoint,
                    accountUser = target.runtime.accountUser,
                ) { publishActiveProfile -> admitChain(request, fresh, publishActiveProfile) }
            }
        } catch (ce: CancellationException) {
            if (request.state != RequestState.COMMITTED) {
                cancel(request, "Agents activation was cancelled.")
            }
            throw ce
        }
        return when (outcome) {
            ProfileRouteAdmission.COMMITTED -> {
                val committed = request.receipt!!
                afterCommit(owner, target.instance)
                committed
            }
            ProfileRouteAdmission.BUSY -> refuse(request, BUSY_REFUSAL)
            ProfileRouteAdmission.STALE -> refuse(request, request.refusal ?: STALE_REFUSAL)
        }
    }

    /**
     * Inside the profile mutex and the registry admission: only non-blocking try-gates from here. No network, join,
     * persistence, logging or unknown callback; every gate is released in reverse order in `finally`.
     */
    private fun admitChain(request: Request, fresh: TerminalAgentsInventoryReceipt, publishActiveProfile: () -> Unit): ProfileRouteAdmission {
        val target = request.target
        if (!inventory.tryLockRoster()) return ProfileRouteAdmission.BUSY
        try {
            val att = inventory.attachmentForLocked(target.runtime)
            if (att == null) {
                request.refusal = "The server connection changed. Refresh Agents and try again."
                return ProfileRouteAdmission.STALE
            }
            val problem = lockedProblem(request, fresh, att)
            if (problem != null) {
                request.refusal = problem
                return ProfileRouteAdmission.STALE
            }
            var reducerBusy = false
            val socketResult = gates.admitSocket(att.binding.ws, target.runtime.socket) {
                val reducerResult = gates.admitReducer(
                    att.binding.reducer,
                    target.runtime.connection,
                    target.runtime.socket,
                    target.serverEpoch,
                    target.statusAuthorityRevision,
                ) { leaf(request, publishActiveProfile) }
                if (reducerResult == AgentRouteAdmission.BUSY) reducerBusy = true
                reducerResult == AgentRouteAdmission.COMMITTED
            }
            return when {
                socketResult == WsSocketAdmission.COMMITTED -> ProfileRouteAdmission.COMMITTED
                reducerBusy || socketResult == WsSocketAdmission.BUSY -> ProfileRouteAdmission.BUSY
                else -> ProfileRouteAdmission.STALE
            }
        } finally {
            inventory.unlockRoster()
        }
    }

    /** Locked (roster gate held): every roster-side authority fact of the final admission. */
    private fun lockedProblem(request: Request, fresh: TerminalAgentsInventoryReceipt, att: TerminalAgentsAttachment): String? {
        val target = request.target
        val owner = target.registration.owner
        if (request.state != RequestState.LIVE) return SPENT
        if (!inventory.registrationLiveLocked(target.registration)) return "That workspace is no longer open."
        val current = inventory.currentReceiptLocked(att)
        if (current == null || current.runtime != fresh.runtime || current.requestTicket != fresh.requestTicket ||
            current.invalidationRevision != fresh.invalidationRevision
        ) {
            return "The terminal list changed while opening it. Try again."
        }
        metadataProblem(target, current, inventory.excludedLocked(target.registration))?.let { return it }
        if (!selection.canCommit(owner, target.instance)) return "That workspace is not available."
        return null
    }

    /** The bounded local linearization point; fixed mutation-only operations, no failure-capable work. */
    private fun leaf(request: Request, publishActiveProfile: () -> Unit): Boolean {
        if (request.state != RequestState.LIVE) return false
        if (request.activatingJob?.isActive == false) return false
        val target = request.target
        val owner = target.registration.owner
        request.state = RequestState.COMMITTING
        selection.commit(owner, target.instance)
        flow.commitVerifiedTerminalRoute(routeOf(target))
        publishActiveProfile()
        val receipt = TerminalAgentsActivationReceipt(request.id, TerminalAgentsActivationResult.Committed)
        request.receipt = receipt
        request.state = RequestState.COMMITTED
        _lastActivation.value = receipt
        if (_pendingRequestId.value == request.id) _pendingRequestId.value = null
        requests.remove(request.id)
        return true
    }

    /** After every gate was released: UI/controller policy and metadata persistence (cannot reclassify the receipt). */
    private suspend fun afterCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {
        withContext(mainContext) {
            val state = flow.state.value
            if (state.activeProfileId == instance.profileId && state.requiredTerminalInstance == instance) {
                selection.afterCommit(owner, instance)
            }
        }
        val profileId = instance.profileId
        scope.launch {
            try {
                profiles.persistActiveProfileIfCurrent(profileId)
            } catch (ce: CancellationException) {
                throw ce
            } catch (_: Throwable) {
                // Persistence is best-effort metadata; the committed route is already authoritative.
            }
        }
    }

    private companion object {
        const val TRADITIONAL = "traditional"
        const val VALIDATION_TIMEOUT_MS = 20_000L
        const val SPENT = "That Agents request was cancelled or replaced."
        const val FRESH_UNAVAILABLE = "The terminal list could not be refreshed. Check the connection and try again."
        const val BUSY_REFUSAL = "Terminal state is busy. Try again."
        const val STALE_REFUSAL = "The terminal changed before it could be opened."
    }
}
