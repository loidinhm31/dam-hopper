package dev.damhopper.nativeapp.platform.editor

import io.github.rosemoe.sora.lang.Language
import dev.damhopper.nativeapp.features.editor.DocumentBudgetMetrics
import dev.damhopper.nativeapp.features.editor.DocumentEvent
import dev.damhopper.nativeapp.features.editor.DocumentSaveSnapshot
import dev.damhopper.nativeapp.features.editor.DocumentViewState
import dev.damhopper.nativeapp.features.editor.EditorDocument
import dev.damhopper.nativeapp.features.editor.EditorDocumentFactory
import dev.damhopper.nativeapp.features.workspace.DocumentId
import io.github.rosemoe.sora.event.ContentChangeEvent
import io.github.rosemoe.sora.event.SelectionChangeEvent
import io.github.rosemoe.sora.event.SubscriptionReceipt
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.langs.java.JavaLanguage
import io.github.rosemoe.sora.text.Content
import io.github.rosemoe.sora.text.ContentListener
import io.github.rosemoe.sora.text.TextRange
import io.github.rosemoe.sora.widget.CodeEditor
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Android implementation of [EditorDocument] wrapping Sora Editor's [Content].
 *
 * Implements the single interactive text and undo authority on Android Main dispatcher.
 * Bounded undo stack, revision tracking, incremental delta events, streaming save snapshots,
 * and clean separation from Activity-bound [CodeEditor] views.
 */
