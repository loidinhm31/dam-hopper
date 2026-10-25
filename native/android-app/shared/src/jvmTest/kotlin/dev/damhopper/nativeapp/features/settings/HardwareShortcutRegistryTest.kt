package dev.damhopper.nativeapp.features.settings

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Dispatch behavior of the frozen C1 grammar: exact modifiers (Mod = Ctrl, Meta separate), physical DOM codes,
 * DoubleShift timing on monotonic event time, and the focus/route/capture/composition/privacy gates. The default
 * preferences are used so the default filename-search binding is dispatched for real.
 */
class HardwareShortcutRegistryTest {

    private val prefs = WorkbenchPreferences()
    private val gate = ShortcutGate(routeId = "TERMINAL|p|proj|TERMINAL")

    private fun shift(left: Boolean, down: Boolean, t: Long, composing: Boolean = false) = ShortcutKeyInput(
        keyId = if (left) "SL" else "SR", code = null, down = down, isShiftKey = true, isModifierKey = true,
        ctrl = false, alt = false, meta = false, shift = true, timeMs = t, composing = composing,
    )

    private fun ctrlKey(down: Boolean, t: Long) = ShortcutKeyInput(
        keyId = "CTRL", code = null, down = down, isShiftKey = false, isModifierKey = true,
        ctrl = true, alt = false, meta = false, shift = false, timeMs = t,
    )

    private fun key(
        id: String,
        code: String?,
        down: Boolean,
        t: Long,
        ctrl: Boolean = false,
        alt: Boolean = false,
        meta: Boolean = false,
        shift: Boolean = false,
        composing: Boolean = false,
    ) = ShortcutKeyInput(id, code, down, isShiftKey = false, isModifierKey = false, ctrl = ctrl, alt = alt, meta = meta, shift = shift, timeMs = t, composing = composing)

    private fun HardwareShortcutRegistry.send(input: ShortcutKeyInput, g: ShortcutGate = gate, p: WorkbenchPreferences = prefs) = onKey(input, g, p)

    private fun doubleShift(r: HardwareShortcutRegistry, gapMs: Long, firstLeft: Boolean = true, secondLeft: Boolean = true): ShortcutOutcome {
        r.send(shift(firstLeft, true, 1_000))
        r.send(shift(firstLeft, false, 1_050))
        return r.send(shift(secondLeft, true, 1_000 + gapMs))
    }

    @Test
    fun defaultFilenameSearchIsDispatchedByDoubleShiftAt449And450ButNot451Milliseconds() {
        assertEquals(ShortcutOutcome.Dispatch(ShortcutAction.SEARCH_FILENAME), doubleShift(HardwareShortcutRegistry(), 449))
        assertEquals(ShortcutOutcome.Dispatch(ShortcutAction.SEARCH_FILENAME), doubleShift(HardwareShortcutRegistry(), 450))
        assertEquals(ShortcutOutcome.PassThrough, doubleShift(HardwareShortcutRegistry(), 451), "451 ms arms a new first tap")
    }

