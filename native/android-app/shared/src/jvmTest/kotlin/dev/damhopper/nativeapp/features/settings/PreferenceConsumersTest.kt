package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.notifications.NotificationFeedState
import dev.damhopper.nativeapp.core.notifications.NotificationRecord
import dev.damhopper.nativeapp.core.notifications.NotificationTarget
import dev.damhopper.nativeapp.features.editor.pinchZoomedEditorFontSize
import dev.damhopper.nativeapp.features.editor.wheelZoomedEditorFontSize
import dev.damhopper.nativeapp.features.files.languageFilterLabel
import dev.damhopper.nativeapp.ui.screens.ACCESSORY_TOUCH_TARGET_DP
import dev.damhopper.nativeapp.ui.screens.AccessoryAction
import dev.damhopper.nativeapp.ui.screens.PreferenceAccess
import dev.damhopper.nativeapp.ui.screens.TerminalCommitStatus
import dev.damhopper.nativeapp.ui.screens.TerminalScrollDirection
import dev.damhopper.nativeapp.ui.screens.accessoryMetrics
import dev.damhopper.nativeapp.ui.screens.accessoryModifierRow
import dev.damhopper.nativeapp.ui.screens.accessoryNavigationRow
import dev.damhopper.nativeapp.ui.screens.accessoryKeyRows
import dev.damhopper.nativeapp.ui.screens.accessoryScrollKeys
import dev.damhopper.nativeapp.ui.screens.autoSwitchProjectFor
import dev.damhopper.nativeapp.ui.screens.clampTerminalScrollStep
import dev.damhopper.nativeapp.ui.screens.filterNotificationRecords
import dev.damhopper.nativeapp.ui.screens.terminalScrollTarget
import dev.damhopper.nativeapp.ui.screens.terminalSuggestionsFor
import dev.damhopper.nativeapp.ui.screens.transientRecords
import dev.damhopper.nativeapp.ui.screens.unreadCount
import dev.damhopper.nativeapp.ui.theme.DamHopperPalettes
import dev.damhopper.nativeapp.ui.theme.systemFontScale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Behavior of the pure consumers of the one reactive preference flow (terminal scroll/suggestions/auto-switch,
 * accessory keyboard, editor zoom, themes, notification list). Nothing here pins source text.
 */
class PreferenceConsumersTest {

    private val owner = SettingsOwner(ConnectionRef("p", 1L), "https://host", "alice")

    private class FakeHistory(initiallyEnabled: Boolean, private val data: List<String>) : CommandHistoryStore {
        private val _enabled = MutableStateFlow(initiallyEnabled)
        override val enabled: StateFlow<Boolean> = _enabled
        override fun setEnabled(enabled: Boolean) { _enabled.value = enabled }
        override fun record(owner: SettingsOwner, project: String, command: String) {}
        override fun suggestions(owner: SettingsOwner, project: String, prefix: String): List<String> =
            data.filter { it.startsWith(prefix) }
        override fun clear() {}
    }

    @Test
    fun scrollStepIsClampedTo1Through50AndMovesByExactlyThatManyLines() {
        assertEquals(1, clampTerminalScrollStep(0))
        assertEquals(1, clampTerminalScrollStep(-9))
        assertEquals(50, clampTerminalScrollStep(51))
        assertEquals(50, clampTerminalScrollStep(500))
        assertEquals(20, clampTerminalScrollStep(20), "the old 1..20 ceiling no longer applies")

        assertEquals(90, terminalScrollTarget(100, 500, TerminalScrollDirection.UP, 10))
        assertEquals(110, terminalScrollTarget(100, 500, TerminalScrollDirection.DOWN, 10))
        assertEquals(50, terminalScrollTarget(100, 500, TerminalScrollDirection.UP, 999), "clamped to 50 lines")
        assertEquals(0, terminalScrollTarget(3, 500, TerminalScrollDirection.UP, 5), "never past the top")
        assertEquals(500, terminalScrollTarget(498, 500, TerminalScrollDirection.DOWN, 5), "never past the bottom")
        assertEquals(0, terminalScrollTarget(250, 500, TerminalScrollDirection.TOP, 5))
        assertEquals(500, terminalScrollTarget(250, 500, TerminalScrollDirection.BOTTOM, 5))
        assertEquals(0, terminalScrollTarget(0, 0, TerminalScrollDirection.DOWN, 5), "empty buffer")
    }

    @Test
    fun autoSwitchOnlyFollowsAnAuthoritativelyAssignedOtherProject() {
        assertEquals("beta", autoSwitchProjectFor(true, "alpha", "beta"))
        assertNull(autoSwitchProjectFor(false, "alpha", "beta"), "preference off preserves the project")
        assertNull(autoSwitchProjectFor(true, "alpha", null), "a free terminal preserves the current project")
        assertNull(autoSwitchProjectFor(true, "alpha", "  "), "blank assignment is not authoritative")
        assertNull(autoSwitchProjectFor(true, "alpha", "alpha"), "same project never switches")
    }

