package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.features.agents.AgentItemCategory
import dev.damhopper.nativeapp.features.agents.AgentType
import dev.damhopper.nativeapp.features.agents.AgentsSubProduct
import dev.damhopper.nativeapp.features.agents.DistributionMethod
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AgentStorePhase14Test {

    @Test
    fun testAgentsPanelRegisteredInAuthoritativeRegistry() {
        val descriptor = PanelRegistry.get(WorkbenchPanel.AGENTS)
        assertEquals("Agents", descriptor.label)
        assertEquals("AGNT", descriptor.shortCode)
    }

    @Test
    fun testZeroFloatingActionButtonsInAgentsUi() {
        val agentsDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents")
        assertTrue(agentsDir.exists(), "Agents features directory must exist")

        val ktFiles = agentsDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV01 invariant: zero FABs permitted in agents panel"
            )
        }
    }

    @Test
    fun testZeroWebViewOrBrowserEngineInAgentsUi() {
        val agentsDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents")
        val ktFiles = agentsDir.walk().filter { it.extension == "kt" }.toList()

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("android.webkit.WebView") || text.contains("WebKit"),
                "File ${file.name} violates B01/B02 invariant: zero WebView or browser engine permitted"
            )
        }
    }

    @Test
    fun testCategoryWireNamesAndStoreDirs() {
        assertEquals("skill", AgentItemCategory.SKILL.wireName)
        assertEquals("skills", AgentItemCategory.SKILL.storeDir)
        assertEquals("command", AgentItemCategory.COMMAND.wireName)
        assertEquals("commands", AgentItemCategory.COMMAND.storeDir)
        assertEquals("hook", AgentItemCategory.HOOK.wireName)
        assertEquals("hooks", AgentItemCategory.HOOK.storeDir)
        assertEquals("mcp-server", AgentItemCategory.MCP_SERVER.wireName)
        assertEquals("mcp-servers", AgentItemCategory.MCP_SERVER.storeDir)
        assertEquals("subagent", AgentItemCategory.SUBAGENT.wireName)
        assertEquals("subagents", AgentItemCategory.SUBAGENT.storeDir)
        assertEquals("memory-template", AgentItemCategory.MEMORY_TEMPLATE.wireName)
        assertEquals("memory-templates", AgentItemCategory.MEMORY_TEMPLATE.storeDir)
    }

    @Test
    fun testAgentTypesAndMethods() {
        assertEquals("claude", AgentType.CLAUDE.wireName)
        assertEquals("gemini", AgentType.GEMINI.wireName)
        assertEquals("symlink", DistributionMethod.SYMLINK.wireName)
        assertEquals("copy", DistributionMethod.COPY.wireName)
    }

    @Test
    fun testAgentsSubProducts() {
        val expected = listOf(
            AgentsSubProduct.STORE,
            AgentsSubProduct.MEMORY,
            AgentsSubProduct.IMPORT,
            AgentsSubProduct.OBSERVATION
        )
        assertEquals(expected, AgentsSubProduct.entries)
    }
}
