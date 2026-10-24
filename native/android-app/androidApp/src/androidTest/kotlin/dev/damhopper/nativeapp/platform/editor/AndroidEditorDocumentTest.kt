package dev.damhopper.nativeapp.platform.editor

import androidx.activity.ComponentActivity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.features.editor.DocumentEvent
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import io.github.rosemoe.sora.text.UndoManager
import io.github.rosemoe.sora.widget.CodeEditor
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlin.test.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidEditorDocumentTest {

    private var defaultMergeLimit: Long = 8000L

    @BeforeTest
    fun setUp() {
        defaultMergeLimit = UndoManager.getMergeTimeLimit()
        UndoManager.setMergeTimeLimit(0L)
    }

    @AfterTest
    fun tearDown() {
        UndoManager.setMergeTimeLimit(defaultMergeLimit)
    }

    private fun testDocId(path: String = "Test.kt"): DocumentId = DocumentId(
        owner = WorkspaceFileOwner(
            profileId = "p-test",
            baseUrl = "https://127.0.0.1:4801",
            accountUser = "dev-user",
            project = "proj",
            worktreePath = null
        ),
        relativePath = path,
        tabIncarnation = 1L
    )

    @Test
    fun testDocumentDeltaEventsAndStateFlows() = runBlocking {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "val a = 1\nval b = 2\n",
            initialMtime = 1000L
        )

        assertEquals(1L, doc.revision.value)
        assertFalse(doc.isDirty.value)
        assertFalse(doc.canUndo.value)

        // Apply programmatic delta edit and assert DocumentEvent is published
        val eventDeferred = async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            kotlinx.coroutines.withTimeout(2000L) { doc.events.first() }
        }
        doc.applyEdit(startLine = 1, startCol = 9, endLine = 1, endCol = 10, replacement = "100")
        val event = eventDeferred.await()
        assertTrue(event is DocumentEvent.ContentChanged)
        assertEquals(2L, (event as DocumentEvent.ContentChanged).revision)
        assertTrue(event.isDirty)
        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        val snapshot = doc.snapshotForSave()
        assertEquals(2L, snapshot.revision)
        assertEquals(1000L, snapshot.mtime)
        assertContentEquals("val a = 100\nval b = 2\n".encodeToByteArray(), snapshot.utf8Bytes)

        doc.close()
    }

    @Test
    fun testReattachmentPreservesViewStateAcrossWidgetRecreation() {
        val doc = AndroidEditorDocument(
            id = testDocId("Sample.java"),
            initialText = (1..50).joinToString("\n") { "int x$it = $it;" },
            initialMtime = 1000L
        )

        ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val editor1 = CodeEditor(activity)
                doc.attachEditor(editor1, useJavaSyntax = true)
                editor1.setSelectionRegion(5, 2, 5, 8, false)
                editor1.scroller.forceFinished(true)
                editor1.scroller.startScroll(0, 150, 0, 0, 0)
                editor1.scroller.abortAnimation()

                // Detach view captures view state
                doc.detachEditor(editor1)
                assertEquals(5, doc.viewState.value.cursorLine)
                assertEquals(150, doc.viewState.value.scrollY)
            }

            scenario.recreate()

            scenario.onActivity { activity ->
                val editor2 = CodeEditor(activity)
                doc.attachEditor(editor2, useJavaSyntax = true)
                doc.restoreViewState(editor2)

                assertEquals(150, editor2.offsetY)
                assertEquals(5, editor2.cursor.leftLine)
                doc.detachEditor(editor2)
            }

            doc.close()
        }
    }

    @Test
    fun testSearchAndMatchNavigation() {
        val text = "fun alpha() {}\nfun beta() {}\nfun alphaTwo() {}\n"
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = text,
            initialMtime = 1000L
        )

        assertTrue(doc.find("alpha", ignoreCase = true))
        assertEquals(0, doc.viewState.value.cursorLine)
        assertEquals(9, doc.viewState.value.cursorColumn)
        assertEquals(4, doc.viewState.value.selectionStart)
        assertEquals(9, doc.viewState.value.selectionEnd)

        // nextMatch finds the second occurrence on line 2
        assertTrue(doc.nextMatch())
        assertEquals(2, doc.viewState.value.cursorLine)

        // previousMatch wraps back to line 0
        assertTrue(doc.previousMatch())
        assertEquals(0, doc.viewState.value.cursorLine)

        doc.close()
    }

    @Test
    fun testReadOnlyPolicyGuardsEdits() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "immutable text",
            initialMtime = 1000L,
            readOnly = true
        )

        assertTrue(doc.isReadOnly.value)
        doc.applyEdit(1, 1, 1, 10, "mutated")
        assertContentEquals("immutable text".encodeToByteArray(), doc.snapshotBytes())
        assertEquals(1L, doc.revision.value)
        assertFalse(doc.canUndo.value)

        doc.close()
    }

    @Test
    fun testReplaceFromLoadWithSuppression() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "original",
            initialMtime = 1000L
        )

        doc.applyEdit(1, 1, 1, 9, "dirty edit")
        assertTrue(doc.isDirty.value)

        doc.replaceFromLoad("completely replaced content", expectedMtime = 2000L)
        assertFalse(doc.isDirty.value)
        assertEquals(2000L, doc.snapshotForSave().mtime)
        assertContentEquals("completely replaced content".encodeToByteArray(), doc.snapshotBytes())
        assertFalse(doc.canUndo.value)

        doc.close()
    }
}
