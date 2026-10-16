package dev.damhopper.nativeapp.features.agents

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlin.test.*

class AgentStoreModelsAndSerializationTest {

    @Test
    fun testAgentTypeSerialization() {
        assertEquals("\"claude\"", ProtocolJson.encodeToString(AgentType.serializer(), AgentType.CLAUDE))
        assertEquals("\"gemini\"", ProtocolJson.encodeToString(AgentType.serializer(), AgentType.GEMINI))
        assertEquals(AgentType.CLAUDE, ProtocolJson.decodeFromString(AgentType.serializer(), "\"claude\""))
        assertEquals(AgentType.GEMINI, ProtocolJson.decodeFromString(AgentType.serializer(), "\"gemini\""))
        assertEquals(AgentType.CLAUDE, AgentType.fromString("CLAUDE"))
        assertEquals(AgentType.GEMINI, AgentType.fromString("gemini"))
        assertNull(AgentType.fromString("unknown"))
    }

    @Test
    fun testAgentItemCategorySerialization() {
        val categories = listOf(
            AgentItemCategory.SKILL to "\"skill\"",
            AgentItemCategory.COMMAND to "\"command\"",
            AgentItemCategory.HOOK to "\"hook\"",
            AgentItemCategory.MCP_SERVER to "\"mcp-server\"",
            AgentItemCategory.SUBAGENT to "\"subagent\"",
            AgentItemCategory.MEMORY_TEMPLATE to "\"memory-template\""
        )
        for ((cat, wire) in categories) {
            assertEquals(wire, ProtocolJson.encodeToString(AgentItemCategory.serializer(), cat))
            assertEquals(cat, ProtocolJson.decodeFromString(AgentItemCategory.serializer(), wire))
        }
    }

    @Test
    fun testDistributionMethodSerialization() {
        assertEquals("\"symlink\"", ProtocolJson.encodeToString(DistributionMethod.serializer(), DistributionMethod.SYMLINK))
        assertEquals("\"copy\"", ProtocolJson.encodeToString(DistributionMethod.serializer(), DistributionMethod.COPY))
    }

    @Test
    fun testAgentStoreItemSerialization() {
        val json = """
            {
                "name": "code-review",
                "category": "skill",
                "relativePath": "skills/code-review/SKILL.md",
                "description": "Reviews code",
                "compatibleAgents": ["claude"],
                "sizeBytes": 2048
            }
        """.trimIndent()
        val item = ProtocolJson.decodeFromString(AgentStoreItem.serializer(), json)
        assertEquals("code-review", item.name)
        assertEquals(AgentItemCategory.SKILL, item.category)
        assertEquals("skills/code-review/SKILL.md", item.relativePath)
        assertEquals("Reviews code", item.description)
        assertEquals(listOf(AgentType.CLAUDE), item.compatibleAgents)
        assertEquals(2048L, item.sizeBytes)
    }

    @Test
    fun testShipResultSerialization() {
        val json = """
            {
                "item": "code-review",
                "category": "skill",
                "project": "my-project",
                "agent": "claude",
                "method": "symlink",
                "success": true,
                "error": null,
                "targetPath": "/path/to/project/.claude/skills/code-review"
            }
        """.trimIndent()
        val res = ProtocolJson.decodeFromString(ShipResult.serializer(), json)
        assertEquals("code-review", res.item)
        assertEquals("my-project", res.project)
        assertEquals(AgentType.CLAUDE, res.agent)
        assertEquals(DistributionMethod.SYMLINK, res.method)
        assertTrue(res.success)
        assertNull(res.error)
        assertEquals("/path/to/project/.claude/skills/code-review", res.targetPath)
    }

    @Test
    fun testHealthCheckResultSerialization() {
        val json = """
            {
                "brokenSymlinks": [
                    {"project": "p1", "path": "p1/.claude/skills/s1", "target": "missing/target"}
                ],
                "orphanedItems": [
                    {"project": "p2", "path": "p2/.claude/commands/c1", "reason": "No store item"}
                ]
            }
        """.trimIndent()
        val health = ProtocolJson.decodeFromString(HealthCheckResult.serializer(), json)
        assertEquals(1, health.brokenSymlinks.size)
        assertEquals("p1", health.brokenSymlinks[0].project)
        assertEquals(1, health.orphanedItems.size)
        assertEquals("No store item", health.orphanedItems[0].reason)
    }

