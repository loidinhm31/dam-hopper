package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class ProfileRepositoryTest {

    private lateinit var vault: InMemoryCredentialVault
    private lateinit var registry: ConnectionRegistry
    private lateinit var repo: ProfileRepository

    @BeforeTest
    fun setUp() {
        vault = InMemoryCredentialVault()
        registry = ConnectionRegistry()
        repo = ProfileRepository(vault = vault, registry = registry)
    }

    @Test
    fun testProfileCrudAndSelection() = runTest {
        repo.initialize()
        val prof1 = repo.addProfile("Server Alpha", "https://alpha.example.com", "alice")
        val prof2 = repo.addProfile("Server Beta", "https://beta.example.com", "bob")

        assertEquals(2, repo.profiles.value.size)
        assertEquals(prof1.id, repo.activeProfileId.value)

        repo.selectProfile(prof2.id)
        assertEquals(prof2.id, repo.activeProfileId.value)

        val updated = repo.updateProfile(prof1.id, "Alpha Renamed", "https://alpha.example.com", "alice2")
        assertEquals("Alpha Renamed", updated.name)
        assertEquals("alice2", updated.username)

        repo.deleteProfile(prof1.id)
        assertEquals(1, repo.profiles.value.size)
        assertEquals(prof2.id, repo.activeProfileId.value)
    }

    @Test
    fun testServerUrlValidation() {
        // Valid URLs
        assertTrue(ServerProfile.validateServerUrl("http://127.0.0.1:4801").isSuccess)
        assertTrue(ServerProfile.validateServerUrl("https://prod.damhopper.com/").isSuccess)
        assertTrue(ServerProfile.validateServerUrl("http://localhost:8080").isSuccess)
        assertTrue(ServerProfile.validateServerUrl("http://10.0.2.2:4803").isSuccess)

        // Invalid URLs
        assertTrue(ServerProfile.validateServerUrl("").isFailure)
        assertTrue(ServerProfile.validateServerUrl("ftp://files.damhopper.com").isFailure)
        assertTrue(ServerProfile.validateServerUrl("https://user:pass@evil.com").isFailure)
        assertTrue(ServerProfile.validateServerUrl("https://example.com/api?token=secret").isFailure)
        assertTrue(ServerProfile.validateServerUrl("https://example.com/#fragment").isFailure)
    }

    @Test
    fun testEndpointEditAdvancesGenerationAndClearsOldCredential() = runTest {
        repo.initialize()
        val prof = repo.addProfile("Production", "https://prod-1.damhopper.com", "alice")
        vault.storeToken(prof.id, prof.baseUrl, "token-prod-1")

        val initialConn = registry.getOrCreateConnection(prof.id)
        assertEquals(1L, initialConn.generation)

        // Change base URL to prod-2
        repo.updateProfile(prof.id, "Production", "https://prod-2.damhopper.com", "alice")

        // Old token for prod-1 must be cleared
        assertNull(vault.getToken(prof.id, "https://prod-1.damhopper.com"))

        // Connection generation must have advanced to 2
        val newConn = registry.getCurrentConnection(prof.id)
        assertNotNull(newConn)
        assertEquals(2L, newConn.generation)
    }

    @Test
    fun testTwoProfilesStayIsolated() = runTest {
        repo.initialize()
        val profA = repo.addProfile("Same Name", "https://server-a.com", "alice")
        val profB = repo.addProfile("Same Name", "https://server-b.com", "bob")

        val sessionA = AuthSession("jwt-token-a", "alice", "user", "2026-11-01T00:00:00Z")
        val sessionB = AuthSession("jwt-token-b", "bob", "user", "2026-11-01T00:00:00Z")

        repo.applyAuthenticatedSession(profA.id, sessionA, null)
        repo.applyAuthenticatedSession(profB.id, sessionB, null)

        assertEquals("jwt-token-a", vault.getToken(profA.id, profA.baseUrl))
        assertEquals("jwt-token-b", vault.getToken(profB.id, profB.baseUrl))

        // Logging out profile A clears A's credentials and retires A's generation
        repo.logout(profA.id)
        assertNull(vault.getToken(profA.id, profA.baseUrl))

        // Profile B must remain completely intact and healthy
        assertEquals("jwt-token-b", vault.getToken(profB.id, profB.baseUrl))
        val statusB = repo.authStatuses.value[profB.id]
        assertTrue(statusB is AuthStatus.Authenticated)
    }

    @Test
    fun testLateAuthAttemptRejectedAfterLogout() = runTest {
        repo.initialize()
        val prof = repo.addProfile("Server", "https://server.com", "alice")
        val attempt = repo.attemptTracker.startAttempt(prof.id)
        assertEquals(1L, attempt.attemptId)

        // User logs out before async login completes
        repo.logout(prof.id)

        // Late response arrives with stale attempt
        val session = AuthSession("late-jwt", "alice", "user", "2026-11-01T00:00:00Z")
        assertFailsWith<AuthAttemptStaleException> {
            repo.applyAuthenticatedSession(prof.id, session, attempt)
        }

        // Vault must NOT contain the late credential
        assertNull(vault.getToken(prof.id, prof.baseUrl))
    }

    @Test
    fun testCredentialRotationRetiresConnectionGeneration() = runTest {
        repo.initialize()
        val prof = repo.addProfile("Server", "https://server.com", "alice")
        val initialConn = registry.getOrCreateConnection(prof.id)
        assertEquals(1L, initialConn.generation)

        val session1 = AuthSession("jwt-1", "alice", "user", "2026-11-01T00:00:00Z")
        repo.applyAuthenticatedSession(prof.id, session1, null)

        val connAfterLogin = registry.getCurrentConnection(prof.id)
        assertEquals(2L, connAfterLogin?.generation)

        // Credential step-up rotation installs session2
        val session2 = AuthSession("jwt-2-rotated", "alice", "user", "2026-11-10T00:00:00Z")
        repo.applyAuthenticatedSession(prof.id, session2, null)

        val connAfterRotation = registry.getCurrentConnection(prof.id)
        assertEquals(3L, connAfterRotation?.generation)
        assertEquals("jwt-2-rotated", vault.getToken(prof.id, prof.baseUrl))
    }
}