    @Test
    fun eitherShiftSideCountsAndTheMatchedReleaseIsConsumedWithoutRepeatTrigger() {
        val r = HardwareShortcutRegistry()
        assertEquals(ShortcutOutcome.Dispatch(ShortcutAction.SEARCH_FILENAME), doubleShift(r, 200, firstLeft = true, secondLeft = false))
        assertEquals(ShortcutOutcome.Consume, r.send(shift(false, false, 1_300)), "trailing release must not leak to PTY/editor")
        // A third tap right after is a fresh first tap, never a second dispatch.
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 1_350)))
    }

    @Test
    fun holdingShiftAndKeyRepeatNeverArmOrTrigger() {
        val r = HardwareShortcutRegistry()
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 0)))
        // Auto-repeat of the held key (down again without a release) never counts as a second tap.
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 100)))
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 200)))
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, false, 300)))
    }

    @Test
    fun interleavedKeysOrAddedModifiersResetThePendingTap() {
        val r = HardwareShortcutRegistry()
        r.send(shift(true, true, 0))
        r.send(shift(true, false, 20))
        r.send(key("A", "KeyA", true, 40))
        r.send(key("A", "KeyA", false, 60))
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 100)), "a non-Shift key between the taps resets")

        val r2 = HardwareShortcutRegistry()
        r2.send(shift(true, true, 0))
        r2.send(shift(true, false, 20))
        r2.send(ctrlKey(true, 40))
        r2.send(ctrlKey(false, 50))
        assertEquals(ShortcutOutcome.PassThrough, r2.send(shift(true, true, 100)), "an added modifier resets")
    }

    @Test
    fun compositionNeverArmsOrTriggers() {
        val r = HardwareShortcutRegistry()
        r.send(shift(true, true, 0, composing = true))
        r.send(shift(true, false, 20))
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 100)), "the composing first tap never armed")
        r.send(shift(true, false, 120))
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 140, composing = true)), "a composing second tap never triggers")
    }

    @Test
    fun focusRouteCaptureAndCoverGatesResetOrBlockTheTap() {
        fun armedThen(change: ShortcutGate): ShortcutOutcome {
            val r = HardwareShortcutRegistry()
            r.send(shift(true, true, 0))
            r.send(shift(true, false, 20))
            return r.send(shift(true, true, 100), g = change)
        }
        assertEquals(ShortcutOutcome.PassThrough, armedThen(gate.copy(routeId = "TERMINAL|p|other|TERMINAL")), "route/owner change")
        assertEquals(ShortcutOutcome.PassThrough, armedThen(gate.copy(focused = false)), "focus loss")
        assertEquals(ShortcutOutcome.PassThrough, armedThen(gate.copy(blocked = true)), "Settings/history/hidden-input cover")
        assertEquals(ShortcutOutcome.PassThrough, armedThen(gate.copy(capturing = true)), "capture owns the keyboard")
        assertEquals(ShortcutOutcome.PassThrough, armedThen(gate.copy(editableFocused = true)), "editable text keeps Shift as text input")
    }

    @Test
    fun chordsRequireExactModifiersAndDispatchOnceWithRepeatAndReleaseConsumed() {
        val r = HardwareShortcutRegistry()
        val down = key("F", "KeyF", true, 0, ctrl = true, shift = true)
        assertEquals(ShortcutOutcome.Dispatch(ShortcutAction.SEARCH_TEXT), r.send(down))
        assertEquals(ShortcutOutcome.Consume, r.send(down.copy(timeMs = 30)), "held repeat is consumed, never re-dispatched")
        assertEquals(ShortcutOutcome.Consume, r.send(down.copy(down = false, timeMs = 60)), "trailing release is consumed")
        assertEquals(ShortcutOutcome.PassThrough, r.send(key("F", "KeyF", true, 100, ctrl = true)), "missing Shift is a different chord")
        assertEquals(ShortcutOutcome.PassThrough, r.send(key("F2", "KeyF", true, 120, ctrl = true, shift = true, alt = true)), "extra Alt is not a match")
        assertEquals(ShortcutOutcome.PassThrough, r.send(key("F3", "KeyF", true, 140, ctrl = true, shift = true, meta = true)), "Meta is separate from Mod")
    }

    @Test
    fun unavailableDestinationsAreExplicitAndNeverDispatch() {
        val r = HardwareShortcutRegistry()
        val git = r.send(key("G", "KeyG", true, 0, ctrl = true, shift = true))
        val unavailable = assertNotNull(git as? ShortcutOutcome.Unavailable)
        assertEquals(ShortcutAction.GIT_PANEL, unavailable.action)
        assertTrue(unavailable.reason.isNotBlank())
    }

    @Test
    fun privacyMaskConsumesEverythingExceptItsOwnDismissalChord() {
        val r = HardwareShortcutRegistry()
        val masked = gate.copy(masked = true)
        assertEquals(ShortcutOutcome.Consume, r.send(key("A", "KeyA", true, 0), masked))
        assertEquals(ShortcutOutcome.Consume, r.send(key("F", "KeyF", true, 10, ctrl = true, shift = true), masked), "other shortcuts never fire under the mask")
        val chord = key("B", "KeyB", true, 20, ctrl = true, alt = true)
        assertEquals(ShortcutOutcome.Dispatch(ShortcutAction.COGNITO), r.send(chord, masked))
        assertEquals(ShortcutOutcome.Consume, r.send(chord.copy(down = false, timeMs = 40), masked))
        // Once unmasked, ordinary keys flow again (the key that went down under the mask is not remembered as handled).
        assertEquals(ShortcutOutcome.PassThrough, r.send(key("Z", "KeyZ", true, 60)))
    }

    @Test
    fun physicalCodesDriveCustomBindingsAndCollisionsAreDetected() {
        val custom = prefs.copy(searchTextShortcut = "Ctrl+Alt+Digit7", terminalFilePanelShortcut = "Alt+F2")
        assertEquals(ShortcutAction.SEARCH_TEXT, HardwareShortcutRegistry.match(custom, "Digit7", ctrl = true, meta = false, alt = true, shift = false))
        assertEquals(ShortcutAction.FILE_PANEL, HardwareShortcutRegistry.match(custom, "F2", ctrl = false, meta = false, alt = true, shift = false))
        assertNull(HardwareShortcutRegistry.match(custom, "KeyF", ctrl = true, meta = false, alt = false, shift = true), "old default no longer bound")

        assertTrue(HardwareShortcutRegistry.collisions(prefs).isEmpty(), "web defaults never collide")
        val colliding = prefs.copy(projectPanelShortcut = prefs.searchTextShortcut)
        assertEquals(listOf(ShortcutAction.SEARCH_TEXT to ShortcutAction.PROJECT_PANEL), HardwareShortcutRegistry.collisions(colliding))
        val twoDoubleShift = prefs.copy(revealActiveFileShortcut = DOUBLE_SHIFT_SHORTCUT)
        assertTrue(HardwareShortcutRegistry.collisions(twoDoubleShift).isNotEmpty(), "two DoubleShift bindings collide")
    }

    @Test
    fun resetClearsEveryPendingState() {
        val r = HardwareShortcutRegistry()
        r.send(shift(true, true, 0))
        r.send(shift(true, false, 20))
        r.reset()
        assertEquals(ShortcutOutcome.PassThrough, r.send(shift(true, true, 100)))
    }
}