    @Test
    fun testBulkShipRequestSerialization() {
        val req = BulkShipRequest(
            items = listOf(BulkShipItem("review", AgentItemCategory.SKILL)),
            projects = listOf(BulkShipProject("proj1", AgentType.CLAUDE)),
            method = DistributionMethod.SYMLINK
        )
        val json = ProtocolJson.encodeToString(BulkShipRequest.serializer(), req)
        assertTrue(json.contains("\"itemName\"") || json.contains("\"name\":\"review\""))
        assertTrue(json.contains("\"projectName\":\"proj1\""))
        assertTrue(json.contains("\"agent\":\"claude\""))
        assertTrue(json.contains("\"method\":\"symlink\""))
    }

    @Test
    fun testMemoryTemplateAndApplySerialization() {
        val tmpl = MemoryTemplateInfo("default", "# Context\n{{project.name}}")
        val json = ProtocolJson.encodeToString(MemoryTemplateInfo.serializer(), tmpl)
        assertTrue(json.contains("\"name\":\"default\""))

        val applyReq = ApplyTemplateRequest(
            projectName = "test-proj",
            agent = "claude",
            templateName = "default",
            write = false
        )
        val applyJson = ProtocolJson.encodeToString(ApplyTemplateRequest.serializer(), applyReq)
        assertTrue(applyJson.contains("\"projectName\":\"test-proj\""))
        assertTrue(applyJson.contains("\"write\":false"))
    }

    @Test
    fun testImportModelsSerialization() {
        val item = RepoScanItem(
            name = "lint",
            category = AgentItemCategory.COMMAND,
            description = "Run linter",
            relativePath = ".claude/commands/lint.md"
        )
        val scanResp = ScanRepoResponse(
            repoUrl = "https://github.com/test/repo.git",
            tmpDir = "/tmp/damhopper-import/123",
            items = listOf(item)
        )
        val json = ProtocolJson.encodeToString(ScanRepoResponse.serializer(), scanResp)
        assertTrue(json.contains("\"repoUrl\":\"https://github.com/test/repo.git\""))
        assertTrue(json.contains("\"tmpDir\":\"/tmp/damhopper-import/123\""))
        assertTrue(json.contains("\"category\":\"command\""))

        val confirmReq = ImportConfirmRequest(
            sourceDir = "/tmp/damhopper-import/123",
            items = listOf(item),
            cleanup = true
        )
        val confirmJson = ProtocolJson.encodeToString(ImportConfirmRequest.serializer(), confirmReq)
        assertTrue(confirmJson.contains("\"sourceDir\":\"/tmp/damhopper-import/123\""))
        assertTrue(confirmJson.contains("\"cleanup\":true"))

        val importRes = ImportResult(name = "lint", success = false, error = "Item exists")
        val resJson = ProtocolJson.encodeToString(ImportResult.serializer(), importRes)
        assertTrue(resJson.contains("\"success\":false"))
        assertTrue(resJson.contains("\"error\":\"Item exists\""))
    }

    @Test
    fun testAgentStoreHelpers() {
        assertEquals("skill:code-review", AgentStoreHelpers.itemKey(AgentItemCategory.SKILL, "code-review"))
        assertEquals("my-proj:claude", AgentStoreHelpers.projectAgentKey("my-proj", AgentType.CLAUDE))
        assertEquals("0 B", AgentStoreHelpers.formatBytes(null))
        assertEquals("0 B", AgentStoreHelpers.formatBytes(0))
        assertEquals("500 B", AgentStoreHelpers.formatBytes(500))
        assertEquals("1.5 KB", AgentStoreHelpers.formatBytes(1536))
        assertEquals("2.0 MB", AgentStoreHelpers.formatBytes(2097152))
    }
}
