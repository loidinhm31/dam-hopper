package dev.damhopper.nativeapp.features.host

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.HostResourceSseClient
import dev.damhopper.nativeapp.core.transport.HostResourceSseFrame
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class HostResourceModelsTest {

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
    fun testSnapshotDeserializationWithNullAndUnsupportedDistinction() {
        val json = """
            {
                "schemaVersion": 1,
                "sampleId": "sample-123",
                "sampledAt": 1729000000,
                "host": { "hostname": "damhopper-host", "osName": "Linux" },
                "capabilities": { "linuxDeepMetrics": { "state": "available", "sampledAt": 1729000000 } },
                "memory": {
                    "totalBytes": 16777216,
                    "usedBytes": 8388608,
                    "availableBytes": 8388608,
                    "swapTotalBytes": null,
                    "swapUsedBytes": null,
                    "availability": { "state": "unsupported", "sampledAt": 1729000000 }
                },
                "mountContext": {
                    "mountPoint": "/workspace",
                    "freeBytes": 104857600
                }
            }
        """.trimIndent()

        val snapshot = ProtocolJson.decodeFromString(HostResourceSnapshotV1.serializer(), json)
        assertEquals(1, snapshot.schemaVersion)
        assertEquals("sample-123", snapshot.sampleId)
        assertEquals("damhopper-host", snapshot.host.hostname)
        assertEquals(16777216uL, snapshot.memory.totalBytes)
        // Null vs zero: swap is null, not zero
        assertNull(snapshot.memory.swapTotalBytes)
        assertEquals(AvailabilityState.UNSUPPORTED, snapshot.memory.availability.state)
        assertEquals(104857600uL, snapshot.mountContext.freeBytes)
    }

    @Test
    fun testMetricsDeserialization() {
        val json = """
            {
                "sampledAt": 1729000000, "hostname": "prod-server", "osName": "Linux", "uptimeSeconds": 86400,
                "cpu": { "usagePercent": 42.5, "logicalCoreCount": 8, "physicalCoreCount": 4 },
                "memory": { "totalBytes": 33554432, "usedBytes": 16777216, "availableBytes": 16777216, "usagePercent": 50.0 },
                "disk": { "name": "nvme0n1", "mountPoint": "/", "totalBytes": 1073741824, "availableBytes": 536870912, "usedBytes": 536870912, "usagePercent": 50.0 },
                "disks": [], "temperatures": [ { "label": "CPU", "celsius": 55.0, "source": "k10temp" } ]
            }
        """.trimIndent()
        val metrics = ProtocolJson.decodeFromString(HostMetrics.serializer(), json)
        assertEquals("prod-server", metrics.hostname)
        assertEquals(86400uL, metrics.uptimeSeconds)
        assertEquals(42.5, metrics.cpu.usagePercent)
        assertEquals(8, metrics.cpu.logicalCoreCount)
        assertEquals(4, metrics.cpu.physicalCoreCount)
        assertEquals(50.0, metrics.memory.usagePercent)
        assertEquals(1, metrics.temperatures.size)
        assertEquals(55.0, metrics.temperatures[0].celsius)
    }

    @Test
    fun testAlertIncidentsDeserialization() {
        val json = """
            [
                {
                    "incidentId": "inc-456",
                    "state": "memoryPressure",
                    "severity": "critical",
                    "openedAt": 1729000000,
                    "updatedAt": 1729000100,
                    "durationSeconds": 100,
                    "scope": "host",
                    "threshold": "psi_some > 25%",
                    "confidence": "high",
                    "evidence": { "psiSomeAvg10": 28.5, "cgroupOomDelta": false },
                    "nextAction": "Restart heavy service"
                }
            ]
        """.trimIndent()

        val alerts = ProtocolJson.decodeFromString(
            kotlinx.serialization.builtins.ListSerializer(AlertIncident.serializer()),
            json
        )
        assertEquals(1, alerts.size)
        val alert = alerts[0]
        assertEquals("inc-456", alert.incidentId)
        assertEquals(AlertState.MEMORY_PRESSURE, alert.state)
        assertEquals(AlertSeverity.CRITICAL, alert.severity)
        assertEquals(Confidence.HIGH, alert.confidence)
        assertEquals(28.5, alert.evidence.psiSomeAvg10)
    }

    @Test
    fun testSseDataEventOverflowRejection() = runTest {
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                // Status frame
                writer.write("event: host-resources-status\n")
                writer.write("""data: {"serverEpoch":"epoch-1","revision":"100","freshnessTtlMs":5000}""")
                writer.write("\n\n")
                writer.flush()

                // Oversize data frame exceeding 256 KiB
                writer.write("event: host-resources\n")
                val padding = "x".repeat(300_000)
                writer.write("data: {\"schemaVersion\":1,\"serverEpoch\":\"epoch-1\",\"revision\":\"100\",\"padding\":\"$padding\"}\n\n")
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = HostResourceSseClient(connection = ref, baseUrl = "http://127.0.0.1:$serverPort")

        val frames = client.openEventStream().toList()
        // Only the status frame should be emitted; the oversize data frame is discarded
        assertEquals(1, frames.size)
        assertIs<HostResourceSseFrame.Status>(frames[0])
    }

    @Test
    fun testSseByteProgressReporting() = runTest {
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                // Comment heartbeat
                writer.write(": ping heartbeat\n\n")
                writer.flush()
            }
        }

        var progressBytes = 0L
        val ref = ConnectionRef("dev-profile", 1L)
        val client = HostResourceSseClient(connection = ref, baseUrl = "http://127.0.0.1:$serverPort")

        client.openEventStream(onByteProgress = { bytes ->
            progressBytes += bytes
        }).toList()

        assertTrue(progressBytes > 0, "Byte progress should be notified on comment heartbeat")
    }

    @Test
    fun testSseBoundedErrorBodyReading() = runTest {
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(503, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                // Write a 503 error JSON
                writer.write("""{"code":"FRAME_TOO_LARGE","error":"Frame exceeds limit"}""")
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = HostResourceSseClient(connection = ref, baseUrl = "http://127.0.0.1:$serverPort")

        val err = assertFailsWith<ApiRequestError> {
            client.openEventStream().toList()
        }
        assertEquals(503, err.status)
        assertEquals("FRAME_TOO_LARGE", err.code)
    }
}
