package dev.damhopper.nativeapp.features.settings

import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type

/**
 * One physical key event reduced to what the registry needs. [code] is the locale-independent DOM `code` of
 * the C1 grammar (null for modifier keys and keys without a DOM code); [keyId] identifies the physical key
 * (including which Shift) for repeat/release bookkeeping; [timeMs] is a monotonic millisecond reading.
 */
data class ShortcutKeyInput(
    val keyId: String,
    val code: String?,
    val down: Boolean,
    val isShiftKey: Boolean,
    val isModifierKey: Boolean,
    val ctrl: Boolean,
    val alt: Boolean,
    val meta: Boolean,
    val shift: Boolean,
    val timeMs: Long,
    /** IME composition active: composition never arms DoubleShift and never triggers a chord. */
    val composing: Boolean = false,
)

/**
 * Everything that can veto or redirect a shortcut. Any change of this value (route, owner, focus, capture,
 * Settings/history/privacy gate) resets a pending DoubleShift tap, so a first tap can never complete in
 * another place.
 *
 * @property routeId stable identity of the current owner/route (profile, project, panel); a change resets.
 * @property focused the window/root has input focus (focus loss resets and blocks).
 * @property blocked Settings, history, hidden-input or any other covering gate: nothing dispatches.
 * @property masked the Cognito privacy mask covers the app: everything is consumed except its own dismissal chord.
 * @property capturing a shortcut capture UI owns the keyboard: it consumes down/up itself, nothing dispatches.
 * @property editableFocused an editable text field has focus: Shift taps are text input there, so DoubleShift
 *   never arms; Ctrl/Alt/Meta chords still work.
 */
data class ShortcutGate(
    val routeId: String? = null,
    val focused: Boolean = true,
    val blocked: Boolean = false,
    val masked: Boolean = false,
    val capturing: Boolean = false,
    val editableFocused: Boolean = false,
)

sealed interface ShortcutOutcome {
    /** Not ours: let the focused widget see the event. */
    data object PassThrough : ShortcutOutcome

    /** Swallow without dispatch (trailing release, repeat of a handled chord, key under the privacy mask). */
    data object Consume : ShortcutOutcome

    /** Handle [action] exactly once and consume the event. */
    data class Dispatch(val action: ShortcutAction) : ShortcutOutcome

    /** A bound destination this app does not have (Git/Ports/Fleet/IDE layout): consumed, with a visible [reason]. */
    data class Unavailable(val action: ShortcutAction, val reason: String) : ShortcutOutcome
}

/**
 * Frozen C1 hardware-shortcut dispatch (Mod=Ctrl, explicit Meta separate, exact modifiers, DOM `code`,
 * first-class DoubleShift with a 450 ms inclusive window on monotonic time).
 *
 * Pure and Compose-free: [onKey] consumes [ShortcutKeyInput]s in event order. A matched chord or DoubleShift
 * dispatches on its down edge only; its repeats and its release are consumed so nothing leaks into the PTY or
 * editor. It makes no claim to intercept keys the OS or IME reserves: it only sees events delivered to the app.
 * The caller supplies the [ShortcutGate]; Settings/history/privacy/capture/focus/route changes reset all
 * pending state.
 */
class HardwareShortcutRegistry(thresholdMs: Long = DOUBLE_SHIFT_MAX_INTERVAL_MS) {
    private val detector = DoubleShiftDetector(thresholdMs)
    private val held = HashSet<String>()
    private val swallowUp = HashSet<String>()
    private var lastGate: ShortcutGate? = null

    /** Drops every pending tap / held / swallowed key (background, owner change, capture start/cancel). */
    fun reset() {
        detector.reset()
        held.clear()
        swallowUp.clear()
        lastGate = null
    }

