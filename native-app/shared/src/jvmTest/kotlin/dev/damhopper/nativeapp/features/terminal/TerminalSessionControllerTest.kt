package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TerminalSessionControllerTest {

    private class MockTerminalSurface : NativeTerminalSurface {
        override val dimensions = TerminalDimensions(80, 24)
        override var isAttached = true
        override var isDisposed = false
        val outputFeed = mutableListOf<ByteArray>()
        var resetCalled = false
        var inputListener: ((ByteArray) -> Unit)? = null

        override fun attachView(hostView: Any?) { isAttached = true }
        override fun detachView() { isAttached = false }
        override fun feedOutput(data: ByteArray, offset: Long, reset: Boolean) {
            if (reset) resetCalled = true
            outputFeed.add(data)
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
}
