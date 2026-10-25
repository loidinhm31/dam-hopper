package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.TerminalAgentStatusRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInventoryHealth
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInventoryReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsProjectionInput
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRegistration
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeSnapshot
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSnapshotFailure
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsWorkspaceSnapshot
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.locks.ReentrantLock

/**
 * The existing runtime of one already-connected profile as the Agents roster sees it: its WsConnection OBJECT, its
 * reducer, one `listDetailed` requester and the runtime's own scope (fetch jobs are its children and die with it).
 * [endpoint] MUST be the normalized endpoint and [accountUser] the authenticated server-returned account.
 */
class TerminalAgentsRuntimeBinding(
    val owner: ConnectionRef,
    val endpoint: String,
    val accountUser: String,
    val ws: WsConnection,
    val reducer: AgentStatusReducer,
    val scope: CoroutineScope,
    val listDetailed: suspend () -> List<TerminalSessionDetailed>,
)

/** Logical display-cache identity: profile + normalized endpoint + authenticated account (never generation/socket). */
data class TerminalAgentsLogicalOwner(val profileId: String, val endpoint: String, val accountUser: String)

internal class InventoryWaiter(val result: CompletableDeferred<TerminalAgentsInventoryReceipt?>)

/**
 * One attachment of a WsConnection OBJECT to the roster. [incarnation] is the monotonic host token allocated whenever
 * the connection object changes - even for the same ConnectionRef and an equal `sock-1` value - so old callbacks can
 * never publish, purge or route successor state. All mutable fields are guarded by the coordinator's roster gate.
 */
class TerminalAgentsAttachment internal constructor(
    val incarnation: Long,
    val binding: TerminalAgentsRuntimeBinding,
) {
    internal var socket: SocketInstanceRef? = null
    internal var revoked = false
    internal var revision = 0L
    internal var ticket = 0L
    internal var fetching = false
    internal var job: Job? = null
    internal var receipt: TerminalAgentsInventoryReceipt? = null
    internal var health = TerminalAgentsInventoryHealth.UNAVAILABLE
    internal val waiters = ArrayList<InventoryWaiter>()
    internal var seenAgents: Set<Pair<String, ULong>> = emptySet()

    val logical: TerminalAgentsLogicalOwner
        get() = TerminalAgentsLogicalOwner(binding.owner.profileId, binding.endpoint, binding.accountUser)
}

/** Everything one roster recomputation needs, captured atomically under the roster gate. */
class TerminalAgentsRosterSnapshot(
    val input: TerminalAgentsProjectionInput,
    val refreshing: Boolean,
    val notices: List<String>,
)

private class RegistrationEntry(val registration: TerminalAgentsRegistration) {
    var published = false
    var runtime: TerminalAgentsRuntimeKey? = null
    var ticket = 0L
    var visibleTabs: List<TerminalSessionDetailed> = emptyList()
    var excluded: Set<String> = emptySet()
}

private class DisplayEntry(
    val runtime: TerminalAgentsRuntimeKey,
    val receipt: TerminalAgentsInventoryReceipt,
    val observations: List<TerminalAgentStatusRow>,
)

/**
 * Retained owner-qualified inventory authority of the Traditional terminal Agents roster.
 *
 * - ONE narrow [ReentrantLock] ([rosterLock]) guards attachments (+ monotonic attachmentIncarnation), registrations and
 *   their order/tabs, inventory ticket/revision/receipt, the private display cache and (via the activation coordinator)
 *   request tokens. Producers are short and immediate (no suspension, network or persistence under it). Final route
 *   admission only try-locks it (see [tryLockRoster]); the retirement barrier only takes this one short gate and
 *   never reaches registry/profile/socket/reducer before it is released.
 * - Existing runtime only: one shared `listDetailed` per runtime, coalesced with an invalidation revision so an
 *   invalidation during a fetch always produces a trailing fetch (never lost work, no polling, no retry after failure).
 * - A pending/failed refresh, a lost socket or any invalidation removes the authority receipt; the private display
 *   cache of the same logical owner survives transport replacement for display only, and identity loss purges it.
 */
