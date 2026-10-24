package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TerminalSessionControllerTest {

    private class MockTerminalSurface : NativeTerminalSurface {
        override val dimensions = TerminalDimensions(80, 24)
        override var isAttached = true
        override var isDisposed = false
        val outputFeed = mutableListOf<ByteArray>()
        var resetCalled = false
        var inputListener: ((ByteArray) -> Unit)? = null
        var onFeed: ((ByteArray, Boolean) -> Unit)? = null

        override fun attachView(hostView: Any?) { isAttached = true }
        override fun detachView() { isAttached = false }
        override fun feedOutput(data: ByteArray, offset: Long, reset: Boolean) {
            if (reset) resetCalled = true
            outputFeed.add(data)
            onFeed?.invoke(data, reset)
        }
        override fun resize(cols: Int, rows: Int) {}
        override fun setOnInputListener(listener: (ByteArray) -> Unit) { inputListener = listener }
        override fun setOnResizeListener(listener: (cols: Int, rows: Int) -> Unit) {}
        override fun search(query: String, matchCase: Boolean) = TerminalSearchResult(query, 1, 0)
        override fun clearSearch() {}
        override fun getSelectedText(): String? = "selected-text"
        override fun copySelection(): String? = "selected-text"
        override fun pasteText(text: String) {}
        override fun close() { isDisposed = true }
    }

    @Test
    fun testKeyModifiersAndSpecialKeyEncoding() {
        val connRef = ConnectionRef("srv-1", 1L)
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("sess-1", 1L, connRef, surface)

        // Ctrl + C -> ASCII 3
        controller.toggleModifier(TerminalModifier.CTRL)
        assertTrue(controller.isModifierActive(TerminalModifier.CTRL))
        val ctrlC = controller.encodeKey('c')
        assertEquals(1, ctrlC.size)
        assertEquals(0x03.toByte(), ctrlC[0])
        assertFalse(controller.isModifierActive(TerminalModifier.CTRL), "One-shot modifier must clear")

        // Alt + X -> ESC + 'x'
        controller.toggleModifier(TerminalModifier.ALT)
        val altX = controller.encodeKey('x')
        assertEquals(2, altX.size)
        assertEquals(0x1B.toByte(), altX[0])
        assertEquals('x'.code.toByte(), altX[1])

        // Special navigation keys
        assertEquals("\u001b[A", controller.encodeSpecialKey("UP").decodeToString())
        assertEquals("\u001b[B", controller.encodeSpecialKey("DOWN").decodeToString())
        assertEquals("\u001b[C", controller.encodeSpecialKey("RIGHT").decodeToString())
        assertEquals("\u001b[D", controller.encodeSpecialKey("LEFT").decodeToString())
        assertEquals("\t", controller.encodeSpecialKey("TAB").decodeToString())
        assertEquals("\u001b", controller.encodeSpecialKey("ESC").decodeToString())
        assertEquals("\r", controller.encodeSpecialKey("ENTER").decodeToString())
        assertEquals(byteArrayOf(0x7F)[0], controller.encodeSpecialKey("BACKSPACE")[0])
    }

    @Test
    fun testBracketedPasteEncoding() {
        val connRef = ConnectionRef("srv-1", 1L)
        val controller = TerminalSessionController("sess-1", 1L, connRef)

        val pasted = controller.encodeBracketedPaste("rm -rf /")
        assertEquals("\u001b[200~rm -rf /\u001b[201~", pasted.decodeToString())
    }

    @Test
    fun testBufferReplayDrainsQueuedLiveChunks() {
        val connRef = ConnectionRef("srv-1", 1L)
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("sess-1", 1L, connRef, surface)

        // Receive live chunk while historical replay is still pending -> gets queued
        controller.handleLiveChunk("live-1".encodeToByteArray(), 16uL, 1uL)
        assertEquals(0, surface.outputFeed.size, "Live chunks must be queued before replay finishes")
        assertEquals(1, controller.gate.queuedLiveData.size)

        // Replay buffer arrives (e.g. 10 bytes up to offset 10)
        controller.handleBufferReplay(
            data = "history123".encodeToByteArray(),
            offset = 10uL,
            reset = true,
            truncated = false,
            bufferIncarnation = 1uL
        )

        // Replay drain renders historical buffer AND processes queued live chunk
        assertTrue(surface.resetCalled)
        assertTrue(surface.outputFeed.size >= 2)
        assertEquals("history123", surface.outputFeed[0].decodeToString())
        assertEquals(16uL, controller.lastSeenOffset)
        assertTrue(controller.isReplayCompleted)
    }

    @Test
    fun testExitAndRestartHandling() {
        val connRef = ConnectionRef("srv-1", 1L)
        val controller = TerminalSessionController("sess-1", 1L, connRef)

        assertFalse(controller.isExited)

        controller.handleExit(
            code = 1,
            restart = true,
            restarts = 1u,
            eventIncarnation = 1uL
        )
        assertTrue(controller.isExited)
        assertEquals(1, controller.exitCode)
        assertTrue(controller.willRestart)
        assertEquals(1u, controller.restartCount)

        controller.handleProcessRestarted(count = 2u, prevExitCode = 1)
        assertFalse(controller.isExited)
        assertNull(controller.exitCode)
        assertFalse(controller.willRestart)
        assertEquals(2u, controller.restartCount)
    }

    @Test
    fun drainKeepsInputAndSurfaceRepliesClosedIncludingReentrantQueuedOutput() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("drain", 1L, ConnectionRef("srv", 1L), surface)
        controller.isPanelActive = true
        val sent = mutableListOf<String>()
        controller.setRawInputSink { sent += it.decodeToString() }
        controller.handleLiveChunk("B".encodeToByteArray(), 2uL, 1uL)
        controller.handleLiveChunk("C".encodeToByteArray(), 3uL, 1uL)
        val observed = mutableListOf<String>()
        surface.onFeed = { data, _ ->
            observed += data.decodeToString()
            assertFalse(controller.isReplayCompleted)
            assertFalse(controller.gate.shouldForwardTerminalData())
            assertTrue(controller.gate.activeReplayWrites > 0)
            controller.sendInput("USER".encodeToByteArray())
            surface.inputListener?.invoke("QUERY_REPLY".encodeToByteArray())
            if (data.decodeToString() == "B") {
                controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
            }
        }
        controller.handleBufferReplay("A".encodeToByteArray(), 1uL, true, false, 1uL)
        assertEquals(listOf("A", "B", "C", "D"), observed)
        assertEquals(4uL, controller.lastSeenOffset)
        assertTrue(controller.isReplayCompleted)
        assertTrue(sent.isEmpty(), "No input or protocol response during any drain feed")
        controller.sendInput("LIVE".encodeToByteArray())
        assertEquals(listOf("LIVE"), sent, "Dropped historical input must never be replayed")
    }

    @Test
    fun gapPartwayThroughDrainCapturesLastContiguousOffsetAndStops() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("gap", 1L, ConnectionRef("srv", 1L), surface)
        val recoveries = mutableListOf<ULong>()
        controller.onRequestReattach = { _, offset -> recoveries += offset }
        controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        controller.handleLiveChunk("G".encodeToByteArray(), 7uL, 1uL)
        controller.handleLiveChunk("H".encodeToByteArray(), 8uL, 1uL)
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        assertEquals(listOf("ABC", "D"), surface.outputFeed.map { it.decodeToString() })
        assertEquals(listOf(4uL), recoveries)
        assertEquals(4uL, controller.lastSeenOffset)
        assertFalse(controller.isReplayCompleted)
        assertFalse(controller.gate.shouldForwardTerminalData())
        assertTrue(controller.gate.queuedLiveData.isEmpty())
    }

    @Test
    fun attachDuringReplayPreservesActiveWriteAndCannotReopenSupersedingGate() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("reset", 1L, ConnectionRef("srv", 1L), surface)
        surface.onFeed = { _, reset ->
            if (reset) {
                assertEquals(3uL, controller.beginAttach())
                assertEquals(1, controller.gate.activeReplayWrites)
                assertFalse(controller.gate.shouldForwardTerminalData())
                controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
            }
        }
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        assertFalse(controller.isReplayCompleted)
        assertEquals(0, controller.gate.activeReplayWrites)
        assertEquals(1, controller.gate.queuedLiveData.size)
        surface.onFeed = null
        controller.handleBufferReplay(byteArrayOf(), 3uL, false, false, 1uL)
        assertEquals(4uL, controller.lastSeenOffset)
        assertTrue(controller.isReplayCompleted)
    }

    @Test
    fun attachDuringDrainDoesNotConsumeNewAttemptQueueOrPublishReady() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("supersede", 1L, ConnectionRef("srv", 1L), surface)
        controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        controller.handleLiveChunk("E".encodeToByteArray(), 5uL, 1uL)
        surface.onFeed = { data, _ ->
            if (data.decodeToString() == "D") {
                assertEquals(4uL, controller.beginAttach())
                controller.handleLiveChunk("E".encodeToByteArray(), 5uL, 1uL)
            }
        }
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        assertFalse(controller.isReplayCompleted)
        assertEquals(listOf("ABC", "D"), surface.outputFeed.map { it.decodeToString() })
        assertEquals(1, controller.gate.queuedLiveData.size)
        surface.onFeed = null
        controller.handleBufferReplay(byteArrayOf(), 4uL, false, false, 1uL)
        assertEquals(listOf("ABC", "D", "E"), surface.outputFeed.map { it.decodeToString() })
        assertTrue(controller.isReplayCompleted)
    }

    @Test
    fun recoveryCapturesOffsetOnceAndDeferredSendMustNotResetQueuedLive() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("recovery", 1L, ConnectionRef("srv", 1L), surface)
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        val generation = controller.gate.replayGeneration
        var send: (() -> ULong)? = null
        controller.onRequestReattach = { id, captured ->
            assertEquals("recovery", id)
            assertFalse(controller.isReplayCompleted)
            assertEquals(generation + 1, controller.gate.replayGeneration)
            send = { captured }
        }
        controller.handleLagged(1uL)
        controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        assertEquals(3uL, send?.invoke())
        assertEquals(1, controller.gate.queuedLiveData.size, "Sending captured offset never resets the queue")
        controller.handleBufferReplay(byteArrayOf(), 3uL, false, false, 1uL)
        assertEquals(4uL, controller.lastSeenOffset)
        assertEquals(generation + 1, controller.gate.replayGeneration)
        assertTrue(controller.isReplayCompleted)
    }

    @Test
    fun recoverySendFailureAndCancellationRemainClosed() {
        val controller = TerminalSessionController("failed-send", 1L, ConnectionRef("srv", 1L))
        controller.markReplayCompleted()
        controller.onRequestReattach = { _, _ -> error("transport unavailable") }
        assertFailsWith<IllegalStateException> { controller.handleLagged(1uL) }
        assertFalse(controller.isReplayCompleted)
        controller.onRequestReattach = { _, _ ->
            throw kotlin.coroutines.cancellation.CancellationException("cancelled")
        }
        assertFailsWith<kotlin.coroutines.cancellation.CancellationException> { controller.handleLagged(1uL) }
        assertFalse(controller.isReplayCompleted)
        assertFalse(controller.gate.shouldForwardTerminalData())
    }

    @Test
    fun replayFeedExceptionDoesNotAdvanceOffsetOrDrainQueue() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("parser-failure", 1L, ConnectionRef("srv", 1L), surface)
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        controller.beginAttach()
        surface.onFeed = { _, _ -> error("parser failure") }
        assertFailsWith<IllegalStateException> {
            controller.handleBufferReplay("D".encodeToByteArray(), 4uL, false, false, 1uL)
        }
        assertEquals(3uL, controller.lastSeenOffset)
        assertEquals(0, controller.gate.activeReplayWrites)
        assertFalse(controller.isReplayCompleted)
        assertFalse(controller.gate.shouldForwardTerminalData())
    }

    @Test
    fun controllerOverflowAtDefaultCountAndByteBoundsRequestsAcceptedOffset() {
        val controller = TerminalSessionController("overflow", 1L, ConnectionRef("srv", 1L))
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        controller.beginAttach()
        val recoveries = mutableListOf<ULong>()
        controller.onRequestReattach = { _, offset -> recoveries += offset }
        repeat(TerminalReplayGate.DEFAULT_MAX_QUEUED_CHUNKS) {
            controller.handleLiveChunk(byteArrayOf(1), 4uL, 1uL)
        }
        assertEquals(TerminalReplayGate.DEFAULT_MAX_QUEUED_CHUNKS, controller.gate.queuedLiveData.size)
        controller.handleLiveChunk(byteArrayOf(1), 4uL, 1uL)
        assertEquals(listOf(3uL), recoveries)
        assertTrue(controller.gate.queuedLiveData.isEmpty())
        controller.handleLiveChunk(ByteArray(TerminalReplayGate.DEFAULT_MAX_QUEUED_BYTES), 4_194_307uL, 1uL)
        assertEquals(1, controller.gate.queuedLiveData.size)
        controller.handleLiveChunk(byteArrayOf(1), 4_194_308uL, 1uL)
        assertEquals(listOf(3uL, 3uL), recoveries)
        assertEquals(3uL, controller.lastSeenOffset)
        assertFalse(controller.isReplayCompleted)
    }

    @Test
    fun reentrantRecoveryBaselineWaitsForSupersededDrainWriteToFinish() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("reentrant-baseline", 1L, ConnectionRef("srv", 1L), surface)
        controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        controller.handleLiveChunk("G".encodeToByteArray(), 7uL, 1uL)
        controller.onRequestReattach = { _, offset ->
            assertEquals(4uL, offset)
            controller.handleBufferReplay("EFG".encodeToByteArray(), 7uL, false, false, 1uL)
            assertFalse(controller.isReplayCompleted, "Old drain still has an outstanding parser write")
        }
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        assertEquals(listOf("ABC", "D", "EFG"), surface.outputFeed.map { it.decodeToString() })
        assertEquals(7uL, controller.lastSeenOffset)
        assertEquals(0, controller.gate.activeReplayWrites)
        assertTrue(controller.isReplayCompleted, "Only the successful new baseline authorizes readiness")
    }

    @Test
    fun queueOverflowDuringDrainCannotReopenReadiness() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("drain-overflow", 1L, ConnectionRef("srv", 1L), surface)
        controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        val recoveries = mutableListOf<ULong>()
        controller.onRequestReattach = { _, offset -> recoveries += offset }
        surface.onFeed = { data, _ ->
            if (data.decodeToString() == "D") {
                repeat(TerminalReplayGate.DEFAULT_MAX_QUEUED_CHUNKS + 1) {
                    controller.handleLiveChunk("E".encodeToByteArray(), 5uL, 1uL)
                }
            }
        }
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        assertEquals(listOf(4uL), recoveries)
        assertEquals(4uL, controller.lastSeenOffset)
        assertFalse(controller.isReplayCompleted)
        assertFalse(controller.gate.shouldForwardTerminalData())
        assertEquals(listOf("ABC", "D"), surface.outputFeed.map { it.decodeToString() })
    }

    @Test
    fun sendFailureDuringDrainPreservesRemainingQueueAndCannotReopenReadiness() {
        val surface = MockTerminalSurface()
        val controller = TerminalSessionController("drain-failure", 1L, ConnectionRef("srv", 1L), surface)
        controller.handleLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        controller.handleLiveChunk("E".encodeToByteArray(), 5uL, 1uL)
        val generation = controller.gate.replayGeneration
        surface.onFeed = { data, _ ->
            if (data.decodeToString() == "D") controller.failAttach()
        }
        controller.handleBufferReplay("ABC".encodeToByteArray(), 3uL, true, false, 1uL)
        assertEquals(listOf("ABC", "D"), surface.outputFeed.map { it.decodeToString() })
        assertEquals(4uL, controller.lastSeenOffset)
        assertEquals(generation, controller.gate.replayGeneration)
        assertEquals(listOf(5uL), controller.gate.queuedLiveData.map { it.offset })
        assertFalse(controller.isReplayCompleted)
        assertFalse(controller.gate.shouldForwardTerminalData())
    }
}
