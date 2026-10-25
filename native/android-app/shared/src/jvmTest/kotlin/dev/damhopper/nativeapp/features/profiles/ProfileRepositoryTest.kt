package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
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

    // ---- C2a1: retirement drain precedes credential/identity publication (real ProfileRepository) ----

    private val rotated = AuthSession("jwt-new", "alice", "user", "2026-11-15T00:00:00Z")

    private data class DrainSnapshot(
        val token: String?,
        val baseUrl: String?,
        val status: AuthStatus?,
        val registered: Boolean,
        val ref: ConnectionRef,
    )

    /**
     * Registers a compliant barrier (non-locking reads only: vault, StateFlow.value; no profile or
     * registry calls) that records the world it sees and then parks on [gate].
     */
    private suspend fun parkingBarrier(profile: ServerProfile, gate: CompletableDeferred<Unit>): () -> DrainSnapshot? {
        var snapshot: DrainSnapshot? = null
        registry.addRetirementBarrier { ref ->
            snapshot = DrainSnapshot(
                token = vault.getToken(profile.id, profile.baseUrl),
                baseUrl = repo.profiles.value.singleOrNull { it.id == profile.id }?.baseUrl,
                status = repo.authStatuses.value[profile.id],
                registered = registry.connectionsState.value.containsKey(profile.id),
                ref = ref,
            )
            gate.await()
        }
        return { snapshot }
    }

    private suspend fun seededProfile(baseUrl: String = "https://a.example.com"): ServerProfile {
        repo.initialize()
        val profile = repo.addProfile("Prod", baseUrl, "alice")
        vault.storeToken(profile.id, profile.baseUrl, "tok-a")
        return profile
    }

    @Test
    fun endpointUpdateAwaitsDrainBeforeCredentialClearAndIdentityPublication() = runTest {
        val prof = seededProfile()
        val old = registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        val drained = parkingBarrier(prof, gate)

        val update = async { repo.updateProfile(prof.id, "Prod", "https://b.example.com", "alice") }
        runCurrent()
        assertNotNull(drained(), "drain must be parked inside the barrier")

        // While the drain is pending nothing has been replaced, and the profile is unavailable.
        assertTrue(update.isActive)
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertEquals(prof.baseUrl, repo.profiles.value.single().baseUrl)
        assertNull(repo.authStatuses.value[prof.id])
        assertNull(registry.getCurrentConnection(prof.id))

        gate.complete(Unit)
        val updated = update.await()
        assertEquals(DrainSnapshot("tok-a", prof.baseUrl, null, false, old), drained())
        assertNull(vault.getToken(prof.id, prof.baseUrl))
        assertEquals(updated.baseUrl, repo.profiles.value.single().baseUrl)
        assertTrue(repo.authStatuses.value[prof.id] is AuthStatus.LoginRequired)
        assertEquals(ConnectionRef(prof.id, 2L), registry.getCurrentConnection(prof.id))
    }

    @Test
    fun sessionApplicationAwaitsDrainBeforeCredentialStoreAndAuthPublication() = runTest {
        val prof = seededProfile()
        val old = registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        val drained = parkingBarrier(prof, gate)

        val apply = async { repo.applyAuthenticatedSession(prof.id, rotated, null) }
        runCurrent()
        assertNotNull(drained(), "drain must be parked inside the barrier")
        assertTrue(apply.isActive)
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertNull(repo.authStatuses.value[prof.id])

        gate.complete(Unit)
        apply.await()
        assertEquals("tok-a", drained()?.token) // credential replaced only after the drain
        assertEquals(old, drained()?.ref)
        assertEquals("jwt-new", vault.getToken(prof.id, prof.baseUrl))
        assertTrue(repo.authStatuses.value[prof.id] is AuthStatus.Authenticated)
        assertEquals(2L, registry.getCurrentConnection(prof.id)?.generation)
    }

    @Test
    fun logoutAwaitsDrainBeforeCredentialClearAndAuthLossPublication() = runTest {
        // Loopback closed port: the best-effort remote revoke fails immediately.
        val prof = seededProfile("http://127.0.0.1:1")
        repo.applyAuthenticatedSession(prof.id, rotated, null)
        val before = registry.getCurrentConnection(prof.id)
        assertNotNull(before)
        val gate = CompletableDeferred<Unit>()
        val drained = parkingBarrier(prof, gate)

        val logout = async { repo.logout(prof.id) }
        runCurrent()
        assertNotNull(drained(), "drain must be parked inside the barrier")
        assertTrue(logout.isActive)
        assertEquals("jwt-new", vault.getToken(prof.id, prof.baseUrl))
        assertTrue(repo.authStatuses.value[prof.id] is AuthStatus.Authenticated)

        gate.complete(Unit)
        logout.await()
        val seen = drained()
        assertEquals("jwt-new", seen?.token)
        assertTrue(seen?.status is AuthStatus.Authenticated)
        assertEquals(before, seen?.ref)
        assertNull(vault.getToken(prof.id, prof.baseUrl))
        assertTrue(repo.authStatuses.value[prof.id] is AuthStatus.LoginRequired)
    }

    @Test
    fun deleteAwaitsDrainBeforeCredentialLossAndLeavesNoSuccessorAuthority() = runTest {
        val prof = seededProfile()
        registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        val drained = parkingBarrier(prof, gate)

        val delete = async { repo.deleteProfile(prof.id) }
        runCurrent()
        assertNotNull(drained(), "drain must be parked inside the barrier")
        assertTrue(delete.isActive)
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertEquals(1, repo.profiles.value.size)

        gate.complete(Unit)
        delete.await()
        assertEquals("tok-a", drained()?.token)
        assertNull(vault.getToken(prof.id, prof.baseUrl))
        assertTrue(repo.profiles.value.isEmpty())
        assertNull(registry.getCurrentConnection(prof.id)) // removed, not replaced by a successor
        assertFalse(registry.connectionsState.value.containsKey(prof.id))
    }

    @Test
    fun clientCreationDuringRetirementWaitsAndNeverRelabelsOldIdentity() = runTest {
        val prof = seededProfile()
        registry.getOrCreateConnection(prof.id)
        val gate = CompletableDeferred<Unit>()
        val drained = parkingBarrier(prof, gate)

        val update = async { repo.updateProfile(prof.id, "Prod", "https://b.example.com", "alice") }
        runCurrent()
        assertNotNull(drained(), "drain must be parked inside the barrier")
        val apiCreation = async { repo.getOrCreateApiClient(prof.id) }
        val wsCreation = async { repo.getOrCreateWsConnection(prof.id) }
        runCurrent()
        // Serialized behind the identity commit on the profile mutex; no pre-wait snapshot is taken.
        assertTrue(apiCreation.isActive)
        assertTrue(wsCreation.isActive)

        gate.complete(Unit)
        val updated = update.await()
        val client = apiCreation.await()
        val ws = wsCreation.await()
        val successor = ConnectionRef(prof.id, 2L)
        assertEquals(successor, client.connection)
        assertEquals(successor, ws.connection)
        assertEquals(updated.baseUrl, client.normalizedBaseUrl)
        assertEquals(updated.baseUrl, ws.baseUrl)
    }

    @Test
    fun failedRetirementLeavesCredentialsAndIdentityUntouchedAndFencesUntilRecovery() = runTest {
        val prof = seededProfile()
        val old = registry.getOrCreateConnection(prof.id)
        var failing = true
        var attempts = 0
        registry.addRetirementBarrier {
            attempts++
            if (failing) throw IllegalStateException("cleanup failed")
        }

        assertFailsWith<ConnectionOwnerError> {
            repo.updateProfile(prof.id, "Prod", "https://b.example.com", "alice")
        }
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertEquals(prof.baseUrl, repo.profiles.value.single().baseUrl)
        assertNull(repo.authStatuses.value[prof.id])

        // Failed transition fences every ordinary entry point without rerunning callbacks.
        assertEquals(
            ConnectionErrorReason.OWNER_MISMATCH,
            assertFailsWith<ConnectionOwnerError> { repo.getOrCreateApiClient(prof.id) }.reason,
        )
        assertFailsWith<ConnectionOwnerError> { repo.getOrCreateWsConnection(prof.id) }
        assertFailsWith<ConnectionOwnerError> { repo.applyAuthenticatedSession(prof.id, rotated, null) }
        assertFailsWith<ConnectionOwnerError> { repo.logout(prof.id) }
        assertFailsWith<ConnectionOwnerError> { repo.deleteProfile(prof.id) }
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertEquals(1, repo.profiles.value.size)
        assertNull(repo.authStatuses.value[prof.id])
        assertEquals(1, attempts)

        // Explicit bounded operator recovery releases only the original successor; no identity is invented.
        failing = false
        registry.recoverRetirement(old)
        assertEquals(2, attempts)
        val client = repo.getOrCreateApiClient(prof.id)
        assertEquals(ConnectionRef(prof.id, 2L), client.connection)
        assertEquals(prof.baseUrl, client.normalizedBaseUrl)
        assertEquals("tok-a", vault.getToken(prof.id, prof.baseUrl))
        assertEquals(prof.baseUrl, repo.profiles.value.single().baseUrl)
    }

    private suspend fun authenticated(name: String, url: String, user: String): Pair<ServerProfile, ConnectionRef> {
        val prof = repo.addProfile(name, url, user)
        repo.applyAuthenticatedSession(prof.id, AuthSession("jwt-$name", user, "user", "2026-11-01T00:00:00Z"), null)
        return prof to assertNotNull(registry.getCurrentConnection(prof.id))
    }

    @Test
    fun commitExistingProfileRoutePublishesTheActiveProfileOnlyInsideTheAdmittedLeaf() = runTest {
        repo.initialize()
        val (a, _) = authenticated("A", "https://a.example.com", "alice")
        val (b, connB) = authenticated("B", "https://b.example.com", "bob")
        assertEquals(a.id, repo.activeProfileId.value)

        var leafRuns = 0
        val result = repo.commitExistingProfileRoute(connB, b.baseUrl + "/", "bob") { publish ->
            leafRuns++
            assertEquals(a.id, repo.activeProfileId.value, "nothing is published before the leaf calls the fixed setter")
            publish()
            ProfileRouteAdmission.COMMITTED
        }
        assertEquals(ProfileRouteAdmission.COMMITTED, result)
        assertEquals(1, leafRuns)
        assertEquals(b.id, repo.activeProfileId.value)
    }

    @Test
    fun commitExistingProfileRouteRefusesStaleIdentityAndPropagatesBusyWithoutPublishing() = runTest {
        repo.initialize()
        val (a, _) = authenticated("A", "https://a.example.com", "alice")
        val (b, connB) = authenticated("B", "https://b.example.com", "bob")
        var leafRuns = 0
        suspend fun attempt(
            connection: ConnectionRef,
            endpoint: String,
            account: String,
            leaf: (() -> Unit) -> ProfileRouteAdmission = { publish -> publish(); ProfileRouteAdmission.COMMITTED },
        ) = repo.commitExistingProfileRoute(connection, endpoint, account) { publish -> leafRuns++; leaf(publish) }

        assertEquals(ProfileRouteAdmission.STALE, attempt(connB, b.baseUrl, "mallory"))
        assertEquals(ProfileRouteAdmission.STALE, attempt(connB, "https://evil.example.com", "bob"))
        assertEquals(ProfileRouteAdmission.STALE, attempt(ConnectionRef(b.id, connB.generation + 1L), b.baseUrl, "bob"))
        assertEquals(ProfileRouteAdmission.STALE, attempt(ConnectionRef("missing", 1L), b.baseUrl, "bob"))
        assertEquals(0, leafRuns, "a denied identity never reaches the admitted leaf")
        assertEquals(a.id, repo.activeProfileId.value)

        // BUSY from the nested chain is returned as is and nothing was published.
        assertEquals(ProfileRouteAdmission.BUSY, attempt(connB, b.baseUrl, "bob") { ProfileRouteAdmission.BUSY })
        assertEquals(1, leafRuns)
        assertEquals(a.id, repo.activeProfileId.value)
    }

    @Test
    fun commitExistingProfileRouteAwaitsTheProfileMutexAndLosesToAnEndpointChange() = runTest {
        repo.initialize()
        val (a, connA) = authenticated("A", "https://a.example.com", "alice")
        val gate = CompletableDeferred<Unit>()
        registry.addRetirementBarrier { gate.await() }
        // The endpoint edit holds the profile mutex across its awaited registry drain.
        val edit = async { repo.updateProfile(a.id, "A", "https://a2.example.com", "alice") }
        runCurrent()
        var leafRuns = 0
        val commit = async {
            repo.commitExistingProfileRoute(connA, a.baseUrl, "alice") { publish -> leafRuns++; publish(); ProfileRouteAdmission.COMMITTED }
        }
        runCurrent()
        assertFalse(commit.isCompleted, "the admission awaits the profile mutex instead of racing it")
        gate.complete(Unit)
        edit.await()
        assertEquals(ProfileRouteAdmission.STALE, commit.await())
        assertEquals(0, leafRuns)
    }

    @Test
    fun persistActiveProfileIfCurrentNeverResurrectsAnOlderDestination() = runTest {
        repo.initialize()
        val a = repo.addProfile("A", "https://a.example.com", "alice")
        val b = repo.addProfile("B", "https://b.example.com", "bob")
        assertTrue(repo.persistActiveProfileIfCurrent(a.id))
        repo.selectProfile(b.id)
        assertFalse(repo.persistActiveProfileIfCurrent(a.id), "a late persistence of the older route is dropped")
        assertEquals(b.id, repo.activeProfileId.value)
        assertFalse(repo.persistActiveProfileIfCurrent("missing"))
    }
}
