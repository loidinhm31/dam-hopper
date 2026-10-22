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
        assertFalse(gate.shouldForwardTerminalData(), "Attach must fence outbound data before parsing starts")

        gate.beginReplayWrite()
        assertTrue(gate.hasAttachBufferBeenReceived)
        assertTrue(gate.isReplayWriting)
        assertFalse(gate.isLiveStreamReady)
        assertFalse(gate.shouldForwardTerminalData(), "Outbound terminal queries must be suppressed during replay")

        var drainCalled = false
        gate.onReplayDrain = { drainCalled = true }

        gate.finishReplayWrite()
        assertFalse(gate.isReplayWriting)
        assertFalse(gate.shouldForwardTerminalData(), "Completing parser writes must not bypass queued drain")

        gate.notifyReplayDrain()
        assertTrue(drainCalled)
        gate.markLiveStreamReady()
        assertTrue(gate.shouldForwardTerminalData())
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
        assertFalse(gate.shouldForwardTerminalData(), "Finishing an obsolete write cannot reopen a new attach")
        var drainCalled = false
        gate.onReplayDrain = { drainCalled = true }
        gate.notifyReplayDrain()
        gate.markLiveStreamReady(0L)
        assertFalse(drainCalled)
        assertFalse(gate.isLiveStreamReady)
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

    @Test
    fun byteLimitUsesBytesAndReleasesCapacityOneChunkAtATime() {
        val gate = TerminalReplayGate(maxQueuedChunks = 10, maxQueuedBytes = 4)
        var overflows = 0
        gate.onQueueOverflow = { overflows += 1 }
        val multibyte = QueuedLiveChunk("é".encodeToByteArray(), 2uL, 1uL)
        assertTrue(gate.enqueueLiveChunk(multibyte))
        assertTrue(gate.enqueueLiveChunk(multibyte.copy(offset = 4uL)))
        assertFalse(gate.enqueueLiveChunk(QueuedLiveChunk(byteArrayOf(1), 5uL, 1uL)))
        assertEquals(1, overflows)
        assertEquals(multibyte, gate.pollQueuedChunk())
        assertTrue(gate.enqueueLiveChunk(multibyte.copy(offset = 6uL)))
        assertEquals(listOf(4uL, 6uL), gate.drainQueuedChunks().map { it.offset })
    }

    @Test
    fun readinessRequiresAnEmptyQueueAndCurrentGeneration() {
        val gate = TerminalReplayGate()
        gate.beginReplayWrite()
        gate.finishReplayWrite()
        gate.enqueueLiveChunk(QueuedLiveChunk(byteArrayOf(1), 1uL, 1uL))
        gate.markLiveStreamReady()
        assertFalse(gate.isLiveStreamReady)
        gate.pollQueuedChunk()
        val oldGeneration = gate.replayGeneration
        gate.resetForAttach()
        gate.beginReplayWrite()
        gate.finishReplayWrite()
        gate.markLiveStreamReady(oldGeneration)
        assertFalse(gate.isLiveStreamReady)
        gate.markLiveStreamReady(gate.replayGeneration)
        assertTrue(gate.isLiveStreamReady)
    }

    @Test
    fun emptyDeltaAndUtf8OverlapUseEndByteOffsets() {
        assertEquals(ReconcileOutputResult.Discard(3uL), reconcileTerminalOutput(byteArrayOf(), 3uL, 3uL))
        assertEquals(ReconcileOutputResult.Gap(3uL, 5uL), reconcileTerminalOutput(byteArrayOf(), 5uL, 3uL))
        val bytes = "A中B".encodeToByteArray()
        val overlap = reconcileTerminalOutput(bytes, 5uL, 2uL)
        assertTrue(overlap is ReconcileOutputResult.Render)
        assertTrue(overlap.data.contentEquals(bytes.copyOfRange(2, 5)))
        assertEquals(5uL, overlap.nextOffset)
    }

    @Test
    fun failedSendPreservesGenerationQueueAndOutstandingWriteButFencesLateReplay() {
        val gate = TerminalReplayGate()
        gate.beginReplayWrite()
        val chunk = QueuedLiveChunk("D".encodeToByteArray(), 4uL, 1uL)
        gate.enqueueLiveChunk(chunk)
        val generation = gate.replayGeneration
        gate.failAttach()
        assertEquals(generation, gate.replayGeneration)
        assertEquals(listOf(chunk), gate.queuedLiveData)
        assertEquals(1, gate.activeReplayWrites)
        gate.finishReplayWrite()
        var drained = false
        gate.onReplayDrain = { drained = true }
        gate.notifyReplayDrain()
        assertFalse(drained)
        gate.pollQueuedChunk()
        gate.beginReplayWrite()
        gate.finishReplayWrite()
        gate.markLiveStreamReady()
        assertFalse(gate.isLiveStreamReady)
        assertFalse(gate.shouldForwardTerminalData())
        gate.resetForAttach()
        gate.beginReplayWrite()
        gate.finishReplayWrite()
        gate.markLiveStreamReady()
        assertTrue(gate.isLiveStreamReady)
    }
}
