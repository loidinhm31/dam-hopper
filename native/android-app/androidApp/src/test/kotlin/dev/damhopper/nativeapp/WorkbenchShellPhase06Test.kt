package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.features.workspace.ProjectTargetSnapshot
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.model.WorkbenchMode
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import dev.damhopper.nativeapp.ui.navigation.WorkbenchNavigation
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkbenchShellPhase06Test {

    @Test
    fun testShellInvariantsTerminalTraditionalOnly() {
        val state = WorkbenchState()
        assertEquals(WorkbenchMode.TERMINAL, state.workspaceMode)
        assertEquals(dev.damhopper.nativeapp.model.TerminalUsageMode.TRADITIONAL, state.terminalUsageMode)
        assertFalse(state.allowFloatingButtons, "Floating action buttons strictly disallowed")
        assertTrue(state.singleContentArea, "Single content area mandatory on all form factors")
    }

    @Test
    fun testPanelRegistryContainsExact12AuthoritativePanels() {
        assertEquals(12, PanelRegistry.allPanels.size)
        val expectedCodes = listOf(
            "TERM", "FS", "EDIT", "DIFF", "MRG", "GIT",
            "FLOW", "AGNT", "RES", "PORT", "HOST", "SET"
        )
        val actualCodes = PanelRegistry.allPanels.map { it.shortCode }
        assertEquals(expectedCodes, actualCodes)
    }

    @Test
    fun testZeroFloatingActionButtonsInSharedUi() {
        val sharedUiDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui")
        assertTrue(sharedUiDir.exists(), "Shared UI directory must exist")

        val ktFiles = sharedUiDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV-01 invariant: zero FABs permitted in native workbench"
            )
        }
    }

    @Test
    fun testManifestAdjustResizeForImeVisibility() {
        val manifest = File("src/main/AndroidManifest.xml")
        assertTrue(manifest.exists())
        val text = manifest.readText()
        assertTrue(
            text.contains("android:windowSoftInputMode=\"adjustResize\""),
            "Manifest must use adjustResize so top navigation row stays visible above soft keyboard"
        )
    }

    @Test
    fun testNavigationBackDismissalPrecedence() {
        val nav = WorkbenchNavigation()

        // At terminal: back yields to platform
        assertFalse(nav.handleBackPress())

        // Non-terminal panel: back navigates to terminal
        nav.navigateTo(WorkbenchPanel.FILES)
        assertEquals(WorkbenchPanel.FILES, nav.state.value.activePanel)
        assertTrue(nav.handleBackPress())
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)

        // Overlay open: back dismisses overlay first
        nav.navigateTo(WorkbenchPanel.SETTINGS)
        nav.openWorkspaceSwitcher()
        assertTrue(nav.state.value.showWorkspaceSwitcher)
        assertTrue(nav.handleBackPress())
        assertFalse(nav.state.value.showWorkspaceSwitcher)
        assertEquals(WorkbenchPanel.SETTINGS, nav.state.value.activePanel)

        // Then back returns to terminal
        assertTrue(nav.handleBackPress())
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)
    }

    @Test
    fun testTargetStoreFailsClosedOnUnavailableTargets() {
        val store = ProjectTargetStore()
        val profile = "p1"
        val ws = "/data/dam-hopper.toml"
        val project = "app"
        val missingWorktree = "missing-wt"

        store.selectTarget(profile, ws, project, missingWorktree)
        store.markTargetUnavailable(profile, ws, project, missingWorktree)

        val snapshot = store.getSnapshot(profile, ws, project)
        assertFalse(snapshot.isAvailable)
        assertFalse(snapshot.isRoot, "Must fail closed without redirecting to root")
        assertEquals(missingWorktree, snapshot.target.worktreePath)
    }
}
