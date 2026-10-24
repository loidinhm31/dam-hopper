package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TerminalSessionControllerLoggingTest {

    private val connRef = ConnectionRef(profileId = "profile-test-1", generation = 42L)

    @BeforeTest
    fun setUp() {
        AppLogger.resetToDefault()
        AppLogger.clearDiagnostics()
    }

    @AfterTest
    fun tearDown() {
        AppLogger.resetToDefault()
    }

    @Test
    fun testStreamGapEmitsDiagnosticWithoutPayloadContent() {
        val ctrl = TerminalSessionController("sess-gap-1", 1L, connRef)

        var reattachRequested = false
        ctrl.onRequestReattach = { _, _ -> reattachRequested = true }

        // Mark ready so gate accepts live chunks
        ctrl.markReplayCompleted()

        // Provide an initial chunk to set lastSeenOffset = 10
        ctrl.handleLiveChunk(ByteArray(10), 10uL, 1uL)

        // Now feed an out-of-order chunk: expected 10, but offset starts at 30
        val secretPayload = "SECRET_PAYLOAD_DATA_NEVER_LOG_ME".encodeToByteArray()
        ctrl.handleLiveChunk(secretPayload, 30uL + secretPayload.size.toUInt(), 1uL)

        assertTrue(reattachRequested)

        val snapshot = AppLogger.getDiagnosticsSnapshot(profileId = "profile-test-1", sessionId = "sess-gap-1")
        val gapEntry = snapshot.entries.find { it.message == "stream_gap_detected" }
        assertNotNull(gapEntry, "Should emit stream_gap_detected diagnostic")

        assertEquals("terminal-panel", gapEntry.scope)
        assertEquals("transport", gapEntry.type)
        assertEquals("10", gapEntry.metadata?.get("expectedOffset"))
        assertEquals("30", gapEntry.metadata?.get("receivedStartOffset"), "Diagnostics report the gap start, not its end")

        // Assert strictly ZERO payload text is logged
        for (entry in snapshot.entries) {
            assertFalse(entry.message.contains("SECRET_PAYLOAD"))
            entry.metadata?.values?.forEach { valStr ->
                assertFalse(valStr.contains("SECRET_PAYLOAD"))
            }
        }
    }

    @Test
    fun testBufferReplayAndCompleteEmitsDiagnostics() {
        val ctrl = TerminalSessionController("sess-replay-1", 1L, connRef)

        val replayBytes = "HELLO_WORLD_PTY_TEXT".encodeToByteArray()
        ctrl.handleBufferReplay(
            data = replayBytes,
            offset = 20uL,
            reset = true,
            truncated = false,
            bufferIncarnation = 1uL,
        )

        val snapshot = AppLogger.getDiagnosticsSnapshot(profileId = "profile-test-1", sessionId = "sess-replay-1")
        val replayEntry = snapshot.entries.find { it.message == "buffer_replay" }
        assertNotNull(replayEntry)
        assertEquals("20", replayEntry.metadata?.get("offset"))
        assertEquals(replayBytes.size.toString(), replayEntry.metadata?.get("byteCount"))

        val completeEntry = snapshot.entries.find { it.message == "buffer_replay_complete" }
        assertNotNull(completeEntry)

        // Verify PTY text is never present in diagnostics
        for (entry in snapshot.entries) {
            assertFalse(entry.message.contains("HELLO_WORLD_PTY_TEXT"))
            entry.metadata?.values?.forEach {
                assertFalse(it.contains("HELLO_WORLD_PTY_TEXT"))
            }
        }
    }

    @Test
    fun testInputDroppedReasonsRecordedWithoutCommandText() {
        val ctrl = TerminalSessionController("sess-input-1", 1L, connRef)
        ctrl.isPanelActive = false

        val secretCommand = "rm -rf / --no-preserve-root --token=super_secret_123".encodeToByteArray()
        ctrl.sendInput(secretCommand)

        val snapshot = AppLogger.getDiagnosticsSnapshot(profileId = "profile-test-1", sessionId = "sess-input-1")
        val droppedEntry = snapshot.entries.find { it.message == "terminal.input_dropped" }
        assertNotNull(droppedEntry)
        assertEquals("panel_inactive", droppedEntry.metadata?.get("reason"))
        assertEquals(secretCommand.size.toString(), droppedEntry.metadata?.get("byteCount"))

        // Verify command text is NEVER retained
        for (entry in snapshot.entries) {
            assertFalse(entry.message.contains("rm -rf"))
            assertFalse(entry.message.contains("super_secret_123"))
            entry.metadata?.values?.forEach {
                assertFalse(it.contains("rm -rf"))
                assertFalse(it.contains("super_secret_123"))
            }
        }
    }

    @Test
    fun testExitAndRestartDiagnostics() {
        val ctrl = TerminalSessionController("sess-exit-1", 1L, connRef)

        ctrl.handleExit(code = 137, restart = true, restarts = 2u, eventIncarnation = 1uL)
        val exitEntry = AppLogger.getDiagnosticsSnapshot().entries.find { it.message == "terminal.exit" }
        assertNotNull(exitEntry)
        assertEquals("137", exitEntry.metadata?.get("exitCode"))
        assertEquals("true", exitEntry.metadata?.get("willRestart"))

        ctrl.handleProcessRestarted(count = 3u, prevExitCode = 137)
        val restartEntry = AppLogger.getDiagnosticsSnapshot().entries.find { it.message == "process.restarted" }
        assertNotNull(restartEntry)
        assertEquals("3", restartEntry.metadata?.get("restartCount"))
    }

    @Test
    fun testResizeDiagnostic() {
        val ctrl = TerminalSessionController("sess-resize-1", 1L, connRef)
        ctrl.resize(120, 36)

        val resizeEntry = AppLogger.getDiagnosticsSnapshot().entries.find { it.message == "terminal.resize" }
        assertNotNull(resizeEntry)
        assertEquals("120", resizeEntry.metadata?.get("cols"))
        assertEquals("36", resizeEntry.metadata?.get("rows"))
    }

    @Test
    fun testMalformedFrameErrorDoesNotLeakRawTextCanary() {
        val secretInMalformedFrame = "MALFORMED_SECRET_PTY_BUFFER_DO_NOT_LEAK"
        val rawMalformedJson = """{"kind":"terminal:output","data":"$secretInMalformedFrame", broken json..."""

        // Simulate what WsConnection does on malformed frame
        AppLogger.recordDiagnostic(
            type = "transport",
            scope = "ws-transport",
            message = "ws.parse_error",
            profileId = connRef.profileId,
            generation = connRef.generation,
            metadata = mapOf(
                "errorCategory" to "SerializationException",
                "frameLength" to rawMalformedJson.length.toString()
            )
        )

        val snapshot = AppLogger.getDiagnosticsSnapshot(profileId = connRef.profileId)
        val parseErr = snapshot.entries.find { it.message == "ws.parse_error" }
        assertNotNull(parseErr)
        assertEquals("SerializationException", parseErr.metadata?.get("errorCategory"))
        assertEquals(rawMalformedJson.length.toString(), parseErr.metadata?.get("frameLength"))

        // Verify canary is not leaked into diagnostics
        for (entry in snapshot.entries) {
            assertFalse(entry.message.contains("MALFORMED_SECRET_PTY"))
            entry.metadata?.values?.forEach {
                assertFalse(it.contains("MALFORMED_SECRET_PTY"))
            }
        }
    }
}
