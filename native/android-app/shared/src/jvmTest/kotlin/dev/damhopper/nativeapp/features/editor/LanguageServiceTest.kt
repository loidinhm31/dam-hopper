package dev.damhopper.nativeapp.features.editor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LanguageServiceTest {

    private val jsonService = JsonLanguageService()
    private val coordinator = LanguageServiceCoordinator()

    @Test
    fun testValidJsonProducesNoDiagnostics() {
        val validJson = """
            {
              "name": "DamHopper",
              "port": 4801,
              "enabled": true,
              "tags": ["android", "native"]
            }
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "/workspace/config.json",
            languageId = "json",
            content = validJson,
            modelVersion = 1L
        )

        val resp = jsonService.validateDocument(req)
        assertEquals(1L, resp.requestId)
        assertEquals(1L, resp.modelVersion)
        assertTrue(resp.data.isEmpty(), "Valid JSON should produce zero diagnostics")
    }

    @Test
    fun testInvalidJsonProducesDiagnostic() {
        val invalidJson = """
            {
              "name": "DamHopper",
              "missing_comma": true
              "port": 4801
            }
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 2L,
            filePath = "/workspace/broken.json",
            languageId = "json",
            content = invalidJson,
            modelVersion = 1L
        )

        val resp = jsonService.validateDocument(req)
        assertFalse(resp.data.isEmpty(), "Invalid JSON must produce diagnostics")
        assertEquals(DiagnosticSeverity.ERROR, resp.data[0].severity)
        assertEquals("json-syntax", resp.data[0].source)
    }

    @Test
    fun testJsonSymbolsHierarchy() {
        val json = """
            {
              "server": {
                "host": "127.0.0.1",
                "port": 4801
              }
            }
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 3L,
            filePath = "/workspace/config.json",
            languageId = "json",
            content = json,
            modelVersion = 1L
        )

        val resp = jsonService.getSymbols(req)
        val symbolNames = resp.data.map { it.name }
        assertTrue(symbolNames.contains("server"), "Should contain server root symbol")
        assertTrue(symbolNames.contains("server.host"), "Should contain nested server.host symbol")
        assertTrue(symbolNames.contains("server.port"), "Should contain nested server.port symbol")
    }

    @Test
    fun testCoordinatorFencesStaleResponses() {
        val filePath = "/workspace/test.json"

        // Edit 1: version 1
        val req1 = coordinator.registerRequest(filePath, modelVersion = 1L)
        // Edit 2: version 2
        val req2 = coordinator.registerRequest(filePath, modelVersion = 2L)

        assertTrue(req2 > req1, "Request IDs must be strictly monotonic")

        // Response for edit 1 arriving after edit 2 is rejected
        assertFalse(
            coordinator.isResponseValid(filePath, responseModelVersion = 1L),
            "Response for older model version must be rejected as stale"
        )

        // Response for edit 2 is valid
        assertTrue(
            coordinator.isResponseValid(filePath, responseModelVersion = 2L),
            "Response for current model version must be accepted"
        )
    }

    @Test
    fun testTypeScriptLanguageServiceAuditBlockerDocumented() {
        assertEquals("BLOCKED_PENDING_RUNTIME_DECISION", TypeScriptLanguageServiceAudit.STATUS)
        assertTrue(TypeScriptLanguageServiceAudit.BLOCKER_RATIONALE.contains("does not host a Language Server Protocol"))
    }
}
