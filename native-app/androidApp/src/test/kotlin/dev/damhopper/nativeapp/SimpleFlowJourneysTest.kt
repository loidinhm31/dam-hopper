package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SimpleFlowJourneysTest {

    @Test
    fun testZeroWebViewInSimpleFlowUi() {
        val filesToCheck = listOf(
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt"),
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt"),
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt"),
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt"),
        )

        for (file in filesToCheck) {
            assertTrue(file.exists(), "Source file must exist: ${file.path}")
            val content = file.readText()
            assertFalse(
                content.contains("android.webkit.WebView") ||
                    content.contains("WebView(") ||
                    content.contains("AndroidViewBinding") && content.contains("WebView"),
                "File ${file.name} must not contain WebView references"
            )
        }
    }

    @Test
    fun testZeroFloatingActionButtonInSimpleFlowUi() {
        val filesToCheck = listOf(
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt"),
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt"),
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt"),
            File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt"),
        )

        for (file in filesToCheck) {
            assertTrue(file.exists(), "Source file must exist: ${file.path}")
            val content = file.readText()
            assertFalse(
                content.contains("FloatingActionButton") ||
                    content.contains("ExtendedFloatingActionButton"),
                "File ${file.name} must not contain FloatingActionButton references"
            )
        }
    }

    @Test
    fun testCompleteSimpleFlowNavigationCycle() {
        val nav = AppFlowNavigation()

        // 1. App starts at Profile Login
        assertEquals(AppFlowStage.PROFILE_LOGIN, nav.state.value.stage)
        assertFalse(nav.handleBackPress())

        // 2. User logs in to profile -> advances to Project List
        nav.onProfileAuthenticated("prof-local")
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
        assertEquals("prof-local", nav.state.value.activeProfileId)

        // 3. User selects a project -> advances to Terminal
        nav.selectProject("dam-hopper")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
        assertEquals("dam-hopper", nav.state.value.activeProject)

        // 4. In Terminal, selecting a session
        nav.selectSession("term-1")
        assertEquals("term-1", nav.state.value.activeSessionId)

        // 5. Back from Terminal returns to Project List without losing active project
        assertTrue(nav.handleBackPress())
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
        assertEquals("dam-hopper", nav.state.value.activeProject)

        // 6. Back from Project List returns to Profile Login
        assertTrue(nav.handleBackPress())
        assertEquals(AppFlowStage.PROFILE_LOGIN, nav.state.value.stage)

        // 7. Back from Profile Login exits (returns false)
        assertFalse(nav.handleBackPress())
    }

    @Test
    fun testManifestComplianceForSimpleFlow() {
        val manifestFile = File("src/main/AndroidManifest.xml")
        assertTrue(manifestFile.exists(), "AndroidManifest.xml must exist")

        val content = manifestFile.readText()
        assertTrue(content.contains("android:windowSoftInputMode=\"adjustResize\""), "MainActivity must use adjustResize")
        assertTrue(content.contains("android:allowBackup=\"false\""), "allowBackup must be false")
        assertTrue(content.contains("android:fullBackupContent=\"false\""), "fullBackupContent must be false")
        assertFalse(content.contains("WebView"), "Manifest must not declare WebView")
    }

    @Test
    fun testProfileSelectionGateAndTestConnectionInvariants() {
        val profileLoginFile = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt")
        assertTrue(profileLoginFile.exists(), "ProfileLoginScreen.kt must exist")
        val loginContent = profileLoginFile.readText()

        // Profile selection gate invariant: Continue button requires an explicitly selected target profile
        assertTrue(
            loginContent.contains("val targetProfile = selectedProfileId?.let { id -> profiles.find { it.id == id } }"),
            "Continue must be gated on a selected target profile"
        )
        assertTrue(
            loginContent.contains("if (targetProfile != null && (isCurrentlyAuthenticated || hasStoredToken))"),
            "Continue button must only be available when targetProfile is selected and authenticated/has token"
        )

        // Test Connection isolation: Test Connection must not call saveProfileFromInputs or selectProfile
        val testConnBlock = loginContent.substringAfter("Test Connection & Capability Probe")
            .substringBefore("enabled = !isBusy")
        assertFalse(
            testConnBlock.contains("saveProfileFromInputs"),
            "Test Connection must not call saveProfileFromInputs"
        )
        assertFalse(
            testConnBlock.contains("selectProfile"),
            "Test Connection must not call selectProfile"
        )

        // DamHopperMobileApp navigation invariant: must not unconditionally navigate on activeProfileId change
        val appFile = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt")
        assertTrue(appFile.exists(), "DamHopperMobileApp.kt must exist")
        val appContent = appFile.readText()
        assertFalse(
            appContent.contains("if (flowState.activeProfileId != null && flowState.activeProfileId != profId) {\n            navigation.onProfileAuthenticated(profId)"),
            "Must not unconditionally navigate on activeProfileId without authentication check"
        )
    }

    @Test
    fun testTerminalFontSizeControlsAndPinchWiringStructuralGuard() {
        val appFile = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt")
        assertTrue(appFile.exists(), "DamHopperMobileApp.kt must exist")
        val appContent = appFile.readText()
        assertTrue(
            appContent.contains("preferencesStore = preferencesStore"),
            "DamHopperMobileApp must pass preferencesStore to ProjectTerminalScreen"
        )

        val terminalFile = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt")
        assertTrue(terminalFile.exists(), "ProjectTerminalScreen.kt must exist")
        val terminalContent = terminalFile.readText().replace("\r\n", "\n")

        assertTrue(
            terminalContent.contains("preferencesStore: PreferencesStore = remember { InMemoryPreferencesStore() }"),
            "ProjectTerminalScreen must accept preferencesStore parameter"
        )
        assertTrue(
            terminalContent.contains("WorkbenchPreferences.clampFont(preferencesStore.loadPreferences().terminalFontSize)"),
            "ProjectTerminalScreen must initialize clamped terminalFontSize from preferencesStore"
        )
        val normalizedWhitespace = terminalContent.replace(Regex("\\s+"), " ")
        assertTrue(
            normalizedWhitespace.contains("preferencesStore.savePreferences( preferencesStore.loadPreferences().copy(terminalFontSize = clamped) )"),
            "ProjectTerminalScreen must persist updated terminalFontSize via fresh load/copy/save"
        )

        val idxMinus = terminalContent.indexOf("text = \"A-\"")
        val idxReadout = terminalContent.indexOf("text = \"\${terminalFontSize}sp\"")
        val idxPlus = terminalContent.indexOf("text = \"A+\"")
        val idxDiag = terminalContent.indexOf("text = \"Diag\"")
        val idxNewTerm = terminalContent.indexOf("text = \"+ New Terminal\"")
        assertTrue(idxMinus > 0 && idxMinus < idxReadout, "A- must precede font size readout")
        assertTrue(idxReadout < idxPlus, "Font size readout must precede A+")
        assertTrue(idxPlus < idxDiag, "A+ must precede Diag")
        assertTrue(idxDiag < idxNewTerm, "Diag must precede + New Terminal")

        assertTrue(
            terminalContent.contains("val terminalTextStyle = remember(terminalFontSize)") &&
                terminalContent.contains("fontSize = terminalFontSize.sp") &&
                terminalContent.contains("lineHeight = terminalLineHeightSp(terminalFontSize).sp"),
            "terminalTextStyle must be keyed by terminalFontSize and use terminalLineHeightSp"
        )
        assertTrue(
            terminalContent.contains("if (pressedCount >= 2)") &&
                terminalContent.contains("event.calculateZoom()"),
            "Pinch zoom calculation must be gated by pressedCount >= 2"
        )
    }
}
