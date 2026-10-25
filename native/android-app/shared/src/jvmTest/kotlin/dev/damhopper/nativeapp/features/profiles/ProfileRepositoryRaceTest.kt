package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class ProfileRepositoryRaceTest {

    private lateinit var vault: InMemoryCredentialVault
    private lateinit var registry: ConnectionRegistry

    @BeforeTest
    fun setUp() {
        vault = InMemoryCredentialVault()
        registry = ConnectionRegistry()
    }

    @Test
    fun testAttemptProfileIdMismatchRejected() = runTest {
        val repo = ProfileRepository(vault = vault, registry = registry)
        repo.initialize()
        val profA = repo.addProfile("Alpha", "https://alpha.com", "alice")
        val profB = repo.addProfile("Beta", "https://beta.com", "bob")

        val attemptA = repo.attemptTracker.startAttempt(profA.id)
        val session = AuthSession("jwt-token", "bob", "user", "2026-11-01T00:00:00Z")

        // Attempting to apply Profile A's attempt to Profile B must be rejected immediately
        assertFailsWith<IllegalArgumentException> {
            repo.applyAuthenticatedSession(profB.id, session, attemptA)
        }
        assertNull(vault.getToken(profB.id, profB.baseUrl))
    }

    @Test
    fun testNewerLoginCompletesWhileRemoteLogoutPending() = runTest {
        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            apiClientFactory = { ref, url, tokenProvider ->
                ApiClient(ref, url, tokenProvider, registry)
            }
        )
        repo.initialize()
        val prof = repo.addProfile("Server", "https://server.com", "alice")
        val session1 = AuthSession("old-jwt", "alice", "user", "2026-11-01T00:00:00Z")
        repo.applyAuthenticatedSession(prof.id, session1, null)

        // User logs out (local state retired immediately)
        repo.logout(prof.id)
        assertNull(vault.getToken(prof.id, prof.baseUrl))

        // Newer login completes immediately
        val session2 = AuthSession("new-jwt", "alice", "user", "2026-11-15T00:00:00Z")
        val attempt2 = repo.attemptTracker.startAttempt(prof.id)
        repo.applyAuthenticatedSession(prof.id, session2, attempt2)

        // Session 2 must be preserved and active
        assertEquals("new-jwt", vault.getToken(prof.id, prof.baseUrl))
        val status = repo.authStatuses.value[prof.id]
        assertTrue(status is AuthStatus.Authenticated)
        assertEquals("new-jwt", status.session.token)
    }

    @Test
    fun testStatusCompletionRacingProfileDeletionIsDiscarded() = runTest {
        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            apiClientFactory = { ref, url, tokenProvider ->
                ApiClient(ref, url, tokenProvider, registry)
            }
        )
        repo.initialize()
        val prof = repo.addProfile("Ephemeral", "https://ephemeral.com", "alice")
        val session = AuthSession("jwt", "alice", "user", "2026-11-01T00:00:00Z")
        repo.applyAuthenticatedSession(prof.id, session, null)

        // Delete profile
        repo.deleteProfile(prof.id)

        // Status for deleted profile must not exist in authStatuses
        assertFalse(repo.authStatuses.value.containsKey(prof.id))
    }

    // ---- C2a1: pending/failed/canceled transitions fence creation and identity publication ----

    private suspend fun seeded(repo: ProfileRepository): ServerProfile {
        repo.initialize()
        val profile = repo.addProfile("Prod", "https://a.example.com", "alice")
        vault.storeToken(profile.id, profile.baseUrl, "tok-a")
        return profile
    }

    @Test
    fun pendingTransitionFencesClientCreationWithoutWaitingOrAllocatingGenerations() = runTest {
        val repo = ProfileRepository(vault = vault, registry = registry)
        val prof = seeded(repo)
        val old = registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        var entered = false
        registry.addRetirementBarrier {
            entered = true
            gate.await()
        }

        // Retirement entered directly through the registry seam (no profile mutex involved).
        val retire = async { registry.retireConnection(old) }
        runCurrent()
        assertTrue(entered)
        assertEquals(
            ConnectionErrorReason.OWNER_MISMATCH,
            assertFailsWith<ConnectionOwnerError> { repo.getOrCreateApiClient(prof.id) }.reason,
        )
        assertFailsWith<ConnectionOwnerError> { repo.getOrCreateWsConnection(prof.id) }
        assertFailsWith<ConnectionOwnerError> { repo.applyAuthenticatedSession(prof.id, AuthSession("jwt", "alice", "user", "2026-11-01T00:00:00Z"), null) }
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertNull(repo.authStatuses.value[prof.id])

        gate.complete(Unit)
        val successor = retire.await()
        assertEquals(2L, successor.generation) // creation attempts allocated nothing
        assertEquals(successor, repo.getOrCreateApiClient(prof.id).connection)
    }

    @Test
    fun canceledEndpointUpdateNeverPublishesIdentityAndLeavesTransitionFenced() = runTest {
        val repo = ProfileRepository(vault = vault, registry = registry)
        val prof = seeded(repo)
        val old = registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        var drainedCleanly = false
        var entered = false
        registry.addRetirementBarrier {
            entered = true
            gate.await()
            drainedCleanly = true
        }

        var caught: CancellationException? = null
        val caller = launch {
            try {
                repo.updateProfile(prof.id, "Prod", "https://b.example.com", "alice")
            } catch (e: CancellationException) {
                caught = e
                throw e
            }
        }
        runCurrent()
        assertTrue(entered, "drain must be parked inside the barrier before cancelling")
        caller.cancel()
        gate.complete(Unit)
        caller.join()

        // Cleanup completed, but the canceled caller published nothing and the transition stays failed.
        assertTrue(drainedCleanly)
        assertNotNull(caught)
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertEquals(prof.baseUrl, repo.profiles.value.single().baseUrl)
        assertNull(repo.authStatuses.value[prof.id])
        assertNull(registry.getCurrentConnection(prof.id))
        assertFailsWith<ConnectionOwnerError> { repo.getOrCreateApiClient(prof.id) }

        // Explicit recovery releases the successor; a later replacement is a separate uncanceled call.
        registry.recoverRetirement(old)
        assertEquals(prof.baseUrl, repo.getOrCreateApiClient(prof.id).normalizedBaseUrl)
        val updated = repo.updateProfile(prof.id, "Prod", "https://b.example.com", "alice")
        assertEquals(updated.baseUrl, repo.profiles.value.single().baseUrl)
        assertNull(vault.getToken(prof.id, prof.baseUrl))
    }

    @Test
    fun canceledSessionApplicationNeverStoresCredential() = runTest {
        val repo = ProfileRepository(vault = vault, registry = registry)
        val prof = seeded(repo)
        registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        var entered = false
        registry.addRetirementBarrier {
            entered = true
            gate.await()
        }

        val caller = launch {
            repo.applyAuthenticatedSession(prof.id, AuthSession("jwt-late", "alice", "user", "2026-11-01T00:00:00Z"), null)
        }
        runCurrent()
        assertTrue(entered, "drain must be parked inside the barrier before cancelling")
        caller.cancel()
        gate.complete(Unit)
        caller.join()

        assertTrue(caller.isCancelled)
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertNull(repo.authStatuses.value[prof.id])
        assertNull(registry.getCurrentConnection(prof.id))
    }

    @Test
    fun retirementObserverRunsAfterDrainWhileProfileMutexIsHeld() = runTest {
        val repo = ProfileRepository(vault = vault, registry = registry)
        val prof = seeded(repo)
        registry.getOrCreateConnection(prof.id)
        val order = mutableListOf<String>()
        registry.addRetirementBarrier { order += "barrier" }
        // Compliant observer: reads only non-locking state; calling the repository here would deadlock
        // because the profile mutex is held for the whole retirement.
        registry.addRetirementListener {
            order += "observer:${repo.profiles.value.size}:${registry.connectionsState.value.containsKey(prof.id)}"
        }

        repo.applyAuthenticatedSession(prof.id, AuthSession("jwt", "alice", "user", "2026-11-01T00:00:00Z"), null)
        assertEquals(listOf("barrier", "observer:1:false"), order)
    }
}
