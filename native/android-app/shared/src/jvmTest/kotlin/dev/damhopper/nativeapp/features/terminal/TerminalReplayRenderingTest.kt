package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Consumer-visible replay regressions through the production controller, parser, and grid. */
class TerminalReplayRenderingTest {
    private class Fixture : AutoCloseable {
        val surface = VtTerminalSurface(initialCols = 80, initialRows = 5)
        val controller = TerminalSessionController("real-vt", 1L, ConnectionRef("srv", 1L), surface)
        val sent = mutableListOf<String>()
        val recoveries = mutableListOf<ULong>()

        init {
            surface.updateCursorBlink(false)
            controller.isPanelActive = true
            controller.setRawInputSink { sent += it.decodeToString() }
            controller.onRequestReattach = { _, offset -> recoveries += offset }
        }

        fun replay(text: String, end: ULong, reset: Boolean = false, truncated: Boolean = false, incarnation: ULong = 1uL) {
            controller.handleBufferReplay(text.encodeToByteArray(), end, reset, truncated, incarnation)
        }

        fun live(text: String, end: ULong, incarnation: ULong = 1uL) {
            controller.handleLiveChunk(text.encodeToByteArray(), end, incarnation)
        }

        fun text(): String = surface.lines.joinToString("\n") { it.text.trimEnd() }.trimEnd()
        override fun close() = controller.close()
    }

    @Test
    fun alreadyAcceptedLiveBytesAreNotAppendedAgainByOrdinaryReattach() {
        Fixture().use { f ->
            f.replay("OLD", 3uL, reset = true)
            f.live("NEW", 6uL)
            assertEquals(6uL, f.controller.beginAttach())
            assertEquals("OLDNEW", f.text(), "Attach retains the framebuffer")
            assertFalse(f.controller.isReplayCompleted)
            f.replay("NEW", 6uL)
            assertEquals("OLDNEW", f.text())
            assertEquals(6uL, f.controller.lastSeenOffset)
            f.live("!", 7uL)
            assertEquals("OLDNEW!", f.text())
        }
    }

    @Test
    fun liveQueuedAfterAttachAndOverlappingDeltaRenderOnlyOnce() {
        Fixture().use { f ->
            f.replay("OLD", 3uL, reset = true)
            assertEquals(3uL, f.controller.beginAttach())
            f.live("NEW", 6uL)
            assertEquals("OLD", f.text())
            f.replay("NEW", 6uL)
            assertEquals("OLDNEW", f.text())
            assertEquals(6uL, f.controller.lastSeenOffset)
            assertTrue(f.controller.isReplayCompleted)
            assertTrue(f.controller.gate.queuedLiveData.isEmpty())
        }
    }

    @Test
    fun partialDuplicateStaleAndEmptyDeltasKeepMonotonicAcceptedBytes() {
        Fixture().use { f ->
            f.replay("ABC", 3uL, reset = true)
            f.controller.beginAttach()
            f.replay("ABCDEF", 6uL)
            assertEquals("ABCDEF", f.text())
            f.replay("ABCDEF", 6uL)
            f.replay("ABC", 3uL)
            assertEquals("ABCDEF", f.text())
            assertEquals(6uL, f.controller.lastSeenOffset)
            f.controller.beginAttach()
            f.live("G", 7uL)
            f.replay("", 6uL)
            assertEquals("ABCDEFG", f.text())
            assertEquals(7uL, f.controller.lastSeenOffset)
            assertTrue(f.controller.isReplayCompleted)
        }
    }

    @Test
    fun deltaGapsIncludingEmptyAndTruncatedNeverSkipMissingBytes() {
        for ((payload, truncated) in listOf("FG" to false, "" to false, "FG" to true)) {
            Fixture().use { f ->
                f.replay("ABC", 3uL, reset = true)
                f.controller.beginAttach()
                f.replay(payload, 7uL, truncated = truncated)
                assertEquals("ABC", f.text())
                assertEquals(3uL, f.controller.lastSeenOffset)
                assertEquals(listOf(3uL), f.recoveries)
                assertFalse(f.controller.isReplayCompleted)
                assertFalse(f.controller.gate.shouldForwardTerminalData())
            }
        }
    }

