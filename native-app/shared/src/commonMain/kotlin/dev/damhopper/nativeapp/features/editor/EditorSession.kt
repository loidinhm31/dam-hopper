package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef

/**
 * Core in-memory document editing session.
 * Manages text buffer, bounded undo/redo, text selection, find/replace,
 * model versioning, edit epochs, and submitted-bytes baseline tracking for CAS saves.
 */
class EditorSession(
    val key: String,
    val profileId: String,
    val target: ProjectTargetRef,
    val path: String,
    val sessionIncarnation: Long = 1L,
    initialContent: String = "",
    initialMtime: Long? = null,
    val isReadOnly: Boolean = false,
) : AutoCloseable {

    private var content: StringBuilder = StringBuilder(initialContent)
    private val undoManager = EditorUndoManager()

    var serverMtime: Long? = initialMtime; private set
    var savedContent: String = initialContent; private set
    var submittedContent: String? = null; private set
    var submittedEpoch: Long? = null; private set
    var modelVersion: Long = 1L; private set
    var editEpoch: Long = 1L; private set
    var isDirty: Boolean = (initialContent != savedContent); private set
    var isDisposed: Boolean = false; private set
    var cursorPosition: TextPosition = TextPosition(1, 1); private set
    var selection: TextRange? = null; private set
    var scrollLine: Int = 1; private set
    var gutterDecorations: List<GutterDecoration> = emptyList(); private set
    var findReplaceState: FindReplaceState = FindReplaceState(); private set

    private var onContentChangeListener: ((text: String, modelVersion: Long, editEpoch: Long) -> Unit)? = null

    init { updateCursorPositionFromOffset(0) }

    fun setOnContentChangeListener(l: (text: String, modelVersion: Long, editEpoch: Long) -> Unit) { onContentChangeListener = l }
    fun getText(): String { checkNotDisposed(); return content.toString() }
    val length: Int get() = content.length
    fun canUndo(): Boolean = !isDisposed && !isReadOnly && undoManager.canUndo
    fun canRedo(): Boolean = !isDisposed && !isReadOnly && undoManager.canRedo

    fun setText(newText: String, newModelVersion: Long = modelVersion + 1L) {
        checkNotDisposed(); if (isReadOnly) return
        undoManager.recordSnapshot(content.toString())
        content.clear(); content.append(newText)
        modelVersion = newModelVersion; editEpoch++
        isDirty = (newText != savedContent)
        updateCursorPositionFromOffset(0); selection = null
        refreshFindMatches()
        onContentChangeListener?.invoke(newText, modelVersion, editEpoch)
    }

    fun loadServerContent(text: String, mtime: Long?, initialModelVersion: Long = 1L) {
        checkNotDisposed(); undoManager.clear()
        content.clear(); content.append(text)
        savedContent = text; submittedContent = null; submittedEpoch = null
        serverMtime = mtime; modelVersion = initialModelVersion; editEpoch++
        isDirty = false
        updateCursorPositionFromOffset(0); selection = null
        refreshFindMatches()
        onContentChangeListener?.invoke(text, modelVersion, editEpoch)
    }

    fun beginSave(): Pair<String, Long>? {
        checkNotDisposed(); if (isReadOnly || !isDirty) return null
        val snapshot = getText()
        submittedContent = snapshot; submittedEpoch = editEpoch
        return Pair(snapshot, editEpoch)
    }

    fun completeSave(savedMtime: Long, submittedSnapshot: String) {
        checkNotDisposed()
        savedContent = submittedSnapshot; serverMtime = savedMtime
        submittedContent = null; submittedEpoch = null
        isDirty = (getText() != savedContent); editEpoch++
        onContentChangeListener?.invoke(getText(), modelVersion, editEpoch)
    }

    fun abortSave() { submittedContent = null; submittedEpoch = null }

    fun undo(): Boolean {
        checkNotDisposed(); if (!canUndo()) return false
        val prev = undoManager.undo(content.toString()) ?: return false
        content.clear(); content.append(prev)
        modelVersion++; editEpoch++; isDirty = (content.toString() != savedContent)
        refreshFindMatches(); onContentChangeListener?.invoke(content.toString(), modelVersion, editEpoch)
        return true
    }

    fun redo(): Boolean {
        checkNotDisposed(); if (!canRedo()) return false
        val next = undoManager.redo(content.toString()) ?: return false
        content.clear(); content.append(next)
        modelVersion++; editEpoch++; isDirty = (content.toString() != savedContent)
        refreshFindMatches(); onContentChangeListener?.invoke(content.toString(), modelVersion, editEpoch)
        return true
    }

    fun applyEdit(edit: TextEdit) {
        checkNotDisposed(); if (isReadOnly) return
        val start = EditorPositionHelper.positionToOffset(content, edit.range.start)
        val end = EditorPositionHelper.positionToOffset(content, edit.range.end)
        if (start > end || start < 0 || end > content.length) return
        undoManager.recordSnapshot(content.toString())
        content.replace(start, end, edit.newText)
        modelVersion++; editEpoch++; isDirty = (content.toString() != savedContent)
        updateCursorPositionFromOffset(start + edit.newText.length); selection = null
        refreshFindMatches(); onContentChangeListener?.invoke(content.toString(), modelVersion, editEpoch)
    }

    fun setCursorAndSelection(cursor: TextPosition, sel: TextRange? = null) {
        checkNotDisposed(); cursorPosition = cursor; selection = sel
    }
    fun setScrollLine(line: Int) { checkNotDisposed(); scrollLine = maxOf(1, line) }
    fun setGutterDecorations(decorations: List<GutterDecoration>) { checkNotDisposed(); gutterDecorations = decorations }

    fun openFindReplace(query: String = "", caseSensitive: Boolean = false) {
        checkNotDisposed()
        findReplaceState = findReplaceState.copy(searchQuery = query, caseSensitive = caseSensitive, isOpen = true)
        refreshFindMatches()
    }
    fun closeFindReplace() { findReplaceState = findReplaceState.copy(isOpen = false) }
    fun setFindQuery(q: String, cs: Boolean = findReplaceState.caseSensitive) {
        checkNotDisposed(); findReplaceState = findReplaceState.copy(searchQuery = q, caseSensitive = cs); refreshFindMatches()
    }
    fun setReplaceQuery(rq: String) { checkNotDisposed(); findReplaceState = findReplaceState.copy(replaceQuery = rq) }

    fun findNext(): TextRange? {
        val matches = findReplaceState.matches; if (matches.isEmpty()) return null
        val nextIdx = (findReplaceState.currentMatchIndex + 1) % matches.size
        findReplaceState = findReplaceState.copy(currentMatchIndex = nextIdx)
        val m = matches[nextIdx]; setCursorAndSelection(m.end, m); return m
    }

    fun findPrevious(): TextRange? {
        val matches = findReplaceState.matches; if (matches.isEmpty()) return null
        val prevIdx = if (findReplaceState.currentMatchIndex <= 0) matches.size - 1 else findReplaceState.currentMatchIndex - 1
        findReplaceState = findReplaceState.copy(currentMatchIndex = prevIdx)
        val m = matches[prevIdx]; setCursorAndSelection(m.end, m); return m
    }

    fun replaceCurrent(): Boolean {
        if (isReadOnly) return false
        val curr = findReplaceState.currentMatch ?: return false
        applyEdit(TextEdit(curr, findReplaceState.replaceQuery)); findNext(); return true
    }

    fun replaceAll(): Int {
        if (isReadOnly) return 0
        val (newText, count) = EditorFindReplaceHelper.replaceAll(
            content.toString(), findReplaceState.searchQuery, findReplaceState.replaceQuery, findReplaceState.caseSensitive
        )
        if (count > 0) setText(newText)
        return count
    }

    private fun refreshFindMatches() {
        val m = EditorFindReplaceHelper.computeMatches(content, findReplaceState.searchQuery, findReplaceState.caseSensitive)
        findReplaceState = findReplaceState.copy(matches = m, currentMatchIndex = -1)
    }

    private fun updateCursorPositionFromOffset(offset: Int) {
        cursorPosition = EditorPositionHelper.offsetToPosition(content, offset)
    }

    private fun checkNotDisposed() { check(!isDisposed) { "EditorSession $key is disposed" } }

    override fun close() {
        if (isDisposed) return
        isDisposed = true; undoManager.clear(); content.clear(); gutterDecorations = emptyList(); onContentChangeListener = null
    }
}
