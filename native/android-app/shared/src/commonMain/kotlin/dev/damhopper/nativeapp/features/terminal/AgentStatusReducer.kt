package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

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
 * Authoritative reducer coordinating server-pushed agent status updates and REST snapshots.
 *
 * Enforces:
 * 1. Server epoch fencing: serverEpoch defines a discrete server run/namespace, not necessarily a monotonic number.
 *    Any mismatch between current accepted epoch and incoming event/snapshot forces reconciliation.
 * 2. Monotonic revision fencing within accepted epoch: drops stale or reordered updates.
 * 3. Race resolution: snapshot arrival supersedes older events; queued/concurrent deltas with
 *    newer revision are cleanly merged.
 * 4. Attention deduplication: historical events loaded via snapshot or replayed deltas
 *    do NOT regenerate notification alerts.
 */
class AgentStatusReducer(
    private val terminalRepository: TerminalRepository? = null,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val mutex = Mutex()
    private val _state = MutableStateFlow(AgentStatusState())
    val state: StateFlow<AgentStatusState> = _state.asStateFlow()

    private val seenAttentionIds = LinkedHashSet<String>()
    private val maxSeenAttentions = 1000

    /**
     * Updates active agent filter.
     */
    fun setFilter(filter: AgentFilter) {
        _state.value = _state.value.copy(activeFilter = filter)
    }

    /**
     * Clears an unread attention event by ID.
     */
    fun dismissAttention(attentionId: String) {
        val current = _state.value
        _state.value = current.copy(
            unreadAttentions = current.unreadAttentions.filterNot { it.id == attentionId }
        )
    }

    /**
     * Clears all unread attention events for a given terminal session.
     */
    fun dismissAttentionsForTerminal(terminalId: String, incarnation: ULong) {
        val current = _state.value
        _state.value = current.copy(
            unreadAttentions = current.unreadAttentions.filterNot {
                it.terminalId == terminalId && it.incarnation == incarnation
            }
        )
    }

    /**
     * Applies a fresh snapshot from REST or initial bootstrap.
     */
    suspend fun applySnapshot(snapshot: AgentStatusSnapshotV1) = mutex.withLock {
        val current = _state.value

        // Seed seen attention IDs from existing rows in snapshot so we don't alert on historical state
        snapshot.terminals.forEach { row ->
            if (row.attentionRevision > 0uL) {
                val seedId = "${snapshot.serverEpoch}:${row.id}:${row.incarnation}:${row.attentionRevision}"
                seenAttentionIds.add(seedId)
            }
        }

        val agentMap = snapshot.terminals.associateBy { it.id }

        // If snapshot is from same epoch and has older revision than live stream, preserve newer live state
        if (current.serverEpoch == snapshot.serverEpoch && snapshot.revision < current.revision) {
            _state.value = current.copy(
                availability = snapshot.availability,
                isSnapshotLoading = false,
                lastError = null,
            )
            return@withLock
        }

        _state.value = current.copy(
            serverEpoch = snapshot.serverEpoch,
            revision = snapshot.revision,
            availability = snapshot.availability,
            agents = agentMap,
            isSnapshotLoading = false,
            lastError = null,
        )
    }

    /**
     * Applies ServerMsg.AgentStatusChanged from live WebSocket.
     */
    suspend fun applyStatusChanged(msg: ServerMsg.AgentStatusChanged) {
        var shouldReload = false
        mutex.withLock {
            val current = _state.value

            // Parse row DTO from JSON element
            val row = try {
                json.decodeFromJsonElement(TerminalAgentStatusRow.serializer(), msg.row)
            } catch (_: Exception) {
                return@withLock
            }

            val attention = msg.attention?.let {
                try {
                    json.decodeFromJsonElement(AgentAttentionEvent.serializer(), it)
                } catch (_: Exception) {
                    null
                }
            }

            // Epoch mismatch: server restarted or switched namespaces -> trigger fresh snapshot reload
            if (current.serverEpoch != 0uL && msg.serverEpoch != current.serverEpoch) {
                _state.value = current.copy(
                    serverEpoch = msg.serverEpoch,
                    revision = msg.revision,
                    agents = mapOf(row.id to row),
                    unreadAttentions = emptyList(),
                )
                shouldReload = true
                return@withLock
            }

            // Revision fencing: reject stale or duplicate revisions within same epoch
            if (msg.serverEpoch == current.serverEpoch && msg.revision <= current.revision) {
                return@withLock
            }

            val updatedAgents = current.agents.toMutableMap()
            updatedAgents[row.id] = row

            val updatedAttentions = current.unreadAttentions.toMutableList()
            if (attention != null) {
                val attentionId = attention.id.ifBlank {
                    "${msg.serverEpoch}:${attention.terminalId}:${attention.incarnation}:${attention.attentionRevision}"
                }
                if (!seenAttentionIds.contains(attentionId)) {
                    if (seenAttentionIds.size >= maxSeenAttentions) {
                        val iter = seenAttentionIds.iterator()
                        if (iter.hasNext()) { iter.next(); iter.remove() }
                    }
                    seenAttentionIds.add(attentionId)
                    updatedAttentions.add(attention)
                }
            }

            _state.value = current.copy(
                serverEpoch = msg.serverEpoch,
                revision = msg.revision,
                agents = updatedAgents,
                unreadAttentions = updatedAttentions,
                lastError = null,
            )
        }
        if (shouldReload) {
            reloadSnapshotAsync()
        }
    }
    /**
     * Applies ServerMsg.AgentStatusRemoved from live WebSocket.
     */
    suspend fun applyStatusRemoved(msg: ServerMsg.AgentStatusRemoved) {
        var shouldReload = false
        mutex.withLock {
            val current = _state.value

            if (current.serverEpoch != 0uL && msg.serverEpoch != current.serverEpoch) {
                shouldReload = true
                return@withLock
            }

            if (msg.serverEpoch == current.serverEpoch && msg.revision <= current.revision) {
                return@withLock
            }

            val existing = current.agents[msg.terminalId]
            val updatedAgents = current.agents.toMutableMap()
            if (existing != null && existing.incarnation <= msg.incarnation) {
                updatedAgents.remove(msg.terminalId)
            }

            val updatedAttentions = current.unreadAttentions.filterNot {
                it.terminalId == msg.terminalId && it.incarnation <= msg.incarnation
            }

            _state.value = current.copy(
                serverEpoch = msg.serverEpoch,
                revision = msg.revision,
                agents = updatedAgents,
                unreadAttentions = updatedAttentions,
            )
        }
        if (shouldReload) {
            reloadSnapshotAsync()
        }
    }
    /**
     * Applies ServerMsg.AgentStatusInvalidated from live WebSocket.
     */
    suspend fun applyStatusInvalidated(msg: ServerMsg.AgentStatusInvalidated) {
        mutex.withLock {
            val current = _state.value
            _state.value = current.copy(
                serverEpoch = msg.serverEpoch,
                revision = msg.revision,
                agents = emptyMap(),
                unreadAttentions = emptyList(),
            )
        }
        reloadSnapshotAsync()
    }

    /**
     * Asynchronously triggers snapshot reload via repository.
     */
    suspend fun reloadSnapshot() {
        val repo = terminalRepository ?: return
        _state.value = _state.value.copy(isSnapshotLoading = true)
        try {
            val snapshot = repo.getAgentStatusSnapshot()
            applySnapshot(snapshot)
        } catch (e: Exception) {
            _state.value = _state.value.copy(
                isSnapshotLoading = false,
                lastError = e.message ?: "Failed to load agent status snapshot"
            )
        }
    }

    private suspend fun reloadSnapshotAsync() {
        terminalRepository?.let { repo ->
            try {
                val snapshot = repo.getAgentStatusSnapshot()
                applySnapshot(snapshot)
            } catch (_: Exception) {}
        }
    }
}
