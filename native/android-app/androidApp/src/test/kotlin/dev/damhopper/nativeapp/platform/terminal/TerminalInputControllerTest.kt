package dev.damhopper.nativeapp.platform.terminal

import android.view.KeyEvent
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TerminalInputControllerTest {

    @Test
    fun testImeCommitAndBackspaceIsolation() {
        val connRef = ConnectionRef("srv-1", 1L)
        val sessionController = TerminalSessionController("sess-1", 1L, connRef)
        val inputController = TerminalInputController(sessionController)

        var lastDispatched: String? = null
        sessionController.setRawInputSink { bytes ->
            lastDispatched = bytes.decodeToString()
        }

        // 1. Inactive panel / pending replay -> dropped
        inputController.onImeCommitText("git status\n")
        assertNull(lastDispatched)

        // 2. Panel active and ready -> dispatched
        sessionController.isPanelActive = true
        sessionController.markReplayCompleted()

        inputController.onImeCommitText("git status\n")
        assertEquals("git status\n", lastDispatched)

        // 3. Backspace
        inputController.onImeDeleteBackward()
        assertEquals("\u007f", lastDispatched)
    }

    @Test
    fun testHardwareArrowAndControlKeys() {
        val connRef = ConnectionRef("srv-1", 1L)
        val sessionController = TerminalSessionController("sess-1", 1L, connRef)
        val inputController = TerminalInputController(sessionController)

        sessionController.isPanelActive = true
        sessionController.markReplayCompleted()

        var lastDispatched: String? = null
        sessionController.setRawInputSink { bytes ->
            lastDispatched = bytes.decodeToString()
        }

        // Up arrow key event
        val consumedUp = inputController.onHardwareKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_UP)
        assertTrue(consumedUp)
        assertEquals("\u001b[A", lastDispatched)

        // Enter key event
        val consumedEnter = inputController.onHardwareKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER)
        assertTrue(consumedEnter)
        assertEquals("\r", lastDispatched)

        // Tab key event
        val consumedTab = inputController.onHardwareKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_TAB)
        assertTrue(consumedTab)
        assertEquals("\t", lastDispatched)
    }
}
