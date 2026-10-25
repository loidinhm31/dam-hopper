package dev.damhopper.nativeapp.core.ownership

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProfileId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Manages active ConnectionRef instances per ProfileId, enforcing generation fences.
 *
 * Each server profile has an independent monotonically increasing generation counter.
 * Advancing or retiring a profile's generation guarantees that stale background tasks,
 * asynchronous REST responses, and old WebSocket callbacks cannot mutate live state.
 *
 * ## Awaited retirement (C2a1)
 *
 * [retireConnection] and [removeProfile] atomically revoke the usable generation N under the
 * registry [Mutex], reserve (never expose) successor N+1, and run one shared drain:
 *
 * 1. every captured awaited barrier ([addRetirementBarrier]) in registration order, outside the lock;
 * 2. every captured synchronous observer ([addRetirementListener]) in registration order, outside the lock;
 * 3. one non-suspending critical section that seals the disposition, finalizes authority and settles
 *    the shared completion.
 *
 * The whole protocol after revocation is `NonCancellable`. While it is pending or failed the profile is
 * unavailable: [getCurrentConnection] returns null, [connectionsState] omits it, [getOrCreateConnection]
 * and [assertCurrentOwner] throw, [isCurrentOwner] and [admitCurrentOwner] return false.
 *
 * **Transitive restriction:** barriers, observers and any work they await MUST NOT call into this
 * registry or `ProfileRepository`, nor await work that needs their locks. Callers such as
 * `ProfileRepository` may hold their own mutex for the entire drain.
 */
class ConnectionRegistry {
    private val mutex = Mutex()
    private val activeGenerations = mutableMapOf<ProfileId, Long>()
    private val generationWatermarks = mutableMapOf<ProfileId, Long>()
    private val retirementListeners = mutableListOf<(ConnectionRef) -> Unit>()
    private val retirementBarriers = LinkedHashMap<Long, suspend (ConnectionRef) -> Unit>()
    private var nextBarrierToken = 1L
    private val transitions = mutableMapOf<ProfileId, Transition>()

    private val _connectionsState = MutableStateFlow<Map<ProfileId, ConnectionRef>>(emptyMap())
    val connectionsState: StateFlow<Map<ProfileId, ConnectionRef>> = _connectionsState.asStateFlow()

