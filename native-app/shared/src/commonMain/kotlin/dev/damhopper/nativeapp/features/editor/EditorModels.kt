package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.serialization.Serializable

/**
 * Position in a text document (1-indexed line and column).
 */
@Serializable
data class TextPosition(
    val line: Int = 1,
    val column: Int = 1,
) {
    init {
        require(line >= 1) { "line must be >= 1: $line" }
        require(column >= 1) { "column must be >= 1: $column" }
    }
}

/**
 * Text range spanning from [start] to [end].
 */
@Serializable
data class TextRange(
    val start: TextPosition,
    val end: TextPosition,
)

/**
 * Text edit representing a replacement of text inside [range] with [newText].
 */
@Serializable
data class TextEdit(
    val range: TextRange,
    val newText: String,
)

/**
 * Gutter decoration representation for errors, warnings, git status, or breakpoints.
 */
data class GutterDecoration(
    val line: Int,
    val icon: String? = null,
    val colorHex: String? = null,
    val tooltip: String? = null,
)

/**
 * In-document Find and Replace state.
 */
data class FindReplaceState(
    val searchQuery: String = "",
    val replaceQuery: String = "",
    val caseSensitive: Boolean = false,
    val matches: List<TextRange> = emptyList(),
    val currentMatchIndex: Int = -1,
    val isOpen: Boolean = false,
) {
    val totalMatches: Int get() = matches.size
    val currentMatch: TextRange?
        get() = if (currentMatchIndex in matches.indices) matches[currentMatchIndex] else null
}

/**
 * Generates a qualified composite tab key across profiles, projects, worktrees, and paths.
 * Guarantees that identical file paths across different profiles or worktrees do not collide.
 */
fun buildEditorTabKey(
    kind: String = "file",
    profileId: String,
    project: String,
    worktreePath: String? = null,
    path: String,
): String {
    val cleanWorktree = worktreePath?.ifBlank { null } ?: "."
    return "$kind::$profileId::$project::$cleanWorktree::$path"
}

/**
 * Active tab state in the editor panel.
 */
data class EditorTab(
    val key: String,
    val profileId: String,
    val target: ProjectTargetRef,
    val path: String,
    val name: String,
    val mtime: Long, // Server mtime in Unix seconds (or ms as reported by server)
    val size: Long,
    val tier: FileTier,
    val mime: String? = null,
    val content: String = "",
    val savedContent: String = "",
    val submittedContent: String? = null, // In-flight submitted bytes snapshot during save
    val binaryBase64: String? = null,
    val isDirty: Boolean = false,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val isConflicted: Boolean = false,
    val isStale: Boolean = false,
    val targetAvailable: Boolean = true,
    val error: String? = null,
    val cursorPosition: TextPosition = TextPosition(1, 1),
    val selection: TextRange? = null,
    val scrollLine: Int = 1,
    val hydrated: Boolean = false,
    val sessionIncarnation: Long = 1L,
    val modelVersion: Long = 1L,
    val editEpoch: Long = 1L,
    val largeFileOffset: Long = 0L,
    val largeFileEof: Boolean = false,
    val markdownPreviewMode: Boolean = false,
    val encryptedSessionRequired: Boolean = false,
    val diagnostics: List<Diagnostic> = emptyList(),
    val rangeWindow: BoundedRangeWindow? = null,
) {
    val displayName: String
        get() = if (isDirty) "$name *" else name
}

/**
 * Persistable tab metadata.
 * INVARIANT: Dirty content, in-memory buffers, and secret tokens are strictly excluded.
 */
@Serializable
data class PersistedTabMetadata(
    val key: String,
    val profileId: String,
    val project: String,
    val worktreePath: String? = null,
    val path: String,
    val name: String,
    val tier: String,
    val scrollLine: Int = 1,
    val cursorLine: Int = 1,
    val cursorColumn: Int = 1,
)
