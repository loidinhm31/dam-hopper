package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.features.workspace.DocumentId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Document lifecycle and modification events emitted on the UI dispatcher.
 */
sealed interface DocumentEvent {
    data class ContentChanged(
        val revision: Long,
        val length: Int,
        val lineCount: Int,
        val isDirty: Boolean,
        val canUndo: Boolean,
        val canRedo: Boolean,
    ) : DocumentEvent

    data class Replaced(
        val newRevision: Long,
        val length: Int,
        val lineCount: Int,
    ) : DocumentEvent

    data class SelectionChanged(
        val cursorLine: Int,
        val cursorColumn: Int,
        val selectionStart: Int,
        val selectionEnd: Int,
    ) : DocumentEvent

    data class Closed(
        val id: DocumentId,
    ) : DocumentEvent
}

/**
 * Immutable view state captured on detach and restored upon widget reattachment.
 */
data class DocumentViewState(
    val cursorLine: Int = 0,
    val cursorColumn: Int = 0,
    val selectionStart: Int = 0,
    val selectionEnd: Int = 0,
    val scrollX: Int = 0,
    val scrollY: Int = 0,
)

/**
 * Immutable save snapshot captured on the UI dispatcher for saving or reconciliation.
 */
data class DocumentSaveSnapshot(
    val id: DocumentId,
    val revision: Long,
    val utf8Bytes: ByteArray,
    val mtime: Long,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DocumentSaveSnapshot) return false
        return id == other.id &&
            revision == other.revision &&
            mtime == other.mtime &&
            utf8Bytes.contentEquals(other.utf8Bytes)
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + revision.hashCode()
        result = 31 * result + mtime.hashCode()
        result = 31 * result + utf8Bytes.contentHashCode()
        return result
    }
}

/**
 * Document retention and memory budget metrics.
 */
data class DocumentBudgetMetrics(
    val utf8Length: Long,
    val undoStackBytes: Long,
    val undoStackSize: Int,
    val inFlightSnapshotBytes: Long = 0L,
) {
    val estimatedRetainedBytes: Long
        get() = (utf8Length * 4L) + undoStackBytes + (inFlightSnapshotBytes * 2L)
}

/**
 * Core interactive document authority.
 * Implemented on Android by subclassing Sora 0.23.4 Content on Android Main dispatcher.
 */
interface EditorDocument {
    val id: DocumentId
    val revision: StateFlow<Long>
    val length: StateFlow<Int>
    val lineCount: StateFlow<Int>
    val isDirty: StateFlow<Boolean>
    val canUndo: StateFlow<Boolean>
    val canRedo: StateFlow<Boolean>
    val isReadOnly: StateFlow<Boolean>
    val viewState: StateFlow<DocumentViewState>
    val events: Flow<DocumentEvent>

    fun applyEdit(startLine: Int, startCol: Int, endLine: Int, endCol: Int, replacement: String, sourceToken: String? = null)
    fun rekey(newPath: String)
    fun undo()
    fun redo()
    fun find(query: String, ignoreCase: Boolean = true, startLine: Int = 0, startCol: Int = 0): Boolean
    fun nextMatch(): Boolean
    fun previousMatch(): Boolean
    fun setSelection(startLine: Int, startCol: Int, endLine: Int, endCol: Int)
    fun setReadOnly(readOnly: Boolean)

    /**
     * Programmatic text replacement from load/reload with source-token suppression.
     * Advances revision, resets undo stack, sets savedRevision = currentRevision.
     */
    fun replaceFromLoad(text: String, expectedMtime: Long)

    /**
     * Captures an immutable save snapshot on the UI dispatcher.
     */
    fun snapshotForSave(): DocumentSaveSnapshot

    /**
     * Marks the current revision as saved (establishes baseline save point).
     */
    fun markSaved(savedRevision: Long, newMtime: Long)

    /**
     * Updates view state (scroll/cursor) upon detach.
     */
    fun captureViewState(viewState: DocumentViewState)

    /**
     * Returns provisional accounted memory and undo budget metrics.
     */
    fun getBudgetMetrics(): DocumentBudgetMetrics

    /**
     * Detaches any attached widget and finishes active IME compositions.
     */
    fun detachView()

    /**
     * Releases retained native Content and listeners.
     */
    fun close()
}

/**
 * Factory for creating qualified EditorDocument instances.
 * Injected from Android platform code (backed by Sora 0.23.4 Content subclass),
 * or from test doubles for pure JVM unit tests.
 */
interface EditorDocumentFactory {
    fun createDocument(
        id: DocumentId,
        initialText: String,
        initialMtime: Long,
        readOnly: Boolean = false,
        maxUndoStackSize: Int = 200,
        maxUndoBytes: Long = 2_097_152L, // 2 MiB logical UTF-16
    ): EditorDocument
}
