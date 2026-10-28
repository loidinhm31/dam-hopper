package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class WsRecoverySupervisorTest {

    @Test
    fun testSupervisorStartAndStopLifecycle() = runTest {
        val testDispatcher = StandardTestDispatcher(testScheduler)
        val testScope = TestScope(testDispatcher)

        val conn = ConnectionRef("test-prof", 1L)
        val stateFlow = kotlinx.coroutines.flow.MutableStateFlow<WsState>(WsState.Disconnected)
        val ws = object : WsConnection(conn, "http://127.0.0.1:1") {
            override val state: kotlinx.coroutines.flow.StateFlow<WsState> = stateFlow
            override suspend fun connect() {
                stateFlow.value = WsState.Connected(SocketInstanceRef(conn, "sock-1"))
            }
            override suspend fun disconnect() {
                stateFlow.value = WsState.Disconnected
            }
        }

        val supervisor = WsRecoverySupervisor(ws, testScope)
        assertEquals(RecoveryPhase.STOPPED, supervisor.snapshot.value.phase)

        supervisor.start()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.CONNECTED, supervisor.snapshot.value.phase)

        supervisor.stop()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.STOPPED, supervisor.snapshot.value.phase)
    }

    @Test
    fun testSupervisorBackgroundPausesAndForegroundResumes() = runTest {
        val testDispatcher = StandardTestDispatcher(testScheduler)
        val testScope = TestScope(testDispatcher)

        val conn = ConnectionRef("test-prof", 1L)
        val ws = object : WsConnection(conn, "http://127.0.0.1:1") {
            override suspend fun connect() {}
            override suspend fun disconnect() {}
        }

        val supervisor = WsRecoverySupervisor(ws, testScope)
        supervisor.start()
        testDispatcher.scheduler.advanceUntilIdle()

        supervisor.onBackground()
        testDispatcher.scheduler.advanceUntilIdle()

        supervisor.onForeground()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.CONNECTING, supervisor.snapshot.value.phase)
    }

    @Test
    fun testSupervisorNetworkLostAndRestored() = runTest {
        val testDispatcher = StandardTestDispatcher(testScheduler)
        val testScope = TestScope(testDispatcher)

        val conn = ConnectionRef("test-prof", 1L)
        val ws = object : WsConnection(conn, "http://127.0.0.1:1") {
            override suspend fun connect() {}
            override suspend fun disconnect() {}
        }

        val supervisor = WsRecoverySupervisor(ws, testScope)
        supervisor.start()
        testDispatcher.scheduler.advanceUntilIdle()

        supervisor.onNetworkLost()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.WAITING_NETWORK, supervisor.snapshot.value.phase)

        supervisor.onNetworkAvailable()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.CONNECTING, supervisor.snapshot.value.phase)
    }

    @Test
    fun testAuthBlockedCannotBeBypassedByHints() = runTest {
        val testDispatcher = StandardTestDispatcher(testScheduler)
        val testScope = TestScope(testDispatcher)

        val conn = ConnectionRef("test-prof", 1L)
        val stateFlow = kotlinx.coroutines.flow.MutableStateFlow<WsState>(WsState.Disconnected)
        var connectCalls = 0
        val ws = object : WsConnection(conn, "http://127.0.0.1:1") {
            override val state: kotlinx.coroutines.flow.StateFlow<WsState> = stateFlow
            override suspend fun connect() {
                connectCalls++
                stateFlow.value = WsState.MfaRequired(4403)
            }
            override suspend fun disconnect() {
                stateFlow.value = WsState.Disconnected
            }
        }

        val supervisor = WsRecoverySupervisor(ws, testScope)
        supervisor.start()
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(RecoveryPhase.AUTH_BLOCKED, supervisor.snapshot.value.phase)
        assertEquals(1, connectCalls)

        // Hints should be blocked and not cause new attempts
        supervisor.onBackground()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.AUTH_BLOCKED, supervisor.snapshot.value.phase)

        supervisor.onForeground()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.AUTH_BLOCKED, supervisor.snapshot.value.phase)

        supervisor.onNetworkAvailable()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.AUTH_BLOCKED, supervisor.snapshot.value.phase)

        supervisor.requestRecovery("Manual retry")
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.AUTH_BLOCKED, supervisor.snapshot.value.phase)
        assertEquals(1, connectCalls)
    }

    @Test
    fun testDuplicateForegroundWithoutBackgroundDoesNotDisconnectConnectedSocket() = runTest {
        val testDispatcher = StandardTestDispatcher(testScheduler)
        val testScope = TestScope(testDispatcher)

        val conn = ConnectionRef("test-prof", 1L)
        val stateFlow = kotlinx.coroutines.flow.MutableStateFlow<WsState>(WsState.Disconnected)
        var connectCalls = 0
        var disconnectCalls = 0
        val ws = object : WsConnection(conn, "http://127.0.0.1:1") {
            override val state: kotlinx.coroutines.flow.StateFlow<WsState> = stateFlow
            override suspend fun connect() {
                connectCalls++
                stateFlow.value = WsState.Connected(SocketInstanceRef(conn, "sock-1"))
            }
            override suspend fun disconnect() {
                disconnectCalls++
                stateFlow.value = WsState.Disconnected
            }
        }

        val supervisor = WsRecoverySupervisor(ws, testScope)
        supervisor.start()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.CONNECTED, supervisor.snapshot.value.phase)
        assertEquals(1, connectCalls)
        assertEquals(0, disconnectCalls)

        // Duplicate foreground without background does not disconnect
        supervisor.onForeground()
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(RecoveryPhase.CONNECTED, supervisor.snapshot.value.phase)
        assertEquals(1, connectCalls)
        assertEquals(0, disconnectCalls)
    }
}
