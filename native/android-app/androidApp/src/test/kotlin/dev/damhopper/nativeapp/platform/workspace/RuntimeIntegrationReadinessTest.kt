package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.profiles.InMemoryCredentialVault
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentPathsVerification
import dev.damhopper.nativeapp.features.terminal.ExtensionStatusReport
import dev.damhopper.nativeapp.features.terminal.IntegrationOwner
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Provider semantics (one readiness/effect gate, revision, revocation) and the REAL ProfileRepository -> registry
 * barrier -> provider drain: retirement and replacement publication wait for an admitted effect and the cleanup.
 */
class RuntimeIntegrationReadinessTest {

    private fun ownerOf(ref: ConnectionRef, revision: Long = 0L) =
        IntegrationOwner(ref, SocketInstanceRef(ref, "sock-1"), "https://a.example.com", "alice", revision)

    private val paths = AgentPathsVerification(
        effectiveHome = "/h", ompInstallDir = "/h/.omp/agent", ompNotificationDir = "/h/.omp/agent", ompStatus = "current",
        ompCanEnable = true, codexConfigDir = "/h/.codex", codexNotificationDir = "/h/.codex", codexConfigExists = true,
        codexCanEnable = true, claudeCanEnable = true,
    )
    private val omp = ExtensionStatusReport("current", "/h/.omp/agent/ext", "1", "1", null, "h", null)

    @Test
    fun verifiedRequiresAuthoritativePathAndStatusAndCodexNeverVerifies() {
        val owner = ownerOf(ConnectionRef("p", 1L))
        assertEquals(IntegrationReadinessState.VERIFIED, evaluateReadiness(owner, AgentKind.OMP, paths, omp, null).state)
        assertEquals(IntegrationReadinessState.UNAVAILABLE, evaluateReadiness(owner, AgentKind.OMP, paths.copy(ompCanEnable = false), omp, null).state)
        assertEquals(IntegrationReadinessState.UNAVAILABLE, evaluateReadiness(owner, AgentKind.OMP, paths, omp.copy(status = "absent"), null).state)
        assertEquals(IntegrationReadinessState.UNAVAILABLE, evaluateReadiness(owner, AgentKind.OMP, null, null, null).state)
        assertEquals(IntegrationReadinessState.UNAVAILABLE, evaluateReadiness(owner, AgentKind.CODEX, paths, omp, null).state, "Codex is status-only")
    }

    @Test
    fun effectsRunOnlyForTheExactVerifiedCurrentOwnerAndStaleRevisionsAreRejected() = runBlocking {
        val ref = ConnectionRef("p", 1L)
        var live: Map<String, ConnectionRef> = mapOf("p" to ref)
        val provider = RuntimeReadinessProvider { live }
        val owner = ownerOf(ref, provider.revisionOf("p"))
        assertTrue(provider.publish(evaluateReadiness(owner, AgentKind.OMP, paths, omp, null)))

        var ran = 0
        assertTrue(provider.withVerified(owner, AgentKind.OMP) { ran++ })
        assertFalse(provider.withVerified(owner, AgentKind.CLAUDE) { ran++ }, "no readiness for that agent")
        assertFalse(provider.withVerified(owner.copy(socket = SocketInstanceRef(ref, "other")), AgentKind.OMP) { ran++ }, "another socket is another key")
        assertEquals(1, ran)

        live = emptyMap() // pending/failed retirement: omitted from connectionsState
        assertFalse(provider.withVerified(owner, AgentKind.OMP) { ran++ })
        assertEquals(1, ran)
        live = mapOf("p" to ref)

        provider.invalidate(ref) {}
        assertFalse(provider.withVerified(owner, AgentKind.OMP) { ran++ }, "invalidate returns the owner to UNKNOWN")
        assertFalse(provider.publish(evaluateReadiness(owner, AgentKind.OMP, paths, omp, null)), "a refresh captured before invalidate cannot reinstate it")
        assertNull(provider.current(owner, AgentKind.OMP))
        assertEquals(1, ran)
    }

    @Test
    fun invalidateWaitsForAnAlreadyAdmittedEffectThenAttemptsCleanupAndPropagatesFailure() = runBlocking {
        val ref = ConnectionRef("p", 1L)
        val provider = RuntimeReadinessProvider { mapOf("p" to ref) }
        val owner = ownerOf(ref, provider.revisionOf("p"))
        provider.publish(evaluateReadiness(owner, AgentKind.OMP, paths, omp, null))

        val inEffect = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()
        // The effect is synchronous and holds the gate, so it runs on a worker thread to keep this one free.
        val effect = async(kotlinx.coroutines.Dispatchers.Default) {
            provider.withVerified(owner, AgentKind.OMP) {
                order += "effect-start"
                inEffect.complete(Unit)
                // The synchronous effect holds the gate; the release is observed after the test unblocks it.
                runBlocking { release.await() }
                order += "effect-end"
            }
        }
        val effectJob = effect
        withTimeout(5_000) { inEffect.await() }
        val invalidate = async(kotlinx.coroutines.Dispatchers.Default) {
            runCatching { provider.invalidate(ref) { order += "cleanup"; error("cleanup failed") } }
        }
        delay(100)
        assertFalse(invalidate.isCompleted, "invalidate waits for the admitted effect")
        release.complete(Unit)
        withTimeout(5_000) { effectJob.await() }
        val result = withTimeout(5_000) { invalidate.await() }
        assertEquals(listOf("effect-start", "effect-end", "cleanup"), order)
        assertEquals("cleanup failed", result.exceptionOrNull()?.message, "cleanup failure is propagated, not swallowed")
    }

