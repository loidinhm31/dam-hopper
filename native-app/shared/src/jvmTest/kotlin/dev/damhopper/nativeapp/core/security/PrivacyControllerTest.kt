package dev.damhopper.nativeapp.core.security

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.editor.EditorSession
import dev.damhopper.nativeapp.features.settings.CognitoModeStyle
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PrivacyControllerTest {

    @Test
    fun testInitialMemoryStateIsInactive() {
        val controller = PrivacyController()
        assertFalse(controller.isMaskActive.value)
        assertNull(controller.activationChord.value)
        assertTrue(controller.isInputAllowed())
    }

    @Test
    fun testActivationFreezesChordAndBlocksInput() {
        val controller = PrivacyController()
        controller.activate("Ctrl+Alt+P", CognitoModeStyle.BLACK_SCREEN)

        assertTrue(controller.isMaskActive.value)
        assertEquals("ctrl+alt+p", controller.activationChord.value)
        assertEquals(CognitoModeStyle.BLACK_SCREEN, controller.activeStyle.value)
        assertFalse(controller.isInputAllowed())
    }

    @Test
    fun testDismissalRequiresExactMatchingChord() {
        val controller = PrivacyController()
        controller.activate("Ctrl+Alt+P")

        // Wrong chord fails dismissal
        assertFalse(controller.dismissWithChord("Ctrl+Alt+Q"))
        assertTrue(controller.isMaskActive.value)
        assertFalse(controller.isInputAllowed())

        // Exact chord succeeds
        assertTrue(controller.dismissWithChord("ctrl+alt+p"))
        assertFalse(controller.isMaskActive.value)
        assertNull(controller.activationChord.value)
        assertTrue(controller.isInputAllowed())
    }

    @Test
    fun testTouchEmergencyDismissal() {
        val controller = PrivacyController()
        controller.activate("Ctrl+Shift+L")
        assertTrue(controller.isMaskActive.value)

        controller.dismissTouchEmergency()
        assertFalse(controller.isMaskActive.value)
        assertTrue(controller.isInputAllowed())
    }

    @Test
    fun testTrailingReleaseConsumption() {
        val controller = PrivacyController()
        controller.activate("Ctrl+Alt+P")
        controller.dismissWithChord("Ctrl+Alt+P")

        // First release consumed
        assertTrue(controller.consumeTrailingRelease())
        // Subsequent release not consumed
        assertFalse(controller.consumeTrailingRelease())
    }

    @Test
    fun testLifecycleResetCleansUpState() {
        val controller = PrivacyController()
        controller.activate("Ctrl+Alt+P")
        controller.reset()

        assertFalse(controller.isMaskActive.value)
        assertNull(controller.activationChord.value)
        assertFalse(controller.consumeTrailingRelease())
        assertTrue(controller.isInputAllowed())
    }

    @Test
    fun testTerminalInputIsolationUnderPrivacyMask() {
        val privacy = PrivacyController()
        val terminalController = TerminalSessionController(
            sessionId = "term-1",
            initialIncarnation = 1L,
            connectionRef = ConnectionRef("profile-1", 1L),
        )
        terminalController.isInputAllowed = { privacy.isInputAllowed() }
        terminalController.isPanelActive = true

        var receivedInput: ByteArray? = null
        terminalController.setRawInputSink { bytes -> receivedInput = bytes }

        // Simulate live stream ready
        terminalController.handleBufferReplay(
            data = byteArrayOf(),
            offset = 0uL,
            reset = true,
            truncated = false,
            bufferIncarnation = 1uL,
        )

        // Normal input works
        terminalController.sendInput("ls\n".encodeToByteArray())
        assertEquals("ls\n", receivedInput?.decodeToString())

        // Mask activated
        privacy.activate("Ctrl+Alt+P")
        receivedInput = null

        // While masked, input is dropped
        terminalController.sendInput("rm -rf /\n".encodeToByteArray())
        assertNull(receivedInput, "Input must be dropped while Cognito mask is active")

        terminalController.pasteText("forbidden command")
        assertNull(receivedInput, "Paste must be dropped while Cognito mask is active")

        assertNull(terminalController.getSelectedText(), "Selection copy must return null while masked")

        // Dismiss mask -> input works again
        privacy.deactivate()
        terminalController.sendInput("pwd\n".encodeToByteArray())
        assertEquals("pwd\n", receivedInput?.decodeToString())
    }

    @Test
    fun testEditorInputIsolationUnderPrivacyMask() {
        val privacy = PrivacyController()
        val session = EditorSession(
            key = "editor-1",
            profileId = "profile-1",
            target = ProjectTargetRef(project = "proj"),
            path = "main.kt",
            sessionIncarnation = 1L,
            initialContent = "val a = 1",
            initialMtime = 1000L,
            isReadOnly = false,
        )
        session.isInputAllowed = { privacy.isInputAllowed() }

        // Normal edit works
        session.setText("val a = 2")
        assertEquals("val a = 2", session.getText())

        // Mask activated
        privacy.activate("Ctrl+Alt+P")

        // Edit blocked
        session.setText("val a = 3")
        assertEquals("val a = 2", session.getText(), "Edits must be blocked while Cognito mask is active")

        // Save blocked
        assertNull(session.beginSave(), "beginSave must return null while Cognito mask is active")

        // Undo blocked
        assertFalse(session.undo(), "Undo must return false while Cognito mask is active")

        // Redo blocked
        assertFalse(session.redo(), "Redo must return false while Cognito mask is active")

        // Dismiss mask -> edits work again
        privacy.deactivate()
        session.setText("val a = 5")
        assertEquals("val a = 5", session.getText())
    }
}