class AndroidEditorDocument(
    override val id: DocumentId,
    initialText: String,
    initialMtime: Long,
    readOnly: Boolean = false,
    val maxUndoStackSize: Int = 200,
    val maxUndoBytes: Long = 2_097_152L, // 2 MiB
) : EditorDocument, ContentListener {

    private var nextRev = 1L
    private var stackIndex = 0
    private var savedRev = 1L
    private var serverMtime: Long = initialMtime
    private val revStack = ArrayList<Long>().apply { add(1L) }
    private val payloadBytes = ArrayList<Int>().apply { add(0) }
    private var suppressDelta = false
    private var inReplaceOp = false
    private var batchPushed = false
    private var pendingReplaceDeleteChars = 0
    private var attachedEditor: CodeEditor? = null
    private var receipt: SubscriptionReceipt<ContentChangeEvent>? = null
    private var isClosed = false
    var isInputAllowed: () -> Boolean = { true }

    /** Exact UTF-8 size of the content, maintained incrementally from content listener callbacks. */
    private var utf8Bytes: Long = utf8Size(initialText)

    val content: Content = object : Content(initialText, true) {
        override fun undo(): TextRange? {
            if (_isReadOnly.value || !isInputAllowed() || !canUndo() || isUndoManagerWorking) return null
            return super.undo().also {
                if (stackIndex > 0) stackIndex--
                val curRev = revStack.getOrElse(stackIndex) { 1L }
                publishState(curRev)
            }
        }

        override fun redo() {
            if (_isReadOnly.value || !isInputAllowed() || !canRedo() || isUndoManagerWorking) return
            super.redo()
            if (stackIndex < revStack.lastIndex) stackIndex++
            val curRev = revStack.getOrElse(stackIndex) { 1L }
            publishState(curRev)
        }

        override fun endBatchEdit(): Boolean = super.endBatchEdit().also {
            if (!it) batchPushed = false
        }

        override fun resetBatchEdit() {
            while (isInBatchEdit) endBatchEdit()
            super.resetBatchEdit()
            batchPushed = false
        }
    }.also {
        it.setMaxUndoStackSize(maxUndoStackSize)
        it.addContentListener(this)
    }

    private val _revision = MutableStateFlow(1L)
    override val revision: StateFlow<Long> = _revision.asStateFlow()

    private val _length = MutableStateFlow(content.length)
    override val length: StateFlow<Int> = _length.asStateFlow()

    private val _lineCount = MutableStateFlow(content.lineCount)
    override val lineCount: StateFlow<Int> = _lineCount.asStateFlow()

    private val _isDirty = MutableStateFlow(false)
    override val isDirty: StateFlow<Boolean> = _isDirty.asStateFlow()

    private val _canUndo = MutableStateFlow(false)
    override val canUndo: StateFlow<Boolean> = _canUndo.asStateFlow()

    private val _canRedo = MutableStateFlow(false)
    override val canRedo: StateFlow<Boolean> = _canRedo.asStateFlow()

    private val _isReadOnly = MutableStateFlow(readOnly)
    override val isReadOnly: StateFlow<Boolean> = _isReadOnly.asStateFlow()

    private val _viewState = MutableStateFlow(DocumentViewState())
    override val viewState: StateFlow<DocumentViewState> = _viewState.asStateFlow()

    private val _events = MutableSharedFlow<DocumentEvent>(extraBufferCapacity = 64)
    override val events: Flow<DocumentEvent> = _events.asSharedFlow()

    private var lastQuery: String = ""
    private var lastIgnoreCase: Boolean = true

    private fun evictOldestLedgerEntry() {
        if (revStack.size > 1 && stackIndex > 0) {
            revStack.removeAt(0)
            payloadBytes.removeAt(0)
            if (payloadBytes.isNotEmpty()) payloadBytes[0] = 0
            stackIndex--
        }
    }

    private fun enforceUndoBounds() {
        while (stackIndex > 1 && revStack.size - 1 > maxUndoStackSize) {
            evictOldestLedgerEntry()
        }
        while (stackIndex > 1 && payloadBytes.sum() > maxUndoBytes) {
            content.setMaxUndoStackSize((revStack.size - 2).coerceAtLeast(1))
            evictOldestLedgerEntry()
        }
        content.setMaxUndoStackSize(maxUndoStackSize)
        if (payloadBytes.sum() > maxUndoBytes) {
            val curRev = revStack[stackIndex]
            content.setUndoEnabled(false)
            content.setUndoEnabled(true)
            content.setMaxUndoStackSize(maxUndoStackSize)
            revStack.clear()
            revStack.add(curRev)
            payloadBytes.clear()
            payloadBytes.add(0)
            stackIndex = 0
            batchPushed = false
        }
    }

    private fun recordEditStep(changedChars: Int) {
        if (suppressDelta || content.isUndoManagerWorking) return
        while (revStack.lastIndex > stackIndex) {
            revStack.removeAt(revStack.lastIndex)
            payloadBytes.removeAt(payloadBytes.lastIndex)
        }
        val rev = ++nextRev
        val bytes = changedChars * 2
        if (content.isInBatchEdit) {
            if (!batchPushed) {
                revStack.add(rev)
                payloadBytes.add(bytes)
                stackIndex++
                batchPushed = true
            } else {
                revStack[stackIndex] = rev
                payloadBytes[stackIndex] += bytes
            }
        } else {
            revStack.add(rev)
            payloadBytes.add(bytes)
            stackIndex++
        }
        enforceUndoBounds()
        publishState(rev)
    }

    private fun publishState(rev: Long) {
        _revision.value = rev
        _length.value = content.length
        _lineCount.value = content.lineCount
        _canUndo.value = content.canUndo()
        _canRedo.value = content.canRedo()
        val dirty = rev != savedRev
        _isDirty.value = dirty

        _events.tryEmit(
            DocumentEvent.ContentChanged(
                revision = rev,
                length = content.length,
                lineCount = content.lineCount,
                isDirty = dirty,
                canUndo = _canUndo.value,
                canRedo = _canRedo.value,
            )
        )
    }

    override fun beforeModification(c: Content) {
        if (!c.isInBatchEdit) batchPushed = false
    }

    override fun beforeReplace(c: Content) {
        if (!suppressDelta && !c.isUndoManagerWorking) {
            inReplaceOp = true
            pendingReplaceDeleteChars = 0
        }
    }

    override fun afterDelete(c: Content, sl: Int, sc: Int, el: Int, ec: Int, d: CharSequence) {
        utf8Bytes -= utf8Size(d)
        if (inReplaceOp) {
            pendingReplaceDeleteChars = d.length
        } else {
            recordEditStep(d.length)
        }
    }

    override fun afterInsert(c: Content, sl: Int, sc: Int, el: Int, ec: Int, i: CharSequence) {
        utf8Bytes += utf8Size(i)
        val del = if (inReplaceOp) pendingReplaceDeleteChars else 0
        inReplaceOp = false
        pendingReplaceDeleteChars = 0
        recordEditStep(i.length + del)
    }

    override fun applyEdit(
        startLine: Int,
        startCol: Int,
        endLine: Int,
        endCol: Int,
        replacement: String,
        sourceToken: String?
    ) {
        checkNotClosed()
        if (_isReadOnly.value || !isInputAllowed()) return
        val maxL = maxOf(0, content.lineCount - 1)
        val sl = if (startLine <= 0) 0 else (startLine - 1).coerceIn(0, maxL)
        val sc = if (startCol <= 0) 0 else (startCol - 1).coerceIn(0, content.getColumnCount(sl))
        val el = if (endLine <= 0) 0 else (endLine - 1).coerceIn(0, maxL)
        val ec = if (endCol <= 0) 0 else (endCol - 1).coerceIn(0, content.getColumnCount(el))
        content.replace(sl, sc, el, ec, replacement)
    }

    override fun rekey(newPath: String) {
        // DocumentId rekeying handled via owner ports
    }

    override fun undo() {
        checkNotClosed()
        if (_isReadOnly.value || !isInputAllowed() || !content.canUndo() || content.isUndoManagerWorking) return
        content.undo()
    }

    override fun redo() {
        checkNotClosed()
        if (_isReadOnly.value || !isInputAllowed() || !content.canRedo() || content.isUndoManagerWorking) return
        content.redo()
    }

    override fun find(query: String, ignoreCase: Boolean, startLine: Int, startCol: Int): Boolean {
        checkNotClosed()
        if (query.isEmpty()) return false
        lastQuery = query
        lastIgnoreCase = ignoreCase
        val total = content.lineCount
        if (total == 0) return false
        val maxL = total - 1
        val sl = if (startLine <= 0) 0 else (startLine - 1).coerceIn(0, maxL)
        val sc = if (startCol <= 0) 0 else (startCol - 1).coerceIn(0, content.getColumnCount(sl))

        for (step in 0 until total) {
            val idx = (sl + step) % total
            val line = content.getLine(idx)
            val from = if (step == 0) sc else 0
            val col = if (from <= line.length) line.indexOf(query, from, ignoreCase) else -1
            if (col >= 0) {
                attachedEditor?.setSelectionRegion(idx, col, idx, col + query.length, false, SelectionChangeEvent.CAUSE_SEARCH)
                _viewState.value = _viewState.value.copy(
                    cursorLine = idx,
                    cursorColumn = col + query.length,
                    selectionStart = col,
                    selectionEnd = col + query.length
                )
                return true
            }
        }
        return false
    }

    override fun nextMatch(): Boolean {
        checkNotClosed()
        if (lastQuery.isEmpty()) return false
        val cur = attachedEditor?.cursor
        val nextLine = (cur?.rightLine ?: _viewState.value.cursorLine)
        val nextCol = (cur?.rightColumn ?: _viewState.value.cursorColumn)
        return find(lastQuery, lastIgnoreCase, nextLine + 1, nextCol + 1)
    }

    override fun previousMatch(): Boolean {
        checkNotClosed()
        if (lastQuery.isEmpty()) return false
        val total = content.lineCount
        if (total == 0) return false
        val cur = attachedEditor?.cursor
        val curLine = (cur?.leftLine ?: _viewState.value.cursorLine).coerceIn(0, total - 1)
        val matchStart = cur?.leftColumn ?: _viewState.value.selectionStart

        for (step in 0 until total) {
            val idx = (curLine - step + total * 2) % total
            val line = content.getLine(idx)
            val limit = if (step == 0) (matchStart - 1).coerceAtLeast(-1) else line.length
            var lastMatch = -1
            var pos = 0
            while (pos <= limit) {
                val f = line.indexOf(lastQuery, pos, lastIgnoreCase)
                if (f < 0 || f > limit) break
                lastMatch = f
                pos = f + 1
            }
            if (lastMatch >= 0) {
                attachedEditor?.setSelectionRegion(idx, lastMatch, idx, lastMatch + lastQuery.length, false, SelectionChangeEvent.CAUSE_SEARCH)
                _viewState.value = _viewState.value.copy(
                    cursorLine = idx,
                    cursorColumn = lastMatch + lastQuery.length,
                    selectionStart = lastMatch,
                    selectionEnd = lastMatch + lastQuery.length
                )
                return true
            }
        }
        return false
    }

    override fun setSelection(startLine: Int, startCol: Int, endLine: Int, endCol: Int) {
        checkNotClosed()
        val maxL = maxOf(0, content.lineCount - 1)
        val sl = if (startLine <= 0) 0 else (startLine - 1).coerceIn(0, maxL)
        val sc = if (startCol <= 0) 0 else (startCol - 1).coerceIn(0, content.getColumnCount(sl))
        val el = if (endLine <= 0) 0 else (endLine - 1).coerceIn(0, maxL)
        val ec = if (endCol <= 0) 0 else (endCol - 1).coerceIn(0, content.getColumnCount(el))
        attachedEditor?.setSelectionRegion(sl, sc, el, ec, false)
        _viewState.value = _viewState.value.copy(
            cursorLine = el,
            cursorColumn = ec,
            selectionStart = sc,
            selectionEnd = ec
        )
        _events.tryEmit(
            DocumentEvent.SelectionChanged(
                cursorLine = el,
                cursorColumn = ec,
                selectionStart = sc,
                selectionEnd = ec
            )
        )
    }

    override fun setReadOnly(readOnly: Boolean) {
        checkNotClosed()
        _isReadOnly.value = readOnly
        attachedEditor?.isEditable = !readOnly
    }

    override fun replaceFromLoad(text: String, expectedMtime: Long) {
        checkNotClosed()
        suppressDelta = true
        try {
            content.setUndoEnabled(false)
            if (content.length > 0) {
                val last = content.lineCount - 1
                content.delete(0, 0, last, content.getColumnCount(last))
            }
            if (text.isNotEmpty()) {
                content.insert(0, 0, text)
            }
            content.setUndoEnabled(true)
            content.setMaxUndoStackSize(maxUndoStackSize)
        } finally {
            suppressDelta = false
        }
        val rev = ++nextRev
        revStack.clear()
        revStack.add(rev)
        payloadBytes.clear()
        payloadBytes.add(0)
        stackIndex = 0
        savedRev = rev
        serverMtime = expectedMtime
        batchPushed = false
        publishState(rev)
        _events.tryEmit(
            DocumentEvent.Replaced(
                newRevision = rev,
                length = content.length,
                lineCount = content.lineCount
            )
        )
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
                bBuf.clear()
                enc.flush(bBuf)
                if (bBuf.position() > 0) out.write(bBuf.array(), 0, bBuf.position())
            }
            val sep = line.lineSeparator.content
            if (sep.isNotEmpty()) out.write(sep.encodeToByteArray())
        })
        return out.toByteArray()
    }

    override fun snapshotForSave(): DocumentSaveSnapshot {
        checkNotClosed()
        return DocumentSaveSnapshot(
            id = id,
            revision = _revision.value,
            utf8Bytes = snapshotBytes(),
            mtime = serverMtime
        )
    }

    override fun markSaved(savedRevision: Long, newMtime: Long) {
        checkNotClosed()
        this.serverMtime = newMtime
        this.savedRev = savedRevision
        _isDirty.value = (_revision.value != savedRevision)
    }

    override fun captureViewState(viewState: DocumentViewState) {
        checkNotClosed()
        _viewState.value = viewState
    }

    override fun getBudgetMetrics(): DocumentBudgetMetrics {
        return DocumentBudgetMetrics(
            utf8Length = utf8Bytes,
            undoStackBytes = payloadBytes.sum().toLong(),
            undoStackSize = revStack.size - 1,
            inFlightSnapshotBytes = 0L
        )
    }

    /** Attaches [editor] with the legacy Java/empty language choice; prefer the [Language] overload. */
    fun attachEditor(editor: CodeEditor, useJavaSyntax: Boolean = false) {
        attachEditor(editor, if (useJavaSyntax) JavaLanguage() else EmptyLanguage())
    }

    /** Attaches [editor]; [language] is installed before the text so the analyzer resets on empty content. */
    fun attachEditor(editor: CodeEditor, language: Language) {
        check(!isClosed) { "Cannot attach closed document $id" }
        attachedEditor = editor
        check(editor.isUndoEnabled) { "CodeEditor undoEnabled must be true before setText" }
        editor.setEditorLanguage(language)
        editor.isEditable = !_isReadOnly.value
        editor.setText(content, true, null)
        receipt = editor.subscribeEvent(ContentChangeEvent::class.java) { ev, _ ->
            if (ev.action == ContentChangeEvent.ACTION_SET_NEW_TEXT) return@subscribeEvent
        }
    }

    fun restoreViewState(editor: CodeEditor) {
        val state = _viewState.value
        editor.setSelectionRegion(state.cursorLine, state.selectionStart, state.cursorLine, state.selectionEnd, false)
        editor.scroller.forceFinished(true)
        editor.scroller.startScroll(state.scrollX, state.scrollY, 0, 0, 0)
        editor.scroller.abortAnimation()
        editor.eventHandler.scrollBy(0f, 0f)
    }

    fun detachEditor(editor: CodeEditor) {
        if (editor.hasComposingText()) editor.restartInput()
        content.resetBatchEdit()
        val cur = editor.cursor
        _viewState.value = DocumentViewState(
            cursorLine = cur.leftLine,
            cursorColumn = cur.leftColumn,
            selectionStart = cur.leftColumn,
            selectionEnd = cur.rightColumn,
            scrollX = editor.offsetX,
            scrollY = editor.offsetY
        )
        receipt?.unsubscribe()
        receipt = null
        if (attachedEditor === editor) {
            attachedEditor = null
        }
        editor.hideSoftInput()
        editor.clearFocus()
        editor.release()
    }

    override fun detachView() {
        attachedEditor?.let { detachEditor(it) }
    }

    override fun close() {
        if (isClosed) return
        isClosed = true
        detachView()
        receipt?.unsubscribe()
        receipt = null
        content.removeContentListener(this)
        content.setUndoEnabled(false)
        _events.tryEmit(DocumentEvent.Closed(id))
    }

    private fun checkNotClosed() {
        check(!isClosed) { "Document $id is closed" }
    }
}

/**
 * UTF-8 encoded size of [text]. A surrogate pair counts 2 bytes per UTF-16 unit (4 total, exact);
 * a lone surrogate over-counts by one byte, which keeps the size gate conservative.
 */
internal fun utf8Size(text: CharSequence): Long {
    var bytes = 0L
    for (index in 0 until text.length) {
        val code = text[index].code
        bytes += when {
            code < 0x80 -> 1
            code < 0x800 -> 2
            code in 0xD800..0xDFFF -> 2
            else -> 3
        }
    }
    return bytes
}

/**
 * Android implementation of [EditorDocumentFactory].
 */
class AndroidEditorDocumentFactory : EditorDocumentFactory {
    override fun createDocument(
        id: DocumentId,
        initialText: String,
        initialMtime: Long,
        readOnly: Boolean,
        maxUndoStackSize: Int,
        maxUndoBytes: Long,
    ): EditorDocument = AndroidEditorDocument(
        id = id,
        initialText = initialText,
        initialMtime = initialMtime,
        readOnly = readOnly,
        maxUndoStackSize = maxUndoStackSize,
        maxUndoBytes = maxUndoBytes
    )
}
