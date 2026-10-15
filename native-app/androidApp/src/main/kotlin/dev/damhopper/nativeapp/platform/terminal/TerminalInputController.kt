package dev.damhopper.nativeapp.platform.terminal

import android.content.ClipData
import android.content.ClipboardManager
import android.view.KeyEvent
import dev.damhopper.nativeapp.features.terminal.TerminalModifier
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController

/**
 * Controller bridging Android IME input, hardware keyboard events, and system clipboard
 * to the active [TerminalSessionController].
 *
 * Invariants:
 * 1. Hardware modifier keys (Ctrl, Alt, Shift) are properly mapped to ANSI escape codes.
 * 2. Composing / committed IME text (including multibyte and CJK) is dispatched as UTF-8 bytes.
 * 3. Clipboard paste wraps text in bracketed paste sequences to avoid accidental command execution.
 * 4. Input is strictly dropped if the controller's panel is inactive or replay is pending.
 */
class TerminalInputController(
    val sessionController: TerminalSessionController,
) {

    /**
     * Handles hardware keyboard events (USB, Bluetooth, or Chromebook keyboards).
     * Returns true if the key event was consumed.
     */
    fun onHardwareKeyEvent(event: KeyEvent): Boolean {
        return onHardwareKey(
            action = event.action,
            keyCode = event.keyCode,
            isCtrl = event.isCtrlPressed,
            isAlt = event.isAltPressed,
            isShift = event.isShiftPressed,
            unicode = event.unicodeChar
        )
    }

    fun onHardwareKey(
        action: Int,
        keyCode: Int,
        isCtrl: Boolean = false,
        isAlt: Boolean = false,
        isShift: Boolean = false,
        unicode: Int = 0
    ): Boolean {
        if (!sessionController.isPanelActive || !sessionController.isReplayCompleted) {
            return false
        }

        if (action == KeyEvent.ACTION_UP) {
            // Clear modifier state when modifier keys are released
            if (!isCtrl && sessionController.isModifierActive(TerminalModifier.CTRL)) {
                sessionController.toggleModifier(TerminalModifier.CTRL)
            }
            if (!isAlt && sessionController.isModifierActive(TerminalModifier.ALT)) {
                sessionController.toggleModifier(TerminalModifier.ALT)
            }
            if (!isShift && sessionController.isModifierActive(TerminalModifier.SHIFT)) {
                sessionController.toggleModifier(TerminalModifier.SHIFT)
            }
            return false
        }

        if (action != KeyEvent.ACTION_DOWN) {
            return false
        }

        // Synchronize modifier states
        if (isCtrl && !sessionController.isModifierActive(TerminalModifier.CTRL)) {
            sessionController.toggleModifier(TerminalModifier.CTRL)
        }
        if (isAlt && !sessionController.isModifierActive(TerminalModifier.ALT)) {
            sessionController.toggleModifier(TerminalModifier.ALT)
        }
        if (isShift && !sessionController.isModifierActive(TerminalModifier.SHIFT)) {
            sessionController.toggleModifier(TerminalModifier.SHIFT)
        }
        val specialBytes = when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> sessionController.encodeSpecialKey("UP")
            KeyEvent.KEYCODE_DPAD_DOWN -> sessionController.encodeSpecialKey("DOWN")
            KeyEvent.KEYCODE_DPAD_LEFT -> sessionController.encodeSpecialKey("LEFT")
            KeyEvent.KEYCODE_DPAD_RIGHT -> sessionController.encodeSpecialKey("RIGHT")
            KeyEvent.KEYCODE_MOVE_HOME -> sessionController.encodeSpecialKey("HOME")
            KeyEvent.KEYCODE_MOVE_END -> sessionController.encodeSpecialKey("END")
            KeyEvent.KEYCODE_PAGE_UP -> sessionController.encodeSpecialKey("PAGEUP")
            KeyEvent.KEYCODE_PAGE_DOWN -> sessionController.encodeSpecialKey("PAGEDOWN")
            KeyEvent.KEYCODE_FORWARD_DEL -> sessionController.encodeSpecialKey("DELETE")
            KeyEvent.KEYCODE_DEL -> sessionController.encodeSpecialKey("BACKSPACE")
            KeyEvent.KEYCODE_TAB -> sessionController.encodeSpecialKey("TAB")
            KeyEvent.KEYCODE_ESCAPE -> sessionController.encodeSpecialKey("ESC")
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> sessionController.encodeSpecialKey("ENTER")
            else -> null
        }

        if (specialBytes != null) {
            sessionController.sendInput(specialBytes)
            return true
        }

        // Printable Unicode character
        if (unicode != 0) {
            val chars = Character.toChars(unicode)
            val text = String(chars)
            if (text.length == 1) {
                val encoded = sessionController.encodeKey(text[0])
                sessionController.sendInput(encoded)
            } else {
                sessionController.sendInput(text.encodeToByteArray())
            }
            return true
        }

        return false
    }

    /**
     * Dispatches committed text from software keyboard / IME.
     */
    fun onImeCommitText(text: CharSequence) {
        if (!sessionController.isPanelActive || !sessionController.isReplayCompleted) {
            return
        }
        if (text.isEmpty()) return
        val bytes = text.toString().encodeToByteArray()
        sessionController.sendInput(bytes)
    }

    /**
     * Handles software keyboard backspace.
     */
    fun onImeDeleteBackward() {
        if (!sessionController.isPanelActive || !sessionController.isReplayCompleted) {
            return
        }
        val bytes = sessionController.encodeSpecialKey("BACKSPACE")
        sessionController.sendInput(bytes)
    }

    /**
     * Reads text from system clipboard and sends it with bracketed paste escaping.
     */
    fun pasteFromClipboard(clipboardManager: ClipboardManager?): Boolean {
        if (!sessionController.isPanelActive || !sessionController.isReplayCompleted) {
            return false
        }
        val manager = clipboardManager ?: return false
        val clip = manager.primaryClip ?: return false
        if (clip.itemCount == 0) return false
        val item = clip.getItemAt(0)
        val text = item.coerceToText(null)?.toString() ?: return false
        if (text.isEmpty()) return false

        sessionController.pasteText(text)
        return true
    }

    /**
     * Copies selected text from terminal buffer to system clipboard.
     */
    fun copySelectionToClipboard(clipboardManager: ClipboardManager?): Boolean {
        val manager = clipboardManager ?: return false
        val selected = sessionController.getSelectedText() ?: return false
        if (selected.isEmpty()) return false

        val clip = ClipData.newPlainText("Terminal Selection", selected)
        manager.setPrimaryClip(clip)
        return true
    }
}