    @Test
    fun suggestionsAreAppLocalHistoryOnlyAndVanishWhenAnyConsentIsOff() {
        val history = FakeHistory(true, listOf("git status", "git stash", "ls"))
        assertEquals(listOf("git status", "git stash"), terminalSuggestionsFor(true, history, owner, "proj", "git s"))
        assertTrue(terminalSuggestionsFor(false, history, owner, "proj", "git s").isEmpty(), "suggestions preference off")
        assertTrue(terminalSuggestionsFor(true, FakeHistory(false, listOf("git status")), owner, "proj", "git").isEmpty(), "history consent off")
        assertTrue(terminalSuggestionsFor(true, history, null, "proj", "git").isEmpty(), "no owner scope")
        assertTrue(terminalSuggestionsFor(true, history, owner, "proj", "   ").isEmpty(), "blank draft")
        assertTrue(terminalSuggestionsFor(true, null, owner, "proj", "git").isEmpty(), "no store attached")
    }

    @Test
    fun accessoryMetricsClampAndEveryKeyRoutesThroughTheExistingInputPath() {
        val wild = WorkbenchPreferences(mobileCustomKeyboardFontSize = 99, mobileCustomKeyboardPadding = -5, mobileCustomKeyboardRowGap = 99)
        val m = accessoryMetrics(wild)
        assertEquals(18, m.fontSp)
        assertEquals(2, m.paddingDp)
        assertEquals(12, m.gapDp)
        assertEquals(48, ACCESSORY_TOUCH_TARGET_DP, "touch target is independent of the visual padding")

        val actions = (accessoryModifierRow() + accessoryNavigationRow()).map { it.action }
        val specials = actions.filterIsInstance<AccessoryAction.Special>().map { it.name }.toSet()
        assertTrue(specials.containsAll(setOf("ESC", "TAB", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END")))
        assertTrue(AccessoryAction.ToggleCtrl in actions && AccessoryAction.ToggleAlt in actions && AccessoryAction.ToggleShift in actions)
        assertTrue(actions.any { it is AccessoryAction.CtrlChar && it.char == 'c' })
    }

    @Test
    fun accessoryRowsLimitToMaximumTwoRowsAcrossAllPreferenceCombinations() {
        // 1. Both keyboard and scroll buttons enabled -> exactly 2 rows
        val bothRows = accessoryKeyRows(enabled = true, scrollButtonsEnabled = true, scrollStep = 5)
        assertEquals(2, bothRows.size, "both enabled produces exactly 2 rows")
        assertTrue(bothRows.size <= 2)
        val row1Actions = bothRows[0].map { it.action }
        val row2Actions = bothRows[1].map { it.action }
        assertTrue(row1Actions.contains(AccessoryAction.ToggleCtrl))
        assertTrue(row1Actions.contains(AccessoryAction.ToggleShift))
        assertTrue(row1Actions.any { it is AccessoryAction.Scroll && it.direction == TerminalScrollDirection.UP })
        assertTrue(row1Actions.any { it is AccessoryAction.Scroll && it.direction == TerminalScrollDirection.BOTTOM })
        // Local scroll actions are distinct from PTY arrow-key actions
        assertTrue(row2Actions.any { it is AccessoryAction.Special && it.name == "UP" })

        // 2. Keyboard enabled, scroll buttons disabled -> exactly 2 rows
        val kbOnlyRows = accessoryKeyRows(enabled = true, scrollButtonsEnabled = false, scrollStep = 5)
        assertEquals(2, kbOnlyRows.size, "keyboard only produces 2 rows")
        assertTrue(kbOnlyRows.size <= 2)
        assertTrue(kbOnlyRows[0].none { it.action is AccessoryAction.Scroll })

        // 3. Keyboard disabled, scroll buttons enabled -> exactly 1 row
        val scrollOnlyRows = accessoryKeyRows(enabled = false, scrollButtonsEnabled = true, scrollStep = 5)
        assertEquals(1, scrollOnlyRows.size, "scroll only produces 1 row")
        assertTrue(scrollOnlyRows.size <= 2)
        assertEquals(4, scrollOnlyRows[0].size)
        assertTrue(scrollOnlyRows[0].all { it.action is AccessoryAction.Scroll })

        // 4. Neither enabled -> 0 rows
        val neitherRows = accessoryKeyRows(enabled = false, scrollButtonsEnabled = false, scrollStep = 5)
        assertTrue(neitherRows.isEmpty(), "neither enabled produces 0 rows")
        assertTrue(neitherRows.size <= 2)

        // 5. Scroll keys contain all 4 directions and step label
        val scrollKeys = accessoryScrollKeys(10)
        assertEquals(4, scrollKeys.size)
        val scrollDirections = scrollKeys.mapNotNull { (it.action as? AccessoryAction.Scroll)?.direction }.toSet()
        assertEquals(
            setOf(TerminalScrollDirection.UP, TerminalScrollDirection.DOWN, TerminalScrollDirection.TOP, TerminalScrollDirection.BOTTOM),
            scrollDirections
        )
        assertTrue(scrollKeys.any { it.label == "▲ 10" })
        assertTrue(scrollKeys.any { it.label == "▼ 10" })
    }

    @Test
    fun editorZoomStepsAndPinchStayWithinTheFontRange() {
        assertEquals(15, wheelZoomedEditorFontSize(14, -1f), "wheel up grows")
        assertEquals(13, wheelZoomedEditorFontSize(14, 1f), "wheel down shrinks")
        assertEquals(14, wheelZoomedEditorFontSize(14, 0f))
        assertEquals(WorkbenchPreferences.FONT_MAX, wheelZoomedEditorFontSize(WorkbenchPreferences.FONT_MAX, -3f))
        assertEquals(WorkbenchPreferences.FONT_MIN, wheelZoomedEditorFontSize(WorkbenchPreferences.FONT_MIN, 3f))
        assertEquals(28, pinchZoomedEditorFontSize(14, 2f))
        assertEquals(WorkbenchPreferences.FONT_MAX, pinchZoomedEditorFontSize(14, 100f))
        assertEquals(14, pinchZoomedEditorFontSize(14, Float.NaN))
    }

    @Test
    fun systemThemeFollowsAndroidAndEveryThemeHasItsOwnPalette() {
        assertEquals(DamHopperPalettes.Dark, DamHopperPalettes.resolve(WorkbenchTheme.SYSTEM, systemDark = true))
        assertEquals(DamHopperPalettes.Light, DamHopperPalettes.resolve(WorkbenchTheme.SYSTEM, systemDark = false))
        assertEquals(DamHopperPalettes.Light, DamHopperPalettes.resolve(WorkbenchTheme.LIGHT, systemDark = true))
        assertEquals(DamHopperPalettes.Dark, DamHopperPalettes.resolve(WorkbenchTheme.DARK, systemDark = false))
        assertEquals(DamHopperPalettes.HighContrast, DamHopperPalettes.resolve(WorkbenchTheme.HIGH_CONTRAST, systemDark = false))
        assertNotEquals(DamHopperPalettes.Dark.background, DamHopperPalettes.Light.background)
        assertTrue(DamHopperPalettes.Dark.isDark && !DamHopperPalettes.Light.isDark)
    }

    @Test
    fun systemFontSizeScalesRelativeToTheWebDefault() {
        assertEquals(1f, systemFontScale(14))
        assertEquals(2f, systemFontScale(28))
        assertEquals(systemFontScale(WorkbenchPreferences.FONT_MAX), systemFontScale(500), "out of range clamps")
        assertTrue(systemFontScale(10) < 1f)
    }

    @Test
    fun explicitFontWritesGoThroughTheOneReactivePreferenceFlow() {
        val flow = MutableStateFlow(WorkbenchPreferences())
        val access = PreferenceAccess(flow, { transform -> flow.value = transform(flow.value) })
        access.update { it.copy(terminalFontSize = 20) }
        assertEquals(20, access.current.terminalFontSize)
        assertEquals(20, flow.value.terminalFontSize, "no independent saved copy")
        var selected: ExplorerLanguageFilter? = null
        val explicit = PreferenceAccess(flow, { transform -> flow.value = transform(flow.value) }, { selected = it })
        explicit.selectLanguageFilter(ExplorerLanguageFilter.JAVA)
        assertEquals(ExplorerLanguageFilter.JAVA, selected, "explicit choice uses the explicit-write path")
    }

    @Test
    fun languageFamiliesHaveUserFacingLabels() {
        assertEquals(setOf("All", "Rust", "JS/TS", "Java"), ExplorerLanguageFilter.entries.map { languageFilterLabel(it) }.toSet())
    }

    @Test
    fun notificationListFiltersLocallyAndBoundsTransients() {
        fun record(key: String, title: String, read: Boolean = false) = NotificationRecord(
            key = key,
            target = NotificationTarget(profileId = "p", generation = 1L),
            title = title,
            body = "body of $title",
            receivedAtMs = 1L,
            read = read,
        )
        val feed = NotificationFeedState(
            records = listOf(record("a", "OMP needs attention"), record("b", "Claude turn ended", read = true)),
            transients = listOf("a", "gone"),
        )
        assertEquals(1, unreadCount(feed))
        assertEquals(listOf("a"), transientRecords(feed).map { it.key }, "transients missing from the feed are dropped")
        assertEquals(2, filterNotificationRecords(feed.records, "").size)
        assertEquals(listOf("b"), filterNotificationRecords(feed.records, "CLAUDE").map { it.key }, "case-insensitive title match")
        assertEquals(listOf("a"), filterNotificationRecords(feed.records, "body of omp").map { it.key }, "body match")
        assertTrue(filterNotificationRecords(feed.records, "zzz").isEmpty())
        assertFalse(filterNotificationRecords(feed.records, "  ").isEmpty(), "blank filter shows everything")
    }

    @Test
    fun commitStatusLineIsSingleLineAndOmitsMissingParts() {
        assertEquals("main · abc1234 · Fix it", TerminalCommitStatus("main", "abc1234", "Fix it\nsecond line").describe())
        assertEquals("abc1234", TerminalCommitStatus(null, "abc1234", null).describe())
        assertNull(TerminalCommitStatus(null, null, null).describe())
    }
}