    @Test
    fun realProfileRepositoryRetirementWaitsForAdmittedEffectDrainAndFencesReplacement() = runBlocking {
        val registry = ConnectionRegistry()
        val repo = ProfileRepository(vault = InMemoryCredentialVault(), registry = registry)
        repo.initialize()
        val profile = repo.addProfile("Prod", "https://a.example.com", "alice")
        val old = registry.getOrCreateConnection(profile.id)
        val provider = RuntimeReadinessProvider { registry.connectionsState.value }
        val owner = ownerOf(old, provider.revisionOf(profile.id))
        provider.publish(evaluateReadiness(owner, AgentKind.OMP, paths, omp, null))

        val drainStarted = CompletableDeferred<Unit>()
        val releaseDrain = CompletableDeferred<Unit>()
        val lifetime = RetirementLifetime(registry, retireOwner = { ref ->
            provider.invalidate(ref) {}
            drainStarted.complete(Unit)
            releaseDrain.await() // prune/cancel/audio cleanup still running
        })
        assertFalse(lifetime.eligible)
        assertTrue(lifetime.register())
        assertTrue(lifetime.eligible)

        val update = async(kotlinx.coroutines.Dispatchers.Default) {
            repo.updateProfile(profile.id, "Prod", "https://b.example.com", "alice") // endpoint change retires
        }
        withTimeout(5_000) { drainStarted.await() }
        delay(50)
        assertFalse(update.isCompleted, "identity publication waits for the drain")
        assertNull(registry.getCurrentConnection(profile.id), "N is revoked immediately")
        assertFalse(registry.admitCurrentOwner(ConnectionRef(profile.id, old.generation + 1)) { true }, "N+1 cannot be admitted early")
        assertFailsWith<ConnectionOwnerError> { registry.getOrCreateConnection(profile.id) }
        assertFalse(provider.withVerified(owner, AgentKind.OMP) {}, "old readiness is gone")

        releaseDrain.complete(Unit)
        withTimeout(5_000) { update.await() }
        val successor = assertNotNull(registry.getCurrentConnection(profile.id))
        assertEquals(old.generation + 1, successor.generation)
        assertFalse(provider.withVerified(owner, AgentKind.OMP) {}, "N's readiness never covers N+1")
    }

    @Test
    fun failedBarrierKeepsTheProfileUnavailableAndLaterCallsStayFenced() = runBlocking {
        val registry = ConnectionRegistry()
        val repo = ProfileRepository(vault = InMemoryCredentialVault(), registry = registry)
        repo.initialize()
        val profile = repo.addProfile("Prod", "https://a.example.com", "alice")
        registry.getOrCreateConnection(profile.id)
        var attempts = 0
        val lifetime = RetirementLifetime(registry, retireOwner = { attempts++; error("audio cleanup failed") })
        assertTrue(lifetime.register())

        assertFailsWith<Throwable> { repo.updateProfile(profile.id, "Prod", "https://b.example.com", "alice") }
        assertEquals(1, attempts)
        assertNull(registry.getCurrentConnection(profile.id))
        assertFailsWith<ConnectionOwnerError> { repo.getOrCreateApiClient(profile.id) }
        assertEquals(1, attempts, "ordinary later calls never rerun cleanup or recreate authority")
    }

    @Test
    fun verificationCrossingWriteSettlementIsDiscarded() = runBlocking {
        val ref = ConnectionRef("p", 1L)
        val provider = RuntimeReadinessProvider { mapOf("p" to ref) }
        val token = provider.beginMutation(ref)
        val preWriteRevision = provider.revisionOf("p")
        val preWriteOwner = ownerOf(ref, preWriteRevision)

        // Attempting to publish during mutation is rejected
        assertFalse(provider.publish(evaluateReadiness(preWriteOwner, AgentKind.OMP, paths, omp, null)))

        // End mutation settles revision
        provider.endMutation(ref, token)

        // Stale pre-write capture is rejected even after mutation ended
        assertFalse(provider.publish(evaluateReadiness(preWriteOwner, AgentKind.OMP, paths, omp, null)))

        // Fresh capture with settled revision succeeds
        val postWriteOwner = ownerOf(ref, provider.revisionOf("p"))
        assertTrue(provider.publish(evaluateReadiness(postWriteOwner, AgentKind.OMP, paths, omp, null)))
    }

    @Test
    fun cancelledCleanupDoesNotStrandMutationToken() = runBlocking {
        val ref = ConnectionRef("p", 1L)
        val provider = RuntimeReadinessProvider { mapOf("p" to ref) }
        val token = provider.beginMutation(ref)

        // Cancellation during cleanup releases token via NonCancellable
        kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) {
            provider.endMutation(ref, token)
        }

        val freshOwner = ownerOf(ref, provider.revisionOf("p"))
        assertTrue(provider.publish(evaluateReadiness(freshOwner, AgentKind.OMP, paths, omp, null)))
    }

    @Test
    fun duplicateSettlementIsIdempotent() = runBlocking {
        val ref = ConnectionRef("p", 1L)
        val provider = RuntimeReadinessProvider { mapOf("p" to ref) }
        val token = provider.beginMutation(ref)

        provider.endMutation(ref, token)
        val rev1 = provider.revisionOf("p")
        provider.endMutation(ref, token) // second call is idempotent
        val rev2 = provider.revisionOf("p")
        assertEquals(rev1, rev2)

        val freshOwner = ownerOf(ref, provider.revisionOf("p"))
        assertTrue(provider.publish(evaluateReadiness(freshOwner, AgentKind.OMP, paths, omp, null)))
    }
}
