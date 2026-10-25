package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Lifetime of the retained owner's registry barrier (C2a1 consumption): register-before-eligible,
 * registration cancellation, shared concurrent outcome, captured-barrier-survives-unregister and
 * close-drain-before-unregister including refs only the registry's failed transition still knows.
 */
class NativeWorkspaceViewModelTest {

    @Test
    fun producersAreIneligibleUntilTheBarrierIsRegistered() = runBlocking {
        val registry = ConnectionRegistry()
        val lifetime = RetirementLifetime(registry, retireOwner = {})
        assertFalse(lifetime.eligible)
        assertNull(lifetime.registeredToken)
        assertTrue(lifetime.register())
        assertTrue(lifetime.eligible)
        assertNotNull(lifetime.registeredToken)
        assertTrue(lifetime.awaitEligible())
    }

    @Test
    fun cancelledRegistrationLeavesEverythingIneligibleWithNoFallbackListener() = runBlocking {
        val registry = ConnectionRegistry()
        val lifetime = RetirementLifetime(registry, retireOwner = {})
        val cancelled = Job().apply { cancel() }
        assertFailsWith<CancellationException> { withContext(cancelled) { lifetime.register() } }
        assertFalse(lifetime.eligible, "nothing becomes eligible without a registered barrier")
        assertNull(lifetime.registeredToken)
    }

    @Test
    fun concurrentRetireesShareOneBarrierRunAndOldCleanupCannotTouchTheSuccessor() = runBlocking {
        val registry = ConnectionRegistry()
        val old = registry.getOrCreateConnection("p")
        val gate = CompletableDeferred<Unit>()
        val retired = mutableListOf<ConnectionRef>()
        val lifetime = RetirementLifetime(registry, retireOwner = { ref ->
            synchronized(retired) { retired += ref }
            gate.await()
        })
        lifetime.register()

        val first = async(kotlinx.coroutines.Dispatchers.Default) { registry.retireConnection(old) }
        val second = async(kotlinx.coroutines.Dispatchers.Default) { registry.retireConnection(old) }
        delay(100)
        assertFalse(first.isCompleted || second.isCompleted)
        gate.complete(Unit)
        val a = withTimeout(5_000) { first.await() }
        val b = withTimeout(5_000) { second.await() }
        assertEquals(a, b, "same-generation retirees observe one shared result")
        assertEquals(listOf(old), synchronized(retired) { retired.toList() }, "the barrier ran once, for exactly the old ref")
        assertEquals(old.generation + 1, a.generation)
    }

    @Test
    fun aCapturedBarrierSurvivesUnregistrationOfItsToken() = runBlocking {
        val registry = ConnectionRegistry()
        val old = registry.getOrCreateConnection("p")
        val started = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        val lifetime = RetirementLifetime(registry, retireOwner = { started.complete(Unit); calls++; gate.await() })
        lifetime.register()
        val retire = async(kotlinx.coroutines.Dispatchers.Default) { registry.retireConnection(old) }
        withTimeout(5_000) { started.await() }

        assertTrue(registry.removeRetirementBarrier(assertNotNull(lifetime.registeredToken)))
        gate.complete(Unit)
        val successor = withTimeout(5_000) { retire.await() }
        assertEquals(1, calls, "the already captured barrier was still awaited")
        assertEquals(old.generation + 1, successor.generation)
    }

    @Test
    fun closeDrainsEveryOwnedRefIncludingFailedRetirementsBeforeUnregistering() = runBlocking {
        val registry = ConnectionRegistry()
        val old = registry.getOrCreateConnection("p")
        val events = mutableListOf<String>()
        var failFirst = true
        val lifetime = RetirementLifetime(registry, retireOwner = { ref ->
            events += "drain:${ref.generation}"
            if (failFirst) {
                failFirst = false
                error("cleanup failed")
            }
        })
        lifetime.register()
        val other = ConnectionRef("q", 4L)
        lifetime.own(other)

        // The registry transition fails and the profile stays unavailable: only the barrier argument knows the ref.
        assertFailsWith<Throwable> { registry.retireConnection(old) }
        assertNull(registry.getCurrentConnection("p"))
        assertTrue(old in lifetime.ownedRefs())

        val token = assertNotNull(lifetime.registeredToken)
        assertTrue(lifetime.close(), "close drains the failed ref and the other owned ref")
        assertTrue(events.containsAll(listOf("drain:${old.generation}", "drain:4")))
        assertFalse(lifetime.eligible, "producers are disabled")
        assertNull(lifetime.registeredToken, "the token is removed only after a successful drain")
        assertFalse(registry.removeRetirementBarrier(token), "already removed")
    }

