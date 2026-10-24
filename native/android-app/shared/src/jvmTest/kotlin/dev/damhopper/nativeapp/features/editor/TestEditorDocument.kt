package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.features.workspace.DocumentId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Faithful test double implementing [EditorDocument] for JVM unit tests.
 * Maintains an in-memory buffer, bounded undo/redo stack, revision tracking,
 * save-point dirty tracking, and search/selection simulation.
 */
class TestEditorDocument(
    override val id: DocumentId,
    initialText: String,
    initialMtime: Long,
    readOnly: Boolean = false,
    private val maxUndoStackSize: Int = 200,
    private val maxUndoBytes: Long = 2_097_152L, // 2 MiB
) : EditorDocument {

    private var text: StringBuilder = StringBuilder(initialText)
    private var serverMtime: Long = initialMtime
    private var savedRevision: Long = 1L

    private val undoStack: ArrayDeque<String> = ArrayDeque()
    private val redoStack: ArrayDeque<String> = ArrayDeque()
    private var currentUndoBytes: Long = 0L

    private val _revision = MutableStateFlow(1L)
    override val revision: StateFlow<Long> = _revision.asStateFlow()

    private val _length = MutableStateFlow(initialText.length)
    override val length: StateFlow<Int> = _length.asStateFlow()

    private val _lineCount = MutableStateFlow(calculateLineCount(initialText))
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

    private var matches: List<Pair<Int, Int>> = emptyList() // startOffset, endOffset
    private var currentMatchIndex: Int = -1
    private var isClosed = false

    fun getText(): String = text.toString()

    override fun applyEdit(
        startLine: Int,
        startCol: Int,
        endLine: Int,
        endCol: Int,
        replacement: String,
        sourceToken: String?
    ) {
        checkNotClosed()
        if (_isReadOnly.value) return

        val currentStr = text.toString()
        val startOffset = positionToOffset(currentStr, startLine, startCol)
        val endOffset = positionToOffset(currentStr, endLine, endCol)
        if (startOffset > endOffset || startOffset < 0 || endOffset > text.length) return

        pushUndoSnapshot(currentStr)
        text.replace(startOffset, endOffset, replacement)
        updateStateAfterEdit()
    }

    fun setText(newText: String) {
        checkNotClosed()
        if (_isReadOnly.value) return
        pushUndoSnapshot(text.toString())
        text.clear()
        text.append(newText)
        updateStateAfterEdit()
    }

    private fun updateStateAfterEdit() {
        redoStack.clear()
        _canRedo.value = false

        val newRev = _revision.value + 1L
        _revision.value = newRev
        _length.value = text.length
        _lineCount.value = calculateLineCount(text.toString())
        _isDirty.value = (newRev != savedRevision)

        _events.tryEmit(
            DocumentEvent.ContentChanged(
                revision = newRev,
                length = text.length,
                lineCount = _lineCount.value,
                isDirty = _isDirty.value,
                canUndo = _canUndo.value,
                canRedo = _canRedo.value,
            )
        )
    }

    override fun rekey(newPath: String) {
        // DocumentId rekeying handled via port
    }

    override fun undo() {
        checkNotClosed()
        if (_isReadOnly.value || undoStack.isEmpty()) return

        val currentStr = text.toString()
        val prev = undoStack.removeLast()
        currentUndoBytes -= (prev.length * 2L)
        redoStack.addLast(currentStr)
        _canRedo.value = true

        text.clear()
        text.append(prev)

        val newRev = _revision.value + 1L
        _revision.value = newRev
        _length.value = text.length
        _lineCount.value = calculateLineCount(prev)
        _canUndo.value = undoStack.isNotEmpty()
        _isDirty.value = (newRev != savedRevision && text.toString() != getSavedTextSnapshot())

        _events.tryEmit(
            DocumentEvent.ContentChanged(
                revision = newRev,
                length = text.length,
                lineCount = _lineCount.value,
                isDirty = _isDirty.value,
                canUndo = _canUndo.value,
                canRedo = _canRedo.value,
            )
        )
    }

    override fun redo() {
        checkNotClosed()
        if (_isReadOnly.value || redoStack.isEmpty()) return

        val currentStr = text.toString()
        val next = redoStack.removeLast()
        pushUndoSnapshot(currentStr)

        text.clear()
        text.append(next)

        val newRev = _revision.value + 1L
        _revision.value = newRev
        _length.value = text.length
        _lineCount.value = calculateLineCount(next)
        _canRedo.value = redoStack.isNotEmpty()
        _isDirty.value = (newRev != savedRevision && text.toString() != getSavedTextSnapshot())

        _events.tryEmit(
            DocumentEvent.ContentChanged(
                revision = newRev,
                length = text.length,
                lineCount = _lineCount.value,
                isDirty = _isDirty.value,
                canUndo = _canUndo.value,
                canRedo = _canRedo.value,
            )
        )
    }

    private var savedTextSnapshot: String = initialText
    private fun getSavedTextSnapshot(): String = savedTextSnapshot

    private fun pushUndoSnapshot(snapshot: String) {
        val bytes = snapshot.length * 2L
        while (undoStack.size >= maxUndoStackSize || (currentUndoBytes + bytes > maxUndoBytes && undoStack.isNotEmpty())) {
            val removed = undoStack.removeFirst()
            currentUndoBytes -= (removed.length * 2L)
        }
        undoStack.addLast(snapshot)
        currentUndoBytes += bytes
        _canUndo.value = true
    }

    override fun find(query: String, ignoreCase: Boolean, startLine: Int, startCol: Int): Boolean {
        checkNotClosed()
        if (query.isEmpty()) {
            matches = emptyList()
            currentMatchIndex = -1
            return false
        }
        val currentStr = text.toString()
        val found = mutableListOf<Pair<Int, Int>>()
        var idx = 0
        while (idx < currentStr.length) {
            val matchStart = currentStr.indexOf(query, idx, ignoreCase)
            if (matchStart < 0) break
            found.add(Pair(matchStart, matchStart + query.length))
            idx = matchStart + query.length
        }
        matches = found
        currentMatchIndex = if (found.isNotEmpty()) 0 else -1
        return found.isNotEmpty()
    }

    override fun nextMatch(): Boolean {
        checkNotClosed()
        if (matches.isEmpty()) return false
        currentMatchIndex = (currentMatchIndex + 1) % matches.size
        val (start, end) = matches[currentMatchIndex]
        val pos = offsetToPosition(text.toString(), start)
        _viewState.value = _viewState.value.copy(
            cursorLine = pos.first,
            cursorColumn = pos.second,
            selectionStart = start,
            selectionEnd = end
        )
        return true
    }

    override fun previousMatch(): Boolean {
        checkNotClosed()
        if (matches.isEmpty()) return false
        currentMatchIndex = if (currentMatchIndex <= 0) matches.size - 1 else currentMatchIndex - 1
        val (start, end) = matches[currentMatchIndex]
        val pos = offsetToPosition(text.toString(), start)
        _viewState.value = _viewState.value.copy(
            cursorLine = pos.first,
            cursorColumn = pos.second,
            selectionStart = start,
            selectionEnd = end
        )
        return true
    }

    override fun setSelection(startLine: Int, startCol: Int, endLine: Int, endCol: Int) {
        checkNotClosed()
        val currentStr = text.toString()
        val startOffset = positionToOffset(currentStr, startLine, startCol)
        val endOffset = positionToOffset(currentStr, endLine, endCol)
        _viewState.value = _viewState.value.copy(
            cursorLine = endLine,
            cursorColumn = endCol,
            selectionStart = startOffset,
            selectionEnd = endOffset
        )
        _events.tryEmit(
            DocumentEvent.SelectionChanged(
                cursorLine = endLine,
                cursorColumn = endCol,
                selectionStart = startOffset,
                selectionEnd = endOffset
            )
        )
    }

    override fun setReadOnly(readOnly: Boolean) {
        checkNotClosed()
        _isReadOnly.value = readOnly
    }

    override fun replaceFromLoad(text: String, expectedMtime: Long) {
        checkNotClosed()
        undoStack.clear()
        redoStack.clear()
        currentUndoBytes = 0L
        _canUndo.value = false
        _canRedo.value = false

        this.text.clear()
        this.text.append(text)
        this.serverMtime = expectedMtime
        this.savedTextSnapshot = text

        val newRev = _revision.value + 1L
        this.savedRevision = newRev
        _revision.value = newRev
        _length.value = text.length
        _lineCount.value = calculateLineCount(text)
        _isDirty.value = false

        _events.tryEmit(
            DocumentEvent.Replaced(
                newRevision = newRev,
                length = text.length,
                lineCount = _lineCount.value
            )
        )
    }

    override fun snapshotForSave(): DocumentSaveSnapshot {
        checkNotClosed()
        return DocumentSaveSnapshot(
            id = id,
            revision = _revision.value,
            utf8Bytes = text.toString().encodeToByteArray(),
            mtime = serverMtime
        )
    }

    override fun markSaved(savedRevision: Long, newMtime: Long) {
        checkNotClosed()
        this.serverMtime = newMtime
        this.savedRevision = savedRevision
        this.savedTextSnapshot = text.toString()
        _isDirty.value = (_revision.value != savedRevision)
    }

    override fun captureViewState(viewState: DocumentViewState) {
        checkNotClosed()
        _viewState.value = viewState
    }

    override fun getBudgetMetrics(): DocumentBudgetMetrics {
        val utf8 = text.toString().encodeToByteArray().size.toLong()
        return DocumentBudgetMetrics(
            utf8Length = utf8,
            undoStackBytes = currentUndoBytes,
            undoStackSize = undoStack.size,
            inFlightSnapshotBytes = 0L
        )
    }

    override fun detachView() {
        // No-op for test double
    }

    override fun close() {
        if (isClosed) return
        isClosed = true
        undoStack.clear()
        redoStack.clear()
        text.clear()
        _events.tryEmit(DocumentEvent.Closed(id))
    }

    private fun checkNotClosed() {
        check(!isClosed) { "Document $id is closed" }
    }

    companion object {
        fun calculateLineCount(str: String): Int {
            if (str.isEmpty()) return 1
            var count = 1
            for (ch in str) {
                if (ch == '\n') count++
            }
            return count
        }

        fun positionToOffset(str: String, line: Int, col: Int): Int {
            val targetLine = maxOf(1, line)
            val targetCol = maxOf(1, col)
            var currentLine = 1
            var currentOffset = 0
            while (currentOffset < str.length && currentLine < targetLine) {
                if (str[currentOffset] == '\n') currentLine++
                currentOffset++
            }
            return (currentOffset + targetCol - 1).coerceIn(0, str.length)
        }

        fun offsetToPosition(str: String, offset: Int): Pair<Int, Int> {
            val clamped = offset.coerceIn(0, str.length)
            var line = 1
            var lastLineStart = 0
            for (i in 0 until clamped) {
                if (str[i] == '\n') {
                    line++
                    lastLineStart = i + 1
                }
            }
            return Pair(line, clamped - lastLineStart + 1)
        }
    }
}

/**
 * Factory creating [TestEditorDocument] instances.
 */
class TestEditorDocumentFactory : EditorDocumentFactory {
    override fun createDocument(
        id: DocumentId,
        initialText: String,
        initialMtime: Long,
        readOnly: Boolean,
        maxUndoStackSize: Int,
        maxUndoBytes: Long,
    ): EditorDocument {
        return TestEditorDocument(
            id = id,
            initialText = initialText,
            initialMtime = initialMtime,
            readOnly = readOnly,
            maxUndoStackSize = maxUndoStackSize,
            maxUndoBytes = maxUndoBytes
        )
    }
}
