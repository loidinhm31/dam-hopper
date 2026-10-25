package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.notifications.toServerSafeLongOrNull
import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Filter options for displaying agents in the UI.
 */
enum class AgentFilter {
    ALL,
    WORKING,
    BLOCKED,
    NEEDS_ATTENTION,
    IDLE,
}

/**
 * Immutable state representation of all active agents across PTY sessions.
 *
 * [baselineInstalled] is true once a snapshot qualified to the bound owner+socket was installed silently and
 * no gap/epoch change/invalidation/malformed input has closed it since. [admissionOpen] additionally requires
 * no snapshot in flight and a READY availability: only then may a live event be accepted for alerting.
 */
data class AgentStatusState(
    val serverEpoch: ULong = 0uL,
    val revision: ULong = 0uL,
    val availability: AgentStatusAvailability = AgentStatusAvailability.UNAVAILABLE,
    val agents: Map<String, TerminalAgentStatusRow> = emptyMap(),
    val unreadAttentions: List<AgentAttentionEvent> = emptyList(),
    val activeFilter: AgentFilter = AgentFilter.ALL,
    val isSnapshotLoading: Boolean = false,
    val lastError: String? = null,
    val baselineInstalled: Boolean = false,
    val admissionOpen: Boolean = false,
) {
    /**
     * Filtered list of agents according to [activeFilter].
     */
    val filteredAgents: List<TerminalAgentStatusRow>
        get() = agents.values.filter { row ->
            when (activeFilter) {
                AgentFilter.ALL -> true
                AgentFilter.WORKING -> row.state == AgentState.WORKING
                AgentFilter.BLOCKED -> row.state == AgentState.BLOCKED
                AgentFilter.IDLE -> row.state == AgentState.IDLE
                AgentFilter.NEEDS_ATTENTION -> row.state == AgentState.BLOCKED ||
                        unreadAttentions.any { it.terminalId == row.id && it.incarnation == row.incarnation }
            }
        }.sortedByDescending { it.observedAtMs ?: 0uL }

    /**
     * Finds agent status row for a concrete terminal session incarnation.
     */
    fun findAgentForSession(terminalId: String, incarnation: ULong): TerminalAgentStatusRow? {
        val row = agents[terminalId] ?: return null
        return if (row.incarnation == incarnation) row else null
    }
}

/**
 * Receipt of a started snapshot fetch. It is valid only for the exact owner+socket it was captured for and
 * only until the reducer sees a replacement/invalidation/newer capture; [AgentStatusReducer.applySnapshot]
 * rejects a stale receipt, so a fetch that was in flight across a replacement can never install a baseline.
 */
class SnapshotCapture internal constructor(
    val owner: ConnectionRef,
    val socket: SocketInstanceRef,
    internal val ticket: Long,
)

/**
 * Authoritative reducer coordinating server-pushed agent status updates and REST snapshots, and the only
 * producer of [AgentAdmission.Accepted] (C3).
 *
 * - **Silent baseline.** Nothing alerts until a snapshot qualified to the bound owner+socket installed the
 *   baseline. Events before it (or while a fetch is in flight) are discarded, never buffered.
 * - **One contiguous cursor.** Changed, removed and invalidation messages share one revision cursor; a
 *   revision above `cursor + 1`, an epoch change, an invalidation, an unavailable domain or malformed
 *   input closes admission and answers [AgentAdmission.Reconcile]. The retained runtime then refetches and
 *   installs a fresh snapshot silently (no catch-up alerts).
 * - **Exact runtime.** [bindRuntime] is the only way to change the (owner, socket) the reducer serves; a
 *   late callback of a replaced socket or retired generation can neither rebind nor alert nor close the
 *   current baseline (it is Silent).
 * - **Bounded high-water.** Per (terminal, incarnation, agentSession, agentKind) revision high-water plus
 *   per-terminal removed-incarnation tombstones live for the baseline lifetime; reaching [MAX_TRACKED]
 *   closes admission and reconciles instead of evicting authority. Snapshot seeding stores only these bounded
 *   high-water values, never synthetic event ids.
 *
 * No lock is ever held across the network: fetch happens outside between [captureSnapshot] and
 * [applySnapshot]. Callers must feed changed/removed/invalidated messages in transport order from one
 * collector; reordering only causes an extra silent reconcile, never an alert.
 */