    @Test
    fun failedCloseDrainKeepsTheBarrierRegisteredUntilOneBoundedRecovery() = runBlocking {
        val registry = ConnectionRegistry()
        var healthy = false
        val lifetime = RetirementLifetime(registry, retireOwner = { if (!healthy) error("audio stop failed") })
        lifetime.register()
        lifetime.own(ConnectionRef("p", 1L))

        assertFalse(lifetime.close(), "a failed drain reports failure")
        assertNotNull(lifetime.registeredToken, "fenced capability is preserved, never unregister-first")
        healthy = true
        assertTrue(lifetime.recoverClose())
        assertNull(lifetime.registeredToken)
    }

    private fun rosterBinding(
        ref: ConnectionRef,
        scope: kotlinx.coroutines.CoroutineScope,
    ) = TerminalAgentsRuntimeBinding(
        owner = ref,
        endpoint = "http://127.0.0.1:1",
        accountUser = "alice",
        ws = dev.damhopper.nativeapp.core.transport.WsConnection(ref, "http://127.0.0.1:1"),
        reducer = dev.damhopper.nativeapp.features.terminal.AgentStatusReducer(),
        scope = scope,
        listDetailed = {
            listOf(
                dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed(
                    id = "t1", incarnation = 1uL, project = "proj", command = "sh", cwd = "/w",
                ),
            )
        },
    )

    @Test
    fun retirementBarrierRevokesRosterAuthorityUnderItsOwnGateAndReleasesItBeforeDrainingChildren() = runBlocking {
        val registry = ConnectionRegistry()
        val old = registry.getOrCreateConnection("p")
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default)
        val inventory = TerminalAgentsInventoryCoordinator()
        val attachment = inventory.attach(rosterBinding(old, scope))
        inventory.onSocketState(
            attachment,
            dev.damhopper.nativeapp.core.model.SocketInstanceRef(old, "sock-1"),
            dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason.CONNECTED,
        )
        withTimeout(10_000) { while (inventory.inventories.value.isEmpty()) delay(10) }

        val gateHeldWhileDraining = java.util.concurrent.atomic.AtomicBoolean(true)
        val childFinished = CompletableDeferred<Unit>()
        val lifetime = RetirementLifetime(registry, retireOwner = { ref ->
            // Revoke under the roster's own short gate, which must be released BEFORE the children are awaited.
            inventory.retireIdentity(ref)
            gateHeldWhileDraining.set(inventory.rosterLock.isHeldByCurrentThread)
            // A child of the old runtime that itself needs the roster gate must be able to finish (no held gate).
            val child = scope.launch(kotlinx.coroutines.Dispatchers.Default) {
                inventory.underRosterGate { }
                childFinished.complete(Unit)
            }
            child.join()
        })
        assertTrue(lifetime.register())

        val successor = withTimeout(10_000) { registry.retireConnection(old) }
        assertEquals(old.generation + 1, successor.generation)
        assertFalse(gateHeldWhileDraining.get(), "the roster gate is released before awaiting children")
        assertTrue(childFinished.isCompleted)
        assertTrue(attachment.revoked)
        assertTrue(inventory.inventories.value.isEmpty(), "attachment/receipt authority was revoked first")
        scope.cancel()
    }

    @Test
    fun aRetiredGenerationCannotRevokeOrPurgeASuccessorAttachment() = runBlocking {
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default)
        val inventory = TerminalAgentsInventoryCoordinator()
        val old = ConnectionRef("p", 1L)
        val successor = ConnectionRef("p", 2L)
        inventory.attach(rosterBinding(old, scope))
        val live = inventory.attach(rosterBinding(successor, scope))
        inventory.onSocketState(
            live,
            dev.damhopper.nativeapp.core.model.SocketInstanceRef(successor, "sock-1"),
            dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason.CONNECTED,
        )
        withTimeout(10_000) { while (inventory.inventories.value.isEmpty()) delay(10) }

        inventory.retireIdentity(old) // late retirement of the old generation
        assertFalse(live.revoked, "the successor generation is untouched")
        assertEquals(1, inventory.inventories.value.size)
        scope.cancel()
    }
}
