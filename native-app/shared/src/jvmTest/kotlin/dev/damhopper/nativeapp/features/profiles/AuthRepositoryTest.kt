package dev.damhopper.nativeapp.features.profiles

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class AuthRepositoryTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createRepository(tokenProvider: suspend () -> String? = { null }): AuthRepository {
        val ref = ConnectionRef("test-prof", 1L)
        val client = ApiClient(
            connection = ref,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = tokenProvider
        )
        return AuthRepository(client)
    }

    @Test
    fun testLoginEnrollmentRequiredChallenge() = runTest {
        server!!.createContext("/api/auth/login") { exchange ->
            val json = """{"state":"enrollmentRequired","challengeToken":"ch-tok-1","challengeExpiresAt":"2026-10-15T23:00:00Z","authProtocol":2}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.login("alice", "secret123")
        assertTrue(result is LoginResult.Challenge)
        assertEquals(ChallengeType.ENROLLMENT_REQUIRED, result.challenge.type)
        assertEquals("ch-tok-1", result.challenge.challengeToken)
        assertEquals(2, result.challenge.authProtocol)
    }

    @Test
    fun testLoginMfaRequiredChallenge() = runTest {
        server!!.createContext("/api/auth/login") { exchange ->
            val json = """{"state":"mfaRequired","challengeToken":"ch-tok-2","challengeExpiresAt":"2026-10-15T23:00:00Z","authProtocol":2}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.login("bob", "secret123")
        assertTrue(result is LoginResult.Challenge)
        assertEquals(ChallengeType.MFA_REQUIRED, result.challenge.type)
    }

    @Test
    fun testLoginDevModeReturnsSession() = runTest {
        server!!.createContext("/api/auth/login") { exchange ->
            val json = """{"ok":true,"token":"dev-jwt-abc","dev_mode":true,"role":"user","workbenchProtocol":2,"authProtocol":2}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.login()
        assertTrue(result is LoginResult.Session)
        assertEquals("dev-jwt-abc", result.session.token)
        assertTrue(result.session.devMode)
    }

    @Test
    fun testLoginRejectsIncompatibleProtocol() = runTest {
        server!!.createContext("/api/auth/login") { exchange ->
            val json = """{"state":"mfaRequired","challengeToken":"ch-old","challengeExpiresAt":"2026-10-15T23:00:00Z","authProtocol":1}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val err = assertFailsWith<ApiRequestError> {
            repo.login("bob", "pass")
        }
        assertEquals(AuthErrorCodes.INCOMPATIBLE_PROTOCOL, err.code)
    }

    @Test
    fun testFetchMfaSetup() = runTest {
        server!!.createContext("/api/auth/mfa/setup") { exchange ->
            val json = """{"secret":"JBSWY3DPEHPK3PXP","otpauthUri":"otpauth://totp/DamHopper:alice?secret=JBSWY3DPEHPK3PXP","issuer":"DamHopper","accountName":"alice","algorithm":"SHA1","digits":6,"period":30}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val setup = repo.fetchMfaSetup("ch-setup-tok")
        assertEquals("JBSWY3DPEHPK3PXP", setup.secret)
        assertEquals("DamHopper", setup.issuer)
        assertEquals(6, setup.digits)
        assertEquals(30L, setup.period)
    }

    @Test
    fun testConfirmMfaEnrollmentSuccess() = runTest {
        server!!.createContext("/api/auth/mfa/confirm") { exchange ->
            val json = """{"state":"authenticated","token":"confirmed-jwt-xyz","expiresAt":"2026-11-15T00:00:00Z","mfaDueAt":"2026-10-25T00:00:00Z","user":"alice","role":"user","authProtocol":2}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val session = repo.confirmMfaEnrollment("ch-conf-tok", "123456")
        assertEquals("confirmed-jwt-xyz", session.token)
        assertEquals("alice", session.user)
    }

    @Test
    fun testAuthStatusAuthenticatedAndMfaRequired() = runTest {
        var callCount = 0
        server!!.createContext("/api/auth/status") { exchange ->
            callCount++
            if (callCount == 1) {
                val json = """{"authenticated":true,"user":"alice","role":"admin","workbenchProtocol":2,"authProtocol":2,"issuedAt":"2026-10-15T00:00:00Z","expiresAt":"2026-11-15T00:00:00Z","mfaDueAt":"2026-10-25T00:00:00Z"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                val json = """{"authenticated":false,"code":"MFA_REQUIRED","error":"MFA verification required","user":"alice","expiresAt":"2026-11-15T00:00:00Z","mfaDueAt":"2026-10-25T00:00:00Z","workbenchProtocol":2,"authProtocol":2}"""
                exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        val repo = createRepository { "my-active-token" }
        val status1 = repo.checkAuthStatus()
        assertTrue(status1 is AuthStatus.Authenticated)
        assertEquals("alice", status1.session.user)
        assertEquals("admin", status1.session.role)

        val status2 = repo.checkAuthStatus()
        assertTrue(status2 is AuthStatus.MfaRequired)
        assertEquals("alice", status2.user)
    }

    @Test
    fun testAuthStatusAccountDisabledAndUnavailable() = runTest {
        var callCount = 0
        server!!.createContext("/api/auth/status") { exchange ->
            callCount++
            if (callCount == 1) {
                val json = """{"authenticated":false,"code":"ACCOUNT_DISABLED","error":"Account is pending approval or disabled","workbenchProtocol":2,"authProtocol":2}"""
                exchange.sendResponseHeaders(401, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                val json = """{"authenticated":false,"code":"AUTH_UNAVAILABLE","error":"Store unavailable","workbenchProtocol":2,"authProtocol":2}"""
                exchange.sendResponseHeaders(503, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        val repo = createRepository()
        val s1 = repo.checkAuthStatus()
        assertTrue(s1 is AuthStatus.LoginRequired)
        assertEquals(AuthErrorCodes.ACCOUNT_DISABLED, s1.code)

        val s2 = repo.checkAuthStatus()
        assertTrue(s2 is AuthStatus.Unavailable)
        assertEquals(AuthErrorCodes.AUTH_UNAVAILABLE, s2.code)
    }

    @Test
    fun testRegisterSuccess() = runTest {
        server!!.createContext("/api/auth/register") { exchange ->
            val json = """{"ok":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val res = repo.register("charlie", "password123")
        assertTrue(res.isSuccess)
    }
}
