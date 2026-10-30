package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TerminalAttachQueueBindingTest {

    @Test
    fun staleRequestErrorDoesNotFailCurrentControllerAttachGate() = runTest {
        val conn1 = ConnectionRef("profile-1", 1L)
        val controller = TerminalSessionController(
            sessionId = "term-1",
            initialIncarnation = 1L,
            connectionRef = conn1,
        )

        val queue1 = TerminalAttachQueue(controller, this)
        var isCurrent1 = true
        val sendProceed = CompletableDeferred<Unit>()

        queue1.attach(
            isCurrent = { isCurrent1 },
            connect = {},
            send = {
                sendProceed.await()
                throw RuntimeException("Stale network transport error")
            },
            onResult = {},
        )

        // Binding changes to generation 2
        isCurrent1 = false
        // Replay gate receives server data on the controller
        controller.handleBufferReplay("retained bytes\n".encodeToByteArray(), 0uL, reset = true, truncated = false, bufferIncarnation = 1uL)
        // Allow stale send to fail
        sendProceed.complete(Unit)
        testScheduler.runCurrent()

        // Verify the gate was NOT failed by the stale request
        assertFalse(controller.gate.isAttachFailed, "Stale request failure must not trip controller.failAttach")
    }

    @Test
    fun staleCancellationDoesNotTripCurrentControllerAttachGate() = runTest {
        val conn1 = ConnectionRef("profile-1", 1L)
        val controller = TerminalSessionController(
            sessionId = "term-1",
            initialIncarnation = 1L,
            connectionRef = conn1,
        )

        var isCurrent1 = true
        val workerScope = CoroutineScope(Dispatchers.Unconfined)
        val queue1 = TerminalAttachQueue(controller, workerScope)
        val sendStarted = CompletableDeferred<Unit>()

        queue1.attach(
            isCurrent = { isCurrent1 },
            connect = {},
            send = {
                sendStarted.complete(Unit)
                CompletableDeferred<Unit>().await() // Wait indefinitely until cancelled
            },
            onResult = {},
        )

        sendStarted.await()
        // Stale binding
        isCurrent1 = false
        // Cancel worker scope
        workerScope.cancel(CancellationException("Screen unmounted or generation bumped"))

        // Gate must not be failed
        assertFalse(controller.gate.isAttachFailed, "Cancelled stale queue must not fail retained controller gate")
    }

    @Test
    fun staleAttachCallDoesNotCallBeginAttach() = runTest {
        val conn1 = ConnectionRef("profile-1", 1L)
        val controller = TerminalSessionController(
            sessionId = "term-1",
            initialIncarnation = 1L,
            connectionRef = conn1,
        )

        controller.handleBufferReplay("data\n".encodeToByteArray(), 10uL, reset = true, truncated = false, bufferIncarnation = 1uL)
        assertEquals(10uL, controller.lastSeenOffset)

        val queue = TerminalAttachQueue(controller, this)
        // Stale request from the outset
        val offset = queue.attach(
            isCurrent = { false },
            connect = {},
            send = {},
            onResult = {},
        )

        assertEquals(10uL, offset)
        assertFalse(controller.gate.isAttachFailed)
    }

    @Test
    fun currentFailureClosesItsOwnGate() = runTest {
        val conn1 = ConnectionRef("profile-1", 1L)
        val controller = TerminalSessionController(
            sessionId = "term-1",
            initialIncarnation = 1L,
            connectionRef = conn1,
        )

        val queue = TerminalAttachQueue(controller, this)
        var receivedError: Exception? = null

        queue.attach(
            isCurrent = { true },
            connect = {},
            send = { throw RuntimeException("Real network failure") },
            onResult = { receivedError = it },
        )

        testScheduler.runCurrent()
        assertTrue(controller.gate.isAttachFailed, "Current failure must close gate")
        assertEquals("Real network failure", receivedError?.message)
    }
}
