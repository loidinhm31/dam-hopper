package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
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
}
