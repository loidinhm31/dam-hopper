package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class TerminalPresentationPolicyTest {
    @Test
    fun followUsesUserIntentEstablishedBeforePublicationNotPostAppendBottomState() {
        val policy = TerminalFollowPolicy()
        assertEquals(TerminalScrollTarget(2), policy.onContentChanged(listOf(10L, 11L, 12L)))
        // New output makes the old viewport non-bottom; layout must not revoke prior follow intent.
        assertEquals(TerminalScrollTarget(3), policy.onContentChanged(listOf(10L, 11L, 12L, 13L)))
        policy.beginUserScroll()
        policy.observeUserScroll(atBottom = false, firstRowId = 11L, offset = 7)
        assertEquals(TerminalScrollTarget(1, 7), policy.onContentChanged(listOf(10L, 11L, 12L, 13L, 14L)))
        assertFalse(policy.isFollowing)
        policy.observeUserScroll(atBottom = true, firstRowId = 13L, offset = 0)
        assertEquals(TerminalScrollTarget(5), policy.onContentChanged(listOf(10L, 11L, 12L, 13L, 14L, 15L)))
        assertTrue(policy.isFollowing)
    }

    @Test
    fun pausedAnchorSurvivesIndexShiftsAndEvictionClampsToOldestNotNewest() {
        val policy = TerminalFollowPolicy()
        policy.observeUserScroll(atBottom = false, firstRowId = 12L, offset = 9)
        assertEquals(TerminalScrollTarget(1, 9), policy.onContentChanged(listOf(11L, 12L, 13L, 14L)))
        assertEquals(TerminalScrollTarget(0, 9), policy.onContentChanged(listOf(12L, 13L, 14L, 15L)))
        assertEquals(TerminalScrollTarget(0), policy.onContentChanged(listOf(13L, 14L, 15L, 16L)))
        // A reset/alternate/reflow-retired anchor uses the same deterministic fallback.
        assertEquals(TerminalScrollTarget(0), policy.onContentChanged(listOf(90L, 91L, 92L)))
        assertFalse(policy.isFollowing)
    }

    @Test
    fun blinkingRealSurfaceDoesNotPublishScrollContentOrRetirePausedAnchor() {
        val surface = VtTerminalSurface(12, 4)
        surface.feedOutput("one\r\ntwo\r\nthree".encodeToByteArray(), 0L, true)
        val ids = surface.lineIds.toList()
        val revision = surface.updateRevision
        val policy = TerminalFollowPolicy()
        policy.observeUserScroll(atBottom = false, firstRowId = ids.first(), offset = 5)
        repeat(4) { surface.updateCursorBlink(it % 2 == 0) }
        assertEquals(revision, surface.updateRevision, "The UI's content-effect key must not change for blink")
        assertEquals(ids, surface.lineIds)
        assertEquals(TerminalScrollTarget(0, 5), policy.onContentChanged(surface.lineIds))
        assertFalse(policy.isFollowing)
        surface.close()
    }

    @Test
    fun retainedSessionsOwnersControllersAndIncarnationsHaveIndependentReadingState() {
        val states = TerminalReadingStates()
        val a = controller("A", "owner-one")
        val b = controller("B", "owner-one")
        val otherOwnerA = controller("A", "owner-two")
        val oldA = states.forController(a)
        oldA.follow.observeUserScroll(false, 20L, 6)
        assertTrue(states.forController(b).follow.isFollowing)
        assertTrue(states.forController(otherOwnerA).follow.isFollowing)
        assertSame(oldA, states.forController(a))
        assertEquals(TerminalScrollTarget(1, 6), states.forController(a).follow.onContentChanged(listOf(19L, 20L, 21L)))
        assertNotSame(oldA, states.forController(controller("A", "owner-one")))
        a.handleBufferReplay("NEW".encodeToByteArray(), 3uL, true, false, 2uL)
        assertNotSame(oldA, states.forController(a))
        assertTrue(states.forController(a).follow.isFollowing)
        states.remove(a)
        val replacement = states.forController(a)
        states.clear()
        assertNotSame(replacement, states.forController(a))
        listOf(a, b, otherOwnerA).forEach { it.close() }
    }

    @Test
    fun measuredGeometryFitsWholeCellsAndRespondsToFontScaleAndImeSize() {
        assertEquals(TerminalGeometry(44, 20), terminalGeometry(319f, 320f, 7.2f, 16f))
        assertEquals(TerminalGeometry(22, 10), terminalGeometry(319f, 320f, 14.4f, 32f))
        assertEquals(TerminalGeometry(44, 3), terminalGeometry(319f, 63f, 7.2f, 16f))
        assertEquals(TerminalGeometry(1, 1), terminalGeometry(5f, 8f, 7.2f, 16f))
        assertEquals(TerminalGeometry(1, 1), terminalGeometry(0f, 0f, 7.2f, 16f))
        assertEquals(TerminalGeometry(200, 80), terminalGeometry(5000f, 5000f, 7.2f, 16f))
        val updates = TerminalGeometryPolicy()
        val full = terminalGeometry(319f, 320f, 7.2f, 16f)
        assertTrue(updates.update(full))
        assertFalse(updates.update(terminalGeometry(319.5f, 320f, 7.2f, 16f)))
        val ime = terminalGeometry(319f, 63f, 7.2f, 16f)
        assertTrue(updates.update(ime))
        assertFalse(updates.update(ime))
        assertTrue(updates.update(full))
    }

    @Test
    fun terminalFontSizePoliciesClampStepAndScaleCleanly() {
        assertEquals(14, terminalLineHeightSp(10))
        assertEquals(16, terminalLineHeightSp(12))
        assertEquals(17, terminalLineHeightSp(13))
        assertEquals(36, terminalLineHeightSp(32))
        assertEquals(14, terminalLineHeightSp(4))
        assertEquals(36, terminalLineHeightSp(64))

        assertEquals(11, stepTerminalFontSize(12, -1))
        assertEquals(13, stepTerminalFontSize(12, 1))
        assertEquals(10, stepTerminalFontSize(10, -1))
        assertEquals(32, stepTerminalFontSize(32, 1))

        assertEquals(18, pinchedTerminalFontSize(12, 1.5f))
        assertEquals(10, pinchedTerminalFontSize(20, 0.5f))
        assertEquals(13, pinchedTerminalFontSize(13, 1.0f))
        assertEquals(20, pinchedTerminalFontSize(13, 1.5f))
        assertEquals(10, pinchedTerminalFontSize(13, 0.2f))
        assertEquals(32, pinchedTerminalFontSize(13, 5.0f))
        assertEquals(10, pinchedTerminalFontSize(13, Float.MIN_VALUE))
        assertEquals(32, pinchedTerminalFontSize(13, Float.MAX_VALUE))
        assertEquals(13, pinchedTerminalFontSize(13, Float.NaN))
        assertEquals(13, pinchedTerminalFontSize(13, Float.POSITIVE_INFINITY))
        assertEquals(13, pinchedTerminalFontSize(13, Float.NEGATIVE_INFINITY))
        assertEquals(13, pinchedTerminalFontSize(13, 0f))
        assertEquals(13, pinchedTerminalFontSize(13, -1.25f))
    }

    @Test
    fun ordinaryAttachClosesGateBeforeSuspendingAndSendsCapturedNotLaterOffset() = runTest {
        val ctrl = controller()
        ctrl.handleBufferReplay("OLD".encodeToByteArray(), 3uL, true, false, 1uL)
        val connect = CompletableDeferred<Unit>()
        val sent = mutableListOf<ULong?>()
        val queue = TerminalAttachQueue(ctrl, this)
        assertEquals(3uL, queue.attach({ true }, { connect.await() }, { sent += it }))
        assertFalse(ctrl.isReplayCompleted)
        assertTrue(sent.isEmpty())
        // A response already in flight may change accepted offset while connect is suspended.
        ctrl.handleBufferReplay("NEW".encodeToByteArray(), 6uL, false, false, 1uL)
        assertEquals(6uL, ctrl.lastSeenOffset)
        connect.complete(Unit)
        runCurrent()
        assertEquals(listOf<ULong?>(3uL), sent)
        ctrl.close()
    }

    @Test
    fun recoveryConsumesCapturedOffsetWithoutDroppingLiveQueueOrOpeningInput() = runTest {
        val surface = VtTerminalSurface(20, 3).apply { updateCursorBlink(false) }
        val ctrl = controller(surface = surface)
        ctrl.handleBufferReplay("OLD".encodeToByteArray(), 3uL, true, false, 1uL)
        ctrl.isPanelActive = true
        val connect = CompletableDeferred<Unit>()
        val sent = mutableListOf<ULong?>()
        val inputs = mutableListOf<String>()
        ctrl.setRawInputSink { inputs += it.decodeToString() }
        val queue = TerminalAttachQueue(ctrl, this)
        ctrl.onRequestReattach = { _, offset ->
            val generation = ctrl.gate.replayGeneration
            queue.recover(offset, { true }, { connect.await() }, { sent += it })
            assertEquals(generation, ctrl.gate.replayGeneration)
        }
        ctrl.handleLagged(1uL)
        ctrl.handleLiveChunk("NEW".encodeToByteArray(), 6uL, 1uL)
        assertEquals(1, ctrl.gate.queuedLiveData.size)
        ctrl.sendInput("blocked".encodeToByteArray())
        connect.complete(Unit)
        runCurrent()
        assertEquals(listOf<ULong?>(3uL), sent)
        assertEquals(1, ctrl.gate.queuedLiveData.size)
        assertFalse(ctrl.isReplayCompleted, "Sending an attachment is not replay completion")
        assertTrue(inputs.isEmpty())
        ctrl.handleBufferReplay(byteArrayOf(), 3uL, false, false, 1uL)
        assertTrue(ctrl.isReplayCompleted)
        assertEquals("OLDNEW", surface.lines.joinToString("") { it.text }.trimEnd())
        ctrl.close()
    }

    @Test
    fun sendsSerializeAndPendingOrdinaryRequestsCoalesceWithoutAnotherGateReset() = runTest {
        val ctrl = controller()
        ctrl.handleBufferReplay("OLD".encodeToByteArray(), 3uL, true, false, 1uL)
        val firstSend = CompletableDeferred<Unit>()
        val queue = TerminalAttachQueue(ctrl, this)
        val sent = mutableListOf<String>()
        var active = 0
        var maxActive = 0
        queue.attach({ true }, {}, {
            active++
            maxActive = maxOf(maxActive, active)
            sent += "first:$it"
            firstSend.await()
            active--
        })
        queue.attach({ true }, {}, { sent += "superseded:$it" })
        val generation = ctrl.gate.replayGeneration
        ctrl.handleLiveChunk("NEW".encodeToByteArray(), 6uL, 1uL)
        queue.attach({ true }, {}, {
            active++
            maxActive = maxOf(maxActive, active)
            sent += "latest:$it"
            active--
        })
        assertEquals(generation, ctrl.gate.replayGeneration)
        assertEquals(1, ctrl.gate.queuedLiveData.size)
        assertEquals(listOf("first:3"), sent)
        firstSend.complete(Unit)
        runCurrent()
        assertEquals(listOf("first:3", "latest:3"), sent)
        assertEquals(1, maxActive)
        assertFalse(ctrl.isReplayCompleted)
        ctrl.close()
    }

    @Test
    fun invalidatedTargetAfterConnectCannotSendAndZeroOffsetUsesResetRequest() = runTest {
        val ctrl = controller()
        val connect = CompletableDeferred<Unit>()
        val sent = mutableListOf<ULong?>()
        val queue = TerminalAttachQueue(ctrl, this)
        var targetCurrent = true
        queue.attach({ targetCurrent }, { connect.await() }, { sent += it })
        ctrl.handleBufferReplay(byteArrayOf(), 0uL, true, false, 1uL)
        assertTrue(ctrl.isReplayCompleted, "An already-in-flight reset is authoritative")
        targetCurrent = false // owner, controller, selection epoch or incarnation changed during suspension
        connect.complete(Unit)
        runCurrent()
        assertTrue(sent.isEmpty())
        assertFalse(ctrl.isReplayCompleted)
        queue.attach({ true }, {}, { sent += it })
        assertEquals(listOf<ULong?>(null), sent)
        assertFalse(ctrl.isReplayCompleted)
        ctrl.close()
    }

    @Test
    fun failedAndCancelledAttachmentDoNotRetrySendOrEnableInput() = runTest {
        val ctrl = controller()
        ctrl.handleBufferReplay("OLD".encodeToByteArray(), 3uL, true, false, 1uL)
        val errors = mutableListOf<Exception?>()
        var sends = 0
        TerminalAttachQueue(ctrl, this).attach({ true }, {}, {
            sends++
            throw IllegalStateException("transport unavailable")
        }, { errors += it })
        assertEquals(1, sends)
        assertEquals(1, errors.size)
        assertTrue(errors.single() is IllegalStateException)
        assertFalse(ctrl.isReplayCompleted)

        val job = Job(coroutineContext[Job])
        val scope = CoroutineScope(coroutineContext + job)
        val queue = TerminalAttachQueue(ctrl, scope)
        val waiting = CompletableDeferred<Unit>()
        queue.attach({ true }, { waiting.await() }, { sends++ }, { errors += it })
        ctrl.handleBufferReplay(byteArrayOf(), 3uL, false, false, 1uL)
        assertTrue(ctrl.isReplayCompleted)
        val generation = ctrl.gate.replayGeneration
        scope.cancel(CancellationException("owner disposed"))
        runCurrent()
        assertEquals(1, sends)
        assertEquals(1, errors.size, "Cancellation propagates, not a false transport result")
        assertFalse(ctrl.isReplayCompleted)
        assertEquals(generation, ctrl.gate.replayGeneration, "Cancellation fences without beginning another attempt")
        ctrl.close()
    }

    @Test
    fun connectFailureAfterAuthoritativeReplayRefencesWithoutLosingAcceptedText() = runTest {
        val surface = VtTerminalSurface(20, 3).apply { updateCursorBlink(false) }
        val ctrl = controller(surface = surface)
        ctrl.handleBufferReplay("OLD".encodeToByteArray(), 3uL, true, false, 1uL)
        val connect = CompletableDeferred<Unit>()
        val queue = TerminalAttachQueue(ctrl, this)
        val errors = mutableListOf<Exception?>()
        var sends = 0
        queue.attach({ true }, {
            connect.await()
            throw IllegalStateException("connect failed")
        }, { sends++ }, { errors += it })
        val generation = ctrl.gate.replayGeneration
        ctrl.handleBufferReplay(byteArrayOf(), 3uL, false, false, 1uL)
        assertTrue(ctrl.isReplayCompleted)
        connect.complete(Unit)
        runCurrent()
        assertEquals(0, sends)
        assertEquals(1, errors.size)
        assertFalse(ctrl.isReplayCompleted)
        assertEquals(generation, ctrl.gate.replayGeneration)
        assertEquals(3uL, ctrl.lastSeenOffset)
        assertEquals("OLD", surface.lines.joinToString("") { it.text }.trimEnd())
        ctrl.handleLiveChunk("NEW".encodeToByteArray(), 6uL, 1uL)
        assertEquals(1, ctrl.gate.queuedLiveData.size)
        queue.attach({ true }, {}, { sends++ })
        ctrl.handleBufferReplay("NEW".encodeToByteArray(), 6uL, false, false, 1uL)
        assertEquals(1, sends)
        assertTrue(ctrl.isReplayCompleted)
        assertEquals("OLDNEW", surface.lines.joinToString("") { it.text }.trimEnd())
        ctrl.close()
    }

    private fun controller(
        id: String = "session",
        owner: String = "profile",
        surface: NativeTerminalSurface? = null,
    ) = TerminalSessionController(id, 1L, ConnectionRef(owner, 1L), surface)
}
