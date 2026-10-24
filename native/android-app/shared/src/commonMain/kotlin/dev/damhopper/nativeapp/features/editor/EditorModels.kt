package dev.damhopper.nativeapp.features.editor

import androidx.compose.runtime.compositionLocalOf
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.serialization.Serializable
import dev.damhopper.nativeapp.features.workspace.DocumentId

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

    /** Single preview-mode state shared by Markdown and HTML previews; aliases [markdownPreviewMode]. */
    val previewMode: Boolean get() = markdownPreviewMode
}

/** Maximum preview snapshot capture size in UTF-16 code units (1 MiB, matching FileTierPolicy.NORMAL_MAX_BYTES). */
const val PREVIEW_SNAPSHOT_MAX_CHARS: Int = 1_048_576

/** Maximum displayed text length in HTML reader view. */
const val PREVIEW_READER_DISPLAY_MAX_CHARS: Int = 262_144

/** Banner shown when a preview was derived from a truncated snapshot. */
const val PREVIEW_TRUNCATION_NOTICE: String =
    "Preview truncated to 262,144 characters; view source for complete file."
/**
 * Immutable, bounded text snapshot consumed by preview renderers.
 * Previews never own text; they render a snapshot tagged with the (documentId, revision) it came from.
 */
data class DocumentPreviewSnapshot(
    val documentId: DocumentId,
    val revision: Long,
    val text: String,
    val isTruncated: Boolean,
) {
    /** True only when this snapshot still describes the given document at the given revision. */
    fun isCurrentFor(documentId: DocumentId, revision: Long): Boolean =
        this.documentId == documentId && this.revision == revision
}

/** Supplies a snapshot of the active document capped at [maxChars] UTF-16 code units; null when none. */
typealias DocumentSnapshotProvider = (maxChars: Int) -> DocumentPreviewSnapshot?

val LocalDocumentSnapshotProvider = compositionLocalOf<DocumentSnapshotProvider?> { null }

/**
 * Caps [text] at [maxChars] UTF-16 code units. A trailing high surrogate left by the cut is dropped so the
 * result never ends in half a code point. Returns [text] itself when it already fits.
 */
fun capPreviewText(text: String, maxChars: Int): String {
    val cap = maxChars.coerceAtLeast(0)
    if (text.length <= cap) return text
    var end = cap
    if (end > 0 && text[end - 1].isHighSurrogate()) end--
    return text.substring(0, end)
}

/** Builds a snapshot capped at [maxChars] UTF-16 code units; [DocumentPreviewSnapshot.isTruncated] reflects the cut. */
fun buildPreviewSnapshot(
    documentId: DocumentId,
    revision: Long,
    text: String,
    maxChars: Int,
): DocumentPreviewSnapshot {
    val capped = capPreviewText(text, maxChars)
    return DocumentPreviewSnapshot(documentId, revision, capped, isTruncated = capped.length != text.length)
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
