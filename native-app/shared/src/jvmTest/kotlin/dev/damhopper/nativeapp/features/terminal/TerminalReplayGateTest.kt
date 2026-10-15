package dev.damhopper.nativeapp.features.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TerminalReplayGateTest {

    @Test
    fun testReconcileTerminalOutputDuplicateDiscard() {
        val data = "duplicate output".encodeToByteArray()
        // endOffset 100 <= currentOffset 100 -> discard
        val result = reconcileTerminalOutput(data, 100uL, 100uL)
        assertTrue(result is ReconcileOutputResult.Discard)
        assertEquals(100uL, result.nextOffset)

        // endOffset 80 <= currentOffset 100 -> discard
        val resultPast = reconcileTerminalOutput(data, 80uL, 100uL)
        assertTrue(resultPast is ReconcileOutputResult.Discard)
        assertEquals(100uL, resultPast.nextOffset)
    }

    @Test
    fun testReconcileTerminalOutputGapDetection() {
        val data = "gap data".encodeToByteArray() // 8 bytes
        // endOffset = 50, startOffset = 42, currentOffset = 30 -> gap!
        val result = reconcileTerminalOutput(data, 50uL, 30uL)
        assertTrue(result is ReconcileOutputResult.Gap)
        assertEquals(30uL, result.expectedOffset)
        assertEquals(42uL, result.receivedStartOffset)
    }

    @Test
    fun testReconcileTerminalOutputContiguous() {
        val data = "hello world".encodeToByteArray() // 11 bytes
        // endOffset = 21, startOffset = 10, currentOffset = 10 -> contiguous render!
        val result = reconcileTerminalOutput(data, 21uL, 10uL)
        assertTrue(result is ReconcileOutputResult.Render)
        assertEquals(21uL, result.nextOffset)
        assertEquals("hello world", result.data.decodeToString())
    }

    @Test
    fun testReconcileTerminalOutputPartialOverlapSlicing() {
        val data = "ABCDEFGHIJ".encodeToByteArray() // 10 bytes
        // endOffset = 20, startOffset = 10, currentOffset = 15 -> overlap!
        // Bytes to skip: 15 - 10 = 5 -> should render "FGHIJ" from offset 15..20
        val result = reconcileTerminalOutput(data, 20uL, 15uL)
        assertTrue(result is ReconcileOutputResult.Render)
        assertEquals(20uL, result.nextOffset)
        assertEquals("FGHIJ", result.data.decodeToString())
    }

    @Test
    fun testGateLifecycleAndActiveReplayWrites() {
        val gate = TerminalReplayGate()
        assertFalse(gate.hasAttachBufferBeenReceived)
        assertFalse(gate.isLiveStreamReady)
        assertTrue(gate.shouldForwardTerminalData())

        gate.beginReplayWrite()
        assertTrue(gate.hasAttachBufferBeenReceived)
        assertTrue(gate.isReplayWriting)
        assertFalse(gate.isLiveStreamReady)
        assertFalse(gate.shouldForwardTerminalData(), "Outbound terminal queries must be suppressed during replay")

        var drainCalled = false
        gate.onReplayDrain = { drainCalled = true }

        gate.finishReplayWrite()
        assertFalse(gate.isReplayWriting)
        assertTrue(gate.shouldForwardTerminalData())

        gate.notifyReplayDrain()
        assertTrue(drainCalled)
    }

    @Test
    fun testGateAttachResetPreservesOutstandingWrites() {
        val gate = TerminalReplayGate()
        gate.beginReplayWrite()
        assertEquals(1, gate.activeReplayWrites)

        // Attach reset mid-flight
        gate.resetForAttach()
        assertEquals(1L, gate.replayGeneration)
        assertFalse(gate.hasAttachBufferBeenReceived)
        // Outstanding writes survive so in-flight async parser cannot leak queries
        assertTrue(gate.isReplayWriting)
        assertFalse(gate.shouldForwardTerminalData())

        gate.finishReplayWrite()
        assertEquals(0, gate.activeReplayWrites)
        assertFalse(gate.isReplayWriting)
        assertTrue(gate.shouldForwardTerminalData())
    }

    @Test
    fun testBoundedQueueAndDrain() {
        val gate = TerminalReplayGate(maxQueuedChunks = 2, maxQueuedBytes = 100)
        var overflowTriggered = false
        gate.onQueueOverflow = { overflowTriggered = true }

        val chunk1 = QueuedLiveChunk("c1".encodeToByteArray(), 10uL, 1uL)
        val chunk2 = QueuedLiveChunk("c2".encodeToByteArray(), 20uL, 1uL)
        val chunk3 = QueuedLiveChunk("c3".encodeToByteArray(), 30uL, 1uL)

        assertTrue(gate.enqueueLiveChunk(chunk1))
        assertTrue(gate.enqueueLiveChunk(chunk2))
        assertFalse(gate.enqueueLiveChunk(chunk3), "Queue must bound chunk count")
        assertTrue(overflowTriggered)

        val drained = gate.drainQueuedChunks()
        assertEquals(2, drained.size)
        assertEquals(0, gate.queuedLiveData.size)
    }
}