    @Test
    fun resetSnapshotsAreAuthoritativeEvenLowerEmptyAndTruncated() {
        Fixture().use { f ->
            f.replay("OLDLONGTEXT", 11uL, reset = true)
            f.replay("X", 1uL, reset = true)
            assertEquals("X", f.text())
            assertEquals(1uL, f.controller.lastSeenOffset)
            f.replay("", 0uL, reset = true)
            assertEquals("", f.text())
            assertEquals(0uL, f.controller.lastSeenOffset)
            assertTrue(f.controller.isReplayCompleted)
            f.controller.beginAttach()
            f.live("ILX", 101uL)
            f.replay("TAIL", 100uL, reset = true, truncated = true)
            assertEquals("TAILX", f.text())
            assertEquals(101uL, f.controller.lastSeenOffset)
            assertTrue(f.controller.isTruncated)
            assertTrue(f.controller.isReplayCompleted)
        }
    }

    @Test
    fun emptyResetAlsoClearsIncompleteParserState() {
        Fixture().use { f ->
            f.replay("OLD\u001b[31", 7uL, reset = true)
            f.replay("", 0uL, reset = true)
            f.live("mNEW", 4uL)
            assertEquals("mNEW", f.text(), "Old partial CSI must not consume the new process text")
        }
    }

    @Test
    fun oldIncarnationMessagesCannotChangeTextOffsetMetadataOrReadiness() {
        Fixture().use { f ->
            f.replay("CURRENT", 7uL, reset = true, incarnation = 2uL)
            f.live("OLD", 100uL, incarnation = 1uL)
            f.replay("STALE", 0uL, reset = true, truncated = true, incarnation = 1uL)
            assertEquals("CURRENT", f.text())
            assertEquals(7uL, f.controller.lastSeenOffset)
            assertEquals(2uL, f.controller.incarnation)
            assertFalse(f.controller.isTruncated)
            assertTrue(f.controller.isReplayCompleted)
            assertTrue(f.recoveries.isEmpty())
        }
    }

    @Test
    fun newIncarnationLiveWaitsForResetAndDeduplicatesQueuedBytes() {
        Fixture().use { f ->
            f.replay("OLD\u001b[", 5uL, reset = true)
            f.controller.beginAttach()
            f.live("OBSOLETE", 13uL)
            f.live("NEW", 3uL, incarnation = 2uL)
            assertEquals(0uL, f.controller.lastSeenOffset)
            assertEquals(listOf(0uL), f.recoveries)
            assertFalse(f.controller.isReplayCompleted)
            assertEquals(listOf(2uL), f.controller.gate.queuedLiveData.map { it.incarnation })
            f.controller.sendInput("BLOCKED".encodeToByteArray())
            assertTrue(f.sent.isEmpty())
            f.replay("NEW", 3uL, reset = true, incarnation = 2uL)
            assertEquals("NEW", f.text())
            assertEquals(3uL, f.controller.lastSeenOffset)
            assertTrue(f.controller.isReplayCompleted)
            f.live("!", 4uL, incarnation = 2uL)
            assertEquals("NEW!", f.text())
        }
    }

    @Test
    fun newerDeltaCannotEstablishBaselineOrReuseOldOffset() {
        Fixture().use { f ->
            f.replay("OLD", 3uL, reset = true)
            val generation = f.controller.gate.replayGeneration
            f.replay("NEW", 3uL, incarnation = 2uL)
            assertEquals("OLD", f.text(), "No new-incarnation bytes append before authoritative reset")
            assertEquals(0uL, f.controller.lastSeenOffset)
            assertEquals(listOf(0uL), f.recoveries)
            assertEquals(generation + 1, f.controller.gate.replayGeneration)
            assertFalse(f.controller.isReplayCompleted)
            f.replay("FRESH", 5uL, reset = true, incarnation = 2uL)
            assertEquals("FRESH", f.text())
            assertTrue(f.controller.isReplayCompleted)
        }
    }

