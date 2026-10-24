package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.DocumentId

/**
 * Retained document editing session.
 * Delegates text storage, undo/redo history, selection, search, and save-point
 * baseline tracking directly to an injected [EditorDocument] authority.
 * Holds only metadata, revision/mtime tracking, and caller listeners.
 */
class EditorSession(
    val document: EditorDocument,
    key: String,
    val profileId: String,
    val target: ProjectTargetRef,
    path: String,
    val sessionIncarnation: Long = 1L,
    initialMtime: Long? = null,
    val isReadOnly: Boolean = false,
) : AutoCloseable {

    var key: String = key; private set
    var path: String = path; private set
    var isFrozen: Boolean = false
    val isInputPermitted: Boolean get() = !isFrozen && isInputAllowed()

    var serverMtime: Long? = initialMtime; private set
    var submittedSnapshot: DocumentSaveSnapshot? = null; private set
    var submittedEpoch: Long? = null; private set
    var editEpoch: Long = 1L; private set
    var isDisposed: Boolean = false; private set

    var cursorPosition: TextPosition = TextPosition(1, 1); private set
    var selection: TextRange? = null; private set
    var scrollLine: Int = 1; private set
    var gutterDecorations: List<GutterDecoration> = emptyList(); private set
    var findReplaceState: FindReplaceState = FindReplaceState(); private set

    var isInputAllowed: () -> Boolean = { true }
    private var onContentChangeListener: ((text: String, modelVersion: Long, editEpoch: Long) -> Unit)? = null

    val id: DocumentId get() = document.id
    val isDirty: Boolean get() = !isDisposed && document.isDirty.value
    fun canUndo(): Boolean = !isDisposed && !isReadOnly && document.canUndo.value
    fun canRedo(): Boolean = !isDisposed && !isReadOnly && document.canRedo.value
    val revision: Long get() = document.revision.value
    val modelVersion: Long get() = document.revision.value
    val length: Int get() = document.length.value
    val lineCount: Int get() = document.lineCount.value

    val savedContent: String
        get() = getText()

    val submittedContent: String?
        get() = submittedSnapshot?.utf8Bytes?.decodeToString()

    fun setOnContentChangeListener(l: (text: String, modelVersion: Long, editEpoch: Long) -> Unit) {
        onContentChangeListener = l
    }

    fun getText(): String {
        checkNotDisposed()
        return document.snapshotForSave().utf8Bytes.decodeToString()
    }

    fun setText(newText: String, newModelVersion: Long = modelVersion + 1L) {
        checkNotDisposed()
        if (isReadOnly || !isInputPermitted) return
        document.applyEdit(1, 1, maxOf(1, lineCount), maxOf(1, length + 1), newText)
        editEpoch++
        cursorPosition = TextPosition(1, 1)
        selection = null
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
    }

    fun loadServerContent(text: String, mtime: Long?, initialModelVersion: Long = 1L) {
        checkNotDisposed()
        document.replaceFromLoad(text, mtime ?: 0L)
        serverMtime = mtime
        submittedSnapshot = null
        submittedEpoch = null
        editEpoch++
        cursorPosition = TextPosition(1, 1)
        selection = null
        onContentChangeListener?.invoke(text, modelVersion, editEpoch)
    }

    fun beginSave(): Pair<String, Long>? {
        checkNotDisposed()
        if (isReadOnly || !isDirty || !isInputAllowed()) return null
        val snapshot = document.snapshotForSave()
        submittedSnapshot = snapshot
        submittedEpoch = editEpoch
        return Pair(snapshot.utf8Bytes.decodeToString(), editEpoch)
    }

    fun snapshotSave(): DocumentSaveSnapshot? {
        checkNotDisposed()
        if (isReadOnly || !isDirty || !isInputAllowed()) return null
        val snapshot = document.snapshotForSave()
        submittedSnapshot = snapshot
        submittedEpoch = editEpoch
        return snapshot
    }

    fun completeSave(savedMtime: Long, submittedSnapshot: String) {
        checkNotDisposed()
        val snapshot = this.submittedSnapshot
        val rev = snapshot?.revision ?: document.revision.value
        document.markSaved(rev, savedMtime)
        serverMtime = savedMtime
        this.submittedSnapshot = null
        submittedEpoch = null
        editEpoch++
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
    }

    fun completeSave(savedMtime: Long, snapshot: DocumentSaveSnapshot) {
        checkNotDisposed()
        document.markSaved(snapshot.revision, savedMtime)
        serverMtime = savedMtime
        submittedSnapshot = null
        submittedEpoch = null
        editEpoch++
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
    }

    fun abortSave() {
        submittedSnapshot = null
        submittedEpoch = null
    }

    fun rekey(newKey: String, newPath: String) {
        checkNotDisposed()
        key = newKey
        path = newPath
        document.rekey(newPath)
    }

    fun undo(): Boolean {
        checkNotDisposed()
        if (!canUndo() || !isInputPermitted) return false
        document.undo()
        editEpoch++
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
        return true
    }

    fun redo(): Boolean {
        checkNotDisposed()
        if (!canRedo() || !isInputPermitted) return false
        document.redo()
        editEpoch++
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
        return true
    }

    fun applyEdit(edit: TextEdit) {
        checkNotDisposed()
        if (isReadOnly || !isInputPermitted) return
        document.applyEdit(
            startLine = edit.range.start.line,
            startCol = edit.range.start.column,
            endLine = edit.range.end.line,
            endCol = edit.range.end.column,
            replacement = edit.newText
        )
        editEpoch++
        cursorPosition = edit.range.end
        selection = null
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
    }

    fun setCursorAndSelection(cursor: TextPosition, sel: TextRange? = null) {
        checkNotDisposed()
        cursorPosition = cursor
        selection = sel
        document.setSelection(cursor.line, cursor.column, sel?.end?.line ?: cursor.line, sel?.end?.column ?: cursor.column)
    }

    fun setScrollLine(line: Int) {
        checkNotDisposed()
        scrollLine = maxOf(1, line)
    }

    fun setGutterDecorations(decorations: List<GutterDecoration>) {
        checkNotDisposed()
        gutterDecorations = decorations
    }

    fun openFindReplace(query: String = "", caseSensitive: Boolean = false) {
        checkNotDisposed()
        findReplaceState = findReplaceState.copy(searchQuery = query, caseSensitive = caseSensitive, isOpen = true)
        refreshMatches()
    }

    fun closeFindReplace() {
        findReplaceState = findReplaceState.copy(isOpen = false)
    }

    fun setFindQuery(q: String, cs: Boolean = findReplaceState.caseSensitive) {
        checkNotDisposed()
        findReplaceState = findReplaceState.copy(searchQuery = q, caseSensitive = cs)
        refreshMatches()
    }

    fun setReplaceQuery(rq: String) {
        checkNotDisposed()
        findReplaceState = findReplaceState.copy(replaceQuery = rq)
    }

    private fun refreshMatches() {
        val q = findReplaceState.searchQuery
        if (q.isEmpty()) {
            findReplaceState = findReplaceState.copy(matches = emptyList(), currentMatchIndex = -1)
            return
        }
        document.find(q, ignoreCase = !findReplaceState.caseSensitive)
        val currentText = getText()
        val found = mutableListOf<TextRange>()
        var idx = 0
        while (idx < currentText.length) {
            val matchStart = currentText.indexOf(q, idx, ignoreCase = !findReplaceState.caseSensitive)
            if (matchStart < 0) break
            val (sLine, sCol) = offsetToLineCol(currentText, matchStart)
            val (eLine, eCol) = offsetToLineCol(currentText, matchStart + q.length)
            found.add(TextRange(TextPosition(sLine, sCol), TextPosition(eLine, eCol)))
            idx = matchStart + q.length
        }
        findReplaceState = findReplaceState.copy(matches = found, currentMatchIndex = if (found.isNotEmpty()) 0 else -1)
    }

    fun findNext(): TextRange? {
        checkNotDisposed()
        val found = document.nextMatch()
        if (!found) return null
        val vs = document.viewState.value
        val range = TextRange(TextPosition(vs.cursorLine, vs.cursorColumn), TextPosition(vs.cursorLine, vs.cursorColumn))
        cursorPosition = range.end
        selection = range
        return range
    }

    fun findPrevious(): TextRange? {
        checkNotDisposed()
        val found = document.previousMatch()
        if (!found) return null
        val vs = document.viewState.value
        val range = TextRange(TextPosition(vs.cursorLine, vs.cursorColumn), TextPosition(vs.cursorLine, vs.cursorColumn))
        cursorPosition = range.end
        selection = range
        return range
    }

    fun replaceCurrent(): Boolean {
        if (isReadOnly || !isInputAllowed()) return false
        val q = findReplaceState.searchQuery
        val rq = findReplaceState.replaceQuery
        if (q.isEmpty()) return false
        val currentText = getText()
        val idx = currentText.indexOf(q, ignoreCase = !findReplaceState.caseSensitive)
        if (idx < 0) return false
        val (startLine, startCol) = offsetToLineCol(currentText, idx)
        val (endLine, endCol) = offsetToLineCol(currentText, idx + q.length)
        applyEdit(TextEdit(TextRange(TextPosition(startLine, startCol), TextPosition(endLine, endCol)), rq))
        findNext()
        return true
    }

    fun replaceAll(): Int {
        if (isReadOnly || !isInputAllowed()) return 0
        val q = findReplaceState.searchQuery
        val rq = findReplaceState.replaceQuery
        if (q.isEmpty()) return 0
        val currentText = getText()
        var count = 0
        var idx = 0
        while (idx < currentText.length) {
            val matchStart = currentText.indexOf(q, idx, ignoreCase = !findReplaceState.caseSensitive)
            if (matchStart < 0) break
            count++
            idx = matchStart + q.length
        }
        if (count > 0) {
            val replaced = currentText.replace(q, rq, ignoreCase = !findReplaceState.caseSensitive)
            setText(replaced)
        }
        return count
    }

    private fun offsetToLineCol(str: String, offset: Int): Pair<Int, Int> {
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

    private fun checkNotDisposed() {
        check(!isDisposed) { "EditorSession $key is disposed" }
    }

    override fun close() {
        if (isDisposed) return
        isDisposed = true
        document.close()
        gutterDecorations = emptyList()
        onContentChangeListener = null
    }
}
