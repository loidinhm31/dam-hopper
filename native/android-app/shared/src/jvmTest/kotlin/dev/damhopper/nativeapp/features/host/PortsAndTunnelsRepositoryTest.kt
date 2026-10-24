package dev.damhopper.nativeapp.features.host

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class PortsAndTunnelsRepositoryTest {

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
    fun testRefreshPortsAndIncarnationFencing() = runTest {
        server!!.createContext("/api/ports") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "ports": [
                            {
                                "port": 3000,
                                "session_id": "sess-1",
                                "incarnation": 2,
                                "project": "web",
                                "detected_via": "proc_net",
                                "state": "listening"
                            }
                        ]
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = PortRepository(apiClient)

        val ports = repo.refreshPorts()
        assertEquals(1, ports.size)
        assertEquals(3000, ports[0].port)
        assertEquals(2uL, ports[0].incarnation)
        assertEquals(PortState.LISTENING, ports[0].state)

        // Stale incarnation (incarnation 1 < current 2) should be rejected
        repo.handleServerMsg(
            ServerMsg.PortDiscovered(
                port = 3000,
                sessionId = "sess-1",
                incarnation = 1uL,
                project = "web",
                detectedVia = "stdout_regex",
                state = "provisional"
            )
        )
        assertEquals(PortState.LISTENING, repo.ports.value[0].state)
        assertEquals(2uL, repo.ports.value[0].incarnation)

        // Newer incarnation (incarnation 3 >= current 2) should update
        repo.handleServerMsg(
            ServerMsg.PortDiscovered(
                port = 3000,
                sessionId = "sess-1",
                incarnation = 3uL,
                project = "web",
                detectedVia = "stdout_regex",
                state = "provisional"
            )
        )
        assertEquals(PortState.PROVISIONAL, repo.ports.value[0].state)
        assertEquals(3uL, repo.ports.value[0].incarnation)

        // Port lost from older incarnation (1 < 3) should be ignored
        repo.handleServerMsg(
            ServerMsg.PortLost(
                port = 3000,
                sessionId = "sess-1",
                incarnation = 1uL
            )
        )
        assertEquals(PortState.PROVISIONAL, repo.ports.value[0].state)

        // Port lost from matching or newer incarnation (3 >= 3) should mark LOST
        repo.handleServerMsg(
            ServerMsg.PortLost(
                port = 3000,
                sessionId = "sess-1",
                incarnation = 3uL
            )
        )
        assertEquals(PortState.LOST, repo.ports.value[0].state)
    }

    @Test
    fun testTunnelCrudAndReminderLifecycle() = runTest {
        server!!.createContext("/api/tunnels") { exchange ->
            if (exchange.requestMethod == "GET") {
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""
                        [
                            {
                                "id": "t-1",
                                "port": 8080,
                                "label": "api",
                                "driver": "cloudflared",
                                "status": "ready",
                                "url": "https://api.trycloudflare.com",
                                "startedAt": 10000,
                                "reminderDue": false
                            }
                        ]
                    """.trimIndent())
                    writer.flush()
                }
            } else if (exchange.requestMethod == "POST") {
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(201, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""
                        {
                            "id": "t-2",
                            "port": 5000,
                            "label": "flask",
                            "driver": "cloudflared",
                            "status": "starting",
                            "startedAt": 20000,
                            "reminderDue": false
                        }
                    """.trimIndent())
                    writer.flush()
                }
            }
        }

        server!!.createContext("/api/tunnels/t-1") { exchange ->
            if (exchange.requestMethod == "DELETE") {
                exchange.sendResponseHeaders(204, -1)
            }
        }

        server!!.createContext("/api/tunnels/install") { exchange ->
            if (exchange.requestMethod == "GET") {
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, 0)
                exchange.responseBody.bufferedWriter().use { writer ->
                    writer.write("""{"installing": false, "installed": true}""")
                    writer.flush()
                }
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = TunnelRepository(apiClient)

        // 1. Initial list
        val tunnels = repo.refreshTunnels()
        assertEquals(1, tunnels.size)
        assertEquals("t-1", tunnels[0].id)
        assertEquals(TunnelStatus.READY, tunnels[0].status)
        assertFalse(tunnels[0].reminderDue)

        // 2. Install status check
        val installStatus = repo.refreshInstallStatus()
        assertNotNull(installStatus)
        assertTrue(installStatus.installed)
        assertFalse(installStatus.installing)

        // 3. Create tunnel
        val created = repo.createTunnel(5000, "flask").getOrThrow()
        assertEquals("t-2", created.id)
        assertEquals(TunnelStatus.STARTING, created.status)
        assertEquals(2, repo.tunnels.value.size)

        // 4. WebSocket ready event
        repo.handleServerMsg(
            ServerMsg.TunnelReady(
                id = "t-2",
                url = "https://flask.trycloudflare.com"
            )
        )
        val readyTunnel = repo.tunnels.value.find { it.id == "t-2" }
        assertNotNull(readyTunnel)
        assertEquals(TunnelStatus.READY, readyTunnel.status)
        assertEquals("https://flask.trycloudflare.com", readyTunnel.url)

        // 5. WebSocket 3-hour reminder event
        repo.handleServerMsg(
            ServerMsg.TunnelReminder(id = "t-2")
        )
        val remindedTunnel = repo.tunnels.value.find { it.id == "t-2" }
        assertNotNull(remindedTunnel)
        assertTrue(remindedTunnel.reminderDue)

        // 6. Stop tunnel
        val stopRes = repo.stopTunnel("t-1")
        assertTrue(stopRes.isSuccess)
        val stoppedTunnel = repo.tunnels.value.find { it.id == "t-1" }
        assertNotNull(stoppedTunnel)
        assertEquals(TunnelStatus.STOPPED, stoppedTunnel.status)

        // 7. Warning dismissal
        assertFalse(repo.warningDismissed.value)
        repo.dismissWarning()
        assertTrue(repo.warningDismissed.value)
    }
}
