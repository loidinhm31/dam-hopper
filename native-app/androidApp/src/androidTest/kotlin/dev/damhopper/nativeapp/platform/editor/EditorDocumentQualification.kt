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
import io.github.rosemoe.sora.event.*
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.langs.java.JavaLanguage
import io.github.rosemoe.sora.text.*
import io.github.rosemoe.sora.widget.*
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import kotlin.test.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EditorDocumentQualification {
    private var defaultMergeLimit: Long = 8000L
    @BeforeTest fun setUp() { defaultMergeLimit = UndoManager.getMergeTimeLimit(); UndoManager.setMergeTimeLimit(0L) }
    @AfterTest fun tearDown() { UndoManager.setMergeTimeLimit(defaultMergeLimit) }

    private class RetainedNativeDoc(initialText: String, val maxUndo: Int = 200, val maxUndoBytes: Int = 2 * 1024 * 1024) : ContentListener {
        private var nextRev = 1L; private var stackIndex = 0; private var savedRev = 1L
        private val revStack = ArrayList<Long>().apply { add(1L) }
        private val payloadBytes = ArrayList<Int>().apply { add(0) }
        private var suppressDelta = false; private var inReplaceOp = false; private var batchPushed = false
        private var pendingReplaceDeleteChars = 0
        var deltaCount = 0; private set
        var replaceCount = 0; private set
        var scrollX = 0; var scrollY = 0; var selLeftLine = 0; var selLeftCol = 0; var selRightLine = 0; var selRightCol = 0
        private var receipt: SubscriptionReceipt<ContentChangeEvent>? = null

        val content: Content = object : Content(initialText, true) {
            override fun undo(): TextRange? = if (!canUndo() || isUndoManagerWorking) null else super.undo().also { if (stackIndex > 0) stackIndex-- }
            override fun redo() { if (canRedo() && !isUndoManagerWorking) { super.redo(); if (stackIndex < revStack.lastIndex) stackIndex++ } }
            override fun endBatchEdit(): Boolean = super.endBatchEdit().also { if (!it) batchPushed = false }
            override fun resetBatchEdit() { while (isInBatchEdit) endBatchEdit(); super.resetBatchEdit(); batchPushed = false }
        }.also { it.setMaxUndoStackSize(maxUndo); it.addContentListener(this) }

        val revision: Long get() = revStack[stackIndex]
        val isDirty: Boolean get() = revision != savedRev
        val undoStackBytes: Int get() = payloadBytes.sum()

        private fun evictOldestLedgerEntry() {
            revStack.removeAt(0); payloadBytes.removeAt(0); payloadBytes[0] = 0; stackIndex--
        }

        private fun enforceUndoBounds() {
            while (stackIndex > 1 && revStack.size - 1 > maxUndo) evictOldestLedgerEntry()
            while (stackIndex > 1 && undoStackBytes > maxUndoBytes) {
                content.setMaxUndoStackSize((revStack.size - 2).coerceAtLeast(1))
                evictOldestLedgerEntry()
            }
            content.setMaxUndoStackSize(maxUndo)
            if (undoStackBytes > maxUndoBytes) {
                val curRev = revStack[stackIndex]
                content.setUndoEnabled(false); content.setUndoEnabled(true); content.setMaxUndoStackSize(maxUndo)
                revStack.clear(); revStack.add(curRev); payloadBytes.clear(); payloadBytes.add(0); stackIndex = 0
                batchPushed = false
            }
        }

        private fun recordEditStep(changedChars: Int) {
            if (suppressDelta || content.isUndoManagerWorking) return
            while (revStack.lastIndex > stackIndex) { revStack.removeAt(revStack.lastIndex); payloadBytes.removeAt(payloadBytes.lastIndex) }
            val rev = ++nextRev; val bytes = changedChars * 2
            if (content.isInBatchEdit) {
                if (!batchPushed) { revStack.add(rev); payloadBytes.add(bytes); stackIndex++; batchPushed = true }
                else { revStack[stackIndex] = rev; payloadBytes[stackIndex] += bytes }
            } else { revStack.add(rev); payloadBytes.add(bytes); stackIndex++ }
            enforceUndoBounds(); deltaCount++
        }

        override fun beforeModification(c: Content) { if (!c.isInBatchEdit) batchPushed = false }
        override fun beforeReplace(c: Content) { if (!suppressDelta && !c.isUndoManagerWorking) { inReplaceOp = true; pendingReplaceDeleteChars = 0 } }
        override fun afterDelete(c: Content, sl: Int, sc: Int, el: Int, ec: Int, d: CharSequence) {
            if (inReplaceOp) pendingReplaceDeleteChars = d.length else recordEditStep(d.length)
        }
        override fun afterInsert(c: Content, sl: Int, sc: Int, el: Int, ec: Int, i: CharSequence) {
            val del = if (inReplaceOp) pendingReplaceDeleteChars else 0
            inReplaceOp = false; pendingReplaceDeleteChars = 0; recordEditStep(i.length + del)
        }
        fun undo(): Boolean = content.canUndo().also { if (it) content.undo() }
        fun redo(): Boolean = content.canRedo().also { if (it) content.redo() }
        fun markSaved(rev: Long = revision) { savedRev = rev }

        fun replaceFromLoad(newText: String) {
            suppressDelta = true
            try {
                content.setUndoEnabled(false)
                if (content.length > 0) { val last = content.lineCount - 1; content.delete(0, 0, last, content.getColumnCount(last)) }
                if (newText.isNotEmpty()) content.insert(0, 0, newText)
                content.setUndoEnabled(true); content.setMaxUndoStackSize(maxUndo)
            } finally { suppressDelta = false }
            val rev = ++nextRev; revStack.clear(); revStack.add(rev); payloadBytes.clear(); payloadBytes.add(0)
            stackIndex = 0; savedRev = rev; batchPushed = false; replaceCount++
        }

        fun snapshotBytes(): ByteArray {
            val out = ByteArrayOutputStream(content.length.coerceAtLeast(16))
            val enc = Charsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)
            val bBuf = ByteBuffer.allocate(8192)
            val last = content.lineCount - 1
            content.runReadActionsOnLines(0, last, Content.ContentLineConsumer2 { _, line, _ ->
                val len = line.length
                if (len > 0) {
                    enc.reset()
                    val cBuf = CharBuffer.wrap(line, 0, len)
                    while (true) {
                        bBuf.clear()
                        val res = enc.encode(cBuf, bBuf, true)
                        if (bBuf.position() > 0) out.write(bBuf.array(), 0, bBuf.position())
                        if (res.isUnderflow) break
                    }
                    bBuf.clear(); enc.flush(bBuf); if (bBuf.position() > 0) out.write(bBuf.array(), 0, bBuf.position())
                }
                val sep = line.lineSeparator.content; if (sep.isNotEmpty()) out.write(sep.encodeToByteArray())
            })
            return out.toByteArray()
        }

        fun find(editor: CodeEditor, query: String, forward: Boolean = true, ignoreCase: Boolean = false): Boolean {
            if (query.isEmpty()) return false
            val cur = editor.cursor; val total = content.lineCount; val startL = if (forward) cur.rightLine else cur.leftLine
            for (step in 0..total) {
                val idx = if (forward) (startL + step) % total else (startL - step + total * 2) % total
                val line = content.getLine(idx)
                val col = if (forward) {
                    val from = if (step == 0) cur.rightColumn else 0
                    if (from <= line.length) TextUtils.indexOf(line, query, ignoreCase, from) else -1
                } else {
                    val limit = if (step == 0) (cur.leftColumn - query.length).coerceAtLeast(-1) else line.length
                    var lastMatch = -1; var pos = 0
                    while (pos <= limit) { val f = TextUtils.indexOf(line, query, ignoreCase, pos); if (f < 0 || f > limit) break; lastMatch = f; pos = f + 1 }
                    lastMatch
                }
                if (col >= 0) { editor.setSelectionRegion(idx, col, idx, col + query.length, false, SelectionChangeEvent.CAUSE_SEARCH); return true }
            }
            return false
        }

        fun attach(editor: CodeEditor, useJavaSyntax: Boolean) {
            check(editor.isUndoEnabled) { "CodeEditor undoEnabled must be true before setText" }
            editor.setEditorLanguage(if (useJavaSyntax) JavaLanguage() else EmptyLanguage())
            editor.setText(content, true, null)
            receipt = editor.subscribeEvent(ContentChangeEvent::class.java) { ev, _ -> if (ev.action == ContentChangeEvent.ACTION_SET_NEW_TEXT) return@subscribeEvent }
        }

        fun restoreViewState(editor: CodeEditor) {
            editor.setSelectionRegion(selLeftLine, selLeftCol, selRightLine, selRightCol, false)
            editor.scroller.forceFinished(true); editor.scroller.startScroll(scrollX, scrollY, 0, 0, 0)
            editor.scroller.abortAnimation(); editor.eventHandler.scrollBy(0f, 0f)
        }

        fun detach(editor: CodeEditor) {
            if (editor.hasComposingText()) editor.restartInput()
            content.resetBatchEdit()
            val cur = editor.cursor; selLeftLine = cur.leftLine; selLeftCol = cur.leftColumn; selRightLine = cur.rightLine; selRightCol = cur.rightColumn
            scrollX = editor.offsetX; scrollY = editor.offsetY; receipt?.unsubscribe(); receipt = null
            editor.hideSoftInput(); editor.clearFocus(); editor.release()
        }

        fun close() {
            receipt?.unsubscribe(); receipt = null
            content.removeContentListener(this); content.setUndoEnabled(false)
        }
    }

    private fun mountEditor(activity: ComponentActivity, doc: RetainedNativeDoc): CodeEditor = CodeEditor(activity).also { ed ->
        activity.setContentView(ed, FrameLayout.LayoutParams(900, 700))
        ed.measure(MeasureSpec.makeMeasureSpec(900, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(700, MeasureSpec.EXACTLY))
        ed.layout(0, 0, 900, 700); doc.attach(ed, useJavaSyntax = true)
    }

    private fun awaitEditorReady(scenario: ActivityScenario<ComponentActivity>, editor: CodeEditor) {
        val inst = InstrumentationRegistry.getInstrumentation()
        repeat(50) { inst.waitForIdleSync(); var ok = false; scenario.onActivity { ok = editor.isEditable }; if (ok) return; Thread.sleep(20) }
        fail("CodeEditor remained layoutBusy / non-editable")
    }

    private fun awaitCleared(ref: WeakReference<*>?, label: String) {
        val deadline = SystemClock.uptimeMillis() + 3_000L
        while (ref?.get() != null && SystemClock.uptimeMillis() < deadline) { System.gc(); System.runFinalization(); Thread.sleep(25) }
        assertNull(ref?.get(), "$label must be GC-collected")
    }
    @Test
    fun qualifyRetainedDocumentReattachmentSavePointAndImeBoundary() {
        val baseLines = (1..80).joinToString("\n") { if (it == 2) "public class Line2 { String s = \"λ-🚀\"; }\r" else "public class Line$it { int v = $it; }" }
        val doc = RetainedNativeDoc(baseLines, maxUndo = 100)
        val expectedPostImeBytes = ("// b1\n// b2\n/*ime-α*/" + baseLines).encodeToByteArray()
        var oldActivityRef: WeakReference<ComponentActivity>? = null; var oldEditorRef: WeakReference<CodeEditor>? = null
        var editor1: CodeEditor? = null; var editor2: CodeEditor? = null
        ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
            scenario.onActivity { editor1 = mountEditor(it, doc) }; awaitEditorReady(scenario, assertNotNull(editor1))
            scenario.onActivity { activity ->
                val editor = assertNotNull(editor1).also { doc.restoreViewState(it) }
                assertFalse(doc.isDirty); assertEquals(0, doc.deltaCount)
                doc.content.beginBatchEdit(); doc.content.insert(0, 0, "// "); doc.content.beginBatchEdit(); doc.content.insert(0, 3, "b1\n"); doc.content.endBatchEdit(); doc.content.resetBatchEdit()
                doc.markSaved(); assertFalse(doc.isDirty)
                doc.content.beginBatchEdit(); doc.content.insert(1, 0, "// b2\n"); doc.content.endBatchEdit(); assertTrue(doc.isDirty)
                editor.undo(); assertFalse(doc.isDirty); editor.undo(); assertTrue(doc.isDirty)
                editor.redo(); assertFalse(doc.isDirty); editor.redo(); assertTrue(doc.isDirty)
                val ic = assertNotNull(editor.onCreateInputConnection(EditorInfo()))
                assertTrue(ic.setComposingText("/*ime-α*/", 1)); assertTrue(editor.hasComposingText())
                editor.setSelectionRegion(2, 0, 2, 6, false); editor.scroller.forceFinished(true); editor.scroller.startScroll(0, 240, 0, 0, 0); editor.scroller.abortAnimation()
                oldActivityRef = WeakReference(activity); oldEditorRef = WeakReference(editor)
                doc.detach(editor); assertFalse(editor.hasComposingText()); assertFalse(doc.content.isInBatchEdit)
                assertContentEquals(expectedPostImeBytes, doc.snapshotBytes())
                (editor.parent as? ViewGroup)?.removeView(editor)
            }
            editor1 = null; scenario.recreate()
            scenario.onActivity { editor2 = mountEditor(it, doc) }; awaitEditorReady(scenario, assertNotNull(editor2))
            scenario.onActivity {
                val newEditor = assertNotNull(editor2).also { doc.restoreViewState(it) }
                assertEquals(240, newEditor.offsetY); assertEquals(2, newEditor.cursor.leftLine); assertEquals(6, newEditor.cursor.rightColumn)
                assertTrue(newEditor.canUndo()); assertContentEquals(expectedPostImeBytes, doc.snapshotBytes())
                newEditor.undo(); newEditor.undo(); assertFalse(doc.isDirty)
                assertContentEquals(("// b1\n" + baseLines).encodeToByteArray(), doc.snapshotBytes())
                newEditor.undo(); assertTrue(doc.isDirty); doc.content.insert(0, 0, "// branch\n"); assertFalse(newEditor.canRedo()); assertTrue(doc.isDirty)
                assertTrue(doc.find(newEditor, "Line10", forward = true)); assertEquals(10, newEditor.cursor.leftLine)
                assertTrue(doc.find(newEditor, "Line2", forward = false)); assertEquals(2, newEditor.cursor.leftLine)
                newEditor.isEditable = false; assertFalse(newEditor.isEditable); assertNull(newEditor.onCreateInputConnection(EditorInfo())); newEditor.isEditable = true
                newEditor.setEditorLanguage(EmptyLanguage())
                val boundaryLine = "a".repeat(4095) + "🚀" + "b".repeat(100) + "\r\nline 2"
                doc.replaceFromLoad(boundaryLine)
                assertFalse(doc.isDirty); assertFalse(newEditor.canUndo()); assertEquals(1, doc.replaceCount)
                assertContentEquals(boundaryLine.encodeToByteArray(), doc.snapshotBytes())
                doc.detach(newEditor); (newEditor.parent as? ViewGroup)?.removeView(newEditor)
            }
            editor2 = null; awaitCleared(oldEditorRef, "Detached CodeEditor"); awaitCleared(oldActivityRef, "Recreated ComponentActivity")
            doc.close()
        }
        val batchDoc = RetainedNativeDoc("init", maxUndo = 10, maxUndoBytes = 4)
        batchDoc.content.beginBatchEdit(); batchDoc.content.insert(0, 0, "ABC"); batchDoc.content.insert(0, 3, "x"); batchDoc.content.endBatchEdit()
        batchDoc.markSaved(); assertFalse(batchDoc.isDirty); assertEquals(2, batchDoc.undoStackBytes)
        assertTrue(batchDoc.undo()); assertTrue(batchDoc.isDirty); assertContentEquals("ABCinit".encodeToByteArray(), batchDoc.snapshotBytes())
        assertTrue(batchDoc.redo()); assertFalse(batchDoc.isDirty); assertContentEquals("ABCxinit".encodeToByteArray(), batchDoc.snapshotBytes())
        batchDoc.close()
    }

    private fun usedBytes(): Long {
        val rt = Runtime.getRuntime(); System.gc(); System.runFinalization(); Thread.sleep(25); return rt.totalMemory() - rt.freeMemory()
    }

    private fun run1MiBScope(near1MiB: String): Pair<WeakReference<Content>, String> {
        val base1 = usedBytes()
        val doc1 = RetainedNativeDoc(near1MiB, maxUndo = 200, maxUndoBytes = 1000)
        val ref = WeakReference(doc1.content)
        doc1.markSaved(); repeat(210) { i -> doc1.content.insert(0, 0, "x$i") }
        val mem1 = (usedBytes() - base1).coerceAtLeast(0L); val undo1 = doc1.undoStackBytes
        assertEquals(1000, undo1)
        val snap1 = doc1.snapshotBytes(); val postSnap1 = (usedBytes() - base1).coerceAtLeast(mem1)
        assertTrue(snap1.contentEquals(((209 downTo 0).joinToString("") { "x$it" } + near1MiB).encodeToByteArray()))
        var undos1 = 0; while (doc1.undo()) undos1++; assertEquals(130, undos1); assertTrue(doc1.isDirty)
        doc1.content.replace(0, 0, 0, 4, "ABCD"); assertEquals(16, doc1.undoStackBytes)
        doc1.content.insert(0, 0, "Z".repeat(600)); assertEquals(0, doc1.undoStackBytes); assertFalse(doc1.content.canUndo())
        doc1.close()
        return ref to "mem1MiB=$mem1 postSnap1=$postSnap1 undo1=$undo1"
    }

    private fun run5MiBScope(near5MiB: String): Pair<WeakReference<Content>, String> {
        val base5 = usedBytes()
        val doc5 = RetainedNativeDoc(near5MiB, maxUndo = 50, maxUndoBytes = 2048)
        val ref = WeakReference(doc5.content)
        doc5.markSaved(); repeat(55) { i -> doc5.content.insert(0, 0, "y$i") }
        val mem5 = (usedBytes() - base5).coerceAtLeast(0L); val undo5 = doc5.undoStackBytes
        assertEquals(290, undo5)
        val snap5 = doc5.snapshotBytes(); val postSnap5 = (usedBytes() - base5).coerceAtLeast(mem5)
        assertTrue(snap5.contentEquals(((54 downTo 0).joinToString("") { "y$it" } + near5MiB).encodeToByteArray()))
        var undos5 = 0; while (doc5.undo()) undos5++; assertEquals(50, undos5); assertTrue(doc5.isDirty)
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