    fun onKey(input: ShortcutKeyInput, gate: ShortcutGate, prefs: WorkbenchPreferences): ShortcutOutcome {
        if (gate != lastGate) {
            detector.reset()
            lastGate = gate
        }
        val repeat = input.down && !held.add(input.keyId)
        if (!input.down) held.remove(input.keyId)

        if (gate.capturing) {
            detector.reset()
            swallowUp.clear()
            return ShortcutOutcome.PassThrough
        }
        if (gate.masked) return masked(input, prefs)
        if (gate.blocked || !gate.focused) {
            detector.reset()
            return ShortcutOutcome.PassThrough
        }

        if (!input.down) {
            if (input.isShiftKey && detector.onShiftUp()) return ShortcutOutcome.Consume
            if (swallowUp.remove(input.keyId)) return ShortcutOutcome.Consume
            return ShortcutOutcome.PassThrough
        }

        if (input.isShiftKey) {
            if (gate.editableFocused) {
                detector.reset()
                return ShortcutOutcome.PassThrough
            }
            val matched = detector.onShiftDown(input.timeMs, repeat, input.composing, input.ctrl, input.alt, input.meta)
            if (!matched) return ShortcutOutcome.PassThrough
            val action = ShortcutAction.entries.firstOrNull { ShortcutGrammar.parse(it.read(prefs))?.kind == ShortcutKind.DOUBLE_SHIFT }
                ?: return ShortcutOutcome.PassThrough
            return outcomeFor(action)
        }

        // Any other key (including Ctrl/Alt/Meta going down) ends a pending DoubleShift.
        detector.reset()
        if (input.isModifierKey) return ShortcutOutcome.PassThrough
        if (repeat) return if (input.keyId in swallowUp) ShortcutOutcome.Consume else ShortcutOutcome.PassThrough
        if (input.composing) return ShortcutOutcome.PassThrough
        val code = input.code ?: return ShortcutOutcome.PassThrough
        val action = match(prefs, code, input.ctrl, input.meta, input.alt, input.shift) ?: return ShortcutOutcome.PassThrough
        swallowUp += input.keyId
        return outcomeFor(action)
    }

    private fun masked(input: ShortcutKeyInput, prefs: WorkbenchPreferences): ShortcutOutcome {
        detector.reset()
        if (!input.down || input.isModifierKey || input.code == null) return ShortcutOutcome.Consume
        val matched = match(prefs, input.code, input.ctrl, input.meta, input.alt, input.shift)
        if (matched != ShortcutAction.COGNITO) return ShortcutOutcome.Consume
        swallowUp += input.keyId
        return ShortcutOutcome.Dispatch(ShortcutAction.COGNITO)
    }

    private fun outcomeFor(action: ShortcutAction): ShortcutOutcome {
        val reason = action.unavailableReason
        return if (reason != null) ShortcutOutcome.Unavailable(action, reason) else ShortcutOutcome.Dispatch(action)
    }

    companion object {
        /** First action (enum order) whose stored keyboard binding matches exactly; null when none does. */
        fun match(
            prefs: WorkbenchPreferences,
            code: String,
            ctrl: Boolean,
            meta: Boolean,
            alt: Boolean,
            shift: Boolean,
        ): ShortcutAction? = ShortcutAction.entries.firstOrNull { action ->
            val parsed = ShortcutGrammar.parse(action.read(prefs)) ?: return@firstOrNull false
            ShortcutGrammar.matches(parsed, code, ctrl, meta, alt, shift)
        }

        /** Actions whose stored bindings collide (same exact chord, or more than one DoubleShift). */
        fun collisions(prefs: WorkbenchPreferences): List<Pair<ShortcutAction, ShortcutAction>> {
            val entries = ShortcutAction.entries
            val out = ArrayList<Pair<ShortcutAction, ShortcutAction>>()
            for (i in entries.indices) {
                val a = ShortcutGrammar.parse(entries[i].read(prefs)) ?: continue
                for (j in i + 1 until entries.size) {
                    if (shortcutsCollide(a, ShortcutGrammar.parse(entries[j].read(prefs)))) out += entries[i] to entries[j]
                }
            }
            return out
        }
    }
}

private fun Key.isShiftKey() = this == Key.ShiftLeft || this == Key.ShiftRight

private fun Key.isModifier() = isShiftKey() || this == Key.CtrlLeft || this == Key.CtrlRight ||
    this == Key.AltLeft || this == Key.AltRight || this == Key.MetaLeft || this == Key.MetaRight ||
    this == Key.CapsLock || this == Key.NumLock || this == Key.ScrollLock

/**
 * Converts a Compose key event; null for event types other than down/up. [timeMs] must be a monotonic reading
 * taken when the event was delivered; [composing] comes from the focused input's IME state.
 */
fun KeyEvent.toShortcutInput(timeMs: Long, composing: Boolean): ShortcutKeyInput? {
    val down = when (type) {
        KeyEventType.KeyDown -> true
        KeyEventType.KeyUp -> false
        else -> return null
    }
    val k = key
    return ShortcutKeyInput(
        keyId = k.keyCode.toString(),
        code = domCodeFor(k),
        down = down,
        isShiftKey = k.isShiftKey(),
        isModifierKey = k.isModifier(),
        ctrl = isCtrlPressed,
        alt = isAltPressed,
        meta = isMetaPressed,
        shift = isShiftPressed,
        timeMs = timeMs,
        composing = composing,
    )
}
