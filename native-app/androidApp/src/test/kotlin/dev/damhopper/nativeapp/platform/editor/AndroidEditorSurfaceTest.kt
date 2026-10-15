package dev.damhopper.nativeapp.platform.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidEditorSurfaceTest {

    @Test
    fun testCandidateAdapterMetadata() {
        val candidate = CandidateEditorAdapter()
        assertEquals("Sora Editor", candidate.name)
        assertEquals("0.23.4", candidate.version)
        assertEquals("io.github.rosemoe.sora-editor:editor:0.23.4", candidate.artifact)
        assertEquals("LGPL-2.1-or-later", candidate.license)
        assertTrue(candidate.licenseNotice.contains("dynamic linkage"))
        assertTrue(candidate.licenseNotice.contains("relinking"))
    }

    @Test
    fun testTextEditAndModelVersion() {
        val surface = AndroidEditorSurface()
        surface.setText("line 1\nline 2\nline 3", modelVersion = 1L)
        assertEquals("line 1\nline 2\nline 3", surface.getText())
        assertEquals(1L, surface.modelVersion)

        // Replace "line 2" with "line two updated"
        val edit = EditorTextEdit(
            range = EditorTextRange(
                start = EditorTextPosition(2, 1),
                end = EditorTextPosition(2, 7)
            ),
            newText = "line two updated"
        )
        surface.applyEdit(edit)

        assertEquals("line 1\nline two updated\nline 3", surface.getText())
        assertEquals(2L, surface.modelVersion)
    }

    @Test
    fun testUndoRedoStack() {
        val surface = AndroidEditorSurface()
        surface.setText("initial", modelVersion = 1L)
        assertFalse(surface.canUndo())
        assertFalse(surface.canRedo())

        // Edit 1
        surface.applyEdit(
            EditorTextEdit(
                range = EditorTextRange(EditorTextPosition(1, 1), EditorTextPosition(1, 8)),
                newText = "modified"
            )
        )
        assertTrue(surface.canUndo())
        assertEquals("modified", surface.getText())

        // Undo
        assertTrue(surface.undo())
        assertEquals("initial", surface.getText())
        assertTrue(surface.canRedo())

        // Redo
        assertTrue(surface.redo())
        assertEquals("modified", surface.getText())
    }

    @Test
    fun testReadOnlyGuard() {
        val surface = AndroidEditorSurface()
        surface.setText("protected content", modelVersion = 1L)
        surface.setReadOnly(true)
        assertTrue(surface.isReadOnly())

        var caught = false
        try {
            surface.applyEdit(
                EditorTextEdit(
                    range = EditorTextRange(EditorTextPosition(1, 1), EditorTextPosition(1, 2)),
                    newText = "X"
                )
            )
        } catch (_: IllegalStateException) {
            caught = true
        }
        assertTrue(caught, "Edits must be rejected in read-only mode")
        assertEquals("protected content", surface.getText())
    }

    @Test
    fun testGutterDecorations() {
        val surface = AndroidEditorSurface()
        val decs = listOf(
            EditorGutterDecoration(1, icon = "git-mod", colorHex = "#00FF00", tooltip = "Added line"),
            EditorGutterDecoration(5, icon = "error", colorHex = "#FF0000", tooltip = "Syntax error")
        )
        surface.setGutterDecorations(decs)
        assertEquals(2, surface.getGutterDecorations().size)
        assertEquals("Added line", surface.getGutterDecorations()[0].tooltip)
    }

    @Test
    fun testEditorSessionDirtyAndSaveLifecycle() {
        val connRef = ConnectionRef("srv-1", 1L)
        val surface = AndroidEditorSurface()
        val session = EditorSession("src/main.rs", "proj-1", connRef, surface)

        session.loadServerContent("fn main() {}", mtime = 1700000000L)
        assertFalse(session.isDirty)
        assertFalse(session.canSave(), "Unmodified document cannot be saved")

        // Make edit
        surface.applyEdit(
            EditorTextEdit(
                range = EditorTextRange(EditorTextPosition(1, 1), EditorTextPosition(1, 3)),
                newText = "pub fn"
            )
        )
        assertTrue(session.isDirty)
        assertTrue(session.canSave(), "Dirty document can be saved")

        // Save
        session.markSaved(1700000001L)
        assertFalse(session.isDirty)
        assertEquals(1700000001L, session.serverMtime)
        assertFalse(session.canSave())

        session.close()
    }
}
