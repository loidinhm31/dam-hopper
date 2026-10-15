package dev.damhopper.nativeapp.core.ownership

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProfileId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Manages active ConnectionRef instances per ProfileId, enforcing generation fences.
 *
 * Each server profile has an independent monotonically increasing generation counter.
 * Advancing or retiring a profile's generation guarantees that stale background tasks,
 * asynchronous REST responses, and old WebSocket callbacks cannot mutate live state.
 */
class ConnectionRegistry {
    private val mutex = Mutex()
    private val activeGenerations = mutableMapOf<ProfileId, Long>()
    private val generationWatermarks = mutableMapOf<ProfileId, Long>()
    private val retirementListeners = mutableListOf<(ConnectionRef) -> Unit>()

    private val _connectionsState = MutableStateFlow<Map<ProfileId, ConnectionRef>>(emptyMap())
    val connectionsState: StateFlow<Map<ProfileId, ConnectionRef>> = _connectionsState.asStateFlow()

    /**
     * Gets or creates the active ConnectionRef for a profileId.
     * Initial generation starts at 1.
     */
    suspend fun getOrCreateConnection(profileId: ProfileId): ConnectionRef = mutex.withLock {
        require(profileId.isNotBlank()) { "profileId cannot be blank" }
        val currentGen = activeGenerations.getOrPut(profileId) {
            val watermark = generationWatermarks.getOrElse(profileId) { 0L }
            val next = watermark + 1L
            generationWatermarks[profileId] = next
            next
        }
        val ref = ConnectionRef(profileId, currentGen)
        updateStateFlow()
        ref
    }

    /**
     * Returns the current ConnectionRef for a profileId if registered.
     */
    suspend fun getCurrentConnection(profileId: ProfileId): ConnectionRef? = mutex.withLock {
        activeGenerations[profileId]?.let { gen -> ConnectionRef(profileId, gen) }
    }

    /**
     * Retires the given ConnectionRef and advances the generation counter by 1.
     * If the passed ref is already older than the current generation, it is ignored
     * (as it was already retired).
     *
     * Returns the new ConnectionRef with incremented generation.
     */
    suspend fun retireConnection(ref: ConnectionRef): ConnectionRef {
        val (newRef, listenersToNotify) = mutex.withLock {
            val currentGen = activeGenerations[ref.profileId]
            if (currentGen != null && currentGen == ref.generation) {
                val nextGen = currentGen + 1
                activeGenerations[ref.profileId] = nextGen
                generationWatermarks[ref.profileId] = nextGen
                updateStateFlow()
                val newConnection = ConnectionRef(ref.profileId, nextGen)
                val listeners = retirementListeners.toList()
                Pair(newConnection, listeners)
            } else {
                // Already retired or replaced; return current active ref or incremented
                val gen = currentGen ?: (ref.generation + 1)
                Pair(ConnectionRef(ref.profileId, gen), emptyList())
            }
        }

        // Notify listeners outside the mutex lock to avoid deadlocks
        listenersToNotify.forEach { listener ->
            try {
                listener(ref)
            } catch (_: Throwable) {
                // Suppress listener exceptions to preserve registry integrity
            }
        }

        return newRef
    }

    /**
     * Completely removes a profile from the registry (e.g. on logout/delete).
     */
    suspend fun removeProfile(profileId: ProfileId): ConnectionRef? {
        val (retiredRef, listenersToNotify) = mutex.withLock {
            val lastGen = activeGenerations.remove(profileId)
            updateStateFlow()
            if (lastGen != null) {
                Pair(ConnectionRef(profileId, lastGen), retirementListeners.toList())
            } else {
                Pair(null, emptyList())
            }
        }

        if (retiredRef != null) {
            listenersToNotify.forEach { listener ->
                try {
                    listener(retiredRef)
                } catch (_: Throwable) {
                }
            }
        }

        return retiredRef
    }

    /**
     * Checks if the given ref matches the current generation for its profile.
     */
    suspend fun isCurrentOwner(ref: ConnectionRef): Boolean = mutex.withLock {
        val currentGen = activeGenerations[ref.profileId]
        currentGen != null && currentGen == ref.generation
    }

    /**
     * Asserts that the given ref is currently active. Throws ConnectionOwnerError if stale or missing.
     */
    suspend fun assertCurrentOwner(ref: ConnectionRef, operation: String = "operation") {
        mutex.withLock {
            val currentGen = activeGenerations[ref.profileId]
                ?: throw ConnectionOwnerError(
                    "Profile '${ref.profileId}' is not registered in ConnectionRegistry ($operation)",
                    ConnectionErrorReason.OWNER_MISMATCH,
                )

            if (ref.generation < currentGen) {
                throw ConnectionOwnerError(
                    "Connection generation ${ref.generation} is stale for profile '${ref.profileId}' (current: $currentGen) during $operation",
                    ConnectionErrorReason.STALE,
                )
            } else if (ref.generation > currentGen) {
                throw ConnectionOwnerError(
                    "Connection generation ${ref.generation} is from the future for profile '${ref.profileId}' (current: $currentGen) during $operation",
                    ConnectionErrorReason.OWNER_MISMATCH,
                )
            }
        }
    }

    /**
     * Registers a callback that runs when a ConnectionRef is retired.
     */
    suspend fun addRetirementListener(listener: (ConnectionRef) -> Unit) = mutex.withLock {
        retirementListeners.add(listener)
    }

    /**
     * Unregisters a previously registered retirement listener.
     */
    suspend fun removeRetirementListener(listener: (ConnectionRef) -> Unit) = mutex.withLock {
        retirementListeners.remove(listener)
    }

    private fun updateStateFlow() {
        _connectionsState.value = activeGenerations.mapValues { (profileId, gen) ->
            ConnectionRef(profileId, gen)
        }
    }
}
