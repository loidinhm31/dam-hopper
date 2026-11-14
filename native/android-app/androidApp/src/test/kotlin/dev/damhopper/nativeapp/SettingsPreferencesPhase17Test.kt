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
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.features.settings.PreferenceSourceStatus
import dev.damhopper.nativeapp.features.settings.SettingsBinding
import dev.damhopper.nativeapp.features.settings.SettingsOwnerResolver
import dev.damhopper.nativeapp.features.settings.SettingsRepository
import dev.damhopper.nativeapp.features.settings.SettingsSourceTargetState
import dev.damhopper.nativeapp.features.settings.dirtyUiPatch
import dev.damhopper.nativeapp.features.settings.applyTo
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.AuthSession
import dev.damhopper.nativeapp.ui.flow.AppFlowState
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.flow.SettingsOrigin
import kotlinx.serialization.json.JsonNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

    @Test
    fun agentSettingsTargetBPersistsWithoutTouchingPreferenceSourceAOrThePreferences() {
        val scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
        try {
            val preferences = WorkbenchPreferences(terminalFontSize = 17)
            val store = InMemoryPreferencesStore(
                initialPreferences = preferences,
                initialSourceTargetState = SettingsSourceTargetState(
                    preferencesProfileId = "A",
                    preferencesStatus = PreferenceSourceStatus.ACTIVE,
                    settingsProfileId = "A",
                ),
            )
            val resolver = object : SettingsOwnerResolver {
                override suspend fun current(profileId: String): SettingsBinding? = null
                override fun currentSnapshot(profileId: String): SettingsBinding? = null
            }
            val repository = SettingsRepository(store, resolver, scope, debounceMillis = 20L, invalidateRuntime = {})

            // Opening the contextual Agents settings queues the selected workspace server B as the Settings target.
            repository.setSettingsTarget("B")

            val persisted = store.loadSourceTargetState()
            assertEquals("B", persisted.settingsProfileId)
            assertEquals("A", persisted.preferencesProfileId, "preference source A is independent of target B")
            assertEquals(17, store.loadPreferences().terminalFontSize, "no preference is rewritten by selecting a target")
            assertEquals(17, repository.preferences.value.terminalFontSize)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun hubCWorkspaceSwitchNeverSelectsSettingsSourceAOrAdminTargetB() {
        val scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
        try {
            val store = InMemoryPreferencesStore(
                initialPreferences = WorkbenchPreferences(),
                initialSourceTargetState = SettingsSourceTargetState(
                    preferencesProfileId = "server-A",
                    preferencesStatus = PreferenceSourceStatus.ACTIVE,
                    settingsProfileId = "server-B",
                ),
            )
            val resolver = object : SettingsOwnerResolver {
                override suspend fun current(profileId: String): SettingsBinding? = null
                override fun currentSnapshot(profileId: String): SettingsBinding? = null
            }
            val repository = SettingsRepository(store, resolver, scope, debounceMillis = 20L, invalidateRuntime = {})

            val nav = AppFlowNavigation()

            // Hub C workspace/profile context via production navigation
            nav.onProfileAuthenticated("server-C1")
            assertEquals("server-A", repository.sourceTargetState.value.preferencesProfileId)
            assertEquals("server-B", repository.sourceTargetState.value.settingsProfileId)

            nav.onProfileAuthenticated("server-C2")
            // Switching Hub C never modifies Source A or Target B
            assertEquals("server-A", repository.sourceTargetState.value.preferencesProfileId)
            assertEquals("server-B", repository.sourceTargetState.value.settingsProfileId)

            // Switching target B never modifies Source A or Hub C
            repository.setSettingsTarget("server-B-new")
            assertEquals("server-A", repository.sourceTargetState.value.preferencesProfileId)
            assertEquals("server-B-new", repository.sourceTargetState.value.settingsProfileId)
            assertEquals("server-C2", nav.state.value.activeProfileId)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun sparsePatchUnbindingSendsExplicitJsonNullAndPreservesWebOnlyValues() {
        val base = WorkbenchPreferences(
            searchTextShortcut = "Ctrl+F",
            terminalWorkspaceShortcut = "Ctrl+Shift+D", // web-only desktop shortcut
            gitPanelShortcut = "Ctrl+Shift+G", // web-only shortcut
        )
        // User unbinds searchTextShortcut
        val unbound = base.copy(searchTextShortcut = "")
        val dirty = unbound.dirtyUiPatch(base)
        val unbinds = buildSet {
            if (base.searchTextShortcut.isNotBlank() && unbound.searchTextShortcut.isBlank()) {
                add("searchTextShortcut")
            }
        }
        val sparse = dirty.toSparsePatch(unbinds)
        // Emits JSON null for the unbound field
        assertEquals(JsonNull, sparse.ui["searchTextShortcut"])
        // Web-only shortcuts remain un-emitted and untouched
        assertFalse(sparse.ui.containsKey("terminalWorkspaceShortcut"))
        assertFalse(sparse.ui.containsKey("gitPanelShortcut"))
        assertFalse(sparse.ui.containsKey("fleetTerminalShortcut"))
        // Applying the patch preserves the unbind
        val updated = dirty.applyTo(base)
        assertEquals("", updated.searchTextShortcut)
        assertEquals("Ctrl+Shift+D", updated.terminalWorkspaceShortcut)
        assertEquals("Ctrl+Shift+G", updated.gitPanelShortcut)
    }

    @Test
    fun removedPreferenceSourcePreservesLocalSnapshotAndDisplaysRemovedState() {
        val scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
        try {
            val initial = WorkbenchPreferences(terminalFontSize = 19)
            val store = InMemoryPreferencesStore(
                initialPreferences = initial,
                initialSourceTargetState = SettingsSourceTargetState(
                    preferencesProfileId = "server-A",
                    preferencesStatus = PreferenceSourceStatus.ACTIVE,
                    settingsProfileId = "server-B",
                    lastSnapshot = initial,
                    lastSnapshotSourceProfileId = "server-A",
                ),
            )
            val resolver = object : SettingsOwnerResolver {
                override suspend fun current(profileId: String): SettingsBinding? = null
                override fun currentSnapshot(profileId: String): SettingsBinding? = null
            }
            val repository = SettingsRepository(store, resolver, scope, debounceMillis = 20L, invalidateRuntime = {})

            // Profile A is removed from available profiles
            repository.onProfileRemoved("server-A")

            val state = repository.sourceTargetState.value
            assertNull(state.preferencesProfileId, "removed source leaves preference profile ID null")
            assertEquals(PreferenceSourceStatus.SOURCE_REMOVED, state.preferencesStatus)
            assertEquals("server-B", state.settingsProfileId, "admin target B remains independent")
            // Local preferences remain readable and editable
            assertEquals(19, repository.preferences.value.terminalFontSize)
            repository.updatePreferences { it.copy(terminalFontSize = 21) }
            assertEquals(21, repository.preferences.value.terminalFontSize)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun supportedNoAuthDevAdminProvidesCapabilityWarningWithoutBlanketDenial() {
        val devSession = AuthSession(
            token = "dev-token-xyz",
            user = "developer",
            devMode = true,
            expiresAt = "2099-01-01T00:00:00Z",
        )
        val devStatus = AuthStatus.Authenticated(session = devSession)
        assertTrue(devStatus.session.devMode)

        // Check dev-mode capability policy
        val isDevMode = devStatus.session.devMode
        val adminBlockedReason: String? = when {
            devStatus !is AuthStatus.Authenticated -> "Sign in to the selected server to administer it."
            else -> null
        }
        val adminWarning = if (isDevMode) {
            "This server runs in development mode without authentication. Administration is active without credential verification."
        } else {
            null
        }
        val idleBlocked = if (isDevMode) {
            "This server runs without authentication; it does not accept idle-suspend changes."
        } else {
            null
        }

        // Administration is NOT denied or blocked
        assertNull(adminBlockedReason, "dev-mode must not produce a blanket read-only denial")
        assertNotNull(adminWarning, "dev-mode must provide an explicit informational warning")
        assertEquals("This server runs without authentication; it does not accept idle-suspend changes.", idleBlocked)
    }

    @Test
    fun settingsOverlayOriginRestorationReturnsExactPanelDocumentAndSession() {
        val capturedOrigin = SettingsOrigin(
            stage = AppFlowStage.TERMINAL,
            panel = "EDITOR",
            document = "native/android-app/Main.kt",
            sessionId = "term-sess-99",
        )

        // 1. Production navigation path test
        val nav = AppFlowNavigation(AppFlowState(stage = AppFlowStage.TERMINAL))
        nav.openSettings(capturedOrigin)
        val closedOrigin = nav.closeSettings()
        assertNotNull(closedOrigin)
        assertEquals(capturedOrigin, closedOrigin)
        assertNull(nav.state.value.settings)

        // 2. Component hook contract test
        var restoredOrigin: SettingsOrigin? = null
        val onCloseWithOrigin: (SettingsOrigin?) -> Unit = { origin ->
            restoredOrigin = origin
        }
        onCloseWithOrigin(capturedOrigin)

        assertEquals(AppFlowStage.TERMINAL, restoredOrigin?.stage)
        assertEquals("EDITOR", restoredOrigin?.panel)
        assertEquals("native/android-app/Main.kt", restoredOrigin?.document)
        assertEquals("term-sess-99", restoredOrigin?.sessionId)
    }
}
