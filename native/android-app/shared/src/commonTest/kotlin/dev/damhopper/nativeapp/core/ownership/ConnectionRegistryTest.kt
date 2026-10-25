package dev.damhopper.nativeapp.core.ownership

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import kotlinx.coroutines.Job
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConnectionRegistryTest {

    @Test
    fun testIndependentProfileGenerations() = runTest {
        val registry = ConnectionRegistry()

        val connA = registry.getOrCreateConnection("profile-a")
        val connB = registry.getOrCreateConnection("profile-b")

        assertEquals("profile-a", connA.profileId)
        assertEquals(1L, connA.generation)
        assertEquals("profile-b", connB.profileId)
        assertEquals(1L, connB.generation)

        assertTrue(registry.isCurrentOwner(connA))
        assertTrue(registry.isCurrentOwner(connB))

        // Retiring profile A must NOT affect profile B
        val retiredA = registry.retireConnection(connA)
        assertEquals("profile-a", retiredA.profileId)
        assertEquals(2L, retiredA.generation)

        assertFalse(registry.isCurrentOwner(connA)) // Old generation 1 is now stale
        assertTrue(registry.isCurrentOwner(retiredA)) // New generation 2 is active
        assertTrue(registry.isCurrentOwner(connB)) // Profile B is untouched at gen 1
    }

    @Test
    fun testStaleOwnerAssertionThrows() = runTest {
        val registry = ConnectionRegistry()
        val initial = registry.getOrCreateConnection("server-1")

        // First assertion passes
        registry.assertCurrentOwner(initial, "initial-op")

        // Retire connection
        val updated = registry.retireConnection(initial)
        assertEquals(2L, updated.generation)

        // Attempting operation with stale initial connection MUST throw ConnectionOwnerError.STALE
        val err = assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(initial, "stale-op")
        }
        assertEquals(ConnectionErrorReason.STALE, err.reason)
        assertTrue(err.message?.contains("stale") == true)

        // Operation with updated connection passes
        registry.assertCurrentOwner(updated, "new-op")
    }

    @Test
    fun testRetirementListenerNotification() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection("prod-server")

        var notifiedRef: ConnectionRef? = null
        val listener: (ConnectionRef) -> Unit = { ref -> notifiedRef = ref }
        registry.addRetirementListener(listener)

        val newConn = registry.retireConnection(conn)
        assertEquals(conn, notifiedRef)

        // Removing listener
        registry.removeRetirementListener(listener)
        notifiedRef = null
        registry.retireConnection(newConn)
        assertEquals(null, notifiedRef)
    }

    @Test
    fun testRemoveProfileCleansUpState() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection("temp-server")

        assertTrue(registry.isCurrentOwner(conn))
        val removed = registry.removeProfile("temp-server")
        assertEquals(conn, removed)

        assertFalse(registry.isCurrentOwner(conn))
        assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(conn, "post-remove")
        }
    }

    @Test
    fun testAbaGenerationPreventionOnRecreation() = runTest {
        val registry = ConnectionRegistry()
        val conn1 = registry.getOrCreateConnection("recreated-profile")
        assertEquals(1L, conn1.generation)

        val conn2 = registry.retireConnection(conn1)
        assertEquals(2L, conn2.generation)

        // Profile is removed (e.g. logged out)
        registry.removeProfile("recreated-profile")

        // Profile is re-added; its new generation MUST be monotonic (3L, NOT resetting to 1L or 2L)
        val conn3 = registry.getOrCreateConnection("recreated-profile")
        assertEquals(3L, conn3.generation)
        assertTrue(conn3.generation > conn2.generation)

        // Old callbacks with conn1 or conn2 are rejected
        assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(conn1, "old-stale-callback")
        }
        assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(conn2, "old-stale-callback")
        }
        registry.assertCurrentOwner(conn3, "valid-active-callback")
    }

    // ---- C2a1 awaited retirement barrier: named regressions ----

    private val profile = "p"

    @Test
    fun pendingRetirementFencesSuccessor() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        val seen = mutableListOf<ConnectionRef>()
        registry.addRetirementBarrier { ref ->
            seen += ref
            gate.await()
        }

        val retire = async { registry.retireConnection(conn) }
        runCurrent()
        assertEquals(listOf(conn), seen)
        assertTrue(retire.isActive)

        // Atomic revoke: N is unusable immediately and the reserved successor is not exposed.
        val reserved = ConnectionRef(profile, 2L)
        assertNull(registry.getCurrentConnection(profile))
        assertFalse(registry.connectionsState.value.containsKey(profile))
        val createError = assertFailsWith<ConnectionOwnerError> { registry.getOrCreateConnection(profile) }
        assertEquals(ConnectionErrorReason.OWNER_MISMATCH, createError.reason)
        assertFalse(registry.isCurrentOwner(conn))
        assertFalse(registry.isCurrentOwner(reserved))
        assertFailsWith<ConnectionOwnerError> { registry.assertCurrentOwner(reserved, "guessed-successor") }
        var committed = false
        assertFalse(registry.admitCurrentOwner(reserved) { committed = true; true })
        assertFalse(registry.admitCurrentOwner(conn) { committed = true; true })
        assertFalse(committed)
        // Other profiles are unaffected by the transition.
        assertEquals(1L, registry.getOrCreateConnection("other").generation)

        gate.complete(Unit)
        val successor = retire.await()
        assertEquals(reserved, successor)
        assertEquals(successor, registry.getCurrentConnection(profile))
        assertTrue(registry.connectionsState.value.containsKey(profile))
        assertTrue(registry.admitCurrentOwner(successor) { committed = true; true })
        assertTrue(committed)
    }

    @Test
    fun concurrentRetireesShareCompletion() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        var barrierCalls = 0
        registry.addRetirementBarrier {
            barrierCalls++
            gate.await()
        }

        val first = async { registry.retireConnection(conn) }
        runCurrent()
        val second = async { registry.retireConnection(conn) }
        val third = async { registry.retireConnection(conn) }
        runCurrent()
        assertEquals(1, barrierCalls)
        assertTrue(first.isActive && second.isActive && third.isActive)

        gate.complete(Unit)
        val results = listOf(first.await(), second.await(), third.await())
        assertEquals(1, results.toSet().size)
        assertEquals(2L, results.first().generation)
        assertEquals(1, barrierCalls)

        // A stale ref after the completed transition returns the real successor and drains nothing.
        assertEquals(results.first(), registry.retireConnection(conn))
        assertEquals(1, barrierCalls)
    }

    @Test
    fun canceledJoinerWaitsForSharedDrainThenPropagates() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        var entered = false
        registry.addRetirementBarrier {
            entered = true
            gate.await()
        }

        val initiator = async { registry.retireConnection(conn) }
        runCurrent()
        assertTrue(entered)
        var joinerCancellation: CancellationException? = null
        val joiner = launch {
            try {
                registry.retireConnection(conn)
            } catch (e: CancellationException) {
                joinerCancellation = e
                throw e
            }
        }
        runCurrent()
        joiner.cancel()
        runCurrent()
        // Joiner cancellation neither cancels the shared drain nor completes before it.
        assertTrue(initiator.isActive)
        assertFalse(joiner.isCompleted)

        gate.complete(Unit)
        assertEquals(2L, initiator.await().generation)
        joiner.join()
        assertNotNull(joinerCancellation)
        assertEquals(2L, registry.getCurrentConnection(profile)?.generation)
    }

    @Test
    fun allBarriersAttemptedAfterFailure() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val events = mutableListOf<String>()
        var observed = 0
        registry.addRetirementBarrier { ref ->
            events += "b1:${ref.generation}"
            throw IllegalStateException("first failure")
        }
        registry.addRetirementBarrier { ref -> events += "b2:${ref.generation}" }
        registry.addRetirementBarrier { ref ->
            events += "b3:${ref.generation}"
            throw CancellationException("barrier cancelled itself")
        }
        registry.addRetirementBarrier { ref -> events += "b4:${ref.generation}" }
        registry.addRetirementListener { observed++ }

        val error = assertFailsWith<ConnectionOwnerError> { registry.retireConnection(conn) }
        assertEquals(ConnectionErrorReason.OWNER_MISMATCH, error.reason)
        // Every captured barrier ran once, in registration order, with the exact old ref.
        assertEquals(listOf("b1:1", "b2:1", "b3:1", "b4:1"), events)
        assertEquals(2, error.suppressedExceptions.size)
        assertTrue(error.suppressedExceptions.any { it is IllegalStateException })
        assertTrue(error.suppressedExceptions.any { it is CancellationException })
        // Observers still dispatch once for the original failed retirement.
        assertEquals(1, observed)
        assertNull(registry.getCurrentConnection(profile))
    }

    @Test
    fun failedAndCancelledRetirementStayUnavailable() = runTest {
        // Failure latch: ordinary calls neither clear it, allocate a generation, nor rerun callbacks.
        val failing = ConnectionRegistry()
        val failedConn = failing.getOrCreateConnection(profile)
        var attempts = 0
        failing.addRetirementBarrier {
            attempts++
            throw IllegalStateException("cleanup failed")
        }
        assertFailsWith<ConnectionOwnerError> { failing.retireConnection(failedConn) }
        assertEquals(1, attempts)
        assertNull(failing.getCurrentConnection(profile))
        assertFalse(failing.connectionsState.value.containsKey(profile))
        assertEquals(
            ConnectionErrorReason.OWNER_MISMATCH,
            assertFailsWith<ConnectionOwnerError> { failing.getOrCreateConnection(profile) }.reason,
        )
        assertFailsWith<ConnectionOwnerError> { failing.retireConnection(failedConn) }
        assertFailsWith<ConnectionOwnerError> { failing.removeProfile(profile) }
        assertFailsWith<ConnectionOwnerError> { failing.retireConnection(ConnectionRef(profile, 2L)) }
        assertFalse(failing.admitCurrentOwner(ConnectionRef(profile, 2L)) { true })
        assertFalse(failing.isCurrentOwner(failedConn))
        assertEquals(1, attempts)

        // Cancellation after the atomic start: cleanup finishes, transition is failed/unavailable,
        // and the caller's own cancellation propagates.
        val cancelled = ConnectionRegistry()
        val cancelledConn = cancelled.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        var cleaned = false
        var entered = false
        cancelled.addRetirementBarrier {
            entered = true
            gate.await()
            cleaned = true
        }
        var caught: CancellationException? = null
        val caller = launch {
            try {
                cancelled.retireConnection(cancelledConn)
            } catch (e: CancellationException) {
                caught = e
                throw e
            }
        }
        runCurrent()
        assertTrue(entered, "drain must be parked inside the barrier before cancelling")
        caller.cancel()
        gate.complete(Unit)
        caller.join()
        assertTrue(cleaned)
        assertNotNull(caught)
        assertTrue(caught!!.suppressedExceptions.any { it is ConnectionOwnerError })
        assertNull(cancelled.getCurrentConnection(profile))
        assertFailsWith<ConnectionOwnerError> { cancelled.getOrCreateConnection(profile) }

        // Cancellation before the atomic start makes no transition.
        val untouched = ConnectionRegistry()
        val untouchedConn = untouched.getOrCreateConnection(profile)
        val preCancelled = launch(start = CoroutineStart.UNDISPATCHED) {
            currentCoroutineContext().cancel()
            untouched.retireConnection(untouchedConn)
        }
        preCancelled.join()
        assertTrue(preCancelled.isCancelled)
        assertEquals(untouchedConn, untouched.getCurrentConnection(profile))
    }

    @Test
    fun explicitRecoveryIsBounded() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        var failing = true
        var attempts = 0
        var observed = 0
        val token = registry.addRetirementBarrier {
            attempts++
            if (failing) throw IllegalStateException("cleanup")
        }
        registry.addRetirementListener { observed++ }

        assertFailsWith<ConnectionOwnerError> { registry.retireConnection(conn) }
        advanceUntilIdle()
        assertEquals(1, attempts) // no implicit retry loop
        assertEquals(1, observed)

        // Wrong, unknown or already-healthy refs are rejected without touching callbacks.
        assertFailsWith<ConnectionOwnerError> { registry.recoverRetirement(ConnectionRef(profile, 2L)) }
        assertFailsWith<ConnectionOwnerError> { registry.recoverRetirement(ConnectionRef("other", 1L)) }
        assertEquals(1, attempts)

        // Barrier unregistration does not shrink an already captured recovery set.
        assertTrue(registry.removeRetirementBarrier(token))

        // One recovery call = one attempt of every captured barrier; failure stays latched.
        val failedRecovery = assertFailsWith<ConnectionOwnerError> { registry.recoverRetirement(conn) }
        assertEquals(2, attempts)
        assertEquals(1, failedRecovery.suppressedExceptions.size)
        assertNull(registry.getCurrentConnection(profile))
        advanceUntilIdle()
        assertEquals(2, attempts)

        failing = false
        registry.recoverRetirement(conn)
        assertEquals(3, attempts)
        assertEquals(1, observed) // observers never redispatch on recovery
        // Recovery releases only the original successor; N is not rolled back.
        assertEquals(ConnectionRef(profile, 2L), registry.getCurrentConnection(profile))
        assertFalse(registry.isCurrentOwner(conn))
        assertFailsWith<ConnectionOwnerError> { registry.recoverRetirement(conn) }
        assertEquals(3, attempts)
    }

    @Test
    fun recoveryRejectedWhilePendingAndSharedWhenConcurrent() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        registry.addRetirementBarrier {
            calls++
            if (calls == 1) throw IllegalStateException("first attempt fails")
            gate.await()
        }

        assertFailsWith<ConnectionOwnerError> { registry.retireConnection(conn) }
        val recoveryA = async { registry.recoverRetirement(conn) }
        runCurrent()
        val recoveryB = async { registry.recoverRetirement(conn) }
        runCurrent()
        assertEquals(2, calls) // concurrent recoveries share one attempt
        assertNull(registry.getCurrentConnection(profile))

        gate.complete(Unit)
        recoveryA.await()
        recoveryB.await()
        assertEquals(2, calls)
        assertEquals(2L, registry.getCurrentConnection(profile)?.generation)

        // Recovery of an original that is still pending is rejected.
        val pendingRegistry = ConnectionRegistry()
        val pendingConn = pendingRegistry.getOrCreateConnection(profile)
        val pendingGate = CompletableDeferred<Unit>()
        pendingRegistry.addRetirementBarrier { pendingGate.await() }
        val pending = async { pendingRegistry.retireConnection(pendingConn) }
        runCurrent()
        assertFailsWith<ConnectionOwnerError> { pendingRegistry.recoverRetirement(pendingConn) }
        pendingGate.complete(Unit)
        assertEquals(2L, pending.await().generation)
    }

    @Test
    fun removeAndRetireShareDrain() = runTest {
        // retire first, remove joins before sealing => final disposition is removal
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        var barrierCalls = 0
        registry.addRetirementBarrier {
            barrierCalls++
            gate.await()
        }
        val retire = async { runCatching { registry.retireConnection(conn) } }
        runCurrent()
        val remove = async { registry.removeProfile(profile) }
        runCurrent()
        assertEquals(1, barrierCalls)

        gate.complete(Unit)
        assertTrue(retire.await().exceptionOrNull() is ConnectionOwnerError) // no synthetic successor
        assertEquals(conn, remove.await())
        assertEquals(1, barrierCalls)
        assertNull(registry.getCurrentConnection(profile))
        assertFalse(registry.connectionsState.value.containsKey(profile))
        // Reserved N+1 is never resurrected; a fresh create stays monotonic.
        assertEquals(3L, registry.getOrCreateConnection(profile).generation)

        // remove first, retire joins => retire cannot recreate the profile
        val reverse = ConnectionRegistry()
        val reverseConn = reverse.getOrCreateConnection(profile)
        val reverseGate = CompletableDeferred<Unit>()
        reverse.addRetirementBarrier { reverseGate.await() }
        val firstRemove = async { reverse.removeProfile(profile) }
        runCurrent()
        val joinedRetire = async { runCatching { reverse.retireConnection(reverseConn) } }
        runCurrent()
        reverseGate.complete(Unit)
        assertEquals(reverseConn, firstRemove.await())
        assertTrue(joinedRetire.await().exceptionOrNull() is ConnectionOwnerError)
        assertNull(reverse.getCurrentConnection(profile))
        assertNull(reverse.removeProfile(profile)) // absent and no transition => null
    }

    @Test
    fun capturedBarrierSurvivesUnregistration() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val gate = CompletableDeferred<Unit>()
        val seen = mutableListOf<String>()
        val gateToken = registry.addRetirementBarrier { ref ->
            seen += "gate:${ref.generation}"
            gate.await()
        }
        val capturedToken = registry.addRetirementBarrier { ref -> seen += "captured:${ref.generation}" }
        assertTrue(capturedToken > gateToken) // opaque monotonic tokens

        val retire = async { registry.retireConnection(conn) }
        runCurrent()
        assertEquals(listOf("gate:1"), seen) // drain entered and parked before unregistration
        assertTrue(registry.removeRetirementBarrier(capturedToken))
        assertFalse(registry.removeRetirementBarrier(capturedToken))
        assertFalse(registry.removeRetirementBarrier(Long.MAX_VALUE))

        gate.complete(Unit)
        val successor = retire.await()
        assertEquals(listOf("gate:1", "captured:1"), seen) // already captured => still awaited

        // Removal affects only future captures.
        registry.retireConnection(successor)
        assertEquals(listOf("gate:1", "captured:1", "gate:2"), seen)
    }

    @Test
    fun cancellationObservedAtSealBoundaryLatchesFailureAndRecoveryReleasesSuccessor() = runTest {
        // All barriers succeed; the caller is cancelled while observers run, i.e. after the drain but
        // before finalization: the transition must still become failed/unavailable (no successor).
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        var barrierCalls = 0
        var observerCalls = 0
        var callerJob: Job? = null
        registry.addRetirementBarrier { barrierCalls++ }
        registry.addRetirementListener {
            observerCalls++
            callerJob?.cancel()
        }

        var caught: CancellationException? = null
        val caller = launch(start = CoroutineStart.LAZY) {
            try {
                registry.retireConnection(conn)
            } catch (e: CancellationException) {
                caught = e
                throw e
            }
        }
        callerJob = caller
        caller.start()
        caller.join()

        assertEquals(1, barrierCalls)
        assertEquals(1, observerCalls)
        assertNotNull(caught)
        assertTrue(caught!!.suppressedExceptions.any { it is ConnectionOwnerError })
        assertNull(registry.getCurrentConnection(profile))
        assertFalse(registry.connectionsState.value.containsKey(profile))
        assertFailsWith<ConnectionOwnerError> { registry.getOrCreateConnection(profile) }

        // Explicit recovery (not a retry loop) releases exactly the original successor, no observer redispatch.
        registry.recoverRetirement(conn)
        assertEquals(2, barrierCalls)
        assertEquals(1, observerCalls)
        assertEquals(ConnectionRef(profile, 2L), registry.getCurrentConnection(profile))
    }

    @Test
    fun observersRunAfterDrainOutsideRegistryLock() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val events = mutableListOf<String>()
        registry.addRetirementBarrier { ref -> events += "barrier:${ref.generation}" }

        var probeCompleted = false
        var probeCurrent: ConnectionRef? = ConnectionRef("sentinel", 9999L)
        var probeCreateError: ConnectionOwnerError? = null
        var probeAdmitted: Boolean? = null
        registry.addRetirementListener { ref ->
            events += "observer:${ref.generation}"
            // UNDISPATCHED probes complete synchronously only when the registry lock is free, and
            // they must observe the still-unavailable transition (no successor before the seal).
            launch(start = CoroutineStart.UNDISPATCHED) {
                probeCurrent = registry.getCurrentConnection(profile)
                probeCreateError = runCatching { registry.getOrCreateConnection(profile) }
                    .exceptionOrNull() as? ConnectionOwnerError
                probeAdmitted = registry.admitCurrentOwner(ConnectionRef(profile, 2L)) { true }
                probeCompleted = true
            }
        }

        val successor = registry.retireConnection(conn)
        assertEquals(listOf("barrier:1", "observer:1"), events)
        assertTrue(probeCompleted, "observer dispatch must not hold the registry lock")
        assertNull(probeCurrent)
        assertEquals(ConnectionErrorReason.OWNER_MISMATCH, probeCreateError?.reason)
        assertEquals(false, probeAdmitted)
        assertEquals(ConnectionRef(profile, 2L), successor)
        assertEquals(successor, registry.getCurrentConnection(profile))
    }

    @Test
    fun preSealRemoveUpgradesDispositionAndPostSealRemoveDrainsSuccessor() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        val barrierRefs = mutableListOf<ConnectionRef>()
        registry.addRetirementBarrier { ref -> barrierRefs += ref }
        var removal: Deferred<ConnectionRef?>? = null
        val observerToken = registry.addRetirementListener { ref ->
            if (ref == conn) {
                removal = async(start = CoroutineStart.UNDISPATCHED) { registry.removeProfile(profile) }
            }
        }
        assertTrue(observerToken)

        // Pre-seal removal (issued while the observer pauses the transition) finalizes as removal.
        assertTrue(runCatching { registry.retireConnection(conn) }.exceptionOrNull() is ConnectionOwnerError)
        assertEquals(conn, removal!!.await())
        assertEquals(listOf(conn), barrierRefs) // joined the drain; N cleanup not reused
        assertNull(registry.getCurrentConnection(profile))
        assertTrue(registry.connectionsState.value.isEmpty())

        // Post-seal: a fresh authority is drained in its own cycle, never with N's cleanup.
        val fresh = registry.getOrCreateConnection(profile)
        assertEquals(3L, fresh.generation)
        assertEquals(fresh, registry.removeProfile(profile))
        assertEquals(listOf(conn, fresh), barrierRefs)
    }

    @Test
    fun admitCurrentOwnerCommitsOnlyForCurrentAvailableOwner() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection(profile)
        var commits = 0
        assertTrue(registry.admitCurrentOwner(conn) { commits++; true })
        assertFalse(registry.admitCurrentOwner(conn) { commits++; false }) // commit decides
        assertFalse(registry.admitCurrentOwner(ConnectionRef(profile, 9L)) { commits++; true })
        assertFalse(registry.admitCurrentOwner(ConnectionRef("unknown", 1L)) { commits++; true })
        assertEquals(2, commits)

        val successor = registry.retireConnection(conn)
        assertFalse(registry.admitCurrentOwner(conn) { commits++; true })
        assertTrue(registry.admitCurrentOwner(successor) { commits++; true })
        assertEquals(3, commits)

        assertFailsWith<ConnectionOwnerError> { registry.retireConnection(ConnectionRef("never-registered", 1L)) }
    }
}
