package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.*

class EditorSessionTest {

    private val target = ProjectTargetRef(project = "test-project")

    private fun createSession(
        key: String = "file::p1::test-project::.::main.ts",
        profileId: String = "p1",
        projectTarget: ProjectTargetRef = target,
        path: String = "main.ts",
        initialContent: String = "",
        initialMtime: Long = 100L,
        readOnly: Boolean = false,
        maxUndoStackSize: Int = 200,
        maxUndoBytes: Long = 2_097_152L,
    ): EditorSession {
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = "http://127.0.0.1:4803",
            accountUser = "dev-user",
            project = projectTarget.project,
            worktreePath = projectTarget.worktreePath
        )
        val docId = DocumentId(owner = owner, relativePath = path, tabIncarnation = 1L)
        val doc = TestEditorDocument(
            id = docId,
            initialText = initialContent,
            initialMtime = initialMtime,
            readOnly = readOnly,
            maxUndoStackSize = maxUndoStackSize,
            maxUndoBytes = maxUndoBytes
        )
        return EditorSession(
            document = doc,
            key = key,
            profileId = profileId,
            target = projectTarget,
            path = path,
            sessionIncarnation = 1L,
            initialMtime = initialMtime,
            isReadOnly = readOnly
        )
    }

    @Test
    fun testTextEditingAndDirtyTracking() {
        val session = createSession(initialContent = "const x = 1;\n", initialMtime = 100L)

        assertFalse(session.isDirty)
        assertEquals("const x = 1;\n", session.getText())
        assertEquals(1L, session.modelVersion)
        assertEquals(1L, session.editEpoch)

        session.setText("const x = 2;\n")
        assertTrue(session.isDirty)
        assertEquals(2L, session.modelVersion)
        assertEquals(2L, session.editEpoch)

        // Undo back to initial content restores clean state
        session.undo()
        assertFalse(session.isDirty)
        assertEquals("const x = 1;\n", session.getText())
    }

    @Test
    fun testUndoRedoBoundedHistory() {
        val session = createSession(initialContent = "v0", maxUndoStackSize = 2)

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
        val session = createSession(initialContent = "val foo = 1;\nval bar = foo + foo;\n")

        session.openFindReplace("foo", caseSensitive = true)
        assertEquals(3, session.findReplaceState.totalMatches)

        val m1 = session.findNext()
        assertNotNull(m1)

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
        val session = createSession(initialContent = "line 1\n", initialMtime = 100L)

        session.setText("line 1\nline 2\n")
        assertTrue(session.isDirty)

        // 1. Begin save captures snapshot
        val (submittedSnapshot, epoch) = session.beginSave()!!
        assertEquals("line 1\nline 2\n", submittedSnapshot)
        assertEquals(session.editEpoch, epoch)

        // 2. User types "line 3" while save request is in-flight on network
        session.setText("line 1\nline 2\nline 3\n")
        assertEquals(epoch + 1, session.editEpoch)

        // 3. Save finishes successfully with new server mtime
        session.completeSave(savedMtime = 200L, submittedSnapshot = submittedSnapshot)

        // CRITICAL INVARIANT: intermediate keystrokes keep session dirty!
        assertEquals(200L, session.serverMtime)
        assertEquals("line 1\nline 2\nline 3\n", session.getText())
        assertTrue(session.isDirty, "Session must remain dirty when modified during save request")
    }

    @Test
    fun testDocumentBudgetMetricsAndRetention() {
        val session = createSession(initialContent = "hello world\n", initialMtime = 100L)
        val metrics = session.document.getBudgetMetrics()
        assertTrue(metrics.utf8Length > 0L)
        assertTrue(metrics.estimatedRetainedBytes > 0L)
        assertEquals(0, metrics.undoStackSize)

        session.setText("hello world 2\n")
        val updatedMetrics = session.document.getBudgetMetrics()
        assertEquals(1, updatedMetrics.undoStackSize)
        assertTrue(updatedMetrics.undoStackBytes > 0L)
    }

    @Test
    fun testReadOnlyDocumentBlocksEditsAndUndo() {
        val session = createSession(initialContent = "read only content", readOnly = true)
        assertTrue(session.isReadOnly)
        assertFalse(session.canUndo())
        assertFalse(session.canRedo())

        session.setText("attempted change")
        assertEquals("read only content", session.getText())
        assertFalse(session.isDirty)

        assertNull(session.beginSave())
        assertFalse(session.undo())
        assertFalse(session.redo())
    }
}
