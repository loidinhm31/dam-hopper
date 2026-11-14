package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.WsState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlin.test.Test
import kotlin.test.assertEquals

class TerminalConnectionPresentationTest {

    private val socketRef = SocketInstanceRef(ConnectionRef("test", 1L), "sock-1")

    @Test
    fun testDisconnectedShowsOfflineAndNeverGreen() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Disconnected,
            isSessionAlive = true,
            isStreamReady = true,
        )
        assertEquals("OFFLINE", status.label)
        assertEquals(DamHopperColors.TextSecondary, status.color)
    }

    @Test
    fun testNullTransportShowsOfflineAndNeverGreen() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = null,
            isSessionAlive = true,
            isStreamReady = true,
        )
        assertEquals("OFFLINE", status.label)
        assertEquals(DamHopperColors.TextSecondary, status.color)
    }

    @Test
    fun testConnectingShowsWarning() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Connecting,
            isSessionAlive = true,
            isStreamReady = true,
        )
        assertEquals("CONNECTING", status.label)
        assertEquals(DamHopperColors.Warning, status.color)
    }

    @Test
    fun testOverflowShowsResyncingWarning() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Overflow(4001),
            isSessionAlive = true,
            isStreamReady = true,
        )
        assertEquals("RESYNCING", status.label)
        assertEquals(DamHopperColors.Warning, status.color)
    }

    @Test
    fun testErrorShowsErrorColor() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Error(Exception("fail")),
            isSessionAlive = true,
            isStreamReady = true,
        )
        assertEquals("ERROR", status.label)
        assertEquals(DamHopperColors.Error, status.color)
    }

    @Test
    fun testExitedProcessShowsExitedError() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Connected(socketRef),
            isSessionAlive = false,
            isStreamReady = true,
        )
        assertEquals("EXITED", status.label)
        assertEquals(DamHopperColors.Error, status.color)
    }

    @Test
    fun testReplayingStreamShowsWarning() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Connected(socketRef),
            isSessionAlive = true,
            isStreamReady = false,
        )
        assertEquals("REPLAYING", status.label)
        assertEquals(DamHopperColors.Warning, status.color)
    }

    @Test
    fun testConnectedAliveAndReadyShowsSuccessGreen() {
        val status = TerminalConnectionPresentation.resolveTabStatus(
            wsState = WsState.Connected(socketRef),
            isSessionAlive = true,
            isStreamReady = true,
            restartCount = 0u,
        )
        assertEquals("READY", status.label)
        assertEquals(DamHopperColors.Success, status.color)
    }

    @Test
    fun testUncertainCreateStatusStrictlyForbidsLaunchAgainAndOffersCheckStatus() {
        val pendingRecord = UncertainCreateRecord(
            intentId = "intent-1",
            profileId = "prof-1",
            terminalId = "term-pending",
            createdAtEpochMs = 1000L,
            status = UncertainCreateStatus.PENDING,
        )
        val pendingPres = TerminalConnectionPresentation.resolveCreateStatusPresentation(pendingRecord)
        assertEquals("CREATION UNCERTAIN", pendingPres.label)
        assertEquals(true, pendingPres.canCheckStatus, "Uncertain create must offer Check status")
        assertEquals(false, pendingPres.canLaunchAgain, "Uncertain create must NEVER offer Launch Again")
        assertEquals(true, pendingPres.explanation.contains("blocked"))

        val confirmedRecord = UncertainCreateRecord(
            intentId = "intent-2",
            profileId = "prof-1",
            terminalId = "term-confirmed",
            createdAtEpochMs = 2000L,
            status = UncertainCreateStatus.CONFIRMED,
        )
        val confirmedPres = TerminalConnectionPresentation.resolveCreateStatusPresentation(confirmedRecord)
        assertEquals("CONFIRMED", confirmedPres.label)
        assertEquals(false, confirmedPres.canCheckStatus)
        assertEquals(false, confirmedPres.canLaunchAgain)

        val refusedRecord = UncertainCreateRecord(
            intentId = "intent-3",
            profileId = "prof-1",
            terminalId = "term-refused",
            createdAtEpochMs = 3000L,
            status = UncertainCreateStatus.REFUSED,
        )
        val refusedPres = TerminalConnectionPresentation.resolveCreateStatusPresentation(refusedRecord)
        assertEquals("DEFINITELY REFUSED", refusedPres.label)
        assertEquals(false, refusedPres.canCheckStatus)
        assertEquals(false, refusedPres.canLaunchAgain)
    }

    @Test
    fun testTerminationOutcomePresentationsAwaitingProcessExit() {
        // 202 terminationRequested
        val outcome202 = TerminalTerminationOutcome(
            id = "term-1",
            requested = true,
            restartCancelled = false,
            statusCode = 202,
        )
        val pres202 = TerminalConnectionPresentation.resolveTerminationOutcomePresentation(outcome202)
        assertEquals("TERMINATION REQUESTED", pres202.label)
        assertEquals(true, pres202.isPending)
        assertEquals(false, pres202.isRefused)
        assertEquals(true, pres202.description.contains("Awaiting observed process exit"))

        // 200 restartCancelled
        val outcome200 = TerminalTerminationOutcome(
            id = "term-1",
            requested = false,
            restartCancelled = true,
            statusCode = 200,
        )
        val pres200 = TerminalConnectionPresentation.resolveTerminationOutcomePresentation(outcome200)
        assertEquals("RESTART CANCELLED", pres200.label)
        assertEquals(true, pres200.isPending)
        assertEquals(false, pres200.isRefused)
        assertEquals(true, pres200.description.contains("Awaiting observed process exit"))

        // 409 mismatch / refusal
        val outcome409 = TerminalTerminationOutcome(
            id = "term-1",
            requested = false,
            restartCancelled = false,
            statusCode = 409,
        )
        val pres409 = TerminalConnectionPresentation.resolveTerminationOutcomePresentation(outcome409)
        assertEquals("TERMINATION REFUSED", pres409.label)
        assertEquals(false, pres409.isPending)
        assertEquals(true, pres409.isRefused)
        assertEquals(true, pres409.description.contains("Original target preserved"))

        // 500 uncertain termination
        val outcome500 = TerminalTerminationOutcome(
            id = "term-1",
            requested = false,
            restartCancelled = false,
            statusCode = 500,
        )
        val pres500 = TerminalConnectionPresentation.resolveTerminationOutcomePresentation(outcome500)
        assertEquals("TERMINATION UNCERTAIN", pres500.label)
        assertEquals(true, pres500.isPending)
        assertEquals(false, pres500.isRefused)
    }
}
