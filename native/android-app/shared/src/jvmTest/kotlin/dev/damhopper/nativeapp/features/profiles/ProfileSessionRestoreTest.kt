package dev.damhopper.nativeapp.features.profiles

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class ProfileSessionRestoreTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private lateinit var vault: InMemoryCredentialVault
    private lateinit var registry: ConnectionRegistry
    private lateinit var metadataStore: InMemoryProfileMetadataStore

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
        vault = InMemoryCredentialVault()
        registry = ConnectionRegistry()
        metadataStore = InMemoryProfileMetadataStore()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    @Test
    fun testColdStartRestoresPersistedActiveProfile() = runTest {
        val prof1 = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        val prof2 = ServerProfile("prof-2", "Server 2", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof1, prof2))
        metadataStore.saveActiveProfileId("prof-2")

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repo.initialize()

        assertEquals("prof-2", repo.activeProfileId.value, "Must restore persisted active profile ID on cold start")
    }

    @Test
    fun testColdStartValidatesStoredTokenAndRestoresSession() = runTest {
        server!!.createContext("/api/auth/status") { exchange ->
            val authHeader = exchange.requestHeaders.getFirst("Authorization")
            if (authHeader == "Bearer valid-token-123") {
                val json = """{"authenticated":true,"user":"alice","role":"user","authProtocol":2,"workbenchProtocol":2}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                val json = """{"authenticated":false,"code":"AUTH_REQUIRED","error":"Invalid token","authProtocol":2,"workbenchProtocol":2}"""
                exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        val prof = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof))
        metadataStore.saveActiveProfileId(prof.id)
        vault.storeToken(prof.id, prof.baseUrl, "valid-token-123")

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repo.initialize()

        val status = repo.refreshAuthStatus(prof.id)
        assertTrue(status is AuthStatus.Authenticated)
        assertEquals("alice", status.session.user)
        assertEquals("valid-token-123", vault.getToken(prof.id, prof.baseUrl), "Valid token must be retained in vault")
    }

    @Test
    fun testExpiredToken401ClearsVaultTokenAndSetsLoginRequired() = runTest {
        server!!.createContext("/api/auth/status") { exchange ->
            val json = """{"authenticated":false,"code":"AUTH_REQUIRED","error":"Token expired","authProtocol":2,"workbenchProtocol":2}"""
            exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val prof = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof))
        metadataStore.saveActiveProfileId(prof.id)
        vault.storeToken(prof.id, prof.baseUrl, "expired-token")

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repo.initialize()

        val status = repo.refreshAuthStatus(prof.id)
        assertTrue(status is AuthStatus.LoginRequired)
        assertNull(vault.getToken(prof.id, prof.baseUrl), "Expired token must be cleared from vault on 401 AUTH_REQUIRED")
    }

    @Test
    fun testMfaRequiredPreservesVaultTokenForStepUp() = runTest {
        server!!.createContext("/api/auth/status") { exchange ->
            val json = """{"authenticated":false,"code":"MFA_REQUIRED","user":"alice","authProtocol":2,"workbenchProtocol":2}"""
            exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val prof = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof))
        metadataStore.saveActiveProfileId(prof.id)
        vault.storeToken(prof.id, prof.baseUrl, "valid-token-needing-mfa")

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repo.initialize()

        val status = repo.refreshAuthStatus(prof.id)
        assertTrue(status is AuthStatus.MfaRequired)
        assertEquals("valid-token-needing-mfa", vault.getToken(prof.id, prof.baseUrl), "MFA step-up must preserve valid token")
    }

    @Test
    fun testOfflinePreservesVaultToken() = runTest {
        // Stop server immediately to simulate offline / unreachable
        server?.stop(0)
        server = null

        val prof = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof))
        metadataStore.saveActiveProfileId(prof.id)
        vault.storeToken(prof.id, prof.baseUrl, "good-token")

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repo.initialize()

        val status = repo.refreshAuthStatus(prof.id)
        assertTrue(status is AuthStatus.Unavailable)
        assertEquals("good-token", vault.getToken(prof.id, prof.baseUrl), "Offline / network error must preserve token")
    }

    @Test
    fun testStaleGenerationAuthRequiredDoesNotClearNewerToken() = runTest {
        val prof = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof))
        metadataStore.saveActiveProfileId(prof.id)
        vault.storeToken(prof.id, prof.baseUrl, "old-token")

        var repoRef: ProfileRepository? = null

        server!!.createContext("/api/auth/status") { exchange ->
            // Simulate concurrent login occurring while this request is in flight
            val freshSession = AuthSession("new-fresh-token", "alice", "user", "2026-11-15T00:00:00Z")
            kotlinx.coroutines.runBlocking {
                repoRef?.applyAuthenticatedSession(prof.id, freshSession, null)
            }

            // Then this in-flight request finishes with 401 AUTH_REQUIRED
            val json = """{"authenticated":false,"code":"AUTH_REQUIRED","error":"Token revoked","authProtocol":2,"workbenchProtocol":2}"""
            exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repoRef = repo
        repo.initialize()

        // refreshAuthStatus runs with initial gen 1; during execution, login advances gen to 2
        try {
            repo.refreshAuthStatus(prof.id)
        } catch (_: dev.damhopper.nativeapp.core.model.ConnectionOwnerError) {
            // Expected: ApiClient ownership check correctly rejects stale in-flight request when generation advances
        }

        // Stale in-flight request must NOT have cleared the newly installed token
        assertEquals("new-fresh-token", vault.getToken(prof.id, prof.baseUrl), "Stale request must not clear newer token")
        val currentStatus = repo.authStatuses.value[prof.id]
        assertTrue(currentStatus is AuthStatus.Authenticated, "Newer authenticated status must not be overwritten by stale request")
    }
    @Test
    fun testProbingArbitraryUrlDoesNotMutateProfilesOrSelection() = runTest {
        val prof1 = ServerProfile("prof-1", "Server 1", "http://127.0.0.1:$serverPort")
        metadataStore.saveProfiles(listOf(prof1))
        metadataStore.saveActiveProfileId(prof1.id)

        val repo = ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
        repo.initialize()

        assertEquals(1, repo.profiles.value.size)
        assertEquals("prof-1", repo.activeProfileId.value)

        // Test connection to a different URL using ephemeral client (as ProfileLoginScreen does)
        val ephemeralUrl = "http://127.0.0.1:$serverPort"
        val tempConn = dev.damhopper.nativeapp.core.model.ConnectionRef("ephemeral-test", 0L)
        val tempClient = dev.damhopper.nativeapp.core.transport.ApiClient(tempConn, ephemeralUrl, { null }, null)
        val authRepo = AuthRepository(tempClient)

        server!!.createContext("/api/auth/status") { exchange ->
            val json = """{"authenticated":false,"code":"AUTH_REQUIRED","authProtocol":2,"workbenchProtocol":2}"""
            exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val probeStatus = authRepo.checkAuthStatus()
        assertTrue(probeStatus is AuthStatus.LoginRequired)

        // Must not have added a profile, changed active selection, or stored credentials
        assertEquals(1, repo.profiles.value.size, "Probing must never add a new profile")
        assertEquals("prof-1", repo.activeProfileId.value, "Probing must never change active profile")
        assertNull(vault.getToken("ephemeral-test", ephemeralUrl), "Probing must never store tokens")
    }
}
