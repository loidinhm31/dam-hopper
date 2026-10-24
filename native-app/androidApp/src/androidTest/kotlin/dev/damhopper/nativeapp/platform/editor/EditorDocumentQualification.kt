package dev.damhopper.nativeapp.platform.editor

import android.os.SystemClock
import android.util.Log
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.text.Content
import io.github.rosemoe.sora.text.UndoManager
import io.github.rosemoe.sora.widget.CodeEditor
import java.lang.ref.WeakReference
import kotlin.test.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EditorDocumentQualification {
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

    private fun qualDocId(name: String = "Qual.java"): DocumentId = DocumentId(
        owner = WorkspaceFileOwner(
            profileId = "p-qual",
            baseUrl = "https://127.0.0.1:4801",
            accountUser = "dev-user",
            project = "proj",
            worktreePath = null
        ),
        relativePath = name,
        tabIncarnation = 1L
    )

    private fun mountEditor(activity: ComponentActivity, doc: AndroidEditorDocument): CodeEditor = CodeEditor(activity).also { ed ->
        activity.setContentView(ed, FrameLayout.LayoutParams(900, 700))
        ed.measure(MeasureSpec.makeMeasureSpec(900, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(700, MeasureSpec.EXACTLY))
        ed.layout(0, 0, 900, 700)
        doc.attachEditor(ed, useJavaSyntax = true)
    }

    private fun awaitEditorReady(scenario: ActivityScenario<ComponentActivity>, editor: CodeEditor) {
        val inst = InstrumentationRegistry.getInstrumentation()
        repeat(50) {
            inst.waitForIdleSync()
            var ok = false
            scenario.onActivity { ok = editor.isEditable }
            if (ok) return
            Thread.sleep(20)
        }
        fail("CodeEditor remained layoutBusy / non-editable")
    }

    private fun awaitCleared(ref: WeakReference<*>?, label: String) {
        val deadline = SystemClock.uptimeMillis() + 3_000L
        while (ref?.get() != null && SystemClock.uptimeMillis() < deadline) {
            System.gc()
            System.runFinalization()
            Thread.sleep(25)
        }
        assertNull(ref?.get(), "$label must be GC-collected")
    }

    @Test
    fun qualifyRetainedDocumentReattachmentSavePointAndImeBoundary() {
        val baseLines = (1..80).joinToString("\n") {
            if (it == 2) "public class Line2 { String s = \"λ-🚀\"; }\r" else "public class Line$it { int v = $it; }"
        }
        val doc = AndroidEditorDocument(qualDocId(), baseLines, initialMtime = 1000L, maxUndoStackSize = 100)
        val expectedPostImeBytes = ("// b1\n// b2\n/*ime-α*/" + baseLines).encodeToByteArray()
        var oldActivityRef: WeakReference<ComponentActivity>? = null
        var oldEditorRef: WeakReference<CodeEditor>? = null
        var editor1: CodeEditor? = null
        var editor2: CodeEditor? = null

        ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
            scenario.onActivity { editor1 = mountEditor(it, doc) }
            awaitEditorReady(scenario, assertNotNull(editor1))

            scenario.onActivity { activity ->
                val editor = assertNotNull(editor1).also { doc.restoreViewState(it) }
                assertFalse(doc.isDirty.value)

                doc.content.beginBatchEdit()
                doc.content.insert(0, 0, "// ")
                doc.content.beginBatchEdit()
                doc.content.insert(0, 3, "b1\n")
                doc.content.endBatchEdit()
                doc.content.resetBatchEdit()

                doc.markSaved(doc.revision.value, 1100L)
                assertFalse(doc.isDirty.value)

                doc.content.beginBatchEdit()
                doc.content.insert(1, 0, "// b2\n")
                doc.content.endBatchEdit()
                assertTrue(doc.isDirty.value)

                editor.undo()
                assertFalse(doc.isDirty.value)
                editor.undo()
                assertTrue(doc.isDirty.value)

                editor.redo()
                assertFalse(doc.isDirty.value)
                editor.redo()
                assertTrue(doc.isDirty.value)

                val ic = assertNotNull(editor.onCreateInputConnection(EditorInfo()))
                assertTrue(ic.setComposingText("/*ime-α*/", 1))
                assertTrue(editor.hasComposingText())

                editor.setSelectionRegion(2, 0, 2, 6, false)
                editor.scroller.forceFinished(true)
                editor.scroller.startScroll(0, 240, 0, 0, 0)
                editor.scroller.abortAnimation()

                oldActivityRef = WeakReference(activity)
                oldEditorRef = WeakReference(editor)

                doc.detachEditor(editor)
                assertFalse(editor.hasComposingText())
                assertFalse(doc.content.isInBatchEdit)
                assertContentEquals(expectedPostImeBytes, doc.snapshotBytes())
                (editor.parent as? ViewGroup)?.removeView(editor)
            }

            editor1 = null
            scenario.recreate()

            scenario.onActivity { editor2 = mountEditor(it, doc) }
            awaitEditorReady(scenario, assertNotNull(editor2))

            scenario.onActivity {
                val newEditor = assertNotNull(editor2).also { doc.restoreViewState(it) }
                assertEquals(240, newEditor.offsetY)
                assertEquals(2, newEditor.cursor.leftLine)
                assertEquals(6, newEditor.cursor.rightColumn)
                assertTrue(newEditor.canUndo())
                assertContentEquals(expectedPostImeBytes, doc.snapshotBytes())

                newEditor.undo()
                newEditor.undo()
                assertFalse(doc.isDirty.value)
                assertContentEquals(("// b1\n" + baseLines).encodeToByteArray(), doc.snapshotBytes())

                newEditor.undo()
                assertTrue(doc.isDirty.value)
                doc.content.insert(0, 0, "// branch\n")
                assertFalse(newEditor.canRedo())
                assertTrue(doc.isDirty.value)

                assertTrue(doc.find("Line10", ignoreCase = false))
                assertEquals(10, newEditor.cursor.leftLine)
                assertTrue(doc.find("Line2", ignoreCase = false))
                assertEquals(2, newEditor.cursor.leftLine)

                newEditor.isEditable = false
                assertFalse(newEditor.isEditable)
                assertNull(newEditor.onCreateInputConnection(EditorInfo()))
                newEditor.isEditable = true

                newEditor.setEditorLanguage(EmptyLanguage())
                val boundaryLine = "a".repeat(4095) + "🚀" + "b".repeat(100) + "\r\nline 2"
                doc.replaceFromLoad(boundaryLine, 1200L)
                assertFalse(doc.isDirty.value)
                assertFalse(newEditor.canUndo())
                assertContentEquals(boundaryLine.encodeToByteArray(), doc.snapshotBytes())

                doc.detachEditor(newEditor)
                (newEditor.parent as? ViewGroup)?.removeView(newEditor)
            }

            editor2 = null
            awaitCleared(oldEditorRef, "Detached CodeEditor")
            awaitCleared(oldActivityRef, "Recreated ComponentActivity")
            doc.close()
        }

        val batchDoc = AndroidEditorDocument(qualDocId("Batch.java"), "init", 2000L, maxUndoStackSize = 10, maxUndoBytes = 4)
        batchDoc.content.beginBatchEdit()
        batchDoc.content.insert(0, 0, "ABC")
        batchDoc.content.insert(0, 3, "x")
        batchDoc.content.endBatchEdit()
        batchDoc.markSaved(batchDoc.revision.value, 2100L)
        assertFalse(batchDoc.isDirty.value)
        assertEquals(2, batchDoc.getBudgetMetrics().undoStackBytes.toInt())

        batchDoc.undo()
        assertTrue(batchDoc.isDirty.value)
        assertContentEquals("ABCinit".encodeToByteArray(), batchDoc.snapshotBytes())

        batchDoc.redo()
        assertFalse(batchDoc.isDirty.value)
        assertContentEquals("ABCxinit".encodeToByteArray(), batchDoc.snapshotBytes())
        batchDoc.close()
    }

    private fun usedBytes(): Long {
        val rt = Runtime.getRuntime()
        System.gc()
        System.runFinalization()
        Thread.sleep(25)
        return rt.totalMemory() - rt.freeMemory()
    }

    private fun run1MiBScope(near1MiB: String): Pair<WeakReference<Content>, String> {
        val base1 = usedBytes()
        val doc1 = AndroidEditorDocument(qualDocId("1MiB.txt"), near1MiB, 3000L, maxUndoStackSize = 200, maxUndoBytes = 1000)
        val ref = WeakReference(doc1.content)
        doc1.markSaved(doc1.revision.value, 3000L)
        repeat(210) { i -> doc1.content.insert(0, 0, "x$i") }
        val mem1 = (usedBytes() - base1).coerceAtLeast(0L)
        val undo1 = doc1.getBudgetMetrics().undoStackBytes.toInt()
        assertEquals(1000, undo1)
        val snap1 = doc1.snapshotBytes()
        val postSnap1 = (usedBytes() - base1).coerceAtLeast(mem1)
        assertTrue(snap1.contentEquals(((209 downTo 0).joinToString("") { "x$it" } + near1MiB).encodeToByteArray()))
        var undos1 = 0
        while (doc1.canUndo.value) {
            doc1.undo()
            undos1++
        }
        assertEquals(130, undos1)
        assertTrue(doc1.isDirty.value)
        doc1.content.replace(0, 0, 0, 4, "ABCD")
        assertEquals(16, doc1.getBudgetMetrics().undoStackBytes.toInt())
        doc1.content.insert(0, 0, "Z".repeat(600))
        assertEquals(0, doc1.getBudgetMetrics().undoStackBytes.toInt())
        assertFalse(doc1.canUndo.value)
        doc1.close()
        return ref to "mem1MiB=$mem1 postSnap1=$postSnap1 undo1=$undo1"
    }

    private fun run5MiBScope(near5MiB: String): Pair<WeakReference<Content>, String> {
        val base5 = usedBytes()
        val doc5 = AndroidEditorDocument(qualDocId("5MiB.txt"), near5MiB, 4000L, maxUndoStackSize = 50, maxUndoBytes = 2048)
        val ref = WeakReference(doc5.content)
        doc5.markSaved(doc5.revision.value, 4000L)
        repeat(55) { i -> doc5.content.insert(0, 0, "y$i") }
        val mem5 = (usedBytes() - base5).coerceAtLeast(0L)
        val undo5 = doc5.getBudgetMetrics().undoStackBytes.toInt()
        assertEquals(290, undo5)
        val snap5 = doc5.snapshotBytes()
        val postSnap5 = (usedBytes() - base5).coerceAtLeast(mem5)
        assertTrue(snap5.contentEquals(((54 downTo 0).joinToString("") { "y$it" } + near5MiB).encodeToByteArray()))
        var undos5 = 0
        while (doc5.canUndo.value) {
            doc5.undo()
            undos5++
        }
        assertEquals(50, undos5)
        assertTrue(doc5.isDirty.value)
        doc5.close()
        return ref to "mem5MiB=$mem5 postSnap5=$postSnap5 undo5=$undo5"
    }

    @Test
    fun qualifyTierMemoryAndBoundedUndoRetention() {
        val unit = "0123456789abcdef".repeat(4) + "\n"
        val (ref1, m1) = run1MiBScope(unit.repeat(16_000))
        awaitCleared(ref1, "Released 1MiB Content")
        val (ref5, m5) = run5MiBScope(unit.repeat(78_000))
        awaitCleared(ref5, "Released 5MiB Content")
        Log.i("EditorDocQual", "$m1 $m5")
    }
}
