package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsRepositoryTest {

    @Test
    fun testWorkbenchPreferencesClamping() {
        val prefs = WorkbenchPreferences(
            systemFontSize = 5,
            editorFontSize = 50,
            terminalFontSize = 2,
            terminalScrollStep = 100,
        )
        val clamped = prefs.clamped()
        assertEquals(10, clamped.systemFontSize)
        assertEquals(32, clamped.editorFontSize)
        assertEquals(10, clamped.terminalFontSize)
        assertEquals(20, clamped.terminalScrollStep)
    }

    @Test
    fun testUpdateLocalPreferencesModifiesFlowAndStore() {
        val store = InMemoryPreferencesStore()
        val repo = SettingsRepository(
            preferencesStore = store,
            clientProvider = { null },
        )

        assertEquals(14, repo.preferences.value.editorFontSize)

        repo.updatePreferences { it.copy(editorFontSize = 18, theme = WorkbenchTheme.LIGHT) }

        assertEquals(18, repo.preferences.value.editorFontSize)
        assertEquals(WorkbenchTheme.LIGHT, repo.preferences.value.theme)
        assertEquals(18, store.loadPreferences().editorFontSize)
        assertEquals(WorkbenchTheme.LIGHT, store.loadPreferences().theme)
    }

    @Test
    fun testSwitchPreferenceSourceLifecycle() = runTest {
        val store = InMemoryPreferencesStore()
        val repo = SettingsRepository(
            preferencesStore = store,
            clientProvider = { null },
        )

        assertEquals(PreferenceSourceStatus.UNSET, repo.sourceTargetState.value.preferencesStatus)
        assertNull(repo.sourceTargetState.value.preferencesProfileId)

        // Switch to a profile without connected client
        repo.switchPreferenceSource("server-1")
        assertEquals("server-1", repo.sourceTargetState.value.preferencesProfileId)
        assertEquals(PreferenceSourceStatus.ACTIVE, repo.sourceTargetState.value.preferencesStatus)

        // Switch back to local only (null)
        repo.switchPreferenceSource(null)
        assertNull(repo.sourceTargetState.value.preferencesProfileId)
        assertEquals(PreferenceSourceStatus.UNSET, repo.sourceTargetState.value.preferencesStatus)
    }

    @Test
    fun testSettingsTargetIndependence() {
        val store = InMemoryPreferencesStore()
        val repo = SettingsRepository(
            preferencesStore = store,
            clientProvider = { null },
        )

        assertNull(repo.sourceTargetState.value.settingsProfileId)
        repo.setSettingsTarget("server-target-99")
        assertEquals("server-target-99", repo.sourceTargetState.value.settingsProfileId)
        // Preferences source remains unchanged
        assertNull(repo.sourceTargetState.value.preferencesProfileId)
    }

    @Test
    fun testOnProfileRemovedRetainsSnapshotAndClearsTarget() = runTest {
        val store = InMemoryPreferencesStore()
        val repo = SettingsRepository(
            preferencesStore = store,
            clientProvider = { null },
        )

        repo.switchPreferenceSource("profile-alpha")
        repo.setSettingsTarget("profile-alpha")
        repo.updatePreferences { it.copy(editorFontSize = 20) }

        assertEquals("profile-alpha", repo.sourceTargetState.value.preferencesProfileId)
        assertEquals("profile-alpha", repo.sourceTargetState.value.settingsProfileId)

        repo.onProfileRemoved("profile-alpha")

        // Source is cleared and marked SOURCE_REMOVED, but last preferences snapshot is retained
        assertNull(repo.sourceTargetState.value.preferencesProfileId)
        assertEquals(PreferenceSourceStatus.SOURCE_REMOVED, repo.sourceTargetState.value.preferencesStatus)
        assertNull(repo.sourceTargetState.value.settingsProfileId)
        assertEquals(20, repo.preferences.value.editorFontSize)
    }

    @Test
    fun testImportWorkspaceTomlEnforces1MiBBoundary() = runTest {
        val store = InMemoryPreferencesStore()
        val repo = SettingsRepository(
            preferencesStore = store,
            clientProvider = { null },
        )

        val oversizedContent = "a".repeat((MAX_CONFIG_IMPORT_BYTES + 1024).toInt())
        val result = repo.importWorkspaceToml("profile-1", oversizedContent)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IllegalArgumentException)
        assertTrue(result.exceptionOrNull()?.message?.contains("1 MiB") == true)
    }
}
