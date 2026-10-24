package dev.damhopper.nativeapp.platform.editor

import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AndroidEditorSurfaceTest {

    private fun testOwner(): WorkspaceFileOwner = WorkspaceFileOwner(
        profileId = "profile-1",
        baseUrl = "https://127.0.0.1:4801",
        accountUser = "test-user",
        project = "project-1",
        worktreePath = null
    )

    private fun testDocId(path: String = "src/Main.java"): DocumentId = DocumentId(
        owner = testOwner(),
        relativePath = path,
        tabIncarnation = 1L
    )

    @Test
    fun testFactoryCreatesDocumentWithCorrectInitialState() {
        val factory = AndroidEditorDocumentFactory()
        val docId = testDocId()
        val doc = factory.createDocument(
            id = docId,
            initialText = "public class Main {\n}\n",
            initialMtime = 1700000000L,
            readOnly = false
        )

        assertEquals(docId, doc.id)
        assertEquals(1L, doc.revision.value)
        assertEquals(22, doc.length.value)
        assertEquals(3, doc.lineCount.value)
        assertFalse(doc.isDirty.value)
        assertFalse(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        assertFalse(doc.isReadOnly.value)

        val snapshot = doc.snapshotForSave()
        assertEquals(docId, snapshot.id)
        assertEquals(1L, snapshot.revision)
        assertEquals(1700000000L, snapshot.mtime)
        assertContentEquals("public class Main {\n}\n".encodeToByteArray(), snapshot.utf8Bytes)
        doc.close()
    }

    @Test
    fun testTextEditAndRevisionLifecycle() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "line 1\nline 2\nline 3",
            initialMtime = 1000L
        )

        assertEquals(1L, doc.revision.value)
        assertFalse(doc.isDirty.value)

        // Replace "line 2" with "line two updated" (lines are 1-indexed in applyEdit)
        doc.applyEdit(
            startLine = 2,
            startCol = 1,
            endLine = 2,
            endCol = 7,
            replacement = "line two updated"
        )

        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertFalse(doc.canRedo.value)

        val snapshot = doc.snapshotForSave()
        assertContentEquals("line 1\nline two updated\nline 3".encodeToByteArray(), snapshot.utf8Bytes)
        doc.close()
    }

    @Test
    fun testUndoRedoStackAndSavePointTracking() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "initial text",
            initialMtime = 2000L
        )

        doc.applyEdit(1, 1, 1, 8, "modified")
        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)

        // Mark revision 2 as saved baseline
        doc.markSaved(savedRevision = 2L, newMtime = 2100L)
        assertFalse(doc.isDirty.value)

        // Undo edit -> reverts to initial text, revision revisits 1L, dirty is true because != saved revision (2L)
        doc.undo()
        assertFalse(doc.canUndo.value)
        assertTrue(doc.canRedo.value)
        assertTrue(doc.isDirty.value)
        assertContentEquals("initial text".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)

        // Redo edit -> restored to revision 2L, dirty becomes false
        doc.redo()
        assertTrue(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        assertFalse(doc.isDirty.value)
        assertContentEquals("modified text".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        doc.close()
    }

    @Test
    fun testNativeContentUndoUpdatesRevisionAndDirtyState() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "base text",
            initialMtime = 1000L
        )

        doc.applyEdit(1, 1, 1, 5, "updated")
        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)

        // Mark revision 2 as saved baseline
        doc.markSaved(2L, 1100L)
        assertFalse(doc.isDirty.value)

        // Native widget calling content.undo() directly (bypassing doc.undo())
        assertTrue(doc.content.canUndo())
        doc.content.undo()
        // Verify state is published even when triggered directly from native Content
        assertEquals(1L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertFalse(doc.canUndo.value)
        assertTrue(doc.canRedo.value)

        // Native widget calling content.redo() directly
        doc.content.redo()
        assertEquals(2L, doc.revision.value)
        assertFalse(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        doc.close()
    }

    @Test
    fun testReadOnlyGuard() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "readonly content",
            initialMtime = 3000L,
            readOnly = true
        )

        assertTrue(doc.isReadOnly.value)
        doc.applyEdit(1, 1, 1, 9, "writable")

        // Content unchanged
        assertContentEquals("readonly content".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        assertEquals(1L, doc.revision.value)
        assertFalse(doc.isDirty.value)

        // Unlocking readOnly allows editing
        doc.setReadOnly(false)
        assertFalse(doc.isReadOnly.value)
        doc.applyEdit(1, 1, 1, 9, "writable")
        assertContentEquals("writable content".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        assertTrue(doc.isDirty.value)
        doc.close()
    }

    @Test
    fun testReplaceFromLoadResetsUndoAndEstablishesBaseline() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "old text",
            initialMtime = 4000L
        )

        doc.applyEdit(1, 1, 1, 4, "edited")
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)

        // Programmatic replace from reload
        doc.replaceFromLoad(text = "reloaded fresh content from server", expectedMtime = 4500L)

        assertFalse(doc.isDirty.value)
        assertFalse(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        assertContentEquals("reloaded fresh content from server".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        assertEquals(4500L, doc.snapshotForSave().mtime)
        doc.close()
    }

    @Test
    fun testBudgetMetricsAccounting() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "short",
            initialMtime = 5000L,
            maxUndoStackSize = 50,
            maxUndoBytes = 1024L
        )

        val metrics0 = doc.getBudgetMetrics()
        assertEquals(5L, metrics0.utf8Length)
        assertEquals(0L, metrics0.undoStackBytes)
        assertEquals(0, metrics0.undoStackSize)

        doc.applyEdit(1, 1, 1, 6, "longer text for metrics")
        val metrics1 = doc.getBudgetMetrics()
        assertEquals(23L, metrics1.utf8Length)
        assertTrue(metrics1.undoStackBytes > 0L)
        assertEquals(1, metrics1.undoStackSize)
        doc.close()
    }
}
