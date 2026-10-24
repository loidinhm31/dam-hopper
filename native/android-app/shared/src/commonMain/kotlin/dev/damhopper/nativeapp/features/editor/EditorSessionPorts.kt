package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.files.FileOperationOutcome
import dev.damhopper.nativeapp.features.workspace.DocumentId
import kotlinx.coroutines.flow.StateFlow

/**
 * Read-only tab metadata consumed by UI presentation and explorer.
 * Guarantees zero content/savedContent/submittedContent strings in Compose StateFlows.
 */
data class EditorTabMetadata(
    val id: DocumentId,
    val target: ProjectTargetRef,
    val relativePath: String,
    val title: String,
    val isDirty: Boolean,
    val isReadOnly: Boolean,
    val tier: FileTier,
    val currentRevision: Long,
    val savedRevision: Long,
    val serverMtime: Long,
    val isSaving: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null,
    val rangeWindow: BoundedRangeWindow? = null,
)

/**
 * Bounded range window metadata for large/read-only files (at most 64 KiB).
 */
data class BoundedRangeWindow(
    val offset: Long,
    val requestedBytes: Int,
    val receivedBytes: Int,
    val text: String,
    val isEof: Boolean,
    val epoch: Long,
)

/**
 * User choices when attempting to close a dirty tab or departing workspace.
 */
enum class CloseDecision {
    SAVE,
    DISCARD,
    CANCEL,
}

/**
 * Captured close intent preserving exact dirty revision guarded by user decision.
 */
data class CloseIntent(
    val id: DocumentId,
    val dirtyRevision: Long,
    val decision: CloseDecision,
)

/**
 * Choices presented on save conflict (server mtime mismatch).
 */
enum class ConflictResolutionChoice {
    RELOAD,
    EXPLICIT_OVERWRITE,
    CANCEL,
}

/**
 * Port for executing document editing and navigation commands.
 */
interface EditorCommandPort {
    fun undo(id: DocumentId)
    fun redo(id: DocumentId)
    fun find(id: DocumentId, query: String, ignoreCase: Boolean = true): Boolean
    fun nextMatch(id: DocumentId): Boolean
    fun previousMatch(id: DocumentId): Boolean
    fun setSelection(id: DocumentId, startLine: Int, startCol: Int, endLine: Int, endCol: Int)
}

/**
 * Dirty-guard port consumed by explorer mutations and workspace navigation.
 * Validates whether a file or directory subtree contains uncommitted edits.
 */
interface EditorDirtyGuardPort {
    fun isFileDirty(target: ProjectTargetRef, path: String): Boolean
    fun hasDirtyDescendants(target: ProjectTargetRef, dirPath: String): Boolean
    fun getDirtyDocumentIds(target: ProjectTargetRef, path: String): List<DocumentId>
}

/**
 * Port for observing save outcomes without coupling to transport internals.
 */
interface EditorSaveOutcomePort {
    val saveOutcomes: StateFlow<Map<DocumentId, FileOperationOutcome<Long>>>
}

/**
 * Port for managing tab lifecycle and user intent confirmation.
 */
interface EditorTabLifecyclePort {
    val openTabs: StateFlow<List<EditorTabMetadata>>
    val activeTabId: StateFlow<DocumentId?>

    fun requestCloseTab(id: DocumentId): CloseIntent?
    fun confirmClose(intent: CloseIntent)
    fun resolveConflict(id: DocumentId, choice: ConflictResolutionChoice)
}

/**
 * Port for accessing retained document authorities.
 */
interface EditorDocumentAccessPort {
    fun getDocument(id: DocumentId): EditorDocument?
}

/**
 * Port for windowed range requests on large or read-only files.
 */
interface EditorRangeRequestPort {
    suspend fun requestRangeWindow(id: DocumentId, offset: Long, limitBytes: Int = 65_536): BoundedRangeWindow
}

/**
 * Port for executing document saves.
 */
interface EditorSavePort {
    suspend fun saveDocument(id: DocumentId, explicitOverwrite: Boolean = false): FileOperationOutcome<Long>
}
