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
}
