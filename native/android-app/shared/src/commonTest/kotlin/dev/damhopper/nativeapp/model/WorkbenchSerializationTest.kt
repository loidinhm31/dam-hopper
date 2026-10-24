package dev.damhopper.nativeapp.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class WorkbenchSerializationTest {

    private val json = Json {
        prettyPrint = false
        ignoreUnknownKeys = true
    }

    @Test
    fun testWorkbenchStateSerializationRoundtrip() {
        val original = WorkbenchState(
            activePanel = WorkbenchPanel.GIT,
            serverName = "Production-Host-01",
            activeProject = "damhopper-main",
            isConnected = true,
            connectionStatus = "Connected"
        )

        val encoded = json.encodeToString(WorkbenchState.serializer(), original)
        val decoded = json.decodeFromString(WorkbenchState.serializer(), encoded)

        assertEquals(original.activePanel, decoded.activePanel)
        assertEquals(original.serverName, decoded.serverName)
        assertEquals(original.activeProject, decoded.activeProject)
        assertEquals(original.isConnected, decoded.isConnected)
        assertEquals(original.connectionStatus, decoded.connectionStatus)

        // Verify shell invariants persist
        assertEquals(WorkbenchMode.TERMINAL, decoded.workspaceMode)
        assertEquals(TerminalUsageMode.TRADITIONAL, decoded.terminalUsageMode)
        assertFalse(decoded.allowFloatingButtons)
    }

    @Test
    fun testDefaultStateSerialization() {
        val defaultState = WorkbenchState()
        val encoded = json.encodeToString(WorkbenchState.serializer(), defaultState)
        val decoded = json.decodeFromString(WorkbenchState.serializer(), encoded)

        assertEquals(WorkbenchPanel.TERMINAL, decoded.activePanel)
        assertEquals(WorkbenchMode.TERMINAL, decoded.workspaceMode)
        assertEquals(TerminalUsageMode.TRADITIONAL, decoded.terminalUsageMode)
    }
}