class TerminalAgentsInventoryCoordinator(
    val rosterLock: ReentrantLock = ReentrantLock(),
    private val isCurrentIdentity: (ConnectionRef, String, String) -> Boolean = { _, _, _ -> true },
) {
    private var attachmentSeq = 0L
    private var registrationSeq = 0L
    private var orderSeq = 0L
    private val attachments = HashMap<String, TerminalAgentsAttachment>()
    private val registrations = LinkedHashMap<Long, RegistrationEntry>()
    private val display = HashMap<TerminalAgentsLogicalOwner, DisplayEntry>()

    private val _inventories = MutableStateFlow<Map<TerminalAgentsRuntimeKey, TerminalAgentsInventoryReceipt>>(emptyMap())

    /** Accepted current-owner/current-ticket receipts only, one per runtime; entries vanish on invalidation/loss. */
    val inventories: StateFlow<Map<TerminalAgentsRuntimeKey, TerminalAgentsInventoryReceipt>> = _inventories.asStateFlow()

    private val _changes = MutableStateFlow(0L)

    /** Ticks on every roster-relevant change; consumers recompute from [snapshotInput], never from the tick. */
    val changes: StateFlow<Long> = _changes.asStateFlow()

    private inline fun <T> withGate(block: () -> T): T {
        rosterLock.lock()
        try {
            return block()
        } finally {
            rosterLock.unlock()
        }
    }

    private fun bump() {
        _changes.value = _changes.value + 1L
    }

    // ---- gate access for the admitted route (activation coordinator only) ----

    /** Try-locks the roster gate; false (BUSY) on contention or same-thread reentry. Never waits. */
    internal fun tryLockRoster(): Boolean = !rosterLock.isHeldByCurrentThread && rosterLock.tryLock()

    internal fun unlockRoster() {
        rosterLock.unlock()
    }

    /** Runs [block] under the roster gate (short, immediate, non-suspending). */
    internal fun <T> underRosterGate(block: () -> T): T = withGate(block)

    private fun keyOf(att: TerminalAgentsAttachment, socket: SocketInstanceRef) = TerminalAgentsRuntimeKey(
        connection = att.binding.owner,
        socket = socket,
        attachmentIncarnation = att.incarnation,
        endpoint = att.binding.endpoint,
        accountUser = att.binding.accountUser,
    )

    /** Locked: the live attachment exactly matching [runtime] (object token, connection and current socket). */
    internal fun attachmentForLocked(runtime: TerminalAgentsRuntimeKey): TerminalAgentsAttachment? {
        val att = attachments[runtime.connection.profileId] ?: return null
        if (att.revoked || att.incarnation != runtime.attachmentIncarnation) return null
        if (att.binding.owner != runtime.connection || att.socket != runtime.socket) return null
        if (att.binding.endpoint != runtime.endpoint || att.binding.accountUser != runtime.accountUser) return null
        return att
    }

    /** Locked: the registration entry's exact live registration (explicit close/re-register changes the id). */
    internal fun registrationLiveLocked(registration: TerminalAgentsRegistration): Boolean =
        registrations[registration.registrationId]?.registration == registration

    /** Locked: the registration's last explicit exclusion set (empty when unpublished or unknown). */
    internal fun excludedLocked(registration: TerminalAgentsRegistration): Set<String> =
        registrations[registration.registrationId]?.excluded.orEmpty()

    /** Locked: the current accepted receipt of [att], if no invalidation happened since it was accepted. */
    internal fun currentReceiptLocked(att: TerminalAgentsAttachment): TerminalAgentsInventoryReceipt? =
        att.receipt?.takeIf { att.health == TerminalAgentsInventoryHealth.CURRENT && it.invalidationRevision == att.revision }

    // ---- attachments ----

    /**
     * Attaches the runtime's WsConnection OBJECT. Idempotent for the same object and owner; a different object (even
     * same ConnectionRef / equal socket id) revokes the old attachment and allocates a NEW incarnation while the
     * logical display cache stays. Registrations of the same profile whose endpoint/account no longer match the new
     * runtime lost their identity and are purged.
     */
    fun attach(binding: TerminalAgentsRuntimeBinding): TerminalAgentsAttachment {
        var created = false
        val att = withGate {
            val profileId = binding.owner.profileId
            val existing = attachments[profileId]
            if (existing != null && !existing.revoked && existing.binding.ws === binding.ws &&
                existing.binding.owner == binding.owner
            ) {
                return@withGate existing
            }
            if (existing != null) revokeLocked(existing, purgeIdentity = false)
            val fresh = TerminalAgentsAttachment(++attachmentSeq, binding)
            attachments[profileId] = fresh
            val staleRegistrations = registrations.values.filter {
                val owner = it.registration.owner
                owner.profileId == profileId &&
                    (owner.normalizedBaseUrl != binding.endpoint || owner.accountUser != binding.accountUser)
            }
            staleRegistrations.forEach { registrations.remove(it.registration.registrationId) }
            display.keys.removeAll { it.profileId == profileId && (it.endpoint != binding.endpoint || it.accountUser != binding.accountUser) }
            created = true
            bump()
            fresh
        }
        if (created) {
            // Display mirror only (never authority): reducer changes recompute the roster and report newly observed
            // terminals; the job is a child of the runtime scope and dies with it.
            binding.scope.launch {
                binding.reducer.state.collect { state ->
                    onAgentObservations(att, state.agents.values)
                    withGate { if (!att.revoked) bump() }
                }
            }
        }
        return att
    }

    /** Revokes exactly [att] (replaced connection object / runtime stopped); the logical display cache stays. */
    fun detach(att: TerminalAgentsAttachment) {
        withGate { revokeLocked(att, purgeIdentity = false) }
    }

    /** The runtime keys (live attachment + connected socket) a manual/foreground refresh can target now. */
    fun currentRuntimeKeys(): List<TerminalAgentsRuntimeKey> = withGate {
        attachments.values.mapNotNull { att ->
            val socket = att.socket
            if (att.revoked || socket == null) null else keyOf(att, socket)
        }
    }

    /** True while [att] is the live attachment and [socket] is its currently connected socket (stale callbacks: false). */
    fun isCurrentSocket(att: TerminalAgentsAttachment, socket: SocketInstanceRef): Boolean = withGate {
        !att.revoked && attachments[att.binding.owner.profileId] === att && att.socket == socket
    }

    /**
     * Identity loss (generation retirement, logout, endpoint/account change): revokes every attachment of the profile
     * up to [old]'s generation and purges exactly that profile's display cache. A successor generation is untouched.
     */
    fun retireIdentity(old: ConnectionRef) {
        withGate {
            val att = attachments[old.profileId]
            if (att != null && att.binding.owner.generation <= old.generation) revokeLocked(att, purgeIdentity = true)
            display.keys.removeAll { key ->
                key.profileId == old.profileId && (att == null || att.binding.owner.generation <= old.generation)
            }
            bump()
        }
    }

    /** Teardown: revokes everything and drops every registration and cache. */
    fun clear() {
        withGate {
            attachments.values.toList().forEach { revokeLocked(it, purgeIdentity = true) }
            attachments.clear()
            registrations.clear()
            display.clear()
            _inventories.value = emptyMap()
            bump()
        }
    }

    private fun revokeLocked(att: TerminalAgentsAttachment, purgeIdentity: Boolean) {
        if (att.revoked) return
        att.revoked = true
        if (attachments[att.binding.owner.profileId] === att) attachments.remove(att.binding.owner.profileId)
        dropReceiptLocked(att)
        att.health = TerminalAgentsInventoryHealth.UNAVAILABLE
        failWaitersLocked(att)
        att.job?.cancel()
        att.job = null
        att.fetching = false
        if (purgeIdentity) display.remove(att.logical)
        bump()
    }

    /**
     * Socket-bound transport state of [att]'s own connection: [socket] is its currently connected socket or null. A
     * changed socket is a lifecycle invalidation; losing the socket removes authority and fails the waiters.
     */
    fun onSocketState(att: TerminalAgentsAttachment, socket: SocketInstanceRef?, reason: TerminalAgentsRefreshReason) {
        val job = withGate {
            if (att.revoked || attachments[att.binding.owner.profileId] !== att) return@withGate null
            if (att.socket == socket) return@withGate null
            att.socket = socket
            failWaitersLocked(att)
            invalidateLocked(att)
        }
        job?.start()
    }

    // ---- invalidation / refresh ----

    /** Existing triggers (lifecycle, restart, agent removal/invalidation, foreground...) invalidate and reconcile. */
    fun invalidate(att: TerminalAgentsAttachment, reason: TerminalAgentsRefreshReason) {
        val job = withGate {
            if (att.revoked || attachments[att.binding.owner.profileId] !== att) null else invalidateLocked(att)
        }
        job?.start()
    }

    /**
     * Exact non-null `TermExit` of an owned instance prunes that one membership/observation at once (never when a
     * restart is announced); every exit also reconciles. A null or other incarnation only reconciles.
     */
    fun onTerminalExit(att: TerminalAgentsAttachment, terminalId: String, incarnation: ULong?, willRestart: Boolean) {
        val job = withGate {
            if (att.revoked || attachments[att.binding.owner.profileId] !== att) return@withGate null
            if (incarnation != null && !willRestart) pruneInstanceLocked(att, terminalId, incarnation)
            invalidateLocked(att)
        }
        job?.start()
    }

    /**
     * Records the reducer's currently observed agents; a (terminal, incarnation) never seen before that the accepted
     * inventory does not contain invalidates membership. Only NEW unknown pairs trigger, so steady status changes do
     * not cause refetches.
     */
    fun onAgentObservations(att: TerminalAgentsAttachment, agents: Collection<TerminalAgentStatusRow>) {
        val job = withGate {
            if (att.revoked || attachments[att.binding.owner.profileId] !== att) return@withGate null
            val current: Set<Pair<String, ULong>> = agents.mapTo(HashSet()) { it.id to it.incarnation }
            val added = current - att.seenAgents
            att.seenAgents = current
            if (added.isEmpty()) return@withGate null
            val receipt = att.receipt ?: return@withGate null
            val unknown = added.any { (id, inc) -> receipt.sessions.none { it.id == id && it.incarnation == inc } }
            if (unknown) invalidateLocked(att) else null
        }
        job?.start()
    }

    /**
     * Fresh reconciliation for [runtime]: increments the invalidation revision, then waits for a fetch that STARTED
     * at or after that revision (an in-flight older fetch is discarded and trailed, never joined). Null for a stale
     * runtime key, a failed fetch, a lost socket or retirement; never loops on failure.
     */
    suspend fun refresh(runtime: TerminalAgentsRuntimeKey, reason: TerminalAgentsRefreshReason): TerminalAgentsInventoryReceipt? {
        val waiter = InventoryWaiter(CompletableDeferred())
        val job = withGate {
            val att = attachmentForLocked(runtime) ?: return@withGate FAILED
            att.waiters += waiter
            invalidateLocked(att) ?: NO_JOB
        }
        if (job === FAILED) return null
        (job as? Job)?.start()
        try {
            return waiter.result.await()
        } finally {
            withGate {
                attachments.values.forEach { it.waiters.remove(waiter) }
            }
        }
    }

    /** Locked: bump revision, drop authority, mark refreshing; returns the NOT YET STARTED fetch job, if one is needed. */
    private fun invalidateLocked(att: TerminalAgentsAttachment): Job? {
        att.revision++
        dropReceiptLocked(att)
        att.health = if (att.socket == null) TerminalAgentsInventoryHealth.UNAVAILABLE else TerminalAgentsInventoryHealth.REFRESHING
        bump()
        if (att.socket == null || att.revoked || att.fetching) return null
        att.fetching = true
        val job = att.binding.scope.launch(start = CoroutineStart.LAZY) { fetchLoop(att) }
        att.job = job
        return job
    }

    private suspend fun fetchLoop(att: TerminalAgentsAttachment) {
        try {
            while (true) {
                val start = withGate {
                    val socket = att.socket
                    if (att.revoked || socket == null) {
                        att.fetching = false
                        null
                    } else {
                        att.ticket++
                        FetchStart(att.ticket, att.revision, socket)
                    }
                } ?: return
                val outcome: Result<List<TerminalSessionDetailed>> = try {
                    Result.success(att.binding.listDetailed())
                } catch (ce: CancellationException) {
                    throw ce
                } catch (t: Throwable) {
                    Result.failure(t)
                }
                val trail = withGate {
                    if (att.revoked) {
                        att.fetching = false
                        return@withGate false
                    }
                    if (att.revision != start.revision || att.socket != start.socket) {
                        // Invalidated while fetching: discard this result; a trailing fetch starts immediately.
                        return@withGate true
                    }
                    att.fetching = false
                    val sessions = outcome.getOrNull()
                    if (sessions == null) {
                        att.receipt = null
                        att.health = TerminalAgentsInventoryHealth.UNAVAILABLE
                        completeWaitersLocked(att, null)
                    } else {
                        installReceiptLocked(att, start, sessions)
                    }
                    bump()
                    false
                }
                if (!trail) return
            }
        } finally {
            val self = kotlin.coroutines.coroutineContext[Job]
            withGate {
                // Only the job still registered as THE fetch job cleans up; a successor job owns its own state.
                if (att.job === self) {
                    att.job = null
                    att.fetching = false
                    failWaitersLocked(att)
                }
            }
        }
    }

    private class FetchStart(val ticket: Long, val revision: Long, val socket: SocketInstanceRef)

    private fun installReceiptLocked(att: TerminalAgentsAttachment, start: FetchStart, sessions: List<TerminalSessionDetailed>) {
        val receipt = TerminalAgentsInventoryReceipt(
            runtime = keyOf(att, start.socket),
            requestTicket = start.ticket,
            invalidationRevision = start.revision,
            sessions = sessions.toList(),
        )
        att.receipt = receipt
        val hasDuplicateIds = sessions.groupBy { it.id }.any { it.value.size > 1 }
        att.health = if (hasDuplicateIds) TerminalAgentsInventoryHealth.CONFLICT else TerminalAgentsInventoryHealth.CURRENT
        _inventories.value = _inventories.value.filterKeys { it.attachmentIncarnation != att.incarnation } + (receipt.runtime to receipt)
        val reducerState = att.binding.reducer.state.value
        if (reducerState.baselineInstalled && reducerState.snapshotFailure == null) {
            display[att.logical] = DisplayEntry(receipt.runtime, receipt, reducerState.agents.values.toList())
        }
        reconcileRegistrationsLocked(att, receipt)
        completeWaitersLocked(att, receipt)
    }

    private fun dropReceiptLocked(att: TerminalAgentsAttachment) {
        att.receipt = null
        val before = _inventories.value
        if (before.keys.any { it.attachmentIncarnation == att.incarnation }) {
            _inventories.value = before.filterKeys { it.attachmentIncarnation != att.incarnation }
        }
    }

    private fun completeWaitersLocked(att: TerminalAgentsAttachment, receipt: TerminalAgentsInventoryReceipt?) {
        val pending = att.waiters.toList()
        att.waiters.clear()
        pending.forEach { it.result.complete(receipt) }
    }

    private fun failWaitersLocked(att: TerminalAgentsAttachment) = completeWaitersLocked(att, null)

    /**
     * Derives the selectable list of EVERY already-published registration of the runtime's logical owner from the
     * accepted inventory (project match, not excluded) and re-fences it to the new runtime/ticket. Never discovers or
     * registers a workspace; unpublished registrations stay untouched.
     */
    private fun reconcileRegistrationsLocked(att: TerminalAgentsAttachment, receipt: TerminalAgentsInventoryReceipt) {
        for (entry in registrations.values) {
            val owner = entry.registration.owner
            if (!ownedBy(owner, att) || !entry.published) continue
            entry.runtime = receipt.runtime
            entry.ticket = receipt.requestTicket
            entry.visibleTabs = receipt.sessions.filter { it.project == owner.project && it.id !in entry.excluded }
        }
    }

    private fun ownedBy(owner: WorkspaceFileOwner, att: TerminalAgentsAttachment): Boolean =
        owner.profileId == att.binding.owner.profileId &&
            owner.normalizedBaseUrl == att.binding.endpoint &&
            owner.accountUser == att.binding.accountUser

    private fun pruneInstanceLocked(att: TerminalAgentsAttachment, terminalId: String, incarnation: ULong) {
        for (entry in registrations.values) {
            if (!ownedBy(entry.registration.owner, att)) continue
            entry.visibleTabs = entry.visibleTabs.filterNot { it.id == terminalId && it.incarnation == incarnation }
        }
        val cached = display[att.logical]
        if (cached != null) {
            display[att.logical] = DisplayEntry(
                cached.runtime,
                cached.receipt.copy(sessions = cached.receipt.sessions.filterNot { it.id == terminalId && it.incarnation == incarnation }),
                cached.observations.filterNot { it.id == terminalId && it.incarnation == incarnation },
            )
        }
    }

    // ---- registrations ----

    /** Idempotent per live logical owner (keeps first-registration order); closing and re-registering is a new id. */
    fun registerWorkspace(owner: WorkspaceFileOwner): TerminalAgentsRegistration = withGate {
        registrations.values.firstOrNull { it.registration.owner == owner }?.let { return@withGate it.registration }
        val registration = TerminalAgentsRegistration(owner, ++registrationSeq, ++orderSeq)
        registrations[registration.registrationId] = RegistrationEntry(registration)
        bump()
        registration
    }

    /** Retires exactly this registration; a re-registration cannot revive its old receipts/targets. */
    fun closeWorkspace(registration: TerminalAgentsRegistration) {
        withGate {
            val entry = registrations[registration.registrationId]
            if (entry != null && entry.registration == registration) {
                registrations.remove(registration.registrationId)
                bump()
            }
        }
    }

    /**
     * Publishes the workspace's visible/selectable tabs and explicit exclusions from its exact current [receipt]. A
     * stale receipt (invalidated, replaced, other runtime) or a closed/foreign registration is ignored. Never
     * initiates a fetch, so screens cannot create a publication echo loop.
     */
    fun publishWorkspaceTabs(
        registration: TerminalAgentsRegistration,
        receipt: TerminalAgentsInventoryReceipt,
        visibleTabs: List<TerminalSessionDetailed>,
        excludedTerminalIds: Set<String>,
    ) {
        withGate {
            val entry = registrations[registration.registrationId] ?: return@withGate
            if (entry.registration != registration) return@withGate
            val att = attachmentForLocked(receipt.runtime) ?: return@withGate
            val current = currentReceiptLocked(att) ?: return@withGate
            if (current.requestTicket != receipt.requestTicket || current.invalidationRevision != receipt.invalidationRevision) {
                return@withGate
            }
            if (!ownedBy(registration.owner, att)) return@withGate
            entry.published = true
            entry.runtime = receipt.runtime
            entry.ticket = receipt.requestTicket
            entry.visibleTabs = visibleTabs.toList()
            entry.excluded = excludedTerminalIds.toSet()
            bump()
        }
    }

    /** Marks the runtime's inventory CONFLICT (contradictory accepted metadata) until its next accepted receipt. */
    fun markConflict(runtime: TerminalAgentsRuntimeKey) {
        withGate {
            val att = attachmentForLocked(runtime) ?: return@withGate
            if (att.health != TerminalAgentsInventoryHealth.CURRENT) return@withGate
            att.health = TerminalAgentsInventoryHealth.CONFLICT
            bump()
        }
    }

    // ---- projection input ----

    /**
     * Captures the projection input atomically: published workspaces (registration order), the runtime snapshots
     * (live attachments, reducer state read once) and the private display cache. Qualified status observations are
     * remembered for display here; nothing is mutated otherwise.
     */
    fun snapshotInput(profileLabels: Map<String, String>): TerminalAgentsRosterSnapshot = withGate {
        val runtimes = ArrayList<TerminalAgentsRuntimeSnapshot>()
        val notices = LinkedHashSet<String>()
        var refreshing = false
        val covered = HashSet<TerminalAgentsLogicalOwner>()
        for (att in attachments.values) {
            if (att.revoked) continue
            val logical = att.logical
            covered += logical
            val state = att.binding.reducer.state.value
            val socket = att.socket
            val receipt = currentReceiptLocked(att)
            val qualified = socket != null && receipt != null && state.baselineInstalled && state.snapshotFailure == null
            if (qualified) {
                display[logical] = DisplayEntry(receipt.runtime, receipt, state.agents.values.toList())
                reconcileRegistrationsLocked(att, receipt)
            }
            val cached = display[logical]
            val runtimeKey = when {
                socket != null -> keyOf(att, socket)
                cached != null -> cached.runtime
                else -> continue
            }
            if (att.health == TerminalAgentsInventoryHealth.REFRESHING) refreshing = true
            if (att.health == TerminalAgentsInventoryHealth.CONFLICT) {
                notices += "The server returned contradictory terminal metadata. Refresh to retry."
            }
            if (state.snapshotFailure == TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND) {
                notices += "This server does not support agent observation."
            }
            if (socket == null) notices += "A server connection is offline; its agents are shown as unavailable."
            runtimes += TerminalAgentsRuntimeSnapshot(
                runtime = runtimeKey,
                isCurrentIdentity = isCurrentIdentity(att.binding.owner, att.binding.endpoint, att.binding.accountUser),
                isCurrentConnectedSocket = socket != null,
                inventoryHealth = att.health,
                inventory = receipt ?: cached?.receipt,
                statusBaselineInstalled = state.baselineInstalled,
                statusAuthorityRevision = state.routeAuthorityRevision,
                status = state,
                snapshotFailure = state.snapshotFailure,
                cachedObservations = cached?.observations.orEmpty(),
            )
        }
        val workspaces = registrations.values
            .filter { it.published && it.runtime != null }
            .map {
                TerminalAgentsWorkspaceSnapshot(
                    registration = it.registration,
                    runtime = it.runtime!!,
                    inventoryTicket = it.ticket,
                    visibleTabs = it.visibleTabs,
                    excludedTerminalIds = it.excluded,
                )
            }
        TerminalAgentsRosterSnapshot(
            input = TerminalAgentsProjectionInput(workspaces = workspaces, runtimes = runtimes, profileLabels = profileLabels),
            refreshing = refreshing,
            notices = notices.toList(),
        )
    }

    private companion object {
        /** Marker: the runtime key was stale, no waiter was registered. */
        val FAILED = Any()

        /** Marker: a waiter was registered but another fetch job already covers it. */
        val NO_JOB = Any()
    }
}