    @Test
    fun historicalAndQueuedSplitQueriesAreSilentButGenuineLiveQueriesReply() {
        Fixture().use { f ->
            f.live("6n", 5uL)
            f.live("\u001b[c", 8uL)
            f.replay("X\u001b[", 3uL, reset = true)
            assertTrue(f.sent.isEmpty(), "Historical CPR and queued-live CPR/DA must not leak")
            assertTrue(f.controller.isReplayCompleted)
            assertEquals("X", f.text())
            f.live("\u001b[6n", 12uL)
            assertEquals(listOf("\u001b[1;2R"), f.sent)
            f.live("\u001b[c", 15uL)
            assertEquals(2, f.sent.size, "DA remains functional for genuinely live output")
            assertTrue(f.sent.last().startsWith("\u001b[?"))
            assertEquals("X", f.text(), "Replies and user input are not synthetic local echo")
        }
    }

    @Test
    fun utf8ScalarSplitAcrossAcceptedPrefixOverlapReplayAndQueuedDuplicateIsIntact() {
        Fixture().use { f ->
            val bytes = "A中".encodeToByteArray()
            f.controller.handleBufferReplay(bytes.copyOfRange(0, 2), 2uL, true, false, 1uL)
            assertEquals(2uL, f.controller.beginAttach())
            f.controller.handleLiveChunk(bytes.copyOfRange(2, 4), 4uL, 1uL)
            f.controller.handleBufferReplay(bytes, 4uL, false, false, 1uL)
            f.live("B", 5uL)
            assertEquals("A中B", f.text())
            assertEquals(5uL, f.controller.lastSeenOffset)
            assertTrue(f.controller.isReplayCompleted)
        }
    }

    @Test
    fun feedModeIsRestoredAndAttachDropsRatherThanReplaysUserInput() {
        Fixture().use { f ->
            f.surface.isLiveStream = false
            f.replay("A", 1uL, reset = true)
            assertFalse(f.surface.isLiveStream)
            f.surface.isLiveStream = true
            f.controller.beginAttach()
            f.controller.sendInput("NEVER_REPLAY".encodeToByteArray())
            f.replay("\u001b[6n", 5uL)
            assertTrue(f.surface.isLiveStream)
            assertTrue(f.sent.isEmpty())
            assertEquals("A", f.text())
            f.controller.sendInput("USER".encodeToByteArray())
            assertEquals(listOf("USER"), f.sent)
            assertEquals("A", f.text())
        }
    }

    @Test
    fun sendFailureAfterLateResetCannotEnableInputUntilAnotherAttachSucceeds() {
        Fixture().use { f ->
            f.replay("OLD", 3uL, reset = true)
            assertEquals(3uL, f.controller.beginAttach())
            val generation = f.controller.gate.replayGeneration
            // A prior in-flight reset has no attempt ID and is necessarily authoritative.
            f.replay("X", 1uL, reset = true)
            assertTrue(f.controller.isReplayCompleted)
            f.controller.failAttach()
            assertEquals(generation, f.controller.gate.replayGeneration)
            assertEquals("X", f.text())
            assertEquals(1uL, f.controller.lastSeenOffset)
            f.controller.sendInput("BLOCKED".encodeToByteArray())
            f.live("Y", 2uL)
            f.replay("X", 1uL, reset = true)
            assertFalse(f.controller.isReplayCompleted, "Another late replay cannot reopen a failed attempt")
            assertTrue(f.sent.isEmpty())
            assertEquals(1, f.controller.gate.queuedLiveData.size)
            assertEquals(1uL, f.controller.beginAttach())
            f.replay("XY", 2uL, reset = true)
            assertEquals("XY", f.text())
            assertTrue(f.controller.isReplayCompleted)
            f.controller.sendInput("LIVE".encodeToByteArray())
            assertEquals(listOf("LIVE"), f.sent)
            f.controller.failAttach()
            f.replay("NEW", 3uL, reset = true, incarnation = 2uL)
            assertEquals("NEW", f.text(), "New process reset is still authoritative")
            assertFalse(f.controller.isReplayCompleted, "Process change is not successful attach-send evidence")
            assertEquals(3uL, f.controller.beginAttach())
            f.replay("", 3uL, incarnation = 2uL)
            assertTrue(f.controller.isReplayCompleted)
        }
    }
}
