package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class ResourceStreamCoordinatorTest {

    private val testDispatcher = StandardTestDispatcher()
    private val testScope = TestScope(testDispatcher)

    private fun createFakeSseClient(
        connection: ConnectionRef,
        flowToEmit: Flow<HostResourceSseFrame> = flowOf(),
    ): HostResourceSseClient {
        return object : HostResourceSseClient(connection, "http://127.0.0.1:8080") {
            override fun openEventStream(onByteProgress: (Long) -> Unit): Flow<HostResourceSseFrame> {
                onByteProgress(100L)
                return flowToEmit
            }
        }
    }

    @Test
    fun testInitialStateAndInterestRegistration() = runTest {
        val owner = ConnectionRef("prof-1", 1L)
        val sseClient = createFakeSseClient(owner)
        val coordinator = ResourceStreamCoordinator(
            owner = owner,
            sseClient = sseClient,
            coroutineScope = CoroutineScope(testDispatcher),
        )

        assertEquals(ResourceSourceMode.STOPPED, coordinator.state.value.mode)
        assertFalse(coordinator.hasInterest())

        val unregister = coordinator.registerInterest(ResourceConsumerKind.FLEET)
        assertTrue(coordinator.hasInterest())

        unregister()
        assertFalse(coordinator.hasInterest())
        assertEquals(ResourceSourceMode.STOPPED, coordinator.state.value.mode)
    }

    @Test
    fun testForegroundBackgroundLifecycle() = runTest {
        val owner = ConnectionRef("prof-1", 1L)
        val sseClient = createFakeSseClient(owner)
        val coordinator = ResourceStreamCoordinator(
            owner = owner,
            sseClient = sseClient,
            coroutineScope = CoroutineScope(testDispatcher),
        )

        coordinator.registerInterest(ResourceConsumerKind.FLEET)
        assertEquals(ResourceSourceMode.STARTING, coordinator.state.value.mode)

        coordinator.setForeground(false)
        assertEquals(ResourceSourceMode.PAUSED, coordinator.state.value.mode)

        coordinator.setForeground(true)
        assertEquals(ResourceSourceMode.STARTING, coordinator.state.value.mode)
    }

    @Test
    fun testRevisionCommitAndDuplicateRejection() {
        var state = ResourceSourceState()

        val snapJson = ProtocolJson.encodeToJsonElement(HostResourceSnapshotV1.serializer(), HostResourceSnapshotV1(sampleId = "s1"))
        val metricsJson = ProtocolJson.encodeToJsonElement(HostMetrics.serializer(), HostMetrics(hostname = "host1"))

        val status1 = HostResourceStatusEvent(serverEpoch = "ep-1", revision = "10", freshnessTtlMs = 5000)
        val data1 = HostResourceDataEvent(1, "ep-1", "10", snapJson, metricsJson, 5000)

        // 1. First commit: accepted
        val state1 = ResourceFrameCommitter.commitPairedFrame(status1, data1, state, { 1000L })
        assertNotNull(state1)
        assertEquals(ResourceSourceMode.LIVE, state1.mode)
        assertEquals(10uL, state1.lastCommittedRevision)
        assertEquals("ep-1", state1.lastCommittedEpoch)

        // 2. Duplicate revision (10) within same epoch: rejected
        val duplicate = ResourceFrameCommitter.commitPairedFrame(status1, data1, state1, { 1000L })
        assertNull(duplicate)

        // 3. Regressing revision (9) within same epoch: rejected
        val regressingData = HostResourceDataEvent(1, "ep-1", "9", snapJson, metricsJson, 5000)
        val regressing = ResourceFrameCommitter.commitPairedFrame(status1, regressingData, state1, { 1000L })
        assertNull(regressing)

        // 4. Skipped revision (15) within same epoch: accepted
        val skippedData = HostResourceDataEvent(1, "ep-1", "15", snapJson, metricsJson, 5000)
        val state2 = ResourceFrameCommitter.commitPairedFrame(status1, skippedData, state1, { 1000L })
        assertNotNull(state2)
        assertEquals(15uL, state2.lastCommittedRevision)

        // 5. New server epoch: accepted even with smaller revision number
        val newEpochData = HostResourceDataEvent(1, "ep-2", "2", snapJson, metricsJson, 5000)
        val state3 = ResourceFrameCommitter.commitPairedFrame(
            HostResourceStatusEvent("ep-2", "2", freshnessTtlMs = 5000),
            newEpochData,
            state2,
            { 1000L }
        )
        assertNotNull(state3)
        assertEquals("ep-2", state3.lastCommittedEpoch)
        assertEquals(2uL, state3.lastCommittedRevision)
    }

    @Test
    fun testFailureOutcomeLatches() {
        // AUTH_UNAVAILABLE latches AuthBlocked
        val authErr = ApiRequestError("Auth error", 503, "AUTH_UNAVAILABLE")
        val out1 = ResourceFailureHandler.handleFailure(authErr, 0)
        assertIs<FailureOutcome.AuthBlocked>(out1)

        // FRAME_TOO_LARGE latches RestOnly
        val frameErr = ApiRequestError("Oversize", 503, "FRAME_TOO_LARGE")
        val out2 = ResourceFailureHandler.handleFailure(frameErr, 0)
        assertIs<FailureOutcome.RestOnly>(out2)

        // 404 latches RestOnly
        val notFoundErr = ApiRequestError("Not found", 404)
        val out3 = ResourceFailureHandler.handleFailure(notFoundErr, 0)
        assertIs<FailureOutcome.RestOnly>(out3)

        // Transient error within budget triggers Retry
        val transientErr = ApiRequestError("Temporary timeout", 500)
        val out4 = ResourceFailureHandler.handleFailure(transientErr, 2)
        assertIs<FailureOutcome.Retry>(out4)
        assertEquals(3, (out4 as FailureOutcome.Retry).newRetryCount)

        // Exhausted budget (5 retries) latches RestOnly
        val out5 = ResourceFailureHandler.handleFailure(transientErr, 5)
        assertIs<FailureOutcome.RestOnly>(out5)
    }

    @Test
    fun testCanUseResourceRestGate() {
        val owner = ConnectionRef("prof-1", 1L)
        val sseClient = createFakeSseClient(owner)
        val coordinator = ResourceStreamCoordinator(
            owner = owner,
            sseClient = sseClient,
            coroutineScope = CoroutineScope(testDispatcher),
        )

        // No interest: false
        assertFalse(coordinator.canUseResourceRest())

        coordinator.registerInterest(ResourceConsumerKind.FLEET)
        // In STARTING mode: true
        assertTrue(coordinator.canUseResourceRest())

        // In Background: false
        coordinator.setForeground(false)
        assertFalse(coordinator.canUseResourceRest())

        coordinator.setForeground(true)
        assertTrue(coordinator.canUseResourceRest())
    }

    @Test
    fun testIsCurrentOwnerWithRegistryValidation() = runTest {
        val owner = ConnectionRef("prof-reg", 1L)
        val sseClient = createFakeSseClient(owner)
        val registry = ConnectionRegistry()

        // Registry present but profile not registered yet -> must return false
        val coordWithReg = ResourceStreamCoordinator(
            owner = owner,
            sseClient = sseClient,
            registry = registry,
            coroutineScope = CoroutineScope(testDispatcher),
        )
        assertFalse(coordWithReg.isCurrentOwner(), "Missing profile in registry must not be current owner")

        // Register profile with same generation -> returns true
        val activeRef = registry.getOrCreateConnection("prof-reg")
        assertEquals(owner, activeRef)
        assertTrue(coordWithReg.isCurrentOwner(), "Matching generation must be current owner")

        // Retire advances generation -> original owner generation (1L) is now stale
        registry.retireConnection(activeRef)
        assertFalse(coordWithReg.isCurrentOwner(), "Retired / advanced generation must not be current owner")

        // Remove profile -> profile is completely gone from registry
        registry.removeProfile("prof-reg")
        assertFalse(coordWithReg.isCurrentOwner(), "Removed profile must not be current owner")
    }
}
