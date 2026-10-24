package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.settings.MAX_CONFIG_IMPORT_BYTES
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.storage.AndroidPreferencesStore
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsPreferencesPhase17Test {

    @Test
    fun testSettingsPanelRegisteredInAuthoritativeRegistry() {
        val settingsDesc = PanelRegistry.get(WorkbenchPanel.SETTINGS)
        assertEquals("Settings", settingsDesc.label)
        assertEquals("SET", settingsDesc.shortCode)
    }

    @Test
    fun testZeroFloatingActionButtonsInSettingsAndPrivacyUi() {
        val settingsDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings")
        assertTrue(settingsDir.exists(), "Settings features directory must exist")

        val ktFiles = settingsDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV01 invariant: zero FABs permitted in settings and preferences panels"
            )
        }
    }

    @Test
    fun testZeroWebViewOrBrowserEngineInSettingsAndPrivacyUi() {
        val settingsDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings")
        val ktFiles = settingsDir.walk().filter { it.extension == "kt" }.toList()

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("android.webkit.WebView") || text.contains("WebKit"),
                "File ${file.name} violates B01/B02 invariant: zero WebView or browser engine permitted"
            )
        }
    }

    @Test
    fun testEphemeralMemoryOnlyCognitoState() {
        val privacy = PrivacyController()
        assertFalse(privacy.isMaskActive.value)
        assertNull(privacy.activationChord.value)

        // SharedPreferences store must not contain Cognito activation state
        val androidStoreClass = AndroidPreferencesStore::class.java
        val fieldNames = androidStoreClass.declaredFields.map { it.name }
        assertFalse(fieldNames.any { it.contains("COGNITO_ACTIVE", ignoreCase = true) })

        // WorkbenchPreferences must only store shortcut and style, never active state
        val prefProps = WorkbenchPreferences::class.java.declaredFields.map { it.name }
        assertTrue(prefProps.contains("cognitoModeShortcut"))
        assertTrue(prefProps.contains("cognitoModeStyle"))
        assertFalse(prefProps.contains("isCognitoActive") || prefProps.contains("cognitoActive"))
    }

    @Test
    fun testMaxConfigImportBytesCeiling() {
        assertEquals(1024L * 1024L, MAX_CONFIG_IMPORT_BYTES, "Config import ceiling must be exactly 1 MiB")
    }

    @Test
    fun testNotificationChannelsAndDeepLinkKeys() {
        assertEquals("channel_terminal_attention", NotificationChannelId.TERMINAL_ATTENTION.id)
        assertEquals("channel_transfers", NotificationChannelId.TRANSFERS.id)
        assertEquals("channel_idle_suspend", NotificationChannelId.IDLE_SUSPEND.id)

        assertEquals("dev.damhopper.target_profile_id", AndroidNotificationSink.EXTRA_TARGET_PROFILE_ID)
        assertEquals("dev.damhopper.target_generation", AndroidNotificationSink.EXTRA_TARGET_GENERATION)
        assertEquals("dev.damhopper.target_terminal_id", AndroidNotificationSink.EXTRA_TARGET_TERMINAL_ID)
        assertEquals("dev.damhopper.target_incarnation", AndroidNotificationSink.EXTRA_TARGET_INCARNATION)
    }

    @Test
    fun testLifecycleTransitions() {
        val lifecycle = LifecycleCoordinator()
        assertEquals(LifecycleState.INITIALIZED, lifecycle.state.value)

        lifecycle.onAppForeground()
        assertEquals(LifecycleState.FOREGROUND, lifecycle.state.value)

        lifecycle.onAppBackground()
        assertEquals(LifecycleState.BACKGROUND, lifecycle.state.value)

        lifecycle.onDestroy()
        assertEquals(LifecycleState.DESTROYED, lifecycle.state.value)
    }

    @Test
    fun testAndroidPreferencesStoreKeys() {
        assertEquals("damhopper_workbench_preferences", AndroidPreferencesStore.KEY_PREFERENCES)
        assertEquals("damhopper_settings_source_target", AndroidPreferencesStore.KEY_SOURCE_TARGET)
    }
}
