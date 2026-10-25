package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.RequestAdmissionState
import dev.damhopper.nativeapp.core.transport.RequestNotSubmittedError
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.SettingsTestServer
import dev.damhopper.nativeapp.features.settings.TestGuard
import dev.damhopper.nativeapp.features.settings.awaitCondition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class IdleSuspendRepositoryTest {
    private lateinit var server: SettingsTestServer
    private lateinit var registry: ConnectionRegistry

    private var statusJson = status()

    private fun status(
        state: String = "watching",
        enabled: Boolean = true,
        mutable: Boolean = true,
        reason: String? = null,
        capability: String = "systemd",
        minQuiet: Int = 30,
        maxQuiet: Int = 120,
        minWake: Int = 45,
        maxWake: Int = 600,
        handoffActive: Boolean = false,
    ) = """{"version":1,"statusRevision":7,"state":"$state","enabled":$enabled,"automaticPolicy":"empty-fleet",
        "timingMutable":$mutable,${reason?.let { "\"timingMutableReason\":\"$it\"," } ?: ""}"capabilityCode":"$capability",
        "currentEpoch":1,"quietPeriodSeconds":60,"wakeAfterSeconds":90,
        "minQuietPeriodSeconds":$minQuiet,"maxQuietPeriodSeconds":$maxQuiet,
        "minWakeAfterSeconds":$minWake,"maxWakeAfterSeconds":$maxWake,
        "fleetSnapshot":{"handoffActive":$handoffActive}}""".replace("\n", " ")

    @BeforeTest
    fun setUp() {
        server = SettingsTestServer()
        registry = ConnectionRegistry()
        server.route("/api/system/idle-suspend/v1/status") { _ -> 200 to statusJson }
        server.route("/api/system/idle-suspend/v1/timing") { _ ->
            200 to """{"version":1,"changed":true,"statusRevision":8,"quietPeriodSeconds":30,"wakeAfterSeconds":45}"""
        }
        server.route("/api/system/idle-suspend/v1/force-suspend") { _ ->
            202 to """{"version":1,"requestId":"r1","statusRevision":9,"state":"handedOff","wakeAfterSeconds":0,"forced":false,"fleetSnapshot":{}}"""
        }
        server.route("/api/system/idle-suspend/v1/consent/decision") { _ ->
            200 to """{"version":1,"requestId":"c1","decision":"approve","statusRevision":10,"settled":true}"""
        }
    }

    @AfterTest
    fun tearDown() = server.stop()

    private fun repository(token: suspend () -> String? = { "token" }): IdleSuspendRepository {
        val ref = runBlocking { registry.getOrCreateConnection("p") }
        return IdleSuspendRepository(ApiClient(ref, server.baseUrl, token, registry))
    }

    private fun patches() = server.requests.filter { it.method == "PATCH" }

    @Test
    fun timingBoundsComeFromTheLatestStatusForBothFieldsNotHardCodedLimits() = runBlocking {
        val repo = repository()
        // 30 is below the old hard-coded 60 but valid for this server; 20 is below ITS minimum.
        assertFailsWith<IllegalArgumentException> { repo.updateTiming(20, 100, TestGuard()).getOrThrow() }
        assertFailsWith<IllegalArgumentException> { repo.updateTiming(121, 100, TestGuard()).getOrThrow() }
        assertFailsWith<IllegalArgumentException> { repo.updateTiming(60, 44, TestGuard()).getOrThrow() }
        assertFailsWith<IllegalArgumentException> { repo.updateTiming(60, 601, TestGuard()).getOrThrow() }
        assertEquals(0, patches().size, "invalid pairs never reach the server")

        val ok = repo.updateTiming(30, 45, TestGuard()).getOrThrow()
        assertEquals(8L, ok.statusRevision)
        assertEquals("""{"quietPeriodSeconds":30,"wakeAfterSeconds":45}""", patches().single().body, "one atomic pair")

        // The server later widens its bounds: the very next call uses the new bounds.
        statusJson = status(minQuiet = 10, maxQuiet = 900, minWake = 10, maxWake = 9000)
        repo.updateTiming(900, 9000, TestGuard()).getOrThrow()
        assertEquals(2, patches().size)
        assertTrue(server.count("GET", "/api/system/idle-suspend/v1/status") >= 6, "status is re-read before every validation")
    }

    @Test
    fun unknownLockedHandoffDisabledAndCapabilityStatesNeverSubmit() = runBlocking {
        val repo = repository()
        val blocked = listOf(
            status(mutable = false, reason = "operatorLocked"),
            status(state = "handedOff"),
            status(handoffActive = true),
            status(enabled = false, state = "disabled"),
            status(capability = "unavailable"),
        )
        for (json in blocked) {
            statusJson = json
            val result = repo.updateTiming(60, 90, TestGuard())
            assertTrue(result.isFailure, json)
            assertTrue(result.exceptionOrNull() is IllegalArgumentException)
        }
        assertEquals(0, patches().size)
        assertNotNull(idleTimingBlockReason(null), "unknown status blocks")
        assertNull(idleTimingBlockReason(decodeIdleSuspendStatusV1(status())))
    }

    @Test
    fun handoffConflictIsNeverRetried() = runBlocking {
        server.route("/api/system/idle-suspend/v1/timing") { _ ->
            409 to """{"code":"idleSuspendHandoffInProgress","error":"Handoff in progress"}"""
        }
        val guard = TestGuard()
        val error = assertFailsWith<IdleSuspendHandoffConflictException> {
            repository().updateTiming(60, 90, guard).getOrThrow()
        }
        assertTrue(error.message!!.contains("Handoff"))
        assertEquals(1, patches().size)
        val outcome = idleOutcome<Nothing>(Result.failure(error), guard)
        assertTrue(outcome is SettingsOutcome.Rejected, "a 409 answer is a definitive rejection")
    }

    @Test
    fun forceSuspendUsesDynamicWakeBoundsAndMapsFleetConflicts() = runBlocking {
        val repo = repository()
        assertFailsWith<IllegalArgumentException> { repo.forceSuspend(44, false, TestGuard()).getOrThrow() }
        assertFailsWith<IllegalArgumentException> { repo.forceSuspend(601, false, TestGuard()).getOrThrow() }
        assertEquals(0, server.count("POST", "/api/system/idle-suspend/v1/force-suspend"))
        assertEquals("r1", repo.forceSuspend(0, false, TestGuard()).getOrThrow().requestId)
        assertEquals("r1", repo.forceSuspend(45, true, TestGuard()).getOrThrow().requestId)

        server.route("/api/system/idle-suspend/v1/force-suspend") { _ ->
            409 to """{"code":"idleSuspendActiveFleetConfirmationRequired","error":"Active fleet","activeSessionCount":3}"""
        }
        assertFailsWith<IdleSuspendActiveFleetConflictException> { repo.forceSuspend(0, false, TestGuard()).getOrThrow() }
        server.route("/api/system/idle-suspend/v1/force-suspend") { _ ->
            409 to """{"code":"idleSuspendFleetChanged","error":"Changed","activeSessionCount":1}"""
        }
        assertFailsWith<IdleSuspendFleetChangedConflictException> { repo.forceSuspend(0, true, TestGuard()).getOrThrow() }
        assertEquals(4, server.count("POST", "/api/system/idle-suspend/v1/force-suspend"), "no replay after conflicts")
    }

    @Test
    fun suspendedCredentialsThenRetirementZeroOutboundForTimingForceAndConsent() = runBlocking {
        for (action in listOf("timing", "force", "consent")) {
            server.requests.clear()
            val localRegistry = ConnectionRegistry()
            val ref = localRegistry.getOrCreateConnection("p-$action")
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val calls = AtomicInteger()
            val gateOnMutation = action == "consent"
            val client = ApiClient(ref, server.baseUrl, {
                // timing/force read status first (call 1); the mutation is call 2. Consent has no status read.
                val n = calls.incrementAndGet()
                if (n == (if (gateOnMutation) 1 else 2)) {
                    entered.complete(Unit)
                    release.await()
                }
                "token"
            }, localRegistry)
            val repo = IdleSuspendRepository(client)
            val guard = TestGuard()
            val request = dev.damhopper.nativeapp.features.host.ConsentDecisionRequest("c1", 1, "conn", "cap", SleepConsentDecision.APPROVE)
            val call = async(Dispatchers.IO) {
                when (action) {
                    "timing" -> repo.updateTiming(60, 90, guard)
                    "force" -> repo.forceSuspend(0, false, guard)
                    else -> repo.submitConsentDecision(request, guard)
                }
            }
            withTimeout(10_000) { entered.await() }
            localRegistry.retireConnection(ref)
            release.complete(Unit)

            val result = withTimeout(10_000) { call.await() }
            assertTrue(result.isFailure, action)
            assertTrue(result.exceptionOrNull() is RequestNotSubmittedError, "$action: ${result.exceptionOrNull()}")
            assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
            assertEquals(0, server.requests.count { it.method != "GET" }, "$action sent a mutation")
        }
    }

    @Test
    fun consentSubmitsStructuredBodyOnceAndGuardReuseIsNotAuthorized() = runBlocking {
        val repo = repository()
        val request = ConsentDecisionRequest("c1", 4, "conn-1", "secret-cap", SleepConsentDecision.DENY)
        val guard = TestGuard()
        assertEquals(10L, repo.submitConsentDecision(request, guard).getOrThrow().statusRevision)
        val body = server.posts("/api/system/idle-suspend/v1/consent/decision").single().body
        assertTrue(body.contains("\"requestRevision\":4") && body.contains("\"decision\":\"deny\""), body)

        val reuse = repo.submitConsentDecision(request, guard)
        assertTrue(reuse.exceptionOrNull() is RequestNotSubmittedError)
        assertEquals(1, server.count("POST", "/api/system/idle-suspend/v1/consent/decision"))
        assertTrue(idleOutcome(reuse, guard) is SettingsOutcome.Unknown || idleOutcome(reuse, guard) is SettingsOutcome.NotSubmitted)
    }

    @Test
    fun cancellationAfterAdmissionPropagatesAndIsNotSwallowedIntoAResult() = runBlocking {
        val release = CountDownLatch(1)
        server.route("/api/system/idle-suspend/v1/consent/decision") { _ ->
            release.await(10, TimeUnit.SECONDS)
            200 to """{"version":1,"requestId":"c1","decision":"approve","statusRevision":10,"settled":true}"""
        }
        val guard = TestGuard()
        val repo = repository()
        var swallowed: Result<ConsentDecisionResponse>? = null
        val job = launch(Dispatchers.IO) {
            swallowed = repo.submitConsentDecision(ConsentDecisionRequest("c1", 1, "c", "k", SleepConsentDecision.APPROVE), guard)
        }
        awaitCondition("request admitted and in flight") { server.count("POST", "/api/system/idle-suspend/v1/consent/decision") == 1 }
        job.cancel()
        job.join()
        release.countDown()
        assertNull(swallowed, "CancellationException must propagate, never become a Result")
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
        assertEquals(1, server.count("POST", "/api/system/idle-suspend/v1/consent/decision"))
    }

    @Test
    fun outcomeClassificationUsesTheGuardsOwnReceipt() = runBlocking {
        server.route("/api/system/idle-suspend/v1/consent/decision") { _ -> 500 to "" }
        val request = ConsentDecisionRequest("c1", 1, "c", "k", SleepConsentDecision.APPROVE)
        val admitted = TestGuard()
        assertTrue(idleOutcome(repository().submitConsentDecision(request, admitted), admitted) is SettingsOutcome.Unknown)
        server.route("/api/system/idle-suspend/v1/consent/decision") { _ -> 403 to """{"error":"no"}""" }
        val rejected = TestGuard()
        assertTrue(idleOutcome(repository().submitConsentDecision(request, rejected), rejected) is SettingsOutcome.Rejected)
        val unused = TestGuard()
        val failure = Result.failure<ConsentDecisionResponse>(IllegalStateException("local"))
        assertTrue(idleOutcome(failure, unused) is SettingsOutcome.NotSubmitted)
    }
}
