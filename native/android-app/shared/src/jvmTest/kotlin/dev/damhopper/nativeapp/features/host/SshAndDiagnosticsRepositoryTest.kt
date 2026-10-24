package dev.damhopper.nativeapp.features.host

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class SshAndDiagnosticsRepositoryTest {

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
    fun testSshRepositoryKeysAgentAndCredentials() = runTest {
        server!!.createContext("/api/ssh/keys") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""["id_ed25519", "id_rsa"]""")
                writer.flush()
            }
        }

        server!!.createContext("/api/ssh/agent") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""{"has_keys": true, "key_count": 2}""")
                writer.flush()
            }
        }

        var receivedLoadBody = ""
        server!!.createContext("/api/ssh/keys/load") { exchange ->
            receivedLoadBody = exchange.requestBody.bufferedReader().use { it.readText() }
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""{"success": true, "saved": true, "keyPath": "id_ed25519"}""")
                writer.flush()
            }
        }

        server!!.createContext("/api/ssh/credentials") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            if (exchange.requestMethod == "GET") {
                exchange.sendResponseHeaders(200, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""{"saved": true, "keyPath": "id_ed25519"}""")
                    writer.flush()
                }
            } else if (exchange.requestMethod == "DELETE") {
                exchange.sendResponseHeaders(200, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""{"success": true, "forgotten": true}""")
                    writer.flush()
                }
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = SshRepository(apiClient)

        // 1. List keys
        val keys = repo.listKeys().getOrThrow()
        assertEquals(2, keys.size)
        assertEquals("id_ed25519", keys[0].name)
        assertEquals("~/.ssh/id_ed25519", keys[0].path)

        // 2. Check agent
        val agent = repo.checkAgent().getOrThrow()
        assertTrue(agent.hasKeys)
        assertEquals(2, agent.keyCount)

        // 3. Load key
        val loadReq = LoadKeyBody("id_ed25519", "secret-passphrase", true)
        // Redaction assertion: toString() must not leak secret-passphrase
        assertFalse(loadReq.toString().contains("secret-passphrase"))
        assertTrue(loadReq.toString().contains("[REDACTED]"))

        val loadRes = repo.loadKey("id_ed25519", "secret-passphrase", true).getOrThrow()
        assertTrue(loadRes.success)
        assertTrue(loadRes.saved)
        assertEquals("id_ed25519", loadRes.keyPath)

        // 4. Credential status & forget per key
        val credStatus = repo.getCredentialStatus("id_ed25519").getOrThrow()
        assertTrue(credStatus.saved)
        assertEquals("id_ed25519", credStatus.keyPath)

        val forgetRes = repo.forgetCredential("id_ed25519").getOrThrow()
        assertTrue(forgetRes.success)
        assertTrue(forgetRes.forgotten)

        // 5. Test load key failure scenario (e.g. wrong passphrase)
        server!!.removeContext("/api/ssh/keys/load")
        server!!.createContext("/api/ssh/keys/load") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""{"success": false, "saved": false, "keyPath": "id_ed25519", "error": "Incorrect passphrase"}""")
                writer.flush()
            }
        }
        val failedLoad = repo.loadKey("id_ed25519", "wrong-pass", false).getOrThrow()
        assertFalse(failedLoad.success)
        assertEquals("Incorrect passphrase", failedLoad.error)
    }
    @Test
    fun testHostControlAndDiagnosticsRepositories() = runTest {
        server!!.createContext("/api/system/actions/v1/capabilities") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "available": false,
                        "reason": "host actions unavailable: helper connection closed or not configured",
                        "actions": []
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        server!!.createContext("/api/diagnostics/export") { exchange ->
            val body = exchange.requestBody.bufferedReader().use { it.readText() }
            // Verify default includeTerminalOutput is false
            assertTrue(body.contains("\"includeTerminalOutput\":false"))

            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "diagnostic_schema_version": 1,
                        "generated_at": 1700000000000
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val hcRepo = HostControlRepository(apiClient)
        val diagRepo = DiagnosticsRepository(apiClient)

        // 1. Truthful capabilities display
        val cap = hcRepo.getCapabilities().getOrThrow()
        assertFalse(cap.available)
        assertTrue(cap.reason.contains("helper connection closed or not configured"))
        assertTrue(cap.actions.isEmpty())

        // 2. Diagnostics export with default privacy (terminal output false)
        val diagRes = diagRepo.exportDiagnostics().getOrThrow()
        assertEquals(1, diagRes.diagnosticSchemaVersion)
        assertEquals(1700000000000L, diagRes.generatedAt)
    }
}
