package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.settings.CognitoModeStyle
import dev.damhopper.nativeapp.features.settings.ExplorerLanguageFilter
import dev.damhopper.nativeapp.features.settings.MAX_CONFIG_IMPORT_BYTES
import dev.damhopper.nativeapp.features.settings.NativePreferencesEnvelope
import dev.damhopper.nativeapp.features.settings.SettingsImportDecode
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.settings.decodeNativePreferences
import dev.damhopper.nativeapp.features.settings.decodeSettingsImportResponse
import dev.damhopper.nativeapp.features.settings.encodeNativePreferences
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Behavior and boundary regressions of the persistence/privacy logic the Android store delegates to. These tests
 * intentionally do not pin labels, channel ids, keys or source fragments.
 */
class SettingsPreferencesPhase17Test {

    @Test
    fun cognitoActivationIsMemoryOnlyAndNeverReachesPersistedPreferences() {
        val privacy = PrivacyController()
        assertFalse(privacy.isMaskActive.value)
        assertNull(privacy.activationChord.value)

        privacy.activate("mod+alt+keyb", CognitoModeStyle.BLACK_SCREEN)
        assertTrue(privacy.isMaskActive.value)

        val persisted = encodeNativePreferences(
            NativePreferencesEnvelope(preferences = WorkbenchPreferences(cognitoModeStyle = CognitoModeStyle.BLACK_SCREEN)),
        )
        // The style/shortcut preference persists; the activation state does not exist in the stored shape.
        val decoded = decodeNativePreferences(persisted).getOrThrow()
        assertEquals(CognitoModeStyle.BLACK_SCREEN, decoded.preferences.cognitoModeStyle)
        assertFalse(persisted.contains("MaskActive", ignoreCase = true))

        privacy.deactivate()
        assertFalse(privacy.isMaskActive.value)
        assertNull(privacy.activationChord.value)
    }

    @Test
    fun legacyUnversionedBytesMigrateToTheV2ShapeWithoutInventingEnabledAlerts() {
        val legacy = """
            {"theme":"dark","explorerLanguageFilter":"known","terminalScrollStep":20,
             "terminalAgentNotifications":{"masterEnabled":false,"omp":{"enabled":true,"toast":true,"browser":true,"sound":true}}}
        """.trimIndent()
        val migrated = decodeNativePreferences(legacy).getOrThrow()
        assertEquals(2, migrated.nativeVersion)
        // `known` has no wire equivalent: local All fallback, original value kept as recovery metadata.
        assertEquals(ExplorerLanguageFilter.ALL, migrated.preferences.explorerLanguageFilter)
        assertEquals("known", migrated.legacyExplorerLanguageFilter)
        // masterEnabled=false never becomes an enabled agent; browser/sound flags are preserved.
        val omp = migrated.preferences.terminalAgentNotifications.agents.omp
        assertFalse(omp.enabled)
        assertTrue(omp.browser && omp.sound)
        assertEquals(20, migrated.preferences.terminalScrollStep, "existing scroll step is preserved")

        // Re-encoding and decoding the migrated value is stable (idempotent migration).
        val again = decodeNativePreferences(encodeNativePreferences(migrated)).getOrThrow()
        assertEquals(migrated, again)
    }

    @Test
    fun corruptOrUnknownBytesFailInsteadOfBecomingDefaults() {
        assertTrue(decodeNativePreferences("{not json").isFailure)
        assertTrue(decodeNativePreferences("""{"nativeVersion":3,"preferences":{}}""").isFailure)
        assertTrue(decodeNativePreferences("""{"explorerLanguageFilter":"cobol"}""").isFailure)
    }

    @Test
    fun importCeilingAndAuthoritativeResponseBoundary() {
        assertEquals(1024L * 1024L, MAX_CONFIG_IMPORT_BYTES)
        // The obsolete `ok` discriminator can never confirm an import.
        assertTrue(decodeSettingsImportResponse("""{"ok":true}""") is SettingsImportDecode.Malformed)
        assertTrue(decodeSettingsImportResponse("""{"imported":false,"fileName":"a","backupFileName":"b"}""") is SettingsImportDecode.NotImported)
        val confirmed = decodeSettingsImportResponse("""{"imported":true,"fileName":"a.toml","backupFileName":"a.toml.bak.1","workspaceName":null}""")
        assertTrue(confirmed is SettingsImportDecode.Imported)
        assertEquals("a.toml.bak.1", (confirmed as SettingsImportDecode.Imported).result.backupFileName)
    }

    @Test
    fun lifecycleTransitions() {
        val lifecycle = LifecycleCoordinator()
        assertEquals(LifecycleState.INITIALIZED, lifecycle.state.value)

        lifecycle.onAppForeground()
        assertEquals(LifecycleState.FOREGROUND, lifecycle.state.value)

        lifecycle.onAppBackground()
        assertEquals(LifecycleState.BACKGROUND, lifecycle.state.value)

        lifecycle.onDestroy()
        assertEquals(LifecycleState.DESTROYED, lifecycle.state.value)
    }
}
