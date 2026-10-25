package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.notifications.AppNotification
import dev.damhopper.nativeapp.core.notifications.InMemoryNotificationSink
import dev.damhopper.nativeapp.core.notifications.MAX_SERVER_SAFE_INTEGER
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationTarget
import dev.damhopper.nativeapp.core.notifications.toServerSafeLongOrNull
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsModelsTest {

    private fun obj(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    private val legacyFilters = listOf("known", "code", "text")
    private val wireFilters = mapOf(
        "all" to ExplorerLanguageFilter.ALL,
        "rust" to ExplorerLanguageFilter.RUST,
        "javascript-typescript" to ExplorerLanguageFilter.JAVASCRIPT_TYPESCRIPT,
        "java" to ExplorerLanguageFilter.JAVA,
    )

    // ---- defaults, bounds, consent ----

    @Test
    fun defaultsMatchFrozenContractAndGrantNoConsent() {
        val prefs = WorkbenchPreferences()
        assertEquals(14, prefs.systemFontSize)
        assertEquals(14, prefs.editorFontSize)
        assertEquals(13, prefs.terminalFontSize)
        assertEquals(5, prefs.terminalScrollStep)
        assertTrue(prefs.terminalAutoSwitchProjectEnabled)
        assertEquals(ExplorerLanguageFilter.ALL, prefs.explorerLanguageFilter)
        assertTrue(prefs.mobileCustomKeyboardEnabled)
        assertEquals(11, prefs.mobileCustomKeyboardFontSize)
        assertEquals(6, prefs.mobileCustomKeyboardPadding)
        assertEquals(4, prefs.mobileCustomKeyboardRowGap)
        assertEquals("Mod+Shift+KeyF", prefs.searchTextShortcut)
        assertEquals("DoubleShift", prefs.searchFilenameShortcut)
        assertEquals("Mod+Shift+Backquote", prefs.terminalWorkspaceShortcut)
        assertEquals("Mod+Shift+KeyE", prefs.terminalFilePanelShortcut)
        assertEquals("Mod+Shift+KeyZ", prefs.projectPanelShortcut)
        assertEquals("Alt+F1", prefs.revealActiveFileShortcut)
        assertEquals("Mod+Shift+KeyG", prefs.gitPanelShortcut)
        assertEquals("Mod+Shift+KeyP", prefs.portsPanelShortcut)
        assertEquals("Mod+Shift+KeyM", prefs.fleetTerminalShortcut)
        assertEquals("Ctrl+Alt+Shift+Equal", prefs.terminalFontSizeIncreaseShortcut)
        assertEquals("Ctrl+Alt+Minus", prefs.terminalFontSizeDecreaseShortcut)
        assertEquals("Mod+Alt+KeyB", prefs.cognitoModeShortcut)
        // Fresh install: command-history consent off, every agent disabled, no OS post, no sound.
        assertFalse(prefs.commandHistoryEnabled)
        val policy = prefs.terminalAgentNotifications
        assertEquals(2, policy.version)
        listOf(policy.agents.omp, policy.agents.claude, policy.agents.codex).forEach {
            assertEquals(TerminalAgentPolicy(enabled = false, toast = true, browser = false, sound = false, volume = 0.5, pattern = "default"), it)
        }
    }

    @Test
    fun numericBoundsClampAtExactEdges() {
        fun clamp(block: WorkbenchPreferences.() -> WorkbenchPreferences) = WorkbenchPreferences().block().clamped()
        assertEquals(1, clamp { copy(terminalScrollStep = 0) }.terminalScrollStep)
        assertEquals(1, clamp { copy(terminalScrollStep = 1) }.terminalScrollStep)
        assertEquals(20, clamp { copy(terminalScrollStep = 20) }.terminalScrollStep) // existing values preserved
        assertEquals(50, clamp { copy(terminalScrollStep = 50) }.terminalScrollStep)
        assertEquals(50, clamp { copy(terminalScrollStep = 51) }.terminalScrollStep)
        assertEquals(10, clamp { copy(systemFontSize = 9) }.systemFontSize)
        assertEquals(32, clamp { copy(editorFontSize = 33) }.editorFontSize)
        assertEquals(9, clamp { copy(mobileCustomKeyboardFontSize = 8) }.mobileCustomKeyboardFontSize)
        assertEquals(18, clamp { copy(mobileCustomKeyboardFontSize = 19) }.mobileCustomKeyboardFontSize)
        assertEquals(2, clamp { copy(mobileCustomKeyboardPadding = 1) }.mobileCustomKeyboardPadding)
        assertEquals(14, clamp { copy(mobileCustomKeyboardPadding = 15) }.mobileCustomKeyboardPadding)
        assertEquals(2, clamp { copy(mobileCustomKeyboardRowGap = 1) }.mobileCustomKeyboardRowGap)
        assertEquals(12, clamp { copy(mobileCustomKeyboardRowGap = 13) }.mobileCustomKeyboardRowGap)
    }

    @Test
    fun localOnlyPreferencesNeverEnterSharedProjectionOrPatches() {
        val prefs = WorkbenchPreferences(
            theme = WorkbenchTheme.LIGHT,
            soundEnabled = false,
            hapticFeedbackEnabled = false,
            statusFilter = "idle",
            commandHistoryEnabled = true,
        )
        val shared = prefs.sharedProjection()
        assertFalse(shared.commandHistoryEnabled)
        assertEquals(WorkbenchTheme.DARK, shared.theme)
        assertEquals("", shared.statusFilter)
        // Local-only changes are never dirty remote fields.
        assertTrue(prefs.dirtyUiPatch(WorkbenchPreferences()).isEmpty())
        assertTrue(prefs.toUiPreferences().toPatchObject().keys.none { it == "commandHistoryEnabled" || it == "theme" })
    }

    // ---- remote policy codec ----

    @Test
    fun supportedV2PolicyDecodesAndRoundTripsWithIntegerWireVolume() {
        val raw = obj(
            """{"version":2,"agents":{
                "omp":{"enabled":true,"toast":false,"browser":true,"sound":true,"volume":25,"pattern":"urgent"},
                "claude":{"enabled":false,"toast":true,"browser":false,"sound":false,"volume":100,"pattern":"two-tone"},
                "codex":{}}}""",
        )
        val decoded = assertIs<RemoteAgentPolicy.Supported>(decodeRemoteAgentPolicy(raw))
        assertEquals(TerminalAgentPolicy(true, false, true, true, 0.25, "urgent"), decoded.policy.agents.omp)
        assertEquals(TerminalAgentPolicy(false, true, false, false, 1.0, "two-tone"), decoded.policy.agents.claude)
        assertEquals(TerminalAgentPolicy(), decoded.policy.agents.codex) // absent fields => safe local defaults

        val wire = decoded.policy.toWireJson()
        assertEquals(25, wire.getValue("agents").jsonObject.getValue("omp").jsonObject.getValue("volume").toString().toInt())
        val reDecoded = assertIs<RemoteAgentPolicy.Supported>(decodeRemoteAgentPolicy(wire))
        assertEquals(decoded.policy, reDecoded.policy)
    }

    @Test
    fun absentPolicyYieldsSafeDefaultsAndUnsupportedVersionIsPreservedExactly() {
        assertEquals(RemoteAgentPolicy.Absent, decodeRemoteAgentPolicy(null))
        val absentHydrated = UiPreferences(terminalFontSize = 20).applyTo(
            WorkbenchPreferences(
                terminalAgentNotifications = TerminalAgentNotifications(
                    agents = AgentPolicies(omp = TerminalAgentPolicy(enabled = true)),
                ),
            ),
        )
        assertEquals(TerminalAgentNotifications(), absentHydrated.terminalAgentNotifications)

        val future = obj("""{"version":3,"agents":{"omp":{"enabled":true,"browser":true,"sound":true}},"extra":[1,2]}""")
        val unsupported = assertIs<RemoteAgentPolicy.Unsupported>(decodeRemoteAgentPolicy(future))
        assertEquals(future, unsupported.raw) // exact object retained
        val hydrated = UiPreferences(terminalAgentNotifications = future).applyTo(WorkbenchPreferences())
        assertFalse(hydrated.terminalAgentNotifications.agents.omp.enabled) // never rendered as enabled
    }

    @Test
    fun invalidV2PolicyIsUnsupportedNotSilentlyNormalized() {
        val invalid = listOf(
            """{"version":"2","agents":{}}""",
            """{"version":2,"agents":{"omp":{"volume":101}}}""",
            """{"version":2,"agents":{"omp":{"volume":-1}}}""",
            """{"version":2,"agents":{"omp":{"volume":50.5}}}""",
            """{"version":2,"agents":{"omp":{"volume":"50"}}}""",
            """{"version":2,"agents":{"omp":{"pattern":"loud"}}}""",
            """{"version":2,"agents":{"omp":{"enabled":"true"}}}""",
            """{"version":2,"agents":{"omp":{"enabled":null}}}""",
            """{"version":2,"agents":{"omp":{"mystery":1}}}""",
            """{"version":2,"agents":{"antigravity":{}}}""",
            """{"version":2,"agents":[]}""",
            """{"version":2,"other":1}""",
            """{"agents":{}}""",
        )
        invalid.forEach { json ->
            assertIs<RemoteAgentPolicy.Unsupported>(decodeRemoteAgentPolicy(obj(json)), json)
        }
        // Boundary volumes are valid.
        assertIs<RemoteAgentPolicy.Supported>(decodeRemoteAgentPolicy(obj("""{"version":2,"agents":{"omp":{"volume":0}}}""")))
        assertIs<RemoteAgentPolicy.Supported>(decodeRemoteAgentPolicy(obj("""{"version":2,"agents":{"omp":{"volume":100}}}""")))
    }

    // ---- dirty projection ----

    @Test
    fun dirtyProjectionContainsOnlyChangedSupportedFields() {
        val base = WorkbenchPreferences()
        assertTrue(base.dirtyUiPatch(base).isEmpty())

        val edited = base.copy(terminalFontSize = 15, terminalScrollStep = 40)
        val patch = edited.dirtyUiPatch(base)
        assertEquals(UiPreferences(terminalFontSize = 15, terminalScrollStep = 40), patch)
        assertEquals("""{"ui":{"terminalFontSize":15,"terminalScrollStep":40}}""", patch.toUiRequestBody())

        val shortcutEdit = base.copy(searchFilenameShortcut = "Mod+KeyP", mobileCustomKeyboardEnabled = false)
        assertEquals(
            setOf("searchFilenameShortcut", "mobileCustomKeyboardEnabled"),
            shortcutEdit.dirtyUiPatch(base).toPatchObject().keys,
        )
    }

    @Test
    fun policyIsOmittedFromUnrelatedSavesAndIncludedOnlyOnExplicitEdit() {
        val base = WorkbenchPreferences()
        val edited = base.copy(
            terminalFontSize = 16,
            terminalAgentNotifications = TerminalAgentNotifications(
                agents = AgentPolicies(omp = TerminalAgentPolicy(true, true, true, true, 0.25, "urgent")),
            ),
        )
        assertNull(edited.dirtyUiPatch(base).terminalAgentNotifications)
        assertNull(edited.dirtyUiPatch(base).toPatchObject()["terminalAgentNotifications"])

        val explicit = edited.dirtyUiPatch(base, includePolicy = true)
        val expectedAgent = """{"enabled":false,"toast":true,"browser":false,"sound":false,"volume":50,"pattern":"default"}"""
        assertEquals(
            obj(
                """{"version":2,"agents":{
                    "omp":{"enabled":true,"toast":true,"browser":true,"sound":true,"volume":25,"pattern":"urgent"},
                    "claude":$expectedAgent,"codex":$expectedAgent}}""",
            ),
            explicit.terminalAgentNotifications,
        )
        // Policy-only change without includePolicy is not a patch at all.
        assertTrue(base.copy(terminalAgentNotifications = edited.terminalAgentNotifications).dirtyUiPatch(base).isEmpty())
    }

    // ---- language filter: wire values and legacy fallback ----

    @Test
    fun allFourWireLanguageValuesDecodeHydrateAndSave() {
        wireFilters.forEach { (wire, filter) ->
            assertEquals(wire, filter.wire)
            assertEquals(filter, ExplorerLanguageFilter.fromWireOrNull(wire))
            // remote JSON -> UiPreferences -> hydrate
            val ui = ProtocolJson.decodeFromString(UiPreferences.serializer(), """{"explorerLanguageFilter":"$wire"}""")
            val hydrationBase = WorkbenchPreferences(
                explorerLanguageFilter = if (filter == ExplorerLanguageFilter.RUST) ExplorerLanguageFilter.JAVA else ExplorerLanguageFilter.RUST,
            )
            assertEquals(filter, ui.applyTo(hydrationBase).explorerLanguageFilter)
            // local persistence uses the exact wire name
            val stored = encodeNativePreferences(NativePreferencesEnvelope(preferences = WorkbenchPreferences(explorerLanguageFilter = filter)))
            assertTrue(stored.contains(""""explorerLanguageFilter":"$wire""""), stored)
            assertEquals(filter, decodeNativePreferences(stored).getOrThrow().preferences.explorerLanguageFilter)
            // explicit selection is saved as that wire value
            val base = WorkbenchPreferences(explorerLanguageFilter = if (filter == ExplorerLanguageFilter.ALL) ExplorerLanguageFilter.RUST else ExplorerLanguageFilter.ALL)
            assertEquals(wire, WorkbenchPreferences(explorerLanguageFilter = filter).dirtyUiPatch(base).explorerLanguageFilter)
        }
        assertNull(ExplorerLanguageFilter.fromWireOrNull("python"))
        // Unknown future remote value never breaks decode; it hydrates as local ALL.
        val future = ProtocolJson.decodeFromString(UiPreferences.serializer(), """{"explorerLanguageFilter":"python"}""")
        assertEquals(
            ExplorerLanguageFilter.ALL,
            future.applyTo(WorkbenchPreferences(explorerLanguageFilter = ExplorerLanguageFilter.RUST)).explorerLanguageFilter,
        )
    }

    @Test
    fun threeLegacyLanguageValuesFallBackToNonDirtyLocalAll() {
        legacyFilters.forEach { legacy ->
            val envelope = decodeNativePreferences("""{"terminalFontSize":16,"explorerLanguageFilter":"$legacy"}""").getOrThrow()
            assertEquals(ExplorerLanguageFilter.ALL, envelope.preferences.explorerLanguageFilter)
            assertEquals(legacy, envelope.legacyExplorerLanguageFilter) // recoverable metadata, explicitly non-equivalent
            assertEquals(16, envelope.preferences.terminalFontSize)

            val remoteBase = WorkbenchPreferences(explorerLanguageFilter = ExplorerLanguageFilter.RUST)
            // Fallback active: never dirty, unrelated saves omit the field.
            val unrelated = envelope.preferences.copy(terminalFontSize = 17)
            assertNull(unrelated.dirtyUiPatch(remoteBase, languageFilter = LanguageFilterWrite.OMIT).explorerLanguageFilter)
            assertNull(unrelated.dirtyUiPatch(WorkbenchPreferences(), languageFilter = LanguageFilterWrite.IF_CHANGED).explorerLanguageFilter)
            // Only an explicit user selection writes a real wire value ...
            assertEquals("all", envelope.preferences.dirtyUiPatch(remoteBase, languageFilter = LanguageFilterWrite.ALWAYS).explorerLanguageFilter)
            // ... even against a fallback-derived ALL base where value equality alone would drop it.
            assertEquals(
                "all",
                envelope.preferences.dirtyUiPatch(WorkbenchPreferences(), languageFilter = LanguageFilterWrite.ALWAYS).explorerLanguageFilter,
            )

            // The legacy marker survives a save/load cycle.
            val reloaded = decodeNativePreferences(encodeNativePreferences(envelope)).getOrThrow()
            assertEquals(legacy, reloaded.legacyExplorerLanguageFilter)
        }
    }

    @Test
    fun absentAndCorruptLanguageDataAreDistinguished() {
        val absent = decodeNativePreferences("""{"terminalFontSize":15}""").getOrThrow()
        assertEquals(ExplorerLanguageFilter.ALL, absent.preferences.explorerLanguageFilter)
        assertNull(absent.legacyExplorerLanguageFilter)

        assertTrue(decodeNativePreferences("""{"explorerLanguageFilter":"bogus"}""").isFailure)
        assertTrue(decodeNativePreferences("""{"explorerLanguageFilter":"RUST"}""").isFailure)
        assertTrue(decodeNativePreferences("""{"explorerLanguageFilter":7}""").isFailure)
        assertTrue(decodeNativePreferences("""{"explorerLanguageFilter":{}}""").isFailure)
    }

    // ---- persistence envelope and consent migration ----

    @Test
    fun envelopeRoundTripsAllFields() {
        val envelope = NativePreferencesEnvelope(
            preferences = WorkbenchPreferences(
                theme = WorkbenchTheme.HIGH_CONTRAST,
                terminalScrollStep = 50,
                commandHistoryEnabled = true,
                mobileCustomKeyboardRowGap = 12,
                searchFilenameShortcut = "DoubleShift",
                terminalAgentNotifications = TerminalAgentNotifications(
                    agents = AgentPolicies(codex = TerminalAgentPolicy(enabled = true, volume = 1.0, pattern = "soft")),
                ),
            ),
            legacyExplorerLanguageFilter = "known",
        )
        assertEquals(envelope, decodeNativePreferences(encodeNativePreferences(envelope)).getOrThrow())
    }

    @Test
    fun legacyMasterFalseNeverBecomesEnabledAndFlagsArePreserved() {
        val disabledMaster = decodeNativePreferences(
            """{"terminalAgentNotifications":{"masterEnabled":false,
                "omp":{"enabled":true,"toast":false,"sound":true,"browser":true},
                "claude":{"enabled":true},"codex":{"enabled":true}}}""",
        ).getOrThrow().preferences.terminalAgentNotifications
        assertEquals(2, disabledMaster.version)
        assertEquals(TerminalAgentPolicy(enabled = false, toast = false, browser = true, sound = true, volume = 0.5, pattern = "default"), disabledMaster.agents.omp)
        assertFalse(disabledMaster.agents.claude.enabled)
        assertFalse(disabledMaster.agents.codex.enabled)

        val enabledMaster = decodeNativePreferences(
            """{"terminalAgentNotifications":{"masterEnabled":true,
                "omp":{"enabled":true,"toast":false,"sound":true,"browser":true},
                "claude":{"enabled":false,"toast":true,"sound":false,"browser":false}}}""",
        ).getOrThrow().preferences.terminalAgentNotifications
        assertEquals(TerminalAgentPolicy(enabled = true, toast = false, browser = true, sound = true, volume = 0.5, pattern = "default"), enabledMaster.agents.omp)
        assertFalse(enabledMaster.agents.claude.enabled)
        assertEquals(TerminalAgentPolicy(), enabledMaster.agents.codex) // absent legacy agent => disabled defaults

        // Fresh/legacy-disabled install gains no consent from migration.
        val untouched = decodeNativePreferences("""{"terminalFontSize":14}""").getOrThrow().preferences
        assertEquals(TerminalAgentNotifications(), untouched.terminalAgentNotifications)
        assertFalse(untouched.commandHistoryEnabled)

        // Malformed stored data fails even where master=false would have hidden the flag.
        assertTrue(
            decodeNativePreferences("""{"terminalAgentNotifications":{"masterEnabled":false,"omp":{"enabled":"yes"}}}""").isFailure,
        )
        assertTrue(
            decodeNativePreferences("""{"terminalAgentNotifications":{"masterEnabled":false,"omp":{"enabled":null}}}""").isFailure,
        )
    }

    @Test
    fun corruptOrUnknownStoredBytesFailInsteadOfResetting() {
        assertTrue(decodeNativePreferences("not json").isFailure)
        assertTrue(decodeNativePreferences("[]").isFailure)
        assertTrue(decodeNativePreferences("""{"terminalFontSize":"big"}""").isFailure)
        assertTrue(decodeNativePreferences("""{"nativeVersion":3,"preferences":{}}""").isFailure)
        assertTrue(decodeNativePreferences("""{"nativeVersion":"2","preferences":{}}""").isFailure)
        assertTrue(decodeNativePreferences("""{"nativeVersion":2}""").isFailure)
        assertTrue(decodeNativePreferences("""{"terminalAgentNotifications":{"masterEnabled":"yes"}}""").isFailure)
        assertTrue(decodeNativePreferences("""{"terminalAgentNotifications":[]}""").isFailure)
        // Typed policy with unsupported version/volume/pattern is never silently normalized.
        assertTrue(decodeNativePreferences("""{"nativeVersion":2,"preferences":{"terminalAgentNotifications":{"version":3}}}""").isFailure)
        assertTrue(
            decodeNativePreferences(
                """{"nativeVersion":2,"preferences":{"terminalAgentNotifications":{"version":2,"agents":{"omp":{"volume":2.0}}}}}""",
            ).isFailure,
        )
        assertTrue(
            decodeNativePreferences(
                """{"nativeVersion":2,"preferences":{"terminalAgentNotifications":{"version":2,"agents":{"omp":{"pattern":"x"}}}}}""",
            ).isFailure,
        )
        // Valid v2 envelope with existing values keeps them (including pre-existing 1..20 scroll steps).
        val v2 = decodeNativePreferences("""{"nativeVersion":2,"preferences":{"terminalScrollStep":20}}""").getOrThrow()
        assertEquals(20, v2.preferences.terminalScrollStep)
    }

    @Test
    fun sourceSnapshotMigrationKeepsSharedProjectionRawPolicyAndLegacyFilter() {
        val migrated = migrateSourceSnapshot(
            """{"preferencesProfileId":"a","preferencesStatus":"active","settingsProfileId":"b",
                "lastSnapshot":{"theme":"light","commandHistoryEnabled":true,"explorerLanguageFilter":"code","terminalFontSize":20,
                    "terminalAgentNotifications":{"masterEnabled":true,"omp":{"enabled":true}}},
                "lastSnapshotPolicy":{"version":3,"agents":{}},"lastSnapshotSourceProfileId":"a"}""",
        ).getOrThrow()
        assertEquals("a", migrated.preferencesProfileId)
        assertEquals(PreferenceSourceStatus.ACTIVE, migrated.preferencesStatus)
        assertEquals("b", migrated.settingsProfileId)
        val snapshot = assertNotNull(migrated.lastSnapshot)
        assertEquals(20, snapshot.terminalFontSize)
        assertEquals(ExplorerLanguageFilter.ALL, snapshot.explorerLanguageFilter)
        assertEquals("code", migrated.lastSnapshotLegacyLanguageFilter)
        // Local consent/theme never ride along in a source snapshot.
        assertFalse(snapshot.commandHistoryEnabled)
        assertEquals(WorkbenchTheme.DARK, snapshot.theme)
        assertTrue(snapshot.terminalAgentNotifications.agents.omp.enabled) // legacy master=true migrated
        // Unknown remote policy stored raw with its source id, never normalized.
        assertEquals(obj("""{"version":3,"agents":{}}"""), migrated.lastSnapshotPolicy)
        assertEquals("a", migrated.lastSnapshotSourceProfileId)

        assertEquals(migrated, migrateSourceSnapshot(encodeSourceTargetState(migrated)).getOrThrow())

        val bare = migrateSourceSnapshot("""{"preferencesProfileId":"p"}""").getOrThrow()
        assertNull(bare.lastSnapshot)
        assertEquals(PreferenceSourceStatus.UNSET, bare.preferencesStatus)

        assertTrue(migrateSourceSnapshot("""{"preferencesStatus":"mystery"}""").isFailure)
        assertTrue(migrateSourceSnapshot("""{"lastSnapshot":[]}""").isFailure)
        assertTrue(migrateSourceSnapshot("""{"lastSnapshot":{"explorerLanguageFilter":"bogus"}}""").isFailure)
        assertTrue(migrateSourceSnapshot("oops").isFailure)
    }

    // ---- UiPreferences hydration ----

    @Test
    fun hydrationClampsNumbersAndKeepsBaseForInvalidShortcuts() {
        val base = WorkbenchPreferences()
        val hydrated = UiPreferences(
            terminalScrollStep = 999,
            mobileCustomKeyboardFontSize = 100,
            mobileCustomKeyboardPadding = 0,
            mobileCustomKeyboardRowGap = 99,
            systemFontSize = 1,
            searchTextShortcut = "Ctrl+",
            cognitoModeShortcut = "DoubleShift",
            gitPanelShortcut = "Ctrl+Alt+KeyH",
            revealActiveFileShortcut = "Alt+F13", // well-formed but unavailable on Android: preserved
        ).applyTo(base)
        assertEquals(50, hydrated.terminalScrollStep)
        assertEquals(18, hydrated.mobileCustomKeyboardFontSize)
        assertEquals(2, hydrated.mobileCustomKeyboardPadding)
        assertEquals(12, hydrated.mobileCustomKeyboardRowGap)
        assertEquals(10, hydrated.systemFontSize)
        assertEquals(base.searchTextShortcut, hydrated.searchTextShortcut)
        assertEquals(base.cognitoModeShortcut, hydrated.cognitoModeShortcut)
        assertEquals("Ctrl+Alt+KeyH", hydrated.gitPanelShortcut)
        assertEquals("Alt+F13", hydrated.revealActiveFileShortcut)
        // Absent fields keep base; local-only fields are never touched.
        assertEquals(base.terminalFontSize, hydrated.terminalFontSize)
        assertEquals(base.commandHistoryEnabled, hydrated.commandHistoryEnabled)
    }

    @Test
    fun supportedRemotePolicyHydratesTypedPolicy() {
        val hydrated = UiPreferences(
            terminalAgentNotifications = obj("""{"version":2,"agents":{"omp":{"enabled":true,"volume":100}}}"""),
        ).applyTo(WorkbenchPreferences())
        assertEquals(TerminalAgentPolicy(enabled = true, volume = 1.0), hydrated.terminalAgentNotifications.agents.omp)
        assertNull(WorkbenchPreferences().toUiPreferences().terminalAgentNotifications)
        assertNotNull(WorkbenchPreferences().toUiPreferences(includePolicy = true).terminalAgentNotifications)
    }

    // ---- import response ----

    @Test
    fun importResponseConfirmsOnlyValidImportedTrue() {
        val ok = assertIs<SettingsImportDecode.Imported>(
            decodeSettingsImportResponse("""{"imported":true,"fileName":"workspace.toml","backupFileName":"workspace.toml.bak-1"}"""),
        )
        assertEquals(SettingsImportResult(true, "workspace.toml", "workspace.toml.bak-1", null), ok.result)

        val named = assertIs<SettingsImportDecode.Imported>(
            decodeSettingsImportResponse(
                """{"imported":true,"fileName":"w.toml","backupFileName":"b","workspaceName":"Main","extra":1}""",
            ),
        )
        assertEquals("Main", named.result.workspaceName)
        val nullName = assertIs<SettingsImportDecode.Imported>(
            decodeSettingsImportResponse("""{"imported":true,"fileName":"w","backupFileName":"b","workspaceName":null}"""),
        )
        assertNull(nullName.result.workspaceName)

        assertEquals(SettingsImportDecode.NotImported, decodeSettingsImportResponse("""{"imported":false}"""))
        assertEquals(
            SettingsImportDecode.NotImported,
            decodeSettingsImportResponse("""{"imported":false,"fileName":"w","backupFileName":"b"}"""),
        )
    }

    @Test
    fun malformedOrObsoleteImportResponsesNeverConfirm() {
        listOf(
            "",
            "not json",
            "[]",
            "null",
            """{}""",
            """{"ok":true,"imported":true,"backupFileName":"b"}""", // missing fileName
            """{"ok":true,"backupFileName":"b"}""", // obsolete ok discriminator without imported
            """{"ok":true,"fileName":"w","backupFileName":"b"}""",
            """{"imported":"true","fileName":"w","backupFileName":"b"}""",
            """{"imported":1,"fileName":"w","backupFileName":"b"}""",
            """{"imported":null,"fileName":"w","backupFileName":"b"}""",
            """{"imported":true,"backupFileName":"b"}""",
            """{"imported":true,"fileName":"w"}""",
            """{"imported":true,"fileName":"w","backupFileName":" "}""",
            """{"imported":true,"fileName":"","backupFileName":"b"}""",
            """{"imported":true,"fileName":5,"backupFileName":"b"}""",
            """{"imported":true,"fileName":"w","backupFileName":"b","workspaceName":5}""",
        ).forEach { body ->
            assertIs<SettingsImportDecode.Malformed>(decodeSettingsImportResponse(body), "should not confirm: $body")
        }
    }

    // ---- safe integers and notification identity ----

    @Test
    fun safeIntegersAcceptMaxAndRejectPlusOneAndULongMax() {
        assertEquals(0L, 0UL.toServerSafeLongOrNull())
        assertEquals(9_007_199_254_740_991L, 9_007_199_254_740_991UL.toServerSafeLongOrNull())
        assertEquals(MAX_SERVER_SAFE_INTEGER, 9_007_199_254_740_991UL.toServerSafeLongOrNull())
        assertNull(9_007_199_254_740_992UL.toServerSafeLongOrNull())
        assertNull(ULong.MAX_VALUE.toServerSafeLongOrNull())
        assertNull((Long.MAX_VALUE.toULong() + 1UL).toServerSafeLongOrNull())

        val max = NotificationTarget("p", 1L, serverEpoch = MAX_SERVER_SAFE_INTEGER, incarnation = MAX_SERVER_SAFE_INTEGER, attentionRevision = MAX_SERVER_SAFE_INTEGER)
        assertEquals(MAX_SERVER_SAFE_INTEGER, max.attentionRevision)
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", 1L, serverEpoch = MAX_SERVER_SAFE_INTEGER + 1) }
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", 1L, incarnation = -1L) }
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", 1L, attentionRevision = Long.MAX_VALUE) }
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", -1L) }
        // Deserialization (e.g. Intent extras) rejects out-of-range counters too.
        assertFailsWith<IllegalArgumentException> {
            Json.decodeFromString(NotificationTarget.serializer(), """{"profileId":"p","generation":1,"serverEpoch":9007199254740992}""")
        }
        val terminal = NotificationTarget("p", 2L, processInstanceId = "proc", endpoint = "https://h", accountId = "a", project = "pr", worktreePath = "/w", agentSessionId = "s", agentKind = "omp")
        assertEquals("proc", terminal.processInstanceId)
        assertNull(NotificationTarget("p", 2L).terminalId) // generic targets stay non-terminal
    }

    @Test
    fun notificationIdentityIsAStringKey() {
        val sink = InMemoryNotificationSink()
        val target = NotificationTarget("p", 1L)
        fun note(key: String) = AppNotification(key, NotificationChannelId.TERMINAL_ATTENTION, target, "t", "b")
        sink.postNotification(note("k1"))
        sink.postNotification(note("k2"))
        assertTrue(note("k1").silent.not())
        assertEquals("DamHopper", note("k1").publicTitle)
        sink.cancelNotification("k1")
        assertEquals(listOf("k2"), sink.getActiveNotifications().map { it.key })
        assertFailsWith<IllegalArgumentException> { note(" ") }
        sink.cancelNotificationsForProfile("p")
        assertTrue(sink.getActiveNotifications().isEmpty())
    }

    // ---- hardware shortcut grammar ----

    @Test
    fun grammarParsesFormatsAndMapsModifiers() {
        assertEquals("Mod+Shift+KeyF", ShortcutGrammar.format("mod+shift+f"))
        assertEquals("Ctrl+Shift+KeyQ", ShortcutGrammar.format("ctrl+shift+keyq"))
        assertEquals("Alt+Digit7", ShortcutGrammar.format("alt+digit7"))
        assertEquals("Alt+F1", ShortcutGrammar.format("alt+f1"))
        assertEquals("Cmd+Shift+Backquote", ShortcutGrammar.format("command+shift+backquote"))
        assertEquals("Mod+Wheel", ShortcutGrammar.format("mod+wheel"))
        assertEquals("DoubleShift", ShortcutGrammar.format("doubleshift"))

        val mod = assertNotNull(ShortcutGrammar.parse("Mod+Shift+KeyF"))
        assertTrue(mod.effectiveCtrl && !mod.effectiveMeta)
        val ctrlMod = assertNotNull(ShortcutGrammar.parse("Ctrl+Mod+KeyA"))
        assertTrue(ctrlMod.effectiveCtrl) // effective Ctrl+Mod collision equals Ctrl
        val cmd = assertNotNull(ShortcutGrammar.parse("Cmd+KeyA"))
        assertTrue(cmd.effectiveMeta && !cmd.effectiveCtrl)
        assertEquals(ShortcutKind.DOUBLE_SHIFT, ShortcutGrammar.parse("DoubleShift")?.kind)
        assertEquals(ShortcutKind.WHEEL, ShortcutGrammar.parse("Mod+Wheel")?.kind)

        assertTrue(ShortcutGrammar.matches(mod, "KeyF", ctrl = true, meta = false, alt = false, shift = true))
        assertFalse(ShortcutGrammar.matches(mod, "KeyF", ctrl = true, meta = false, alt = true, shift = true))
        assertFalse(ShortcutGrammar.matches(mod, "KeyF", ctrl = true, meta = true, alt = false, shift = true))
        assertFalse(ShortcutGrammar.matches(mod, "KeyG", ctrl = true, meta = false, alt = false, shift = true))
        assertFalse(ShortcutGrammar.matches(cmd, "KeyA", ctrl = true, meta = true, alt = false, shift = false))
    }

    @Test
    fun grammarValidityDoubleShiftAndAndroidAvailability() {
        assertNull(ShortcutGrammar.parse(""))
        assertNull(ShortcutGrammar.parse("Ctrl+Shift")) // modifier-only invalid
        assertNull(ShortcutGrammar.parse("KeyA+KeyB"))
        assertFalse(ShortcutGrammar.isValidBinding("Ctrl+Shift", allowDoubleShift = true))
        assertFalse(ShortcutGrammar.isValidBinding("ShiftLeft", allowDoubleShift = true))
        assertFalse(ShortcutGrammar.isValidBinding("Mod+Wheel", allowDoubleShift = true))
        assertTrue(ShortcutGrammar.isValidBinding("DoubleShift", allowDoubleShift = true))
        assertFalse(ShortcutGrammar.isValidBinding("DoubleShift", allowDoubleShift = false)) // Cognito: chord only
        assertTrue(ShortcutGrammar.isValidBinding("Mod+Alt+KeyB", allowDoubleShift = false))

        listOf("KeyA", "KeyZ", "Digit0", "Digit9", "F1", "F12", "Backquote", "Equal", "Minus", "BracketLeft", "Backslash",
            "Semicolon", "Quote", "Comma", "Period", "Slash", "Space", "Enter", "Escape", "Tab", "Backspace", "Delete", "Insert",
            "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowRight", "Numpad5", "NumpadEnter").forEach {
            assertTrue(ShortcutGrammar.isAndroidDispatchable(it), it)
        }
        listOf("F13", "F24", "CapsLock", "PrintScreen", "Pause", "NumLock", "KeyAA", "Foo").forEach {
            assertFalse(ShortcutGrammar.isAndroidDispatchable(it), it)
        }
        // Well-formed imports without an Android event stay preserved (valid) but unavailable.
        assertTrue(ShortcutGrammar.isKnownDomCode("F24"))
        assertTrue(ShortcutGrammar.isValidBinding("Alt+F24", allowDoubleShift = true))
        // Invented numpad codes are not Android-dispatchable (only the real DOM numpad codes are).
        assertFalse(ShortcutGrammar.isAndroidDispatchable("NumpadWhatever"))
        assertTrue(ShortcutGrammar.isKnownDomCode("NumpadWhatever")) // web isUsableKeyCode parity

        // Cognito: keyboard chord with a usable DOM code only (stricter than the generic binding check).
        assertTrue(ShortcutGrammar.isValidCognitoBinding("Mod+Alt+KeyB"))
        assertTrue(ShortcutGrammar.isValidCognitoBinding("Ctrl+Alt+P"))
        assertTrue(ShortcutGrammar.isValidCognitoBinding("Alt+F24")) // valid but unavailable stays preserved
        assertFalse(ShortcutGrammar.isValidCognitoBinding("DoubleShift"))
        assertFalse(ShortcutGrammar.isValidCognitoBinding("Mod+Wheel"))
        assertFalse(ShortcutGrammar.isValidCognitoBinding("Mod+Alt+Foo"))
        assertTrue(ShortcutGrammar.isValidBinding("Mod+Alt+Foo", allowDoubleShift = true)) // generic web validate is looser
        assertEquals(
            ShortcutDefaults.COGNITO_MODE,
            WorkbenchPreferences(cognitoModeShortcut = "Mod+Alt+Foo").clamped().cognitoModeShortcut,
        )
        assertEquals(
            WorkbenchPreferences().cognitoModeShortcut,
            UiPreferences(cognitoModeShortcut = "Mod+Alt+Foo").applyTo(WorkbenchPreferences()).cognitoModeShortcut,
        )
    }

    @Test
    fun clampedPreservesValidBindingsAndRestoresWebDefaultsForInvalidOnes() {
        val prefs = WorkbenchPreferences(
            cognitoModeShortcut = "DoubleShift",
            searchTextShortcut = "Mod+Wheel",
            gitPanelShortcut = "Ctrl+Shift",
            projectPanelShortcut = "Alt+F13",
            portsPanelShortcut = "Ctrl+Alt+P", // pre-v2 native default style: parseable, preserved verbatim
        ).clamped()
        assertEquals(ShortcutDefaults.COGNITO_MODE, prefs.cognitoModeShortcut)
        assertEquals(ShortcutDefaults.SEARCH_TEXT, prefs.searchTextShortcut)
        assertEquals(ShortcutDefaults.GIT_PANEL, prefs.gitPanelShortcut)
        assertEquals("Alt+F13", prefs.projectPanelShortcut)
        assertEquals("Ctrl+Alt+P", prefs.portsPanelShortcut)
        assertEquals("DoubleShift", WorkbenchPreferences(searchFilenameShortcut = "DoubleShift").clamped().searchFilenameShortcut)
    }

    // ---- DoubleShift 450ms grammar ----

    private fun DoubleShiftDetector.down(
        t: Long,
        repeat: Boolean = false,
        composing: Boolean = false,
        ctrl: Boolean = false,
        alt: Boolean = false,
        meta: Boolean = false,
    ) = onShiftDown(t, repeat, composing, ctrl, alt, meta)

    @Test
    fun doubleShiftBoundary449And450MatchAnd451ArmsNewTap() {
        assertEquals(450L, DOUBLE_SHIFT_MAX_INTERVAL_MS)
        listOf(0L, 1L, 449L, 450L).forEach { gap ->
            val d = DoubleShiftDetector()
            assertFalse(d.down(1_000))
            assertFalse(d.onShiftUp())
            assertTrue(d.down(1_000 + gap), "gap $gap must match")
        }
        val d = DoubleShiftDetector()
        assertFalse(d.down(1_000))
        d.onShiftUp()
        assertFalse(d.down(1_451), "451ms is outside the window and arms a new first tap")
        d.onShiftUp()
        assertTrue(d.down(1_451 + 450), "the late tap became the new first tap")
    }

    @Test
    fun doubleShiftRequiresReleaseAndIgnoresRepeatsAndComposition() {
        // Holding (repeats) never arms or triggers; window counts from the first non-repeat down.
        val held = DoubleShiftDetector()
        assertFalse(held.down(0))
        assertFalse(held.down(50, repeat = true))
        assertFalse(held.down(100, repeat = true))
        assertFalse(held.onShiftUp())
        assertTrue(held.down(300))

        // A repeat as the second edge does not trigger.
        val repeatSecond = DoubleShiftDetector()
        repeatSecond.down(0)
        repeatSecond.onShiftUp()
        assertFalse(repeatSecond.down(100, repeat = true))
        assertTrue(repeatSecond.down(200))

        // Composition never arms or triggers.
        val composing = DoubleShiftDetector()
        assertFalse(composing.down(0, composing = true))
        assertFalse(composing.down(100))
        composing.onShiftUp()
        assertFalse(composing.down(200, composing = true))
        assertTrue(composing.down(300))

        // Second down without a release between (e.g. other Shift side while first is held) re-arms only.
        val noRelease = DoubleShiftDetector()
        assertFalse(noRelease.down(0))
        assertFalse(noRelease.down(100))
        noRelease.onShiftUp()
        assertTrue(noRelease.down(200)) // measured from the re-armed edge
    }

    @Test
    fun doubleShiftResetsOnInterleavedInputAddedModifierAndContextChanges() {
        val interleaved = DoubleShiftDetector()
        interleaved.down(0)
        interleaved.onShiftUp()
        interleaved.reset() // non-Shift key / focus loss / route / owner / capture / gate / background
        assertFalse(interleaved.down(100))
        interleaved.onShiftUp()
        assertTrue(interleaved.down(200))

        val modifier = DoubleShiftDetector()
        modifier.down(0)
        modifier.onShiftUp()
        assertFalse(modifier.down(100, ctrl = true))
        modifier.onShiftUp()
        assertFalse(modifier.down(150)) // fresh first tap, previous one was cleared
        modifier.onShiftUp()
        assertTrue(modifier.down(200))
        for (blocked in listOf({ d: DoubleShiftDetector -> d.down(100, alt = true) }, { d: DoubleShiftDetector -> d.down(100, meta = true) })) {
            val d = DoubleShiftDetector()
            d.down(0)
            d.onShiftUp()
            assertFalse(blocked(d))
        }
    }

    @Test
    fun doubleShiftDispatchesOnceAndConsumesItsRelease() {
        val d = DoubleShiftDetector()
        assertFalse(d.down(0))
        assertFalse(d.onShiftUp()) // first release is not consumed
        assertTrue(d.down(300))
        assertTrue(d.onShiftUp()) // release of the matched second tap is consumed exactly once
        assertFalse(d.onShiftUp())
        // State was cleared by the match: a third quick tap only arms a new first tap.
        assertFalse(d.down(310))
        d.onShiftUp()
        assertTrue(d.down(400))
    }
}
