package dev.damhopper.nativeapp.features.host

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.UiConnectionReceipt
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class IdleConsentControllerTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            executor = null
            start()
        }
        serverPort = server!!.address.port
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    @Test
    fun testStatusParsingAndOldServerFallback() {
        // Standard payload
        val normalJson = """
            {
                "version": 1,
                "statusRevision": 12,
                "state": "watching",
                "enabled": true,
                "automaticPolicy": "agent-activity",
                "activity": {
                    "measurementState": "available",
                    "reasonCode": "quiet",
                    "networkCoverage": "tcp4-tcp6"
                },
                "capabilityCode": "systemd",
                "currentEpoch": 5,
                "quietPeriodSeconds": 300,
                "wakeAfterSeconds": 600,
                "timingMutable": true
            }
        """.trimIndent()
        val decodedNormal = decodeIdleSuspendStatusV1(normalJson)
        assertEquals(IdleSuspendState.WATCHING, decodedNormal.state)
        assertEquals(AutomaticPolicy.AGENT_ACTIVITY, decodedNormal.automaticPolicy)
        assertNotNull(decodedNormal.activity)
        assertEquals(MeasurementState.AVAILABLE, decodedNormal.activity?.measurementState)

        // Old server fallback: both automaticPolicy and activity absent -> normalized
        val oldServerJson = """
            {
                "version": 1,
                "statusRevision": 4,
                "state": "disabled",
                "enabled": false,
                "capabilityCode": "fake",
                "currentEpoch": 1,
                "quietPeriodSeconds": 300,
                "wakeAfterSeconds": 600,
                "timingMutable": false
            }
        """.trimIndent()
        val decodedOld = decodeIdleSuspendStatusV1(oldServerJson)
        assertEquals(AutomaticPolicy.EMPTY_FLEET, decodedOld.automaticPolicy)
        assertNull(decodedOld.activity)

        // Malformed payload: activity present but automaticPolicy missing -> throws decode error
        val malformedJson = """
            {
                "version": 1,
                "statusRevision": 4,
                "state": "disabled",
                "enabled": false,
                "activity": {
                    "measurementState": "available"
                }
            }
        """.trimIndent()
        assertFailsWith<IllegalArgumentException> {
            decodeIdleSuspendStatusV1(malformedJson)
        }
    }

    @Test
    fun testUpdateTimingBoundsAndConflict() = runTest {
        server!!.createContext("/api/system/idle-suspend/v1/timing") { exchange ->
            if (exchange.requestHeaders.getFirst("X-Simulate-Conflict") == "1") {
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(409, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""{"code": "idleSuspendHandoffInProgress", "error": "Handoff in progress"}""")
                    writer.flush()
                }
            } else {
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""
                        {
                            "version": 1,
                            "changed": true,
                            "statusRevision": 13,
                            "quietPeriodSeconds": 120,
                            "wakeAfterSeconds": 300
                        }
                    """.trimIndent())
                    writer.flush()
                }
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = IdleSuspendRepository(apiClient)

        // Lower bound violation: < 60 rejected locally
        assertFailsWith<IllegalArgumentException> {
            repo.updateTiming(59, 300).getOrThrow()
        }

        // Upper bound violation: > 86400 rejected locally
        assertFailsWith<IllegalArgumentException> {
            repo.updateTiming(300, 90000).getOrThrow()
        }

        // Valid bounds success
        val successRes = repo.updateTiming(120, 300).getOrThrow()
        assertEquals(13L, successRes.statusRevision)
        assertEquals(120, successRes.quietPeriodSeconds)
        assertEquals(300, successRes.wakeAfterSeconds)
    }

    @Test
    fun testForceSuspendNonRetryingConflicts() = runTest {
        var callCount = 0
        server!!.createContext("/api/system/idle-suspend/v1/force-suspend") { exchange ->
            callCount++
            exchange.responseHeaders.set("Content-Type", "application/json")
            val mode = exchange.requestHeaders.getFirst("X-Mode")
            when (mode) {
                "active-fleet" -> {
                    exchange.sendResponseHeaders(409, 0)
                    exchange.responseBody.bufferedWriter().use { writer ->
                        writer.write("""
                            {
                                "code": "idleSuspendActiveFleetConfirmationRequired",
                                "error": "Active fleet running",
                                "activeSessionCount": 3
                            }
                        """.trimIndent())
                        writer.flush()
                    }
                }
                "fleet-changed" -> {
                    exchange.sendResponseHeaders(409, 0)
                    exchange.responseBody.bufferedWriter().use { writer ->
                        writer.write("""
                            {
                                "code": "idleSuspendFleetChanged",
                                "error": "Fleet changed concurrently",
                                "activeSessionCount": 1
                            }
                        """.trimIndent())
                        writer.flush()
                    }
                }
                else -> {
                    exchange.sendResponseHeaders(202, 0)
                    exchange.responseBody.bufferedWriter().use { writer ->
                        writer.write("""
                            {
                                "version": 1,
                                "requestId": "req-123",
                                "statusRevision": 14,
                                "state": "handedOff",
                                "wakeAfterSeconds": 0,
                                "forced": false,
                                "fleetSnapshot": {
                                    "generation": 1,
                                    "liveCount": 0,
                                    "creatingCount": 0,
                                    "restartPendingCount": 0,
                                    "disposing": false,
                                    "closing": false,
                                    "handoffActive": true
                                }
                            }
                        """.trimIndent())
                        writer.flush()
                    }
                }
            }
        }

        server!!.createContext("/api/system/idle-suspend/v1/status") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "version": 1,
                        "statusRevision": 14,
                        "state": "watching",
                        "enabled": true,
                        "automaticPolicy": "empty-fleet",
                        "capabilityCode": "systemd",
                        "currentEpoch": 5,
                        "quietPeriodSeconds": 300,
                        "wakeAfterSeconds": 600,
                        "timingMutable": true
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = IdleSuspendRepository(apiClient)
        val controller = IdleConsentController(
            connection = ref,
            repository = repo,
            receiptProvider = { null }
        )

        // 1. Success 202 Accepted
        val admission = controller.requestForceSuspend(wakeAfterSeconds = 0, force = false).getOrThrow()
        assertEquals("req-123", admission.requestId)
        assertEquals("handedOff", admission.state)
        assertEquals(1, callCount)
    }

    @Test
    fun testConsentSubmissionWithLiveReceiptFencing() = runTest {
        var submittedRequestId = ""
        var submittedCapability = ""
        var submittedDecision = ""

        server!!.createContext("/api/system/idle-suspend/v1/status") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "version": 1,
                        "statusRevision": 20,
                        "state": "watching",
                        "enabled": true,
                        "automaticPolicy": "agent-free",
                        "consent": {
                            "requestId": "consent-uuid-1",
                            "requestRevision": 1,
                            "state": "pending",
                            "requestedAtMs": 10000,
                            "expiresAtMs": 70000,
                            "wakeAfterSeconds": 600
                        },
                        "capabilityCode": "systemd",
                        "currentEpoch": 2,
                        "quietPeriodSeconds": 300,
                        "wakeAfterSeconds": 600,
                        "timingMutable": true
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        server!!.createContext("/api/system/idle-suspend/v1/consent/decision") { exchange ->
            val body = exchange.requestBody.bufferedReader().use { it.readText() }
            val parsed = dev.damhopper.nativeapp.core.transport.ProtocolJson.parseToJsonElement(body) as kotlinx.serialization.json.JsonObject
            submittedRequestId = parsed["requestId"]?.toString()?.trim('"') ?: ""
            submittedCapability = parsed["decisionCapability"]?.toString()?.trim('"') ?: ""
            submittedDecision = parsed["decision"]?.toString()?.trim('"') ?: ""

            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "version": 1,
                        "requestId": "consent-uuid-1",
                        "decision": "approve",
                        "statusRevision": 21,
                        "settled": true
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        var liveReceipt: UiConnectionReceipt? = null

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = IdleSuspendRepository(apiClient)
        val controller = IdleConsentController(
            connection = ref,
            repository = repo,
            receiptProvider = { liveReceipt }
        )

        // 1. Fetch status with pending consent
        controller.refreshStatus().getOrThrow()
        val pending = controller.pendingConsent.value
        assertNotNull(pending)
        assertEquals("consent-uuid-1", pending.requestId)
        assertEquals(SleepConsentState.PENDING, pending.state)

        // 2. Submit consent when live receipt is null -> MUST FAIL CLOSED
        val failResult = controller.submitConsent(SleepConsentDecision.APPROVE)
        assertTrue(failResult.isFailure)
        assertTrue(failResult.exceptionOrNull()?.message?.contains("live WebSocket capability receipt not available") == true)

        // 3. Provide live receipt -> MUST SUCCEED with capability submitted
        val sockRef = SocketInstanceRef(ref, "socket-101")
        liveReceipt = UiConnectionReceipt(
            socketRef = sockRef,
            version = 1,
            connectionId = "conn-abc-123",
            decisionCapability = "secret-token-xyz"
        )

        val successResult = controller.submitConsent(SleepConsentDecision.APPROVE)
        assertTrue(successResult.isSuccess)
        assertEquals("consent-uuid-1", submittedRequestId)
        assertEquals("secret-token-xyz", submittedCapability)
        assertEquals("approve", submittedDecision)

        // 4. Test broadcast lag resync (revision = 0) with actual revision bump
        var statusHitCount = 0
        server!!.removeContext("/api/system/idle-suspend/v1/status")
        server!!.createContext("/api/system/idle-suspend/v1/status") { exchange ->
            statusHitCount++
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "version": 1,
                        "statusRevision": 25,
                        "state": "watching",
                        "enabled": true,
                        "automaticPolicy": "empty-fleet",
                        "capabilityCode": "systemd",
                        "currentEpoch": 2,
                        "quietPeriodSeconds": 300,
                        "wakeAfterSeconds": 600,
                        "timingMutable": true
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        controller.handleServerMsg(
            ServerMsg.IdleSuspendChanged(
                payload = ServerMsg.IdleSuspendChangedPayload(
                    version = 1,
                    revision = 0L // Revision 0 is broadcast lag resync hint
                )
            )
        )
        assertEquals(1, statusHitCount)
        assertEquals(25L, controller.lastRevision.value)
    }

    @Test
    fun testPendingConsentClearedWhenStateTurnsNonPending() = runTest {
        var currentConsentState = "pending"
        server!!.createContext("/api/system/idle-suspend/v1/status") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "version": 1,
                        "statusRevision": 30,
                        "state": "watching",
                        "enabled": true,
                        "automaticPolicy": "agent-free",
                        "consent": {
                            "requestId": "consent-uuid-1",
                            "requestRevision": 1,
                            "state": "$currentConsentState",
                            "requestedAtMs": 10000,
                            "expiresAtMs": 70000,
                            "wakeAfterSeconds": 600
                        },
                        "capabilityCode": "systemd",
                        "currentEpoch": 2,
                        "quietPeriodSeconds": 300,
                        "wakeAfterSeconds": 600,
                        "timingMutable": true
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = IdleSuspendRepository(apiClient)
        val controller = IdleConsentController(ref, repo) { null }

        // First check: state is pending -> pendingConsent populated
        controller.refreshStatus().getOrThrow()
        assertNotNull(controller.pendingConsent.value)
        assertEquals(SleepConsentState.PENDING, controller.pendingConsent.value?.state)

        // Second check: server updates same requestId to approved -> pendingConsent MUST BE CLEARED
        currentConsentState = "approved"
        controller.refreshStatus().getOrThrow()
        assertNull(controller.pendingConsent.value)

        // Test retire()
        controller.retire()
        val postRetire = controller.refreshStatus()
        assertTrue(postRetire.isFailure)
        assertTrue(postRetire.exceptionOrNull()?.message?.contains("retired") == true)
    }
}