class AgentStatusReducer(
    private val terminalRepository: TerminalRepository? = null,
) {
    private data class Binding(val owner: ConnectionRef, val socket: SocketInstanceRef)

    private data class Identity(
        val terminalId: String,
        val incarnation: Long,
        val agentSessionId: String,
        val agentKind: AgentKind,
    )

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val mutex = Mutex()
    private val _state = MutableStateFlow(AgentStatusState())
    val state: StateFlow<AgentStatusState> = _state.asStateFlow()

    // Baseline authority; every field below is guarded by [mutex].
    private var bound: Binding? = null
    private var baselineInstalled = false
    private var epoch = 0uL
    private var cursor = 0uL
    private var hasCursor = false
    private var ticket = 0L
    private var inFlightTicket: Long? = null
    private val highWater = HashMap<Identity, Long>()
    private val removedFloor = HashMap<String, Long>()

    /**
     * Updates active agent filter.
     */
    fun setFilter(filter: AgentFilter) {
        _state.update { it.copy(activeFilter = filter) }
    }

    /**
     * Clears an unread attention event by ID.
     */
    fun dismissAttention(attentionId: String) {
        _state.update { cur -> cur.copy(unreadAttentions = cur.unreadAttentions.filterNot { it.id == attentionId }) }
    }

    /**
     * Clears all unread attention events for a given terminal session.
     */
    fun dismissAttentionsForTerminal(terminalId: String, incarnation: ULong) {
        _state.update { cur ->
            cur.copy(
                unreadAttentions = cur.unreadAttentions.filterNot {
                    it.terminalId == terminalId && it.incarnation == incarnation
                },
            )
        }
    }

    /**
     * Binds the reducer to the runtime's current owner+socket (called by the retained runtime when that
     * socket becomes current). Rebinding to a different owner or socket drops all baseline authority and
     * invalidates any in-flight capture; admission stays closed until a new silent baseline installs.
     * Returns false (no change) for a lower generation of the same profile: a retired owner cannot rebind.
     */
    suspend fun bindRuntime(owner: ConnectionRef, socket: SocketInstanceRef): Boolean = mutex.withLock {
        val next = Binding(owner, socket)
        val current = bound
        if (current == next) return@withLock true
        if (current != null && current.owner.profileId == owner.profileId &&
            owner.generation < current.owner.generation
        ) {
            return@withLock false
        }
        bound = next
        resetAuthority()
        true
    }

    /**
     * Drops the binding and all baseline authority of exactly [owner]; another owner is untouched.
     */
    suspend fun retireOwner(owner: ConnectionRef) = mutex.withLock {
        if (bound?.owner == owner) {
            bound = null
            resetAuthority()
        }
    }

    /**
     * Starts a snapshot fetch for the exact bound owner+socket and closes alert admission while it loads.
     * Returns null (no state change) when [owner]/[socket] is not the bound runtime, so a stale caller can
     * neither supersede the current capture nor start a fetch for a replaced socket.
     */
    suspend fun captureSnapshot(owner: ConnectionRef, socket: SocketInstanceRef): SnapshotCapture? =
        mutex.withLock {
            if (bound != Binding(owner, socket)) return@withLock null
            ticket++
            inFlightTicket = ticket
            publishFlags()
            SnapshotCapture(owner, socket, ticket)
        }

    /**
     * Installs [snapshot] silently as the new baseline iff [capture] is still the current in-flight capture
     * for the bound owner+socket. Returns false (and keeps admission closed) for a stale capture, a
     * malformed/over-capacity snapshot, or a same-epoch snapshot older than the live cursor, which never
     * regresses newer state.
     */
    suspend fun applySnapshot(capture: SnapshotCapture, snapshot: AgentStatusSnapshotV1): Boolean =
        mutex.withLock {
            if (bound != Binding(capture.owner, capture.socket) ||
                inFlightTicket != capture.ticket || ticket != capture.ticket
            ) {
                return@withLock false
            }
            inFlightTicket = null
            val rows = validateSnapshot(snapshot)
            if (rows == null) {
                failClosed("Malformed or over-capacity agent status snapshot; alerts suspended")
                return@withLock false
            }
            // Fenced by the last authoritative epoch/cursor even while admission is closed (gap, failed fetch).
            val sameEpochBaseline = hasCursor && epoch == snapshot.serverEpoch
            if (sameEpochBaseline && snapshot.revision < cursor) {
                failClosed("Stale agent status snapshot ignored; reconciling")
                return@withLock false
            }

            val previous: Map<Identity, Long> = if (sameEpochBaseline) HashMap(highWater) else emptyMap()
            highWater.clear()
            removedFloor.clear()
            for (row in rows) {
                val identity = row.identity()
                highWater[identity] = maxOf(previous[identity] ?: 0L, row.attentionRevision.toLong())
            }
            baselineInstalled = true
            hasCursor = true
            epoch = snapshot.serverEpoch
            cursor = snapshot.revision
            val agentMap = rows.associateBy { it.id }
            _state.update { cur ->
                cur.copy(
                    serverEpoch = snapshot.serverEpoch,
                    revision = snapshot.revision,
                    availability = snapshot.availability,
                    agents = agentMap,
                    unreadAttentions = cur.unreadAttentions.filter { agentMap[it.terminalId]?.incarnation == it.incarnation },
                    lastError = null,
                )
            }
            publishFlags()
            true
        }

    /**
     * Ends a failed/cancelled fetch. Admission stays closed (baseline dropped) and the capture is spent, so
     * a later retry captures again and a stray late result cannot install.
     */
    suspend fun abandonSnapshot(capture: SnapshotCapture, error: String? = null) = mutex.withLock {
        if (inFlightTicket != capture.ticket || ticket != capture.ticket) return@withLock
        inFlightTicket = null
        baselineInstalled = false
        ticket++
        _state.update { it.copy(lastError = error ?: it.lastError) }
        publishFlags()
    }

    /**
     * Applies ServerMsg.AgentStatusChanged from the live WebSocket bound to [owner]/[socket].
     * Only [AgentAdmission.Accepted] may produce user-visible effects.
     */
    suspend fun applyStatusChanged(
        owner: ConnectionRef,
        socket: SocketInstanceRef,
        msg: ServerMsg.AgentStatusChanged,
    ): AgentAdmission = mutex.withLock {
        gate(owner, socket, msg.serverEpoch, msg.revision)?.let { return@withLock it }

        val row = decodeRow(msg.row) ?: return@withLock closeBaseline()
        val attention = if (msg.attention == null) null else decodeAttention(msg.attention) ?: return@withLock closeBaseline()
        if (attention != null && !attention.matches(row)) return@withLock closeBaseline()

        val identity = row.identity()
        val existing = _state.value.agents[row.id]
        val floor = removedFloor[row.id]
        val staleRow = (floor != null && identity.incarnation <= floor) ||
            (existing != null && row.incarnation < existing.incarnation)
        if (staleRow) {
            // Older incarnation / tombstoned terminal: never resurrected, never alerts; cursor still advances.
            consumeRevision(msg.revision, row = null, accepted = null)
            return@withLock AgentAdmission.Silent
        }
        if (identity !in highWater && trackedCount() >= MAX_TRACKED) return@withLock closeBaseline()

        val previousRevision = existing?.takeIf { it.identity() == identity }?.attentionRevision?.toServerSafeLongOrNull()
        if (existing != null && existing.identity() == identity && previousRevision == null) return@withLock closeBaseline()
        val threshold = maxOf(previousRevision ?: 0L, highWater[identity] ?: 0L)

        val accepted = if (attention != null &&
            attention.attentionRevision.toLong() > threshold &&
            isSemanticAttention(row.agentKind, attention.kind)
        ) {
            AcceptedLiveAttention(owner, socket, msg.serverEpoch, msg.revision, row, attention)
        } else {
            null
        }
        highWater[identity] = maxOf(highWater[identity] ?: 0L, row.attentionRevision.toLong())
        consumeRevision(msg.revision, row = row, accepted = accepted)
        if (accepted != null) AgentAdmission.Accepted(accepted) else AgentAdmission.Silent
    }

    /**
     * Applies ServerMsg.AgentStatusRemoved from the live WebSocket. Never alerts; the removed incarnation
     * becomes a tombstone for the baseline lifetime so it cannot be resurrected.
     */
    suspend fun applyStatusRemoved(
        owner: ConnectionRef,
        socket: SocketInstanceRef,
        msg: ServerMsg.AgentStatusRemoved,
    ): AgentAdmission = mutex.withLock {
        gate(owner, socket, msg.serverEpoch, msg.revision)?.let { return@withLock it }
        val incarnation = msg.incarnation.toServerSafeLongOrNull()
        if (msg.terminalId.isBlank() || incarnation == null) return@withLock closeBaseline()
        val priorFloor = removedFloor[msg.terminalId]
        if (priorFloor == null && trackedCount() >= MAX_TRACKED) return@withLock closeBaseline()

        removedFloor[msg.terminalId] = maxOf(priorFloor ?: 0L, incarnation)
        cursor = msg.revision
        _state.update { cur ->
            val existing = cur.agents[msg.terminalId]
            val agents = if (existing != null && existing.incarnation <= msg.incarnation) {
                cur.agents - msg.terminalId
            } else {
                cur.agents
            }
            cur.copy(
                revision = msg.revision,
                agents = agents,
                unreadAttentions = cur.unreadAttentions.filterNot {
                    it.terminalId == msg.terminalId && it.incarnation <= msg.incarnation
                },
            )
        }
        AgentAdmission.Silent
    }

    /**
     * Applies ServerMsg.AgentStatusInvalidated. Invalidation always ends the baseline (and any in-flight
     * capture, which may predate it) and asks for a silent reconcile; an already-consumed duplicate is Silent.
     */
    suspend fun applyStatusInvalidated(
        owner: ConnectionRef,
        socket: SocketInstanceRef,
        msg: ServerMsg.AgentStatusInvalidated,
    ): AgentAdmission = mutex.withLock {
        if (bound != Binding(owner, socket)) return@withLock AgentAdmission.Silent
        if (baselineInstalled && inFlightTicket == null && msg.serverEpoch == epoch && msg.revision <= cursor) {
            return@withLock AgentAdmission.Silent
        }
        baselineInstalled = false
        inFlightTicket = null
        ticket++
        // Keep the fence: a snapshot older than this invalidation (same epoch) must not install later.
        if (msg.serverEpoch.toServerSafeLongOrNull() != null && msg.revision.toServerSafeLongOrNull() != null) {
            if (!hasCursor || msg.serverEpoch != epoch) {
                epoch = msg.serverEpoch
                cursor = msg.revision
                hasCursor = true
            } else if (msg.revision > cursor) {
                cursor = msg.revision
            }
        }
        highWater.clear()
        removedFloor.clear()
        _state.update { it.copy(agents = emptyMap(), unreadAttentions = emptyList()) }
        publishFlags()
        AgentAdmission.Reconcile
    }

    /**
     * Fetches a fresh snapshot for the bound owner+socket and installs it silently. The network call runs
     * outside every reducer lock; failure or cancellation spends the capture and leaves admission closed.
     */
    suspend fun reloadSnapshot(owner: ConnectionRef, socket: SocketInstanceRef): Boolean {
        val repo = terminalRepository ?: return false
        val capture = captureSnapshot(owner, socket) ?: return false
        val snapshot = try {
            repo.getAgentStatusSnapshot()
        } catch (e: CancellationException) {
            withContext(NonCancellable) { abandonSnapshot(capture, null) }
            throw e
        } catch (e: Exception) {
            abandonSnapshot(capture, e.message ?: "Failed to load agent status snapshot")
            return false
        }
        return applySnapshot(capture, snapshot)
    }

    // ---- internals (all callers hold [mutex]) ----

    private fun trackedCount(): Int = highWater.size + removedFloor.size

    /**
     * Null when the message is the next contiguous revision of the installed baseline for the bound
     * owner+socket and may be consumed; otherwise the verdict to return.
     */
    private fun gate(owner: ConnectionRef, socket: SocketInstanceRef, msgEpoch: ULong, msgRevision: ULong): AgentAdmission? {
        if (bound != Binding(owner, socket)) return AgentAdmission.Silent
        if (inFlightTicket != null) return AgentAdmission.Silent
        if (!baselineInstalled || _state.value.availability != AgentStatusAvailability.READY) {
            return AgentAdmission.Reconcile
        }
        if (msgEpoch.toServerSafeLongOrNull() == null || msgRevision.toServerSafeLongOrNull() == null) return closeBaseline()
        if (msgEpoch != epoch) return closeBaseline()
        if (msgRevision <= cursor) return AgentAdmission.Silent
        if (msgRevision != cursor + 1uL) return closeBaseline()
        return null
    }

    private fun closeBaseline(): AgentAdmission {
        baselineInstalled = false
        ticket++
        publishFlags()
        return AgentAdmission.Reconcile
    }

    /** Closed after a failed install/fetch: no baseline, no in-flight capture, spent ticket. */
    private fun failClosed(error: String) {
        baselineInstalled = false
        ticket++
        _state.update { it.copy(lastError = error) }
        publishFlags()
    }

    private fun resetAuthority() {
        baselineInstalled = false
        epoch = 0uL
        cursor = 0uL
        hasCursor = false
        inFlightTicket = null
        ticket++
        highWater.clear()
        removedFloor.clear()
        _state.update {
            it.copy(
                serverEpoch = 0uL,
                revision = 0uL,
                availability = AgentStatusAvailability.UNAVAILABLE,
                agents = emptyMap(),
                unreadAttentions = emptyList(),
            )
        }
        publishFlags()
    }

    private fun consumeRevision(revision: ULong, row: TerminalAgentStatusRow?, accepted: AcceptedLiveAttention?) {
        cursor = revision
        _state.update { cur ->
            cur.copy(
                revision = revision,
                agents = if (row != null) cur.agents + (row.id to row) else cur.agents,
                unreadAttentions = if (accepted != null) {
                    (cur.unreadAttentions + accepted.attention).takeLast(MAX_UNREAD)
                } else {
                    cur.unreadAttentions
                },
                lastError = null,
            )
        }
    }

    private fun publishFlags() {
        val installed = baselineInstalled
        val loading = inFlightTicket != null
        _state.update {
            it.copy(
                baselineInstalled = installed,
                admissionOpen = installed && !loading && it.availability == AgentStatusAvailability.READY,
                isSnapshotLoading = loading,
            )
        }
    }

    private fun decodeRow(element: JsonElement): TerminalAgentStatusRow? {
        val row = try {
            json.decodeFromJsonElement(TerminalAgentStatusRow.serializer(), element)
        } catch (_: Exception) {
            return null
        }
        return row.takeIf { it.isWellFormed() }
    }

    private fun decodeAttention(element: JsonElement): AgentAttentionEvent? {
        val attention = try {
            json.decodeFromJsonElement(AgentAttentionEvent.serializer(), element)
        } catch (_: Exception) {
            return null
        }
        return attention.takeIf {
            it.id.isNotBlank() && it.terminalId.isNotBlank() && it.agentSessionId.isNotBlank() &&
                it.incarnation.toServerSafeLongOrNull() != null &&
                (it.attentionRevision.toServerSafeLongOrNull() ?: 0L) > 0L
        }
    }

    /** Distinct nonblank ids, checked safe counters, version 1, bounded size; null if anything is off. */
    private fun validateSnapshot(snapshot: AgentStatusSnapshotV1): List<TerminalAgentStatusRow>? {
        if (snapshot.version != 1u) return null
        if (snapshot.serverEpoch.toServerSafeLongOrNull() == null || snapshot.revision.toServerSafeLongOrNull() == null) return null
        if (snapshot.terminals.size > MAX_TRACKED) return null
        val ids = HashSet<String>()
        for (row in snapshot.terminals) {
            if (!row.isWellFormed() || !ids.add(row.id)) return null
        }
        return snapshot.terminals
    }

    private fun TerminalAgentStatusRow.isWellFormed(): Boolean =
        id.isNotBlank() && agentSessionId.isNotBlank() &&
            incarnation.toServerSafeLongOrNull() != null && attentionRevision.toServerSafeLongOrNull() != null

    private fun TerminalAgentStatusRow.identity() =
        Identity(id, incarnation.toLong(), agentSessionId, agentKind)

    private fun AgentAttentionEvent.matches(row: TerminalAgentStatusRow): Boolean =
        terminalId == row.id && incarnation == row.incarnation && agentKind == row.agentKind &&
            agentSessionId == row.agentSessionId && attentionRevision == row.attentionRevision

    /**
     * Semantic eligibility only; verified integration for Claude/OMP is enforced by the readiness provider.
     * Codex is status-only; Claude may only raise needs-attention; OMP may raise turn-ended or needs-attention.
     */
    private fun isSemanticAttention(agent: AgentKind, kind: AttentionKind): Boolean = when (agent) {
        AgentKind.CODEX -> false
        AgentKind.CLAUDE -> kind == AttentionKind.NEEDS_ATTENTION
        AgentKind.OMP -> kind == AttentionKind.NEEDS_ATTENTION || kind == AttentionKind.TURN_ENDED
    }

    companion object {
        /** Bound on tracked identities + tombstones and on snapshot rows; reaching it reconciles, never evicts. */
        const val MAX_TRACKED = 2048
        private const val MAX_UNREAD = 200
    }
}