    /**
     * Gets or creates the active ConnectionRef for a profileId.
     * Initial generation starts at 1. Throws [ConnectionOwnerError] (OWNER_MISMATCH) while the profile
     * has a pending or failed retirement transition; it never waits for or skips that transition.
     */
    suspend fun getOrCreateConnection(profileId: ProfileId): ConnectionRef = mutex.withLock {
        require(profileId.isNotBlank()) { "profileId cannot be blank" }
        if (transitions.containsKey(profileId)) {
            throw ConnectionOwnerError(
                "Profile '$profileId' is unavailable during connection retirement",
                ConnectionErrorReason.OWNER_MISMATCH,
            )
        }
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
     * Returns the current ConnectionRef for a profileId if registered and not under retirement.
     */
    suspend fun getCurrentConnection(profileId: ProfileId): ConnectionRef? = mutex.withLock {
        if (transitions.containsKey(profileId)) return@withLock null
        activeGenerations[profileId]?.let { gen -> ConnectionRef(profileId, gen) }
    }

    /**
     * Retires [ref] and returns the real successor with generation N+1 once the full drain completed.
     *
     * - Current generation: atomic revoke, awaited barriers, observers, atomic seal.
     * - Same-generation concurrent retire/remove: joins the in-flight shared completion. A joined
     *   removal disposition throws [ConnectionOwnerError] (OWNER_MISMATCH); no authority is fabricated.
     * - Stale generation after a completed transition: returns the real current ref only.
     * - Any other generation while pending/failed, or an unregistered profile: OWNER_MISMATCH.
     * - Failed/cancelled transitions stay latched; they throw the aggregated failure and re-run nothing.
     *
     * Cancellation after the atomic start still completes the drain, then propagates; a transition that
     * observed caller cancellation before sealing is a failed, unavailable transition.
     */
    suspend fun retireConnection(ref: ConnectionRef): ConnectionRef {
        currentCoroutineContext().ensureActive() // cancellation before atomic start => no transition
        val admission: Admission = mutex.withLock {
            val transition = transitions[ref.profileId]
            if (transition != null) {
                if (transition.retired.generation != ref.generation) {
                    throw ownerMismatch(
                        "Connection generation ${ref.generation} cannot retire while generation " +
                            "${transition.retired.generation} of '${ref.profileId}' is in transition",
                    )
                }
                return@withLock joinPending(transition)
            }
            val current = activeGenerations[ref.profileId]
                ?: throw ownerMismatch("Profile '${ref.profileId}' is not registered; nothing to retire")
            when {
                current == ref.generation -> Start(beginTransition(ref, Disposition.RETIRE))
                ref.generation < current -> Immediate(ConnectionRef(ref.profileId, current))
                else -> throw ownerMismatch(
                    "Connection generation ${ref.generation} is from the future for '${ref.profileId}' (current: $current)",
                )
            }
        }
        if (admission is Immediate) return admission.ref!!
        val settled = settle(admission, runObservers = true)
        return when (settled) {
            is Settled.Failed -> throw settled.error
            is Settled.Completed -> settled.successor
                ?: throw ownerMismatch("Profile '${ref.profileId}' was removed during retirement")
        }
    }

    /**
     * Completely removes a profile (e.g. on logout/delete) after the same awaited drain as
     * [retireConnection], with no successor publication. Returns the retired ref, or null only when the
     * profile is absent and no transition exists. Joining a pending retirement before its seal upgrades
     * the final disposition to removal.
     */
    suspend fun removeProfile(profileId: ProfileId): ConnectionRef? {
        currentCoroutineContext().ensureActive() // cancellation before atomic start => no transition
        val admission: Admission = mutex.withLock {
            val transition = transitions[profileId]
            if (transition != null) {
                if (transition.phase == Phase.PENDING) transition.disposition = Disposition.REMOVE
                return@withLock joinPending(transition)
            }
            val current = activeGenerations[profileId] ?: return@withLock Immediate(null)
            Start(beginTransition(ConnectionRef(profileId, current), Disposition.REMOVE))
        }
        if (admission is Immediate) return admission.ref
        val settled = settle(admission, runObservers = true)
        return when (settled) {
            is Settled.Failed -> throw settled.error
            is Settled.Completed -> when (admission) {
                is Start -> admission.transition.retired
                is Join -> admission.retired
                is Immediate -> null
            }
        }
    }

    /**
     * One explicit, bounded local cleanup attempt for the exact failed old [ref]: re-attempts every
     * originally captured barrier once, in order, with the original disposition and reserved watermark.
     * Concurrent recoveries share one completion. Observers are NOT redispatched. A pending original
     * transition, a wrong ref or a non-failed ref throws [ConnectionOwnerError] (OWNER_MISMATCH). Failure
     * or caller cancellation leaves the transition latched failed; success releases only the original
     * successor/removal and never touches profile, auth or credentials.
     */
    suspend fun recoverRetirement(ref: ConnectionRef) {
        currentCoroutineContext().ensureActive()
        val admission: Admission = mutex.withLock {
            val transition = transitions[ref.profileId]
            if (transition == null || transition.retired != ref) {
                throw ownerMismatch("No failed retirement to recover for $ref")
            }
            when (transition.phase) {
                Phase.PENDING -> throw ownerMismatch("Retirement of $ref is still pending; recovery rejected")
                Phase.RECOVERING -> Join(transition.completion, transition.retired)
                Phase.FAILED -> {
                    transition.phase = Phase.RECOVERING
                    transition.completion = CompletableDeferred()
                    Start(transition)
                }
            }
        }
        val settled = settle(admission, runObservers = false)
        if (settled is Settled.Failed) throw settled.error
    }

    /**
     * Checks if the given ref matches the current generation for its profile.
     * False for any profile under pending or failed retirement.
     */
    suspend fun isCurrentOwner(ref: ConnectionRef): Boolean = mutex.withLock {
        if (transitions.containsKey(ref.profileId)) return@withLock false
        val currentGen = activeGenerations[ref.profileId]
        currentGen != null && currentGen == ref.generation
    }

    /**
     * Asserts that the given ref is currently active. Throws ConnectionOwnerError if stale, missing or
     * under pending/failed retirement.
     */
    suspend fun assertCurrentOwner(ref: ConnectionRef, operation: String = "operation") {
        mutex.withLock {
            val transition = transitions[ref.profileId]
            if (transition != null) {
                val reason = if (ref.generation <= transition.retired.generation) {
                    ConnectionErrorReason.STALE
                } else {
                    ConnectionErrorReason.OWNER_MISMATCH
                }
                throw ConnectionOwnerError(
                    "Connection generation ${ref.generation} of '${ref.profileId}' is unavailable during retirement ($operation)",
                    reason,
                )
            }
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
     * Local linearization point: under the registry [Mutex], rejects generation mismatch and
     * pending/failed retirement (returning false without running [commit]), otherwise runs [commit] and
     * returns its result. [commit] MUST be non-suspending, short, and MUST NOT call this registry,
     * `ProfileRepository` or block; it may only `tryLock` independent operation gates.
     */
    suspend fun admitCurrentOwner(ref: ConnectionRef, commit: () -> Boolean): Boolean = mutex.withLock {
        if (transitions.containsKey(ref.profileId)) return@withLock false
        val currentGen = activeGenerations[ref.profileId]
        if (currentGen == null || currentGen != ref.generation) return@withLock false
        commit()
    }

    /**
     * Registers a synchronous best-effort observer invoked once per original retirement (success or
     * failure) after all awaited barriers finished, outside the registry lock, while the transition is
     * still unavailable. Observers obey the transitive no-registry/profile-reentry restriction.
     */
    suspend fun addRetirementListener(listener: (ConnectionRef) -> Unit) = mutex.withLock {
        retirementListeners.add(listener)
    }

    /**
     * Unregisters a previously registered retirement listener (future captures only).
     */
    suspend fun removeRetirementListener(listener: (ConnectionRef) -> Unit) = mutex.withLock {
        retirementListeners.remove(listener)
    }

    /**
     * Registers an awaited retirement barrier. Returns an opaque, registry-local, monotonic token
     * (never a generation or callback equality key) only after the registration is effective. The
     * barrier receives the exact old ref and must clean up without network or registry/profile reentry.
     */
    suspend fun addRetirementBarrier(barrier: suspend (ConnectionRef) -> Unit): Long = mutex.withLock {
        val token = nextBarrierToken++
        retirementBarriers[token] = barrier
        token
    }

    /**
     * Removes the registration for [token]; true only for a registration actually removed. Affects future
     * captures only: transitions that already captured the barrier keep and await it, including
     * explicit [recoverRetirement].
     */
    suspend fun removeRetirementBarrier(token: Long): Boolean = mutex.withLock {
        retirementBarriers.remove(token) != null
    }

    // ---- internals ----

    private enum class Disposition { RETIRE, REMOVE }

    private enum class Phase { PENDING, FAILED, RECOVERING }

    private sealed interface Settled {
        data class Completed(val disposition: Disposition, val successor: ConnectionRef?) : Settled
        data class Failed(val error: ConnectionOwnerError) : Settled
    }

    private class Transition(
        val retired: ConnectionRef,
        val reservedGeneration: Long,
        var disposition: Disposition,
        val barriers: List<suspend (ConnectionRef) -> Unit>,
        val observers: List<(ConnectionRef) -> Unit>,
    ) {
        var phase: Phase = Phase.PENDING
        var completion: CompletableDeferred<Settled> = CompletableDeferred()
        var failure: ConnectionOwnerError? = null
    }

    private sealed interface Admission
    private class Start(val transition: Transition) : Admission
    private class Join(val completion: CompletableDeferred<Settled>, val retired: ConnectionRef) : Admission
    private class Immediate(val ref: ConnectionRef?) : Admission

    private fun ownerMismatch(message: String) =
        ConnectionOwnerError(message, ConnectionErrorReason.OWNER_MISMATCH)

    /** Joins a pending transition, or rethrows the latched failure of a failed/recovering one. */
    private fun joinPending(transition: Transition): Admission = when (transition.phase) {
        Phase.PENDING -> Join(transition.completion, transition.retired)
        Phase.FAILED, Phase.RECOVERING -> throw checkNotNull(transition.failure)
    }

    /** Atomic revoke; caller holds the registry lock. */
    private fun beginTransition(ref: ConnectionRef, disposition: Disposition): Transition {
        val profileId = ref.profileId
        val reserved = maxOf(generationWatermarks.getOrElse(profileId) { 0L }, ref.generation) + 1L
        if (disposition == Disposition.RETIRE) generationWatermarks[profileId] = reserved
        activeGenerations.remove(profileId)
        val transition = Transition(
            retired = ref,
            reservedGeneration = reserved,
            disposition = disposition,
            barriers = retirementBarriers.values.toList(),
            observers = retirementListeners.toList(),
        )
        transitions[profileId] = transition
        updateStateFlow()
        return transition
    }

    /**
     * Runs the drain (Start) or waits for it (Join), both `NonCancellable`, then propagates the caller's
     * own cancellation, retaining a failed transition's error as suppressed.
     */
    private suspend fun settle(admission: Admission, runObservers: Boolean): Settled {
        val callerJob = currentCoroutineContext()[Job]
        val settled = when (admission) {
            is Start -> drain(admission.transition, callerJob, runObservers)
            is Join -> awaitCompletion(admission.completion)
            is Immediate -> error("Immediate admission has no shared completion")
        }
        try {
            currentCoroutineContext().ensureActive()
        } catch (cancellation: CancellationException) {
            if (settled is Settled.Failed) cancellation.addSuppressed(settled.error)
            throw cancellation
        }
        return settled
    }

    private suspend fun awaitCompletion(completion: CompletableDeferred<Settled>): Settled {
        var result: Settled? = null
        try {
            withContext(NonCancellable) { result = completion.await() }
        } catch (cancellation: CancellationException) {
            if (result == null) throw cancellation
        }
        return checkNotNull(result)
    }

    private suspend fun drain(transition: Transition, callerJob: Job?, runObservers: Boolean): Settled {
        var settled: Settled? = null
        try {
            withContext(NonCancellable) {
                val failures = ArrayList<Throwable>()
                for (barrier in transition.barriers) {
                    try {
                        barrier(transition.retired)
                    } catch (e: Throwable) {
                        failures.add(e)
                    }
                }
                if (runObservers) {
                    for (observer in transition.observers) {
                        try {
                            observer(transition.retired)
                        } catch (_: Throwable) {
                            // Observers are best effort; failures never block finalization
                        }
                    }
                }
                val callerCancelled = callerJob?.isActive == false
                settled = mutex.withLock { seal(transition, failures, callerCancelled) }
            }
        } catch (cancellation: CancellationException) {
            if (settled == null) throw cancellation
        }
        return checkNotNull(settled)
    }

    /** Seals disposition, finalizes authority and settles the shared completion atomically. */
    private fun seal(transition: Transition, failures: List<Throwable>, callerCancelled: Boolean): Settled {
        val profileId = transition.retired.profileId
        val settled: Settled
        if (failures.isEmpty() && !callerCancelled) {
            transitions.remove(profileId)
            val successor = if (transition.disposition == Disposition.RETIRE) {
                activeGenerations[profileId] = transition.reservedGeneration
                ConnectionRef(profileId, transition.reservedGeneration)
            } else {
                null
            }
            settled = Settled.Completed(transition.disposition, successor)
        } else {
            val error = ConnectionOwnerError(
                if (failures.isEmpty()) {
                    "Retirement of ${transition.retired} was cancelled before finalization; profile stays unavailable"
                } else {
                    "Retirement of ${transition.retired} failed in ${failures.size} barrier(s); profile stays unavailable"
                },
                ConnectionErrorReason.OWNER_MISMATCH,
            )
            failures.forEach { error.addSuppressed(it) }
            transition.phase = Phase.FAILED
            transition.failure = error
            settled = Settled.Failed(error)
        }
        transition.completion.complete(settled)
        updateStateFlow()
        return settled
    }

    private fun updateStateFlow() {
        _connectionsState.value = activeGenerations.mapValues { (profileId, gen) ->
            ConnectionRef(profileId, gen)
        }
    }
}
