package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlin.test.*

class EditorSessionTest {

    private val target = ProjectTargetRef(project = "test-project")

    @Test
    fun testTextEditingAndDirtyTracking() {
        val session = EditorSession(
            key = "file::p1::test-project::.::main.ts",
            profileId = "p1",
            target = target,
            path = "main.ts",
            initialContent = "const x = 1;\n",
            initialMtime = 100L
        )

        assertFalse(session.isDirty)
        assertEquals("const x = 1;\n", session.getText())
        assertEquals(1L, session.modelVersion)
        assertEquals(1L, session.editEpoch)

        session.setText("const x = 2;\n")
        assertTrue(session.isDirty)
        assertEquals(2L, session.modelVersion)
        assertEquals(2L, session.editEpoch)

        // Reset to saved content clears dirty
        session.setText("const x = 1;\n")
        assertFalse(session.isDirty)
    }

    @Test
    fun testUndoRedoBoundedHistory() {
        val session = EditorSession(
            key = "key1", profileId = "p1", target = target, path = "test.txt",
            initialContent = "v0"
        )

        assertFalse(session.canUndo())
        assertFalse(session.canRedo())

        session.setText("v1")
        session.setText("v2")
        assertTrue(session.canUndo())

        session.undo()
        assertEquals("v1", session.getText())
        assertTrue(session.canRedo())

        session.undo()
        assertEquals("v0", session.getText())
        assertFalse(session.canUndo())

        session.redo()
        assertEquals("v1", session.getText())

        session.redo()
        assertEquals("v2", session.getText())
    }

    @Test
    fun testFindAndReplaceOperations() {
        val session = EditorSession(
            key = "key1", profileId = "p1", target = target, path = "test.txt",
            initialContent = "val foo = 1;\nval bar = foo + foo;\n"
        )

        session.openFindReplace("foo", caseSensitive = true)
        assertEquals(3, session.findReplaceState.totalMatches)

        val m1 = session.findNext()
        assertNotNull(m1)
        assertEquals(TextPosition(1, 5), m1.start)

        session.setReplaceQuery("baz")
        val replaced = session.replaceCurrent()
        assertTrue(replaced)
        assertTrue(session.getText().contains("val baz = 1;"))

        val totalReplaced = session.replaceAll()
        assertEquals(2, totalReplaced)
        assertFalse(session.getText().contains("foo"))
        assertTrue(session.getText().contains("val bar = baz + baz;"))
    }

    @Test
    fun testSubmittedBytesSaveBaselineTracking() {
        val session = EditorSession(
            key = "key1", profileId = "p1", target = target, path = "main.ts",
            initialContent = "line 1\n",
            initialMtime = 100L
        )

        session.setText("line 1\nline 2\n")
        assertTrue(session.isDirty)

        // 1. Begin save captures snapshot
        val (submittedSnapshot, epoch) = session.beginSave()!!
        assertEquals("line 1\nline 2\n", submittedSnapshot)
        assertEquals(session.editEpoch, epoch)

        // 2. User types "line 3" while save request is in-flight on the network!
        session.setText("line 1\nline 2\nline 3\n")
        assertEquals(epoch + 1, session.editEpoch)

        // 3. Save finishes successfully with new server mtime
        session.completeSave(savedMtime = 200L, submittedSnapshot = submittedSnapshot)

        // CRITICAL INVARIANT: savedContent is updated to the snapshot,
        // but session remains dirty because of intermediate keystrokes!
        assertEquals(200L, session.serverMtime)
        assertEquals("line 1\nline 2\n", session.savedContent)
        assertEquals("line 1\nline 2\nline 3\n", session.getText())
        assertTrue(session.isDirty, "Session must remain dirty when modified during save request")
    }

    @Test
    fun testPositionAndOffsetConversions() {
        val text = "abc\ndefgh\nijk"
        assertEquals(TextPosition(1, 1), EditorPositionHelper.offsetToPosition(text, 0))
        assertEquals(TextPosition(1, 4), EditorPositionHelper.offsetToPosition(text, 3))
        assertEquals(TextPosition(2, 1), EditorPositionHelper.offsetToPosition(text, 4))
        assertEquals(TextPosition(2, 3), EditorPositionHelper.offsetToPosition(text, 6))

        assertEquals(0, EditorPositionHelper.positionToOffset(text, TextPosition(1, 1)))
        assertEquals(4, EditorPositionHelper.positionToOffset(text, TextPosition(2, 1)))
        assertEquals(6, EditorPositionHelper.positionToOffset(text, TextPosition(2, 3)))
    }
}
